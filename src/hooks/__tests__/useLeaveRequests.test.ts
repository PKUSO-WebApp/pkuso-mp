// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useLeaveRequests } from '../useLeaveRequests'

// 模块加载即校验环境变量，直接 mock 掉 supabase 模块（测试显式传 client，默认值不被使用）
vi.mock('@/lib/supabase', () => ({
  supabase: {},
}))

// uploadAttachment 现需经 getFileSystemManager 读出字节后上传；mock 返回占位字节
vi.mock('@tarojs/taro', () => ({
  default: {
    getFileSystemManager: () => ({
      readFile: (opts: { success: (res: { data: ArrayBuffer }) => void }) => {
        opts.success({ data: new ArrayBuffer(8) })
      },
    }),
  },
}))

/**
 * 链式 mock 客户端：依次消费 responses（含挂载时的初始 fetch）。
 * 记录每次 update 的表名与载荷（calls），供断言状态变更；
 * 记录 eq/in 过滤参数（filters），供断言 cancelOnSignIn 的「已驳回不动」过滤；
 * 记录 storage.remove 调用（removes），供断言附件删除。
 * update 链（eq → eq）中仅首个 eq 消费响应，后续链式调用（eq/in/select）返回同一
 * thenable，await 解开为对应响应——兼容有无 select 两种链。
 */
function mockClient<T>(responses: T[]) {
  const calls: { table: string; op: 'update'; payload: unknown }[] = []
  const removes: { bucket: string; paths: string[] }[] = []
  const uploads: { bucket: string; path: string }[] = []
  const filters: { table: string; args: unknown[] }[] = []
  let i = 0
  const chain = (r: T, table: string) => ({
    eq: (...args: unknown[]) => {
      filters.push({ table, args: ['eq', ...args] })
      return chain(r, table)
    },
    in: (...args: unknown[]) => {
      filters.push({ table, args: ['in', ...args] })
      return chain(r, table)
    },
    order: () => chain(r, table),
    maybeSingle: () => chain(r, table),
    select: () => chain(r, table),
    then: (resolve: (v: T) => void) => resolve(r),
  })
  return {
    calls,
    removes,
    uploads,
    filters,
    from: (table: string) => ({
      select: () => chain(responses[i++], table),
      insert: () => chain(responses[i++], table),
      update: (payload: unknown) => {
        calls.push({ table, op: 'update', payload })
        return chain(responses[i++], table)
      },
    }),
    rpc: (_name: string, _args: unknown) => Promise.resolve(responses[i++]),
    storage: {
      from: (bucket: string) => ({
        upload: (path: string) => {
          uploads.push({ bucket, path })
          return chain(responses[i++], bucket)
        },
        createSignedUrl: () => chain(responses[i++], bucket),
        remove: (paths: string[]) => {
          removes.push({ bucket, paths })
          return chain(responses[i++], bucket)
        },
      }),
    },
  }
}

const fetchOk = { data: [{ id: '1', rehearsal_id: 1 }], error: null }
const emptyOk = { data: [], error: null }
/** update 匹配到行（0 行检测通过）；无 data 字段的 { error: null } 已被 0 行检测拦截 */
const updateOk = { data: [{ id: 'lr-1' }], error: null }

describe('useLeaveRequests', () => {
  afterEach(() => {
    cleanup()
  })

  it('fetchMine 加载我的申请（含排练 join）', async () => {
    const c = mockClient([
      {
        data: [
          {
            id: 'lr-1',
            rehearsal_id: 1,
            status: 'pending',
            rehearsals: { title: '排练', start_time: '2026-08-15T13:00:00' },
          },
        ],
        error: null,
      },
    ])
    const { result } = renderHook(() => useLeaveRequests(c as never))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.data).toHaveLength(1)
    expect(result.current.data[0]).toMatchObject({ id: 'lr-1', status: 'pending' })
  })

  it('fetchMine 失败：错误归一化为中文文案，清空列表', async () => {
    const c = mockClient([{ data: null, error: { message: '查询失败' } }])
    const { result } = renderHook(() => useLeaveRequests(c as never))
    await waitFor(() => expect(result.current.loading).toBe(false))
    // 与 Web 差异：不透传 dbError.message，统一中文文案（不抛）
    expect(result.current.error).toBe('数据加载失败，请重试')
    expect(result.current.data).toEqual([])
  })

  it('create 新申请（target_status 固定为 excused）', async () => {
    const c = mockClient([fetchOk, { error: null }, emptyOk])
    const { result } = renderHook(() => useLeaveRequests(c as never))
    await waitFor(() => expect(result.current.loading).toBe(false))

    const ok = await act(() =>
      result.current.create({ rehearsal_id: 1, user_id: 'u1', reason: '感冒了' })
    )
    expect(ok).toBe(true)
  })

  it('create 失败返回 false 并写入 error', async () => {
    const c = mockClient([fetchOk, { error: { message: '插入失败' } }])
    const { result } = renderHook(() => useLeaveRequests(c as never))
    await waitFor(() => expect(result.current.loading).toBe(false))

    const ok = await act(() =>
      result.current.create({ rehearsal_id: 1, user_id: 'u1', reason: 'x' })
    )
    expect(ok).toBe(false)
    expect(result.current.error).toBe('插入失败')
  })

  it('updateReason 更新 pending 申请内容', async () => {
    const c = mockClient([fetchOk, updateOk, emptyOk])
    const { result } = renderHook(() => useLeaveRequests(c as never))
    await waitFor(() => expect(result.current.loading).toBe(false))

    const ok = await act(() =>
      result.current.updateReason('lr-1', { reason: '改原因', attachment_url: null })
    )
    expect(ok).toBe(true)
  })

  it('reapply 重新申请：状态回 pending 并清空驳回原因（限 rejected 行）', async () => {
    const c = mockClient([fetchOk, updateOk, emptyOk])
    const { result } = renderHook(() => useLeaveRequests(c as never))
    await waitFor(() => expect(result.current.loading).toBe(false))

    const ok = await act(() =>
      result.current.reapply('lr-1', { reason: '再次申请', attachment_url: null })
    )
    expect(ok).toBe(true)
  })

  // ---- cancelOnSignIn（覆盖请假签到）----
  it('cancelOnSignIn RPC ?????? already-processed????????', async () => {
    const c = mockClient([fetchOk, { data: [], error: null }])
    const { result } = renderHook(() => useLeaveRequests(c as never))
    await waitFor(() => expect(result.current.loading).toBe(false))
    await expect(result.current.cancelOnSignIn(1)).resolves.toEqual({
      ok: false,
      reason: 'already-processed',
    })
    expect(c.removes).toEqual([])
  })

  it('cancelOnSignIn RPC ?? pending/approved ????????????', async () => {
    const c = mockClient([
      fetchOk,
      {
        data: [
          {
            request_id: 'request-1',
            attachment_path: 'u1/a.jpg',
            previous_status: 'pending',
            status: 'canceled',
          },
          {
            request_id: 'request-2',
            attachment_path: 'https://x/storage/v1/object/sign/leave-attachments/u2%2Fb.jpg',
            previous_status: 'approved',
            status: 'canceled',
          },
        ],
        error: null,
      },
      { error: null },
      { error: null },
      emptyOk,
    ])
    const { result } = renderHook(() => useLeaveRequests(c as never))
    await waitFor(() => expect(result.current.loading).toBe(false))
    await expect(result.current.cancelOnSignIn(1)).resolves.toEqual({ ok: true })
    expect(c.removes).toEqual([
      { bucket: 'leave-attachments', paths: ['u1/a.jpg'] },
      { bucket: 'leave-attachments', paths: ['u2/b.jpg'] },
    ])
  })

  it('cancelOnSignIn RPC error ?? network ?????', async () => {
    const c = mockClient([fetchOk])
    c.rpc = () => Promise.resolve({ data: null, error: { message: 'RPC ??' } }) as never
    const { result } = renderHook(() => useLeaveRequests(c as never))
    await waitFor(() => expect(result.current.loading).toBe(false))
    await expect(result.current.cancelOnSignIn(1)).resolves.toEqual({
      ok: false,
      reason: 'network',
    })
    await waitFor(() => expect(result.current.error).toBe('RPC ??'))
  })

  it('cancelOnSignIn RPC ??????????????', async () => {
    const c = mockClient([fetchOk, { data: null, error: null }])
    const { result } = renderHook(() => useLeaveRequests(c as never))
    await waitFor(() => expect(result.current.loading).toBe(false))
    await expect(result.current.cancelOnSignIn(1)).resolves.toEqual({
      ok: false,
      reason: 'already-processed',
    })
    expect(c.removes).toEqual([])
  })

  it('cancelOnSignIn ?? guard ????? RPC', async () => {
    const c = mockClient([fetchOk, { data: [], error: null }])
    const { result } = renderHook(() => useLeaveRequests(c as never))
    await waitFor(() => expect(result.current.loading).toBe(false))
    const values = await Promise.all([
      result.current.cancelOnSignIn(1),
      result.current.cancelOnSignIn(1),
    ])
    expect(values.filter((value) => value.ok === false)).toHaveLength(2)
  })

  it('cancelOnSignIn ?? RPC ??? number', async () => {
    const args: unknown[] = []
    const c = mockClient([fetchOk, { data: [], error: null }])
    const originalRpc = c.rpc
    c.rpc = (name: string, rpcArgs: unknown) => {
      args.push(name, rpcArgs)
      return originalRpc(name, rpcArgs)
    }
    const { result } = renderHook(() => useLeaveRequests(c as never))
    await waitFor(() => expect(result.current.loading).toBe(false))
    await result.current.cancelOnSignIn(123)
    expect(args).toEqual(['cancel_leave_on_sign_in', { p_rehearsal_id: 123 }])
  })

  // ---- cancelRequest ----

  it('cancelRequest 取消 pending 申请（无附件）：状态更新为 canceled，不调用存储删除', async () => {
    const c = mockClient([fetchOk, updateOk, emptyOk])
    const { result } = renderHook(() => useLeaveRequests(c as never))
    await waitFor(() => expect(result.current.loading).toBe(false))

    const ok = await act(() => result.current.cancelRequest('lr-1'))
    expect(ok).toBe(true)
    expect(c.calls).toEqual([
      { table: 'leave_requests', op: 'update', payload: { status: 'canceled' } },
    ])
    expect(c.removes).toEqual([])
  })

  it('cancelRequest 带附件：取消成功后删除私有桶附件', async () => {
    const c = mockClient([
      fetchOk,
      updateOk, // 取消申请 update
      { error: null }, // 附件删除 remove
      emptyOk, // 取消后 fetchMine
    ])
    const { result } = renderHook(() => useLeaveRequests(c as never))
    await waitFor(() => expect(result.current.loading).toBe(false))

    const ok = await act(() =>
      result.current.cancelRequest('lr-1', { attachment_url: 'u1/1-a.jpg' })
    )
    expect(ok).toBe(true)
    expect(c.removes).toEqual([{ bucket: 'leave-attachments', paths: ['u1/1-a.jpg'] }])
  })

  it('cancelRequest 附件删除失败（remove 返回 error）：不影响状态取消', async () => {
    const c = mockClient([
      fetchOk,
      updateOk,
      { error: { message: '删除失败' } }, // remove 返回错误（容错忽略）
      emptyOk,
    ])
    const { result } = renderHook(() => useLeaveRequests(c as never))
    await waitFor(() => expect(result.current.loading).toBe(false))

    const ok = await act(() =>
      result.current.cancelRequest('lr-1', { attachment_url: 'u1/1-a.jpg' })
    )
    expect(ok).toBe(true)
    expect(result.current.error).toBeNull()
    expect(c.removes).toEqual([{ bucket: 'leave-attachments', paths: ['u1/1-a.jpg'] }])
  })

  it('cancelRequest 完整 URL 附件：提取 leave-attachments/ 之后解码的路径删除', async () => {
    const c = mockClient([fetchOk, updateOk, { error: null }, emptyOk])
    const { result } = renderHook(() => useLeaveRequests(c as never))
    await waitFor(() => expect(result.current.loading).toBe(false))

    const ok = await act(() =>
      result.current.cancelRequest('lr-1', {
        attachment_url: 'https://x.supabase.co/storage/v1/object/leave-attachments/u1%2F1-a.jpg',
      })
    )
    expect(ok).toBe(true)
    expect(c.removes).toEqual([{ bucket: 'leave-attachments', paths: ['u1/1-a.jpg'] }])
  })

  it('cancelRequest 更新失败返回 false 并写入 error', async () => {
    const c = mockClient([fetchOk, { error: { message: '取消失败' } }])
    const { result } = renderHook(() => useLeaveRequests(c as never))
    await waitFor(() => expect(result.current.loading).toBe(false))

    const ok = await act(() => result.current.cancelRequest('lr-1'))
    expect(ok).toBe(false)
    expect(result.current.error).toBe('取消失败')
    expect(c.removes).toEqual([])
  })

  it('cancelRequest 并发审批后 0 行更新：返回 false、写入 error、附件不被误删', async () => {
    // 管理员已并发审批通过（status 非 pending），update 匹配 0 行
    const c = mockClient([fetchOk, { data: [], error: null }])
    const { result } = renderHook(() => useLeaveRequests(c as never))
    await waitFor(() => expect(result.current.loading).toBe(false))

    const ok = await act(() =>
      result.current.cancelRequest('lr-1', { attachment_url: 'u1/1-a.jpg' })
    )
    expect(ok).toBe(false)
    expect(result.current.error).toBe('申请已被处理，请刷新后重试')
    expect(c.removes).toEqual([]) // 已通过申请的附件不得被删除
  })

  // ---- 编辑换图删旧附件 ----

  it('updateReason 换图：保存成功后删除旧附件（仅删除旧路径）', async () => {
    const c = mockClient([
      fetchOk,
      updateOk, // 更新申请 update
      { error: null }, // 旧附件删除 remove
      emptyOk, // 保存后 fetchMine
    ])
    const { result } = renderHook(() => useLeaveRequests(c as never))
    await waitFor(() => expect(result.current.loading).toBe(false))

    const ok = await act(() =>
      result.current.updateReason('lr-1', {
        reason: '改原因',
        attachment_url: 'u1/2-b.jpg',
        old_attachment_url: 'u1/1-a.jpg',
      })
    )
    expect(ok).toBe(true)
    expect(c.calls[0].payload).toEqual({
      reason: '改原因',
      attachment_url: 'u1/2-b.jpg',
    })
    expect(c.removes).toEqual([{ bucket: 'leave-attachments', paths: ['u1/1-a.jpg'] }])
  })

  it('updateReason 未换图（新旧相同）：不删除附件', async () => {
    const c = mockClient([fetchOk, updateOk, emptyOk])
    const { result } = renderHook(() => useLeaveRequests(c as never))
    await waitFor(() => expect(result.current.loading).toBe(false))

    const ok = await act(() =>
      result.current.updateReason('lr-1', {
        reason: '改原因',
        attachment_url: 'u1/1-a.jpg',
        old_attachment_url: 'u1/1-a.jpg',
      })
    )
    expect(ok).toBe(true)
    expect(c.removes).toEqual([])
  })

  it('updateReason 仅移除附件（新为 null）：不删除旧附件（换图语义）', async () => {
    const c = mockClient([fetchOk, updateOk, emptyOk])
    const { result } = renderHook(() => useLeaveRequests(c as never))
    await waitFor(() => expect(result.current.loading).toBe(false))

    const ok = await act(() =>
      result.current.updateReason('lr-1', {
        reason: '改原因',
        attachment_url: null,
        old_attachment_url: 'u1/1-a.jpg',
      })
    )
    expect(ok).toBe(true)
    expect(c.removes).toEqual([])
  })

  it('updateReason 并发审批后 0 行更新：返回 false、写入 error、旧附件不被误删', async () => {
    // 管理员已并发审批通过（status 非 pending），update 匹配 0 行
    const c = mockClient([fetchOk, { data: [], error: null }])
    const { result } = renderHook(() => useLeaveRequests(c as never))
    await waitFor(() => expect(result.current.loading).toBe(false))

    const ok = await act(() =>
      result.current.updateReason('lr-1', {
        reason: '改原因',
        attachment_url: 'u1/2-b.jpg',
        old_attachment_url: 'u1/1-a.jpg',
      })
    )
    expect(ok).toBe(false)
    expect(result.current.error).toBe('申请已被处理，请刷新后重试')
    expect(c.removes).toEqual([]) // 已通过申请的附件不得被删除
  })

  it('reapply 换图：保存成功后同样删除旧附件（与 updateReason 同语义）', async () => {
    const c = mockClient([
      fetchOk,
      updateOk, // 重新申请 update
      { error: null }, // 旧附件删除 remove
      emptyOk,
    ])
    const { result } = renderHook(() => useLeaveRequests(c as never))
    await waitFor(() => expect(result.current.loading).toBe(false))

    const ok = await act(() =>
      result.current.reapply('lr-1', {
        reason: '再次申请',
        attachment_url: 'u1/2-b.jpg',
        old_attachment_url: 'u1/1-a.jpg',
      })
    )
    expect(ok).toBe(true)
    expect(c.removes).toEqual([{ bucket: 'leave-attachments', paths: ['u1/1-a.jpg'] }])
  })

  it('reapply 并发处理后 0 行更新：返回 false、写入 error、旧附件不被误删', async () => {
    // 管理员已并发处理（status 非 rejected），update 匹配 0 行
    const c = mockClient([fetchOk, { data: [], error: null }])
    const { result } = renderHook(() => useLeaveRequests(c as never))
    await waitFor(() => expect(result.current.loading).toBe(false))

    const ok = await act(() =>
      result.current.reapply('lr-1', {
        reason: '再次申请',
        attachment_url: 'u1/2-b.jpg',
        old_attachment_url: 'u1/1-a.jpg',
      })
    )
    expect(ok).toBe(false)
    expect(result.current.error).toBe('申请已被处理，请刷新后重试')
    expect(c.removes).toEqual([]) // 已处理申请的附件不得被删除
  })

  it('uploadAttachment 上传到私有桶并返回 storage 路径（无公开 URL）', async () => {
    const c = mockClient([fetchOk, { error: null }])
    const { result } = renderHook(() => useLeaveRequests(c as never))
    await waitFor(() => expect(result.current.loading).toBe(false))

    // 小程序文件入参：{ tempFilePath, name? }（Taro.chooseMedia 结果裁剪）
    const r = await act(() =>
      result.current.uploadAttachment({ tempFilePath: 'wxfile://tmp/a.jpg', name: 'a.jpg' }, 'u1')
    )
    expect(r).toHaveProperty('url')
    expect((r as { url: string }).url).toMatch(/^u1\/\d+-a\.jpg$/)
  })

  it('uploadAttachment 无 name 时从 tempFilePath 取文件名（保留扩展名）', async () => {
    const c = mockClient([fetchOk, { error: null }])
    const { result } = renderHook(() => useLeaveRequests(c as never))
    await waitFor(() => expect(result.current.loading).toBe(false))

    const r = await act(() =>
      result.current.uploadAttachment({ tempFilePath: 'wxfile://tmp/photo.pdf' }, 'u1')
    )
    expect((r as { url: string }).url).toMatch(/^u1\/\d+-photo\.pdf$/)
  })

  it('uploadAttachment 消毒含中文/空格的文件名（Storage InvalidKey）', async () => {
    const c = mockClient([fetchOk, { error: null }])
    const { result } = renderHook(() => useLeaveRequests(c as never))
    await waitFor(() => expect(result.current.loading).toBe(false))

    const r = await act(() =>
      result.current.uploadAttachment(
        { tempFilePath: 'wxfile://tmp/x', name: '病假证明 2025-11-11.pdf' },
        'u1'
      )
    )
    expect(r).toHaveProperty('url')
    // 消毒后 storage key 为纯 ASCII，不含中文/空格，且保留扩展名
    expect(c.uploads[0]).toMatchObject({ bucket: 'leave-attachments' })
    expect(c.uploads[0].path).not.toMatch(/[一-龥\s]/)
    expect(c.uploads[0].path).toMatch(/^[A-Za-z0-9._/-]+$/)
    expect(c.uploads[0].path).toContain('.pdf')
  })

  it('uploadAttachment 上传失败返回 error', async () => {
    const c = mockClient([fetchOk, { error: { message: '存储拒绝' } }])
    const { result } = renderHook(() => useLeaveRequests(c as never))
    await waitFor(() => expect(result.current.loading).toBe(false))

    const r = await act(() =>
      result.current.uploadAttachment({ tempFilePath: 'wxfile://tmp/a.jpg', name: 'a.jpg' }, 'u1')
    )
    expect(r).toHaveProperty('error', '存储拒绝')
  })

  it('getSignedUrl 返回 60s 签名链接', async () => {
    const c = mockClient([fetchOk, { data: { signedUrl: 'https://x/signed?a=1' }, error: null }])
    const { result } = renderHook(() => useLeaveRequests(c as never))
    await waitFor(() => expect(result.current.loading).toBe(false))

    const r = await act(() => result.current.getSignedUrl('u1/1-a.jpg'))
    expect(r).toEqual({ url: 'https://x/signed?a=1' })
  })

  it('卸载后手动 fetchMine 不再发起请求（mountedRef 拦截 setState）', async () => {
    let selectCount = 0
    const chain = (res: unknown) => ({
      eq: () => chain(res),
      in: () => chain(res),
      order: () => chain(res),
      select: () => chain(res),
      then: (resolve: (v: unknown) => void) => resolve(res),
    })
    const c = {
      from: () => ({
        select: () => {
          selectCount += 1
          return chain({ data: [], error: null })
        },
        insert: () => chain({ error: null }),
        update: () => chain({ data: [], error: null }),
      }),
      storage: {
        from: () => ({
          upload: () => chain({ error: null }),
          createSignedUrl: () => chain({ data: { signedUrl: 'x' }, error: null }),
          remove: () => chain({ error: null }),
        }),
      },
    }
    const { result, unmount } = renderHook(() => useLeaveRequests(c as never))
    await waitFor(() => expect(result.current.loading).toBe(false))
    unmount()

    await act(async () => {
      await result.current.fetchMine()
    })
    // 卸载后 fetchMine 被 mountedRef 提前拦截，不再发查询、不再 setState
    expect(selectCount).toBe(1)
  })

  it('挂载请求返回时组件已卸载：跳过 setState 不抛错', async () => {
    let resolveFetch!: (v: unknown) => void
    const chain = () => ({
      eq: () => chain(),
      in: () => chain(),
      order: () => chain(),
      select: () => chain(),
      then: (resolve: (v: unknown) => void) => {
        resolveFetch = resolve
      },
    })
    const c = {
      from: () => ({ select: () => chain() }),
    }
    const { unmount } = renderHook(() => useLeaveRequests(c as never))
    // 等微任务：await 在 thenable 上注册 resolver（then 由 Promise 机制异步调用）
    await act(async () => {})
    unmount()
    // 请求返回时组件已卸载：mountedRef 已置 false，setState 被跳过，不抛错
    await act(async () => {
      resolveFetch({ data: [], error: null })
    })
    expect(true).toBe(true)
  })
})
