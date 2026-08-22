import { useEffect, useRef, useState } from 'react'
import { View, Text, Textarea, Image } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { Modal } from '@/components/ui/Modal'
import { useLeaveRequests, type UploadFileLike } from '@/hooks/useLeaveRequests'
import { useUser } from '@/context/user-context'
import { formatRehearsalRange } from '@/lib/date-utils'
import type { LeaveRequestRow, LeaveStatus, RehearsalRow } from '@/types/database'

/**
 * 成员端请假/补请假弹窗（Web Issue #142 小程序移植）。
 *
 * 状态机（集中注释，前后端一致）：
 * - 无申请 / 已取消：表单模式，可提交新申请（target_status 固定 excused）；
 * - pending：只读展示（状态 chip 在标题栏右侧）+ 底部「编辑申请」改内容 / 「取消请假」；
 * - approved：只读展示，无底部操作行；
 * - rejected：只读展示 + 驳回原因 + 底部「重新申请」（内容预填，保存后状态回 pending）。
 *
 * 附件：私有桶，保存 storage 路径；查看经 getSignedUrl 换 60s 临时链接。
 * 编辑模式展示当前附件，可「更换图片」（替换后保存时由 hook 删除旧附件）。
 * 防重复提交：同步 ref + state 双重 guard；提交/取消中禁关闭。
 * 图片选择用 Taro.chooseMedia（替代 DOM file input），预览用本地临时路径 / 签名 URL。
 */
type Props = {
  open: boolean
  rehearsal: RehearsalRow | null
  onClose: () => void
  /** 保存成功后通知父级刷新卡片上的申请状态 */
  onSaved: () => void
}

type Mode = 'form' | 'view'

const LEAVE_STATUS_LABEL: Record<LeaveStatus, string> = {
  pending: '待审批',
  approved: '已通过',
  rejected: '已驳回',
  withdrawn: '已撤回',
  canceled: '已取消',
}

const LEAVE_STATUS_CHIP: Record<LeaveStatus, string> = {
  pending: 'bg-warning-bg text-warning',
  approved: 'bg-success-bg text-success',
  rejected: 'bg-danger-bg text-danger',
  withdrawn: 'bg-muted text-text-subtle',
  canceled: 'bg-muted text-text-subtle',
}

export function LeaveRequestModal({ open, rehearsal, onClose, onSaved }: Props) {
  const { user } = useUser()
  const {
    fetchMine,
    create,
    updateReason,
    reapply,
    cancelRequest,
    uploadAttachment,
    getSignedUrl,
    saving,
  } = useLeaveRequests()

  const [mode, setMode] = useState<Mode>('view')
  const [current, setCurrent] = useState<LeaveRequestRow | null>(null)
  const [editing, setEditing] = useState<LeaveRequestRow | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [reason, setReason] = useState('')
  const [attachmentFile, setAttachmentFile] = useState<UploadFileLike | null>(null)
  const [attachmentPreview, setAttachmentPreview] = useState<string | null>(null)
  const [keepOldAttachment, setKeepOldAttachment] = useState(false)
  const [viewAttachmentUrl, setViewAttachmentUrl] = useState<string | null>(null)
  const [attachmentLoading, setAttachmentLoading] = useState(false)

  const [isSubmitting, setIsSubmitting] = useState(false)
  const submittingRef = useRef(false)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [isCanceling, setIsCanceling] = useState(false)
  const cancelingRef = useRef(false)

  // 打开时加载该排练我的申请
  useEffect(() => {
    if (!open || !rehearsal) return
    let cancelled = false
    setLoading(true)
    setError(null)
    void (async () => {
      const rows = await fetchMine()
      if (cancelled) return
      const found =
        (rows ?? []).find(
          (r) =>
            r.rehearsal_id === rehearsal.id && r.status !== 'withdrawn' && r.status !== 'canceled'
        ) ?? null
      if (cancelled) return
      setCurrent(found)
      setMode(found ? 'view' : 'form')
      setEditing(null)
      setReason('')
      setAttachmentFile(null)
      setAttachmentPreview(null)
      setKeepOldAttachment(false)
      setViewAttachmentUrl(null)
      setConfirmCancel(false)
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [open, rehearsal, fetchMine])

  // 查看模式 / 编辑模式（保留旧附件）下加载附件签名 URL（60s 临时链接）
  useEffect(() => {
    const needLoad =
      open &&
      !!current?.attachment_url &&
      (mode === 'view' || (mode === 'form' && keepOldAttachment))
    if (!needLoad) {
      setViewAttachmentUrl(null)
      setAttachmentLoading(false)
      return
    }
    let cancelled = false
    setAttachmentLoading(true)
    void (async () => {
      const res = await getSignedUrl(current.attachment_url!)
      if (cancelled) return
      setViewAttachmentUrl(res.url ?? null)
      setAttachmentLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [open, mode, keepOldAttachment, current?.id, current?.attachment_url, getSignedUrl])

  const handleClose = () => {
    if (isSubmitting || isCanceling) return
    onClose()
  }

  const handleChooseImage = () => {
    setError(null)
    void Taro.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
    }).then((res) => {
      const file = res.tempFiles?.[0]
      if (!file) return
      setAttachmentFile({
        tempFilePath: file.tempFilePath,
        name: file.tempFilePath.split('/').pop(),
      })
      setAttachmentPreview(file.tempFilePath)
      setKeepOldAttachment(false)
    })
  }

  const handleClearAttachment = () => {
    setAttachmentFile(null)
    setAttachmentPreview(null)
    setKeepOldAttachment(false)
  }

  const handleEdit = () => {
    if (!current) return
    setEditing(current)
    setReason(current.reason)
    setKeepOldAttachment(!!current.attachment_url)
    setAttachmentFile(null)
    setAttachmentPreview(null)
    setConfirmCancel(false)
    setError(null)
    setMode('form')
  }

  const handleSubmit = async () => {
    if (submittingRef.current || isSubmitting) return
    const trimmed = reason.trim()
    if (!trimmed) {
      setError('请填写请假原因')
      return
    }
    if (!user?.id) {
      setError('登录状态失效，请重新登录')
      return
    }
    if (!rehearsal) return

    submittingRef.current = true
    setIsSubmitting(true)
    setError(null)
    try {
      let attachmentUrl: string | null = keepOldAttachment
        ? (current?.attachment_url ?? null)
        : null
      if (attachmentFile) {
        const up = await uploadAttachment(attachmentFile, user.id)
        if (up.error) {
          setError(`附件上传失败：${up.error}`)
          return
        }
        attachmentUrl = up.url ?? null
      }

      let ok: boolean
      if (editing) {
        const editPayload = {
          reason: trimmed,
          attachment_url: attachmentUrl,
          old_attachment_url: current?.attachment_url ?? null,
        }
        ok =
          editing.status === 'rejected'
            ? await reapply(editing.id, editPayload)
            : await updateReason(editing.id, editPayload)
      } else {
        ok = await create({
          rehearsal_id: rehearsal.id,
          user_id: user.id,
          reason: trimmed,
          attachment_url: attachmentUrl,
        })
      }
      if (!ok) return

      const rows = await fetchMine()
      const found =
        (rows ?? []).find(
          (r) =>
            r.rehearsal_id === rehearsal.id && r.status !== 'withdrawn' && r.status !== 'canceled'
        ) ?? null
      setCurrent(found)
      setMode(found ? 'view' : 'form')
      setEditing(null)
      setReason('')
      setAttachmentFile(null)
      setAttachmentPreview(null)
      setKeepOldAttachment(false)
      setViewAttachmentUrl(null)
      setConfirmCancel(false)
      setError(null)
      onSaved()
    } finally {
      submittingRef.current = false
      setIsSubmitting(false)
    }
  }

  const handleCancelRequest = async () => {
    if (cancelingRef.current || isCanceling || !editing) return
    cancelingRef.current = true
    setIsCanceling(true)
    setError(null)
    try {
      const ok = await cancelRequest(editing.id, editing)
      if (!ok) return
      setConfirmCancel(false)
      onClose()
      onSaved()
    } finally {
      cancelingRef.current = false
      setIsCanceling(false)
    }
  }

  const busy = isSubmitting || isCanceling || saving

  const previewImage = (url: string | null) => {
    if (url) void Taro.previewImage({ urls: [url], current: url })
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title='请假申请'
      position='bottom'
      closeOnOverlay={!busy}
      headerExtra={
        mode === 'view' && current ? (
          <View
            className={`rounded-full px-3 py-1 text-label ${LEAVE_STATUS_CHIP[current.status as LeaveStatus] ?? 'bg-muted text-text-subtle'}`}
          >
            {LEAVE_STATUS_LABEL[current.status as LeaveStatus] ?? current.status}
          </View>
        ) : null
      }
    >
      {loading ? (
        <Text className='block py-8 text-center text-xs text-text-muted'>加载中…</Text>
      ) : mode === 'view' && current ? (
        <View className='mt-2 space-y-3'>
          <Text className='block text-right text-label text-text-subtle'>{current.created_at}</Text>
          <View className='rounded-xl border border-border bg-surface p-3'>
            <Text className='block whitespace-pre-wrap break-words text-sm leading-relaxed text-text'>
              {current.reason}
            </Text>
          </View>

          {current.attachment_url && (
            <View>
              <Text className='mb-1 block text-label text-text-muted'>附件图片</Text>
              {attachmentLoading ? (
                <Text className='block text-xs text-text-subtle'>加载中…</Text>
              ) : viewAttachmentUrl ? (
                <Image
                  src={viewAttachmentUrl}
                  mode='aspectFit'
                  className='block max-h-48 w-full rounded-xl border border-border'
                  onClick={() => previewImage(viewAttachmentUrl)}
                />
              ) : (
                <Text className='block text-xs text-danger'>附件加载失败</Text>
              )}
            </View>
          )}

          {current.status === 'rejected' && current.reject_reason && (
            <View className='rounded-xl border border-danger/30 bg-danger/5 p-3'>
              <Text className='block text-sm font-medium text-danger'>驳回原因</Text>
              <Text className='mt-1 block whitespace-pre-wrap break-words text-sm leading-relaxed text-danger'>
                {current.reject_reason}
              </Text>
            </View>
          )}

          {(current.status === 'pending' || current.status === 'rejected') && (
            <View className='flex items-center justify-end pt-1'>
              <View
                className='rounded-full bg-primary px-4 py-1.5 text-label font-medium text-primary-foreground'
                onClick={busy ? undefined : () => handleEdit()}
              >
                {current.status === 'pending' ? '编辑申请' : '重新申请'}
              </View>
            </View>
          )}
        </View>
      ) : (
        <View className='mt-2 space-y-3'>
          <View className='rounded-xl border border-border bg-surface p-3'>
            <Text className='block text-sm text-text'>
              {rehearsal?.start_time
                ? formatRehearsalRange(rehearsal.start_time, rehearsal.end_time ?? null)
                : '时间未设置'}
            </Text>
            <Text className='mt-0.5 block text-xs text-text-muted'>
              {rehearsal?.repertoire} · 地点：{rehearsal?.location ?? '未设置'}
            </Text>
          </View>

          <View>
            <Text className='mb-1 block text-label text-text-muted'>
              请假原因<span className='text-danger'>*</span>
            </Text>
            <View className='w-full overflow-hidden rounded-xl border border-border bg-muted'>
              <Textarea
                value={reason}
                onInput={(e) => {
                  setReason(e.detail.value)
                  setError(null)
                }}
                maxlength={500}
                disabled={busy}
                className='h-32 bg-transparent px-3 py-3 text-xs leading-relaxed text-text'
                placeholder='请说明请假/补请假原因…'
              />
            </View>
          </View>

          <View>
            <Text className='mb-1 block text-label text-text-muted'>附件图片（选填）</Text>
            {attachmentPreview ? (
              <View className='space-y-2'>
                <Image
                  src={attachmentPreview}
                  mode='aspectFit'
                  className='max-h-40 rounded-xl border border-border'
                />
                <View
                  className='inline-flex rounded-full border border-border bg-surface px-3 py-1 text-xs text-text-muted'
                  onClick={busy ? undefined : () => handleClearAttachment()}
                >
                  移除附件
                </View>
              </View>
            ) : keepOldAttachment ? (
              <View className='space-y-2'>
                {attachmentLoading ? (
                  <Text className='block text-xs text-text-subtle'>加载中…</Text>
                ) : viewAttachmentUrl ? (
                  <Image
                    src={viewAttachmentUrl}
                    mode='aspectFit'
                    className='max-h-40 rounded-xl border border-border'
                    onClick={() => previewImage(viewAttachmentUrl)}
                  />
                ) : (
                  <Text className='block text-xs text-danger'>附件加载失败</Text>
                )}
                <View className='flex gap-2'>
                  <View
                    className='flex flex-1 items-center justify-center rounded-xl border border-dashed border-border bg-surface px-3 py-2 text-sm text-text-muted'
                    onClick={busy ? undefined : () => handleChooseImage()}
                  >
                    更换图片
                  </View>
                  <View
                    className='flex flex-1 items-center justify-center rounded-xl border border-border bg-surface px-3 py-2 text-sm text-text-muted'
                    onClick={busy ? undefined : () => handleClearAttachment()}
                  >
                    移除附件
                  </View>
                </View>
              </View>
            ) : (
              <View
                className='flex items-center justify-center rounded-xl border border-dashed border-border bg-surface px-3 py-4 text-sm text-text-muted'
                onClick={busy ? undefined : () => handleChooseImage()}
              >
                点击选择图片
              </View>
            )}
          </View>

          {error && <Text className='block text-sm text-danger'>{error}</Text>}

          {editing?.status === 'pending' && confirmCancel && (
            <View className='rounded-xl border border-danger/30 bg-danger/5 p-3'>
              <Text className='mb-3 block text-sm text-danger'>
                确认取消该请假申请？取消后视为无申请，可重新提交申请。
              </Text>
              <View className='flex gap-2'>
                <View
                  className='flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-center text-sm text-text-muted'
                  onClick={busy ? undefined : () => setConfirmCancel(false)}
                >
                  取消
                </View>
                <View
                  className='flex-1 rounded-lg bg-danger px-3 py-2 text-center text-sm text-danger-foreground'
                  onClick={busy ? undefined : () => void handleCancelRequest()}
                >
                  {isCanceling ? '取消中…' : '确认取消'}
                </View>
              </View>
            </View>
          )}

          <View className='flex items-center justify-end gap-2 pt-1'>
            {editing?.status === 'pending' ? (
              <View
                className='rounded-full px-4 py-1.5 text-label text-danger'
                onClick={busy ? undefined : () => setConfirmCancel(true)}
              >
                取消请假
              </View>
            ) : (
              <View
                className='rounded-full px-4 py-1.5 text-label text-text-muted'
                onClick={busy ? undefined : () => handleClose()}
              >
                取消
              </View>
            )}
            <View
              className={`rounded-full bg-primary px-4 py-1.5 text-label font-medium text-primary-foreground ${busy ? 'opacity-60' : ''}`}
              onClick={busy ? undefined : () => void handleSubmit()}
            >
              {isSubmitting
                ? '提交中…'
                : editing?.status === 'rejected'
                  ? '重新提交'
                  : editing
                    ? '保存修改'
                    : '提交申请'}
            </View>
          </View>
        </View>
      )}
    </Modal>
  )
}
