import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase as defaultClient } from '@/lib/supabase'
import { dataSyncBump, subscribeSync } from '@/lib/dataSync'
import { APP_ERROR } from '@/lib/appError'
import type { LeaveRequestRow, LeaveRequestWithDetails } from '@/types/database'
import { guessContentType, uploadLocalFile } from '@/lib/uploadLocalFile'

// 小程序文件入参为 { tempFilePath, name? }（Taro.chooseMedia 返回的本地路径，非 DOM File），
// 必须由 uploadLocalFile 读出字节后再上传，否则 storage-js 会判定为非法上传体。

function extractAttachmentPath(attachmentUrl: string): string | null {
  const marker = 'leave-attachments/'
  const index = attachmentUrl.indexOf(marker)
  if (index < 0 && attachmentUrl.includes('://')) return null
  const encodedPath = index >= 0 ? attachmentUrl.slice(index + marker.length) : attachmentUrl
  if (!encodedPath) return null
  try {
    const decoded = decodeURIComponent(encodedPath)
    return decoded || null
  } catch {
    return null
  }
}

/** 新申请载荷：目标考勤状态由服务端固定为 excused，客户端不可指定。 */
export type LeaveRequestPayload = {
  rehearsal_id: number
  user_id: string
  reason: string
  attachment_url?: string | null
}

/** 编辑保存载荷（updateReason / reapply 共用）：old_attachment_url 为更换前的旧附件路径 */
type EditLeaveRequestPayload = {
  reason: string
  attachment_url?: string | null
  old_attachment_url?: string | null
}

/** 待上传的小程序文件（Taro.chooseMedia 结果裁剪）：tempFilePath 为本地临时路径，name 可选 */
export type UploadFileLike = {
  tempFilePath: string
  name?: string
}

/**
 * cancelOnSignIn 返回值（返工）：ok 为 false 时区分失败原因，供页面出不同提示文案——
 * - "already-processed"：SELECT 与 UPDATE 间隙管理员并发处理了申请（驳回/审批），
 *   申请已不归成员掌控，无需再取消；
 * - "network"：查询/更新本身失败（网络或数据库错误），需联系管理员处理。
 */
export type CancelOnSignInResult =
  { ok: true } | { ok: false; reason: 'already-processed' | 'network' }

/**
 * 成员端请假/补请假 hook。
 * - 数据受 RLS 约束：仅本人可见/操作自己的申请；
 * - 附件上传到私有桶 leave-attachments（路径 <user_id>/<时间戳>-<文件名>），
 *   私有桶无公开 URL，保存的是 storage 路径，查看时经 getSignedUrl 换 60s 临时链接；
 * - 提交策略：写操作成功后统一 refetch（放弃乐观更新）——申请列表常与
 *   管理端审批联动（状态会变），refetch 保证成员端展示与管理端一致。
 * 与 Web 版差异：上传入参为小程序文件（{ tempFilePath, name? }）而非 DOM File；
 * 卸载后不再 setState（mountedRef 标志位）；user_id 由调用方从 useUser() 获取后传入。
 */
export function useLeaveRequests(client: typeof defaultClient = defaultClient) {
  const [data, setData] = useState<LeaveRequestWithDetails[]>([])
  const [loading, setLoading] = useState(true)
  // 写路径业务提示与读路径错误共用一个 state：保持 string，load 失败写入 APP_ERROR.loadFailed 常量
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const mountedRef = useRef(true)
  const savingRef = useRef(false)
  const fetchSeqRef = useRef(0)

  /** 查当前用户全部申请（含排练信息 join），按 created_at 倒序 */
  const fetchMine = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!mountedRef.current) return null
      const seq = ++fetchSeqRef.current
      if (!opts?.silent) setLoading(true)
      setError(null)
      const { data: rows, error: dbError } = await client
        .from('leave_requests')
        .select('*, rehearsals(repertoire, title, start_time, end_time, location)')
        .order('created_at', { ascending: false })
      if (!mountedRef.current || seq !== fetchSeqRef.current) return null
      setLoading(false)
      if (dbError) {
        console.error('[useLeaveRequests] 请假单加载失败', dbError)
        setError(APP_ERROR.loadFailed)
        setData([])
        return null
      }
      const list = (rows as LeaveRequestWithDetails[]) ?? []
      setData(list)
      return list
    },
    [client]
  )

  useEffect(() => {
    mountedRef.current = true
    void fetchMine()
    return () => {
      mountedRef.current = false
    }
  }, [fetchMine])

  // 心跳检测到「我的请假」版本变化后静默重取（状态被管理员审批/驳回时即时可见）
  useEffect(() => {
    const handler = () => {
      void fetchMine({ silent: true })
    }
    return subscribeSync('leave', handler)
  }, [fetchMine])

  /** 新建申请（RLS 校验 user_id 必须是本人；目标状态固定为 excused）。 */
  const create = useCallback(
    async (payload: LeaveRequestPayload) => {
      if (savingRef.current) return false
      savingRef.current = true
      setSaving(true)
      setError(null)
      try {
        const { error: dbError } = await client.from('leave_requests').insert({
          rehearsal_id: payload.rehearsal_id,
          user_id: payload.user_id,
          reason: payload.reason,
          attachment_url: payload.attachment_url ?? null,
          target_status: 'excused',
        } as never)
        if (dbError) {
          if (mountedRef.current) {
            setError(
              dbError.message.includes('cannot request leave after signing in')
                ? '已签到，无法再提交请假申请'
                : dbError.message
            )
          }
          return false
        }
        await fetchMine()
        dataSyncBump()
        return true
      } finally {
        savingRef.current = false
        if (mountedRef.current) setSaving(false)
      }
    },
    [client, fetchMine]
  )

  const cleanupOldAttachment = useCallback(
    async (oldPath: string | null | undefined, nextPath: string | null | undefined) => {
      if (!oldPath || !nextPath || oldPath === nextPath) return
      const safePath = extractAttachmentPath(oldPath)
      if (!safePath) return
      await client.storage.from('leave-attachments').remove([safePath])
    },
    [client]
  )

  /**
   * 编辑保存后删除被替换的旧附件（仅当换图：旧附件非空、新附件非空且两者不同）。
   * 删除失败静默容忍——DB 更新已成功，旧文件仅是孤儿存储，不应让保存报错。
   * 注意：supabase storage.remove 不抛异常，失败经返回的 error 对象表达，需显式检查。
   */
  /** 修改申请内容（仅限 pending 行：待审批中可改内容，不可改状态）。
   * 编辑换图（old_attachment_url 非空且与新附件不同）时，更新成功后删除旧附件；
   * 旧附件删除失败不影响保存本身（新附件已上传成功，仅遗留孤儿文件）。
   * 0 行更新检测：管理员并发审批通过后 status 已非 pending，update 匹配 0 行——
   * 此时申请已不归成员掌控，不得删除旧附件（附件随审批结果保留），直接报错返回。 */
  const updateReason = useCallback(
    async (id: string, payload: EditLeaveRequestPayload) => {
      if (savingRef.current) return false
      savingRef.current = true
      setSaving(true)
      setError(null)
      try {
        const { data: updated, error: dbError } = await client
          .from('leave_requests')
          .update({ reason: payload.reason, attachment_url: payload.attachment_url ?? null })
          .eq('id', id)
          .eq('status', 'pending')
          .select('id')
        if (dbError) {
          if (mountedRef.current) setError(dbError.message)
          return false
        }
        if (!updated || updated.length === 0) {
          if (mountedRef.current) setError('申请已被处理，请刷新后重试')
          return false
        }
        await cleanupOldAttachment(payload.old_attachment_url, payload.attachment_url)
        await fetchMine()
        dataSyncBump()
        return true
      } finally {
        savingRef.current = false
        if (mountedRef.current) setSaving(false)
      }
    },
    [client, cleanupOldAttachment, fetchMine]
  )

  /** 被驳回后重新申请：更新内容，状态打回 pending、清空驳回原因（仅限 rejected 行）；
   * 换图时同样删除旧附件（与 updateReason 同语义）。
   * 0 行更新检测：管理员并发处理（重新驳回/审批）后 status 已非 rejected，
   * update 匹配 0 行时不得删除旧附件，直接报错返回。 */
  const reapply = useCallback(
    async (id: string, payload: EditLeaveRequestPayload) => {
      if (savingRef.current) return false
      savingRef.current = true
      setSaving(true)
      setError(null)
      try {
        const { data: updated, error: dbError } = await client
          .from('leave_requests')
          .update({
            reason: payload.reason,
            attachment_url: payload.attachment_url ?? null,
            status: 'pending',
            reject_reason: null,
          })
          .eq('id', id)
          .eq('status', 'rejected')
          .select('id')
        if (dbError) {
          if (mountedRef.current) setError(dbError.message)
          return false
        }
        if (!updated || updated.length === 0) {
          if (mountedRef.current) setError('申请已被处理，请刷新后重试')
          return false
        }
        await cleanupOldAttachment(payload.old_attachment_url, payload.attachment_url)
        await fetchMine()
        dataSyncBump()
        return true
      } finally {
        savingRef.current = false
        if (mountedRef.current) setSaving(false)
      }
    },
    [client, cleanupOldAttachment, fetchMine]
  )

  /**
   * 取消待审批的申请（状态 → canceled）。
   * 与已下线的撤回（withdraw）不同：pending 申请尚未生效
   * （考勤未改写），取消无需考勤联动；取消后卡片视同无申请，成员可重新提交。
   * 附件处理：若申请带附件，顺带删除私有桶中的附件——删除失败不影响状态取消
   * （已取消的申请仍可追溯，仅遗留孤儿文件）。
   * 0 行更新检测：管理员并发审批通过后 status 已非 pending，update 匹配 0 行——
   * 此时不得删除附件（申请已通过，附件属审批结果一部分），直接报错返回。
   * @param request - 被取消的申请行（含 attachment_url），由调用方传入当前展示的申请。
   */
  const cancelRequest = useCallback(
    async (id: string, request?: Pick<LeaveRequestRow, 'attachment_url'> | null) => {
      if (savingRef.current) return false
      savingRef.current = true
      setSaving(true)
      setError(null)
      try {
        const { data: updated, error: dbError } = await client
          .from('leave_requests')
          .update({ status: 'canceled' })
          .eq('id', id)
          .eq('status', 'pending')
          .select('id')
        if (dbError) {
          if (mountedRef.current) setError(dbError.message)
          return false
        }
        if (!updated || updated.length === 0) {
          if (mountedRef.current) setError('申请已被处理，请刷新后重试')
          return false
        }
        const attachmentPath = request?.attachment_url
        if (attachmentPath) {
          const safePath = extractAttachmentPath(attachmentPath)
          if (safePath) await client.storage.from('leave-attachments').remove([safePath])
        }
        await fetchMine()
        dataSyncBump()
        return true
      } finally {
        savingRef.current = false
        if (mountedRef.current) setSaving(false)
      }
    },
    [client, fetchMine]
  )

  /**
   * 覆盖请假签到后撤销有效申请：将本排练当前 pending/approved 的申请
   * 记为 canceled，已驳回维持不变（驳回是管理端结论，签到不覆盖）。
   * 与 cancelRequest 的区别：cancelRequest 仅限 pending 单行（成员主动取消），本方法
   * 按排练批量处理两种状态——签到覆盖是签到的配套动作，approved 申请同样失效。
   * 附件处理与 cancelRequest 同语义（best effort，失败仅遗留孤儿文件，不阻断撤销）。
   * 并发安全（返工）：UPDATE 精确到 SELECT 快照返回的 id 集合（不再按 rehearsal_id +
   * status 宽匹配），并以 UPDATE 返回的已更新 id 与快照取交集——间隙管理员并发驳回的
   * 行不在交集内，其附件（属审批结果一部分）不会被误删；全部被并发处理后 0 行更新，
   * 跳过附件清理并返回 { ok: false, reason: "already-processed" } 由页面提示无需取消。
   * 签到已成功写入考勤，本方法为配套动作：失败返回 { ok: false } 不阻断签到流程。
   */
  const cancelOnSignIn = useCallback(
    async (rehearsalId: number): Promise<CancelOnSignInResult> => {
      if (savingRef.current) return { ok: false, reason: 'network' }
      savingRef.current = true
      setSaving(true)
      setError(null)
      try {
        const { data: rows, error: dbError } = await client.rpc('cancel_leave_on_sign_in', {
          p_rehearsal_id: rehearsalId,
        })
        if (dbError) {
          if (mountedRef.current) setError(dbError.message)
          return { ok: false, reason: 'network' }
        }
        const updatedRows = (rows ?? []) as {
          request_id: string
          attachment_path: string | null
          previous_status: string
          status: string
        }[]
        if (updatedRows.length === 0) {
          if (mountedRef.current) setError('申请已被处理，请刷新后重试')
          return { ok: false, reason: 'already-processed' }
        }
        if (updatedRows.some((row) => row.status !== 'canceled')) {
          if (mountedRef.current) setError('请假撤销未生效，请重试')
          return { ok: false, reason: 'network' }
        }
        for (const row of updatedRows) {
          const safePath = row.attachment_path ? extractAttachmentPath(row.attachment_path) : null
          if (safePath) {
            await client.storage.from('leave-attachments').remove([safePath])
          }
        }
        await fetchMine()
        dataSyncBump()
        return { ok: true }
      } finally {
        savingRef.current = false
        if (mountedRef.current) setSaving(false)
      }
    },
    [client, fetchMine]
  )

  /** 上传附件到私有桶（路径沿用 <user_id>/<时间戳>-<文件名> 模式），返回 storage 路径。
   * 入参为小程序文件（Taro.chooseMedia 返回的 { tempFilePath, size } 或其子集）。 */
  const uploadAttachment = useCallback(
    async (file: UploadFileLike, userId: string) => {
      if (savingRef.current) return { error: '请勿重复提交' }
      savingRef.current = true
      // 文件名消毒：含中文/空格的文件名作 storage key 会被 Supabase Storage 拒绝
      // （400 InvalidKey）；保留 [A-Za-z0-9._-]，其余替换为 "-"。
      // 小程序文件无 name 字段时退化为从 tempFilePath 取末段文件名（保留扩展名）
      const rawName = file.name || file.tempFilePath.split('/').pop() || 'image'
      const safeName = rawName.replace(/[^A-Za-z0-9._-]/g, '-') || 'image'
      const path = `${userId}/${Date.now()}-${safeName}`
      try {
        const up = await uploadLocalFile(
          client,
          'leave-attachments',
          path,
          file.tempFilePath,
          guessContentType(safeName)
        )
        if (up.error) return { error: up.error.message }
        return { url: (up.data as { path: string }).path }
      } finally {
        savingRef.current = false
      }
    },
    [client]
  )

  /** 客户端为私有桶附件生成 60s 签名 URL（本人可读自己的附件，RLS 放行） */
  const getSignedUrl = useCallback(
    async (path: string) => {
      const safePath = extractAttachmentPath(path)
      if (!safePath) return { error: '附件路径无效' }
      const { data: signed, error: urlError } = await client.storage
        .from('leave-attachments')
        .createSignedUrl(safePath, 60)
      if (urlError) return { error: urlError.message }
      return { url: signed.signedUrl }
    },
    [client]
  )

  return {
    data,
    loading,
    error,
    saving,
    fetchMine,
    create,
    updateReason,
    reapply,
    cancelRequest,
    cancelOnSignIn,
    uploadAttachment,
    getSignedUrl,
  }
}
