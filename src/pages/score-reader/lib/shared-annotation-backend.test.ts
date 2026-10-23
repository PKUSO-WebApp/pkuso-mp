import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AnnoStroke } from '@/lib/annotation'
import { createSharedAnnotationBackend } from './shared-annotation-backend'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  pageFingerprint: vi.fn((strokes: unknown) => JSON.stringify(strokes)),
  mergeStrokes: vi.fn((a: unknown[], b: unknown[]) => [...a, ...b]),
}))

vi.mock('@/lib/supabase', () => ({
  supabase: { from: mocks.from, rpc: mocks.rpc },
}))

// 指纹与合并的算法本身在 annotation-sync.test.ts 里钉；这里只关心「谁在什么时候被写」
vi.mock('@/lib/annotation-sync', () => ({
  pageFingerprint: mocks.pageFingerprint,
  mergeStrokes: mocks.mergeStrokes,
}))

const stroke = (color: string): AnnoStroke => ({
  color,
  width: 0.004,
  points: [[0.1, 0.2]],
})

const PUSH = 'push_shared_sheet_music_annotation'
const CAN_EDIT = 'can_edit_shared_annotation'

const pushCalls = () => mocks.rpc.mock.calls.filter(([name]) => name === PUSH)

let annEq: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  annEq = vi.fn().mockResolvedValue({ data: [], error: null })
  mocks.from.mockReturnValue({ select: () => ({ eq: annEq }) })
  mocks.rpc.mockImplementation((name: string) => {
    if (name === CAN_EDIT) return Promise.resolve({ data: true, error: null })
    return Promise.resolve({ data: [{ ok: true, version: 'v-new', strokes: null }], error: null })
  })
})

afterEach(() => {
  vi.useRealTimers()
})

/** 让 `void flushPending()` 里的 await 与微任务走完（不推进 600ms 防抖） */
const settle = async () => {
  await vi.advanceTimersByTimeAsync(0)
}

describe('createSharedAnnotationBackend', () => {
  it('load：读共享表并记录每页版本；can_edit 为真时可写', async () => {
    const remote = stroke('red')
    annEq.mockResolvedValue({
      data: [{ page: 2, strokes: [remote], version: 'v2' }],
      error: null,
    })
    const backend = createSharedAnnotationBackend({})

    await expect(backend.load('f1')).resolves.toEqual({ '2': [remote] })
    expect(annEq).toHaveBeenCalledWith('file_id', 'f1')
    expect(backend.kind).toBe('shared')
    expect(backend.readOnly).toBe(false)
  })

  it('load：无写权 ⇒ readOnly；批注读取失败也按只读（没有远端版本就没法 CAS）', async () => {
    const noPerm = createSharedAnnotationBackend({})
    mocks.rpc.mockResolvedValue({ data: false, error: null })
    await noPerm.load('f1')
    expect(noPerm.readOnly).toBe(true)

    const readFail = createSharedAnnotationBackend({})
    mocks.rpc.mockResolvedValue({ data: true, error: null })
    annEq.mockResolvedValue({ data: null, error: { message: 'boom' } })
    await readFail.load('f1')
    expect(readFail.readOnly).toBe(true)

    const rpcFail = createSharedAnnotationBackend({})
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'boom' } })
    await rpcFail.load('f1')
    expect(rpcFail.readOnly).toBe(true)
  })

  it('persist：600ms 防抖后逐页 CAS；期望版本取 load 到的，新页期望「不存在」', async () => {
    const old = stroke('old')
    const next = stroke('next')
    const p2 = stroke('p2')
    annEq.mockResolvedValue({ data: [{ page: 1, strokes: [old], version: 'v1' }], error: null })
    const onSaveState = vi.fn()
    const backend = createSharedAnnotationBackend({ onSaveState })
    await backend.load('f1')

    backend.persist('f1', { '1': [next], '2': [p2] })
    expect(onSaveState).toHaveBeenLastCalledWith('saving')
    expect(pushCalls()).toHaveLength(0) // 防抖没到，一次网络都还没发

    await vi.advanceTimersByTimeAsync(600)

    expect(pushCalls()).toEqual([
      [PUSH, { p_file_id: 'f1', p_page: 1, p_strokes: [next], p_expected_version: 'v1' }],
      [PUSH, { p_file_id: 'f1', p_page: 2, p_strokes: [p2], p_expected_version: '' }],
    ])
    expect(onSaveState).toHaveBeenLastCalledWith('saved')
  })

  it('persist：与远端内容相同的页不进 dirty（不产生无意义的 CAS）', async () => {
    const same = stroke('same')
    annEq.mockResolvedValue({ data: [{ page: 1, strokes: [same], version: 'v1' }], error: null })
    const backend = createSharedAnnotationBackend({})
    await backend.load('f1')

    backend.persist('f1', { '1': [same] })
    await vi.advanceTimersByTimeAsync(600)

    expect(pushCalls()).toHaveLength(0)
  })

  it('只读：persist 既不排程也不发网络', async () => {
    const backend = createSharedAnnotationBackend({})
    mocks.rpc.mockResolvedValue({ data: false, error: null })
    await backend.load('f1')

    backend.persist('f1', { '1': [stroke('x')] })
    await vi.advanceTimersByTimeAsync(600)

    expect(pushCalls()).toHaveLength(0)
  })

  it('CAS 冲突：交给冲突面板，不覆盖远端；状态转 error', async () => {
    const old = stroke('old')
    const next = stroke('next')
    const remote = stroke('remote')
    annEq.mockResolvedValue({ data: [{ page: 1, strokes: [old], version: 'v1' }], error: null })
    const onConflict = vi.fn()
    const onSaveState = vi.fn()
    const backend = createSharedAnnotationBackend({ onConflict, onSaveState })
    await backend.load('f1')

    mocks.rpc.mockImplementation((name: string) => {
      if (name === CAN_EDIT) return Promise.resolve({ data: true, error: null })
      return Promise.resolve({
        data: [{ ok: false, version: 'v-remote', strokes: [remote] }],
        error: null,
      })
    })
    backend.persist('f1', { '1': [next] })
    await vi.advanceTimersByTimeAsync(600)

    expect(onConflict).toHaveBeenLastCalledWith([
      { page: 1, local: [next], remote: [remote], remoteVersion: 'v-remote' },
    ])
    expect(onSaveState).toHaveBeenLastCalledWith('error')
    // 冲突页不再自动重发（用户没选之前两边都不动）
    backend.persist('f1', { '1': [next] })
    await vi.advanceTimersByTimeAsync(600)
    expect(pushCalls()).toHaveLength(1)
  })

  it('冲突选「远端」：只采纳，不写共享表；之后同内容不再判为 dirty', async () => {
    const next = stroke('next')
    const remote = stroke('remote')
    annEq.mockResolvedValue({ data: [], error: null })
    const backend = createSharedAnnotationBackend({})
    await backend.load('f1')

    mocks.rpc.mockImplementation((name: string) => {
      if (name === CAN_EDIT) return Promise.resolve({ data: true, error: null })
      return Promise.resolve({
        data: [{ ok: false, version: 'v-remote', strokes: [remote] }],
        error: null,
      })
    })
    backend.persist('f1', { '1': [next] })
    await vi.advanceTimersByTimeAsync(600)

    await expect(backend.resolveConflict(1, 'remote')).resolves.toEqual([remote])
    expect(pushCalls()).toHaveLength(1) // 只有那次冲突的推送

    backend.persist('f1', { '1': [remote] })
    await vi.advanceTimersByTimeAsync(600)
    expect(pushCalls()).toHaveLength(1)
  })

  it('冲突选「合并」：以冲突时拿到的远端版本为基准写回合并结果', async () => {
    const next = stroke('next')
    const remote = stroke('remote')
    annEq.mockResolvedValue({ data: [], error: null })
    const onSaveState = vi.fn()
    const backend = createSharedAnnotationBackend({ onSaveState })
    await backend.load('f1')

    mocks.rpc.mockImplementation((name: string) => {
      if (name === CAN_EDIT) return Promise.resolve({ data: true, error: null })
      return Promise.resolve({
        data: [{ ok: false, version: 'v-remote', strokes: [remote] }],
        error: null,
      })
    })
    backend.persist('f1', { '1': [next] })
    await vi.advanceTimersByTimeAsync(600)

    mocks.rpc.mockImplementation((name: string) => {
      if (name === CAN_EDIT) return Promise.resolve({ data: true, error: null })
      return Promise.resolve({ data: [{ ok: true, version: 'v3', strokes: null }], error: null })
    })
    await expect(backend.resolveConflict(1, 'merge')).resolves.toEqual([next, remote])

    expect(pushCalls().at(-1)).toEqual([
      PUSH,
      { p_file_id: 'f1', p_page: 1, p_strokes: [next, remote], p_expected_version: 'v-remote' },
    ])
    expect(onSaveState).toHaveBeenLastCalledWith('saved')
  })

  it('网络失败：转 error 且保留 dirty，retry 时重发', async () => {
    annEq.mockResolvedValue({ data: [], error: null })
    const onSaveState = vi.fn()
    const backend = createSharedAnnotationBackend({ onSaveState })
    await backend.load('f1')

    mocks.rpc.mockImplementation((name: string) => {
      if (name === CAN_EDIT) return Promise.resolve({ data: true, error: null })
      return Promise.resolve({ data: null, error: { message: 'net' } })
    })
    backend.persist('f1', { '1': [stroke('a')] })
    await vi.advanceTimersByTimeAsync(600)
    expect(onSaveState).toHaveBeenLastCalledWith('error')

    mocks.rpc.mockImplementation((name: string) => {
      if (name === CAN_EDIT) return Promise.resolve({ data: true, error: null })
      return Promise.resolve({ data: [{ ok: true, version: 'v9', strokes: null }], error: null })
    })
    backend.retry?.()
    await settle()

    expect(pushCalls()).toHaveLength(2)
    expect(pushCalls().at(-1)?.[1]).toEqual({
      p_file_id: 'f1',
      p_page: 1,
      p_strokes: [stroke('a')],
      p_expected_version: '',
    })
    expect(onSaveState).toHaveBeenLastCalledWith('saved')
  })

  it('onClose / flush：不等防抖，立刻把挂着的页发出去', async () => {
    annEq.mockResolvedValue({ data: [], error: null })
    const backend = createSharedAnnotationBackend({})
    await backend.load('f1')

    backend.persist('f1', { '1': [stroke('a')] })
    backend.onClose?.()
    await settle()

    expect(pushCalls()).toHaveLength(1)
  })

  it('写入在飞时又画了新内容：新的一笔不会被 CAS 成功后的清理吞掉，会再发一轮', async () => {
    annEq.mockResolvedValue({ data: [], error: null })
    const backend = createSharedAnnotationBackend({})
    await backend.load('f1')

    const a = stroke('a')
    const b = stroke('b')
    let resolveFirst: (v: unknown) => void = () => {}
    const firstInFlight = new Promise((resolve) => {
      resolveFirst = resolve
    })
    let pushed = 0
    mocks.rpc.mockImplementation((name: string) => {
      if (name === CAN_EDIT) return Promise.resolve({ data: true, error: null })
      pushed += 1
      if (pushed === 1) return firstInFlight
      return Promise.resolve({
        data: [{ ok: true, version: `v${pushed}`, strokes: null }],
        error: null,
      })
    })

    backend.persist('f1', { '1': [a] })
    await vi.advanceTimersByTimeAsync(600)
    expect(pushCalls()).toHaveLength(1) // 第一笔卡在网络上

    backend.persist('f1', { '1': [b] }) // 用户在等网络时又画了一笔
    resolveFirst({ data: [{ ok: true, version: 'v1', strokes: null }], error: null })
    await settle()

    expect(pushCalls().map((call) => call[1])).toEqual([
      { p_file_id: 'f1', p_page: 1, p_strokes: [a], p_expected_version: '' },
      // 第二轮用的是第一轮成功后拿到的新版本号
      { p_file_id: 'f1', p_page: 1, p_strokes: [b], p_expected_version: 'v1' },
    ])
  })

  it('冲突没解决时继续画：冲突快照的 local 跟到最新，选「用我的」写的是最新那版', async () => {
    annEq.mockResolvedValue({ data: [], error: null })
    const backend = createSharedAnnotationBackend({})
    await backend.load('f1')

    const a = stroke('a')
    const b = stroke('b')
    const remote = stroke('remote')
    mocks.rpc.mockImplementation((name: string) => {
      if (name === CAN_EDIT) return Promise.resolve({ data: true, error: null })
      return Promise.resolve({
        data: [{ ok: false, version: 'v-remote', strokes: [remote] }],
        error: null,
      })
    })
    backend.persist('f1', { '1': [a] })
    await vi.advanceTimersByTimeAsync(600)

    backend.persist('f1', { '1': [b] }) // 冲突面板开着时又画了一笔
    mocks.rpc.mockImplementation((name: string) => {
      if (name === CAN_EDIT) return Promise.resolve({ data: true, error: null })
      return Promise.resolve({ data: [{ ok: true, version: 'v2', strokes: null }], error: null })
    })
    await expect(backend.resolveConflict(1, 'local')).resolves.toEqual([b])

    expect(pushCalls().at(-1)?.[1]).toEqual({
      p_file_id: 'f1',
      p_page: 1,
      p_strokes: [b],
      p_expected_version: 'v-remote',
    })
  })
})
