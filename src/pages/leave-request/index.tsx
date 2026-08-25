import { useEffect, useRef, useState } from 'react'
import { View, Text, Textarea, Image } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useLeaveRequests, type UploadFileLike } from '@/hooks/useLeaveRequests'
import { useUser } from '@/context/user-context'
import { useRehearsals } from '@/hooks/useRehearsals'
import { formatRehearsalRange } from '@/lib/date-utils'
import { useT } from '@/i18n'
import { useThemeClass } from '@/context/theme-context'
import type { LeaveRequestRow } from '@/types/database'

const isActive = (r: LeaveRequestRow) =>
  r.status !== 'withdrawn' && r.status !== 'canceled'

export default function LeaveRequestPage() {
  const router = Taro.getCurrentInstance().router
  const rehearsalId = Number(router?.params?.rehearsalId)
  const darkClass = useThemeClass()
  const { user } = useUser()
  const { data: rehearsals } = useRehearsals()
  const rehearsal = rehearsals?.find((r) => r.id === rehearsalId) ?? null
  const { fetchMine, create, updateReason, reapply, cancelRequest, uploadAttachment, getSignedUrl, saving } =
    useLeaveRequests()
  const { t } = useT()

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
      setError(t('leaveRequest.errorReason'))
      return
    }
    if (!user?.id) {
      setError(t('leaveRequest.errorLogin'))
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
          setError(t('leaveRequest.errorUpload', { error: up.error }))
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
  let submitLabel = t('leaveRequest.submit')
  let submitClass = 'text-white'
  let submitStyle: { backgroundColor: string } | undefined = { backgroundColor: '#6198CB' }
  let submitDisabled = false
  if (mode === 'view') {
    if (leaveStatus === 'pending') {
      submitLabel = t('leaveRequest.statusPending')
      submitClass = 'bg-warning-bg text-warning'
      submitStyle = undefined
      submitDisabled = true
    } else if (leaveStatus === 'approved') {
      submitLabel = t('leaveRequest.statusApproved')
      submitClass = 'bg-success-bg text-success'
      submitStyle = undefined
      submitDisabled = true
    } else if (leaveStatus === 'rejected') {
      submitLabel = t('leaveRequest.statusRejected')
      submitClass = 'bg-danger-bg text-danger'
      submitStyle = undefined
      submitDisabled = true
    }
  } else {
    // 编辑态：提交即保存修改（pending 改内容 / rejected 重新申请）
    submitLabel =
      leaveStatus === 'rejected'
        ? t('leaveRequest.resubmit')
        : leaveStatus === 'pending'
          ? t('leaveRequest.modify')
          : t('leaveRequest.submit')
  }

  const subtitle = rehearsal?.start_time
    ? formatRehearsalRange(rehearsal.start_time, rehearsal.end_time ?? null)
    : t('leaveRequest.notFound')
  const hasAttachment = mode === 'view' ? !!viewAttachmentUrl : !!keepOldAttachment

  return (
        <View className={`${darkClass} flex h-full flex-col bg-page-bg`}>
      <View className='flex-1 overflow-y-auto px-4 pb-safe'>
       <View className='pt-2 pb-2'>
        <Text className='block text-sm text-text-muted'>{subtitle}</Text>
        <View className='my-4 h-px bg-border' />

        {mode === 'view' && current ? (
          <>
            <Text className='block text-sm font-medium text-text'>{t('leaveRequest.reasonLabel')}</Text>
            <Text className='mt-1 block whitespace-pre-wrap text-sm text-text-muted'>{current.reason}</Text>
            <Text className='mb-1 mt-4 block text-sm font-medium text-text'>{t('leaveRequest.attachmentLabel')}</Text>
            {attachmentLoading ? (
              <Text className='text-xs text-text-muted'>{t('leaveRequest.attachmentLoading')}</Text>
            ) : hasAttachment && viewAttachmentUrl ? (
              <Image
                src={viewAttachmentUrl}
                mode='widthFix'
                className='w-full rounded-lg border border-border'
                onClick={() => viewAttachmentUrl && Taro.previewImage({ urls: [viewAttachmentUrl] })}
              />
            ) : (
              <Text className='text-xs text-text-muted'>{t('leaveRequest.noAttachment')}</Text>
            )}
          </>
        ) : (
          <>
            <Text className='block text-sm font-medium text-text'>{t('leaveRequest.reasonLabel')}</Text>
            <Textarea
              value={reason}
              onInput={(e) => setReason(String((e.detail as { value?: string })?.value ?? ''))}
              placeholder={t('leaveRequest.reasonPlaceholder')}
              className='mt-1 w-full rounded-lg border border-border bg-surface p-2 text-sm text-text'
              style={{ minHeight: '96px' }}
            />
            <Text className='mb-1 mt-4 block text-sm font-medium text-text'>{t('leaveRequest.attachmentLabel')}</Text>
            {attachmentPreview ? (
              <View className='relative'>
                <Image src={attachmentPreview} mode='widthFix' className='w-full rounded-lg border border-border' />
                <View
                  className='mt-2 inline-flex items-center rounded-full bg-danger-bg px-3 py-1'
                  onClick={handleClearAttachment}
                >
                  <Text className='text-sm text-danger'>{t('leaveRequest.deleteAttachment')}</Text>
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
                  <Text className='text-sm text-danger'>{t('leaveRequest.deleteAttachment')}</Text>
                </View>
              </View>
            ) : (
              <View
                className='inline-flex items-center rounded-full border border-border bg-surface px-3 py-1'
                onClick={handleChooseImage}
              >
                <Text className='text-sm text-text'>{t('leaveRequest.addAttachment')}</Text>
              </View>
            )}
            {attachmentFile === null && keepOldAttachment && (
              <Text className='mt-1 block text-xs text-text-muted'>{t('leaveRequest.keepOldAttachment')}</Text>
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
              {current?.status === 'rejected' ? t('leaveRequest.resubmit') : t('leaveRequest.editLink')} &gt;
            </Text>
          </View>
        )}
        {mode === 'form' && leaveStatus === 'pending' && (
          <View className='mt-3 flex items-center justify-center'>
            <Text className='text-sm text-danger' onClick={handleCancel}>
              {t('leaveRequest.withdraw')} &gt;
            </Text>
          </View>
        )}
       </View>
       </View>
       </View>
   )
}
