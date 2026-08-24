import { useEffect, useRef, useState } from 'react'
import { View, Text, Textarea, Image } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useLeaveRequests, type UploadFileLike } from '@/hooks/useLeaveRequests'
import { useUser } from '@/context/user-context'
import { useRehearsals } from '@/hooks/useRehearsals'
import { formatRehearsalRange } from '@/lib/date-utils'
import type { LeaveRequestRow } from '@/types/database'

const isActive = (r: LeaveRequestRow) =>
  r.status !== 'withdrawn' && r.status !== 'canceled'

export default function LeaveRequestPage() {
  const router = Taro.getCurrentInstance().router
  const rehearsalId = Number(router?.params?.rehearsalId)
  const { user } = useUser()
  const { data: rehearsals } = useRehearsals()
  const rehearsal = rehearsals?.find((r) => r.id === rehearsalId) ?? null
  const { fetchMine, create, updateReason, reapply, cancelRequest, uploadAttachment, getSignedUrl, saving } =
    useLeaveRequests()

  const [mode, setMode] = useState<'form' | 'view'>('view')
  const [current, setCurrent] = useState<LeaveRequestRow | null>(null)
  const [editing, setEditing] = useState<LeaveRequestRow | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [attachmentFile, setAttachmentFile] = useState<UploadFileLike | null>(null)
  const [attachmentPreview, setAttachmentPreview] = useState<string | null>(null)
  const [keepOldAttachment, setKeepOldAttachment] = useState(false)
  const [viewAttachmentUrl, setViewAttachmentUrl] = useState<string | null>(null)
  const [attachmentLoading, setAttachmentLoading] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const submittingRef = useRef(false)

  useEffect(() => {
    if (!rehearsalId) return
    let cancelled = false
    setError(null)
    void (async () => {
      const rows = await fetchMine()
      if (cancelled) return
      const found = (rows ?? []).find((r) => r.rehearsal_id === rehearsalId && isActive(r)) ?? null
      if (cancelled) return
      setCurrent(found)
      setMode(found ? 'view' : 'form')
      setEditing(null)
      setReason('')
      setAttachmentFile(null)
      setAttachmentPreview(null)
      setKeepOldAttachment(false)
      setViewAttachmentUrl(null)
    })()
    return () => {
      cancelled = true
    }
  }, [rehearsalId, fetchMine])

  useEffect(() => {
    const needLoad =
      (mode === 'view' || (mode === 'form' && keepOldAttachment)) && !!current?.attachment_url
    if (!needLoad) {
      setViewAttachmentUrl(null)
      setAttachmentLoading(false)
      return
    }
    let cancelled = false
    setAttachmentLoading(true)
    void (async () => {
      const url = current.attachment_url!
      const res = await getSignedUrl(url)
      if (cancelled) return
      setViewAttachmentUrl(res.url ?? null)
      setAttachmentLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [mode, current?.id, current?.attachment_url, keepOldAttachment, getSignedUrl])

  const handleChooseImage = () => {
    Taro.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const f = res.tempFiles?.[0] as unknown as UploadFileLike
        if (!f) return
        setAttachmentFile(f)
        setAttachmentPreview(f.tempFilePath)
        setKeepOldAttachment(false)
      },
    })
  }
  const handleClearAttachment = () => {
    setAttachmentFile(null)
    setAttachmentPreview(null)
  }
  const handleRemoveOldAttachment = () => {
    setKeepOldAttachment(false)
    setViewAttachmentUrl(null)
  }
  const handleEdit = () => {
    if (!current) return
    setEditing(current)
    setReason(current.reason)
    setKeepOldAttachment(!!current.attachment_url)
    setAttachmentFile(null)
    setAttachmentPreview(null)
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
      let attachmentUrl = keepOldAttachment ? current?.attachment_url ?? null : null
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
        const payload = { reason: trimmed, attachment_url: attachmentUrl, old_attachment_url: current?.attachment_url ?? null }
        ok =
          editing.status === 'rejected'
            ? await reapply(editing.id, payload)
            : await updateReason(editing.id, payload)
      } else {
        ok = await create({ rehearsal_id: rehearsal.id, user_id: user.id, reason: trimmed, attachment_url: attachmentUrl })
      }
      if (!ok) return
      const rows = await fetchMine()
      const found = (rows ?? []).find((r) => r.rehearsal_id === rehearsalId && isActive(r)) ?? null
      setCurrent(found)
      setMode(found ? 'view' : 'form')
      setEditing(null)
      setReason('')
      setAttachmentFile(null)
      setAttachmentPreview(null)
      setKeepOldAttachment(false)
      setViewAttachmentUrl(null)
      setError(null)
    } finally {
      submittingRef.current = false
      setIsSubmitting(false)
    }
  }

  const handleCancel = async () => {
    if (submittingRef.current || isSubmitting) return
    if (!current) return
    submittingRef.current = true
    setIsSubmitting(true)
    setError(null)
    try {
      const ok = await cancelRequest(current.id, current)
      if (!ok) return
      const rows = await fetchMine()
      const found = (rows ?? []).find((r) => r.rehearsal_id === rehearsalId && isActive(r)) ?? null
      setCurrent(found)
      setMode(found ? 'view' : 'form')
      setEditing(null)
      setReason('')
      setAttachmentFile(null)
      setAttachmentPreview(null)
      setKeepOldAttachment(false)
      setViewAttachmentUrl(null)
      setError(null)
    } finally {
      submittingRef.current = false
      setIsSubmitting(false)
    }
  }

  const busy = isSubmitting || saving
  const leaveStatus = current?.status
  const showEdit = leaveStatus === 'pending' || leaveStatus === 'rejected'

  // 查看态展示申请状态且禁用按钮；编辑态按钮可用，文案为「修改申请 / 重新申请」。
  let submitLabel = '提交申请'
  let submitClass = 'text-white'
  let submitStyle: { backgroundColor: string } | undefined = { backgroundColor: '#6198CB' }
  let submitDisabled = false
  if (mode === 'view') {
    if (leaveStatus === 'pending') {
      submitLabel = '待审批'
      submitClass = 'bg-warning-bg text-warning'
      submitStyle = undefined
      submitDisabled = true
    } else if (leaveStatus === 'approved') {
      submitLabel = '已通过'
      submitClass = 'bg-success-bg text-success'
      submitStyle = undefined
      submitDisabled = true
    } else if (leaveStatus === 'rejected') {
      submitLabel = '已驳回'
      submitClass = 'bg-danger-bg text-danger'
      submitStyle = undefined
      submitDisabled = true
    }
  } else {
    // 编辑态：提交即保存修改（pending 改内容 / rejected 重新申请）
    submitLabel =
      leaveStatus === 'rejected' ? '重新申请' : leaveStatus === 'pending' ? '修改申请' : '提交申请'
  }

  const subtitle = rehearsal?.start_time
    ? formatRehearsalRange(rehearsal.start_time, rehearsal.end_time ?? null)
    : '排练未找到'
  const hasAttachment = mode === 'view' ? !!viewAttachmentUrl : !!keepOldAttachment

  return (
    <View className='flex h-full flex-col bg-page-bg'>
      <View className='flex-1 overflow-y-auto px-4 pb-safe'>
       <View className='pt-2 pb-2'>
        <Text className='block text-sm text-text-muted'>{subtitle}</Text>
        <View className='my-4 h-px bg-border' />

        {mode === 'view' && current ? (
          <>
            <Text className='block text-sm font-medium text-text'>申请原因</Text>
            <Text className='mt-1 block whitespace-pre-wrap text-sm text-text-muted'>{current.reason}</Text>
            <Text className='mb-1 mt-4 block text-sm font-medium text-text'>附件</Text>
            {attachmentLoading ? (
              <Text className='text-xs text-text-muted'>附件加载中…</Text>
            ) : hasAttachment && viewAttachmentUrl ? (
              <Image
                src={viewAttachmentUrl}
                mode='widthFix'
                className='w-full rounded-lg border border-border'
                onClick={() => viewAttachmentUrl && Taro.previewImage({ urls: [viewAttachmentUrl] })}
              />
            ) : (
              <Text className='text-xs text-text-muted'>无附件</Text>
            )}
          </>
        ) : (
          <>
            <Text className='block text-sm font-medium text-text'>申请原因</Text>
            <Textarea
              value={reason}
              onInput={(e) => setReason(String((e.detail as { value?: string })?.value ?? ''))}
              placeholder='请填写请假原因'
              className='mt-1 w-full rounded-lg border border-border bg-surface p-2 text-sm text-text'
              style={{ minHeight: '96px' }}
            />
            <Text className='mb-1 mt-4 block text-sm font-medium text-text'>附件</Text>
            {attachmentPreview ? (
              <View className='relative'>
                <Image src={attachmentPreview} mode='widthFix' className='w-full rounded-lg border border-border' />
                <View
                  className='mt-2 inline-flex items-center rounded-full bg-danger-bg px-3 py-1'
                  onClick={handleClearAttachment}
                >
                  <Text className='text-sm text-danger'>删除附件</Text>
                </View>
              </View>
            ) : keepOldAttachment && viewAttachmentUrl ? (
              <View className='relative'>
                <Image
                  src={viewAttachmentUrl}
                  mode='widthFix'
                  className='w-full rounded-lg border border-border'
                  onClick={() => viewAttachmentUrl && Taro.previewImage({ urls: [viewAttachmentUrl] })}
                />
                <View
                  className='mt-2 inline-flex items-center rounded-full bg-danger-bg px-3 py-1'
                  onClick={handleRemoveOldAttachment}
                >
                  <Text className='text-sm text-danger'>删除附件</Text>
                </View>
              </View>
            ) : (
              <View
                className='inline-flex items-center rounded-full border border-border bg-surface px-3 py-1'
                onClick={handleChooseImage}
              >
                <Text className='text-sm text-text'>添加附件</Text>
              </View>
            )}
            {attachmentFile === null && keepOldAttachment && (
              <Text className='mt-1 block text-xs text-text-muted'>保留原附件（可修改或删除）</Text>
            )}
            {error && <Text className='mt-3 block text-xs text-danger'>{error}</Text>}
          </>
        )}
        <View className='mt-6'>
          <View
            className={`inline-flex h-11 w-full items-center justify-center rounded-xl px-4 text-center text-base font-medium ${submitClass} ${
              submitDisabled ? 'opacity-90' : ''
            }`}
            style={submitStyle}
            onClick={submitDisabled || busy ? undefined : handleSubmit}
          >
            {submitLabel}
          </View>
        </View>
        {mode === 'view' && showEdit && (
          <View className='mt-3 flex items-center justify-center'>
            <Text className='text-sm text-danger' onClick={handleEdit}>
              {current?.status === 'rejected' ? '重新申请' : '编辑申请'} &gt;
            </Text>
          </View>
        )}
        {mode === 'form' && leaveStatus === 'pending' && (
          <View className='mt-3 flex items-center justify-center'>
            <Text className='text-sm text-danger' onClick={handleCancel}>
              撤销申请 &gt;
            </Text>
          </View>
        )}
       </View>
       </View>
       </View>
   )
}
