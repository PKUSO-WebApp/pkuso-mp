import { useEffect, useRef, useState } from 'react'
import { View, Text, Textarea, Image, ScrollView } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { useLeaveRequests, type UploadFileLike } from '@/hooks/useLeaveRequests'
import { useUser } from '@/context/user-context'
import { supabase } from '@/lib/supabase'
import { formatRehearsalRange } from '@/lib/date-utils'
import { useT, useNavTitle } from '@/i18n'
import { useThemeClass } from '@/context/theme-context'
import type { LeaveRequestRow, RehearsalRow } from '@/types/database'
import './index.scss'

const isActive = (r: LeaveRequestRow) => r.status !== 'withdrawn' && r.status !== 'canceled'

export default function LeaveRequestPage() {
  const router = Taro.getCurrentInstance().router
  // 首次渲染时缓存导航参数，防止 chooseMedia 后页面被微信销毁重建导致 router.params 丢失
  const initialParamsRef = useRef({
    rehearsalId: Number(router?.params?.rehearsalId),
    start: router?.params?.start,
    end: router?.params?.end,
  })
  const rehearsalId = initialParamsRef.current.rehearsalId
  const decodedStart = initialParamsRef.current.start
    ? decodeURIComponent(initialParamsRef.current.start)
    : null
  const decodedEnd = initialParamsRef.current.end
    ? decodeURIComponent(initialParamsRef.current.end)
    : null
  const darkClass = useThemeClass()
  useNavTitle('leaveRequest.navTitle')
  const { user } = useUser()
  const [rehearsal, setRehearsal] = useState<RehearsalRow | null>(null)
  const [rehearsalLoading, setRehearsalLoading] = useState(true)
  useEffect(() => {
    if (!rehearsalId) {
      setRehearsal(null)
      setRehearsalLoading(false)
      return
    }
    let cancelled = false
    setRehearsalLoading(true)
    void (async () => {
      const { data, error } = await supabase
        .from('rehearsals')
        .select('*')
        .eq('id', rehearsalId)
        .single()
      if (cancelled) return
      if (error) {
        setRehearsal(null)
        setRehearsalLoading(false)
        return
      }
      setRehearsal((data as RehearsalRow) ?? null)
      setRehearsalLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [rehearsalId])
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
  // 记录已加载签名 URL 对应的旧附件地址，查看态↔编辑态切换时复用、避免重复拉取
  const loadedAttUrlRef = useRef<string | null>(null)

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
    const showOld =
      (mode === 'view' || (mode === 'form' && keepOldAttachment)) && !!current?.attachment_url
    if (!showOld) {
      setViewAttachmentUrl(null)
      setAttachmentLoading(false)
      loadedAttUrlRef.current = null
      return
    }
    // 同一旧附件地址在查看态↔编辑态之间切换时，复用已加载的签名 URL，不重复拉取；
    // 仅当附件地址本身变化（如重新提交新附件）才重新请求
    if (viewAttachmentUrl && loadedAttUrlRef.current === current.attachment_url) {
      setAttachmentLoading(false)
      return
    }
    let cancelled = false
    setAttachmentLoading(true)
    void (async () => {
      const res = await getSignedUrl(current.attachment_url!)
      if (cancelled) return
      loadedAttUrlRef.current = current.attachment_url!
      setViewAttachmentUrl(res.url ?? null)
      setAttachmentLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [
    mode,
    current?.id,
    current?.attachment_url,
    keepOldAttachment,
    getSignedUrl,
    viewAttachmentUrl,
  ])

  // 页面从后台回前台（如 chooseMedia 返回）时，若数据丢失则重取
  useDidShow(() => {
    if (rehearsalId && !rehearsal && !rehearsalLoading) {
      setRehearsalLoading(true)
    }
  })

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
      let attachmentUrl = keepOldAttachment ? (current?.attachment_url ?? null) : null
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
        const payload = {
          reason: trimmed,
          attachment_url: attachmentUrl,
          old_attachment_url: current?.attachment_url ?? null,
        }
        ok =
          editing.status === 'rejected'
            ? await reapply(editing.id, payload)
            : await updateReason(editing.id, payload)
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
    const res = await Taro.showModal({
      title: t('leaveRequest.withdrawConfirmTitle'),
      content: t('leaveRequest.withdrawConfirmContent'),
      confirmText: t('leaveRequest.withdraw'),
      cancelText: t('common.actions.cancel'),
    })
    if (!res.confirm) return
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
  let submitClass = 'bg-signin text-signin-foreground'
  let submitDisabled = false
  if (mode === 'view') {
    if (leaveStatus === 'pending') {
      submitLabel = t('leaveRequest.statusPending')
      submitClass = 'bg-warning-bg text-warning'
      submitDisabled = true
    } else if (leaveStatus === 'approved') {
      submitLabel = t('leaveRequest.statusApproved')
      submitClass = 'bg-success-bg text-success'
      submitDisabled = true
    } else if (leaveStatus === 'rejected') {
      submitLabel = t('leaveRequest.statusRejected')
      submitClass = 'bg-danger-bg text-danger'
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

  const subtitle = decodedStart
    ? formatRehearsalRange(decodedStart, decodedEnd || null)
    : rehearsal?.start_time
      ? formatRehearsalRange(rehearsal.start_time, rehearsal.end_time ?? null)
      : rehearsalLoading
        ? ''
        : t('leaveRequest.notFound')
  const hasAttachment = mode === 'view' ? !!viewAttachmentUrl : !!keepOldAttachment

  return (
    <View className={`${darkClass} flex h-full w-full flex-col overflow-hidden bg-page-bg pb-safe`}>
      <ScrollView scrollY className='flex-1 min-h-0'>
        <View className='w-full px-4 pt-2 pb-4'>
          <Text className='block text-sm text-text-muted'>{subtitle}</Text>
          <View className='my-4 h-px bg-border' />

          {mode === 'view' && current ? (
            <>
              <Text className='block text-sm font-medium text-text'>
                {t('leaveRequest.reasonLabel')}
              </Text>
              <Text className='mt-1 block whitespace-pre-wrap text-sm text-text-muted'>
                {current.reason}
              </Text>
              <Text className='mb-1 mt-4 block text-sm font-medium text-text'>
                {t('leaveRequest.attachmentLabel')}
              </Text>
              {attachmentLoading ? (
                <Text className='text-xs text-text-muted'>
                  {t('leaveRequest.attachmentLoading')}
                </Text>
              ) : hasAttachment && viewAttachmentUrl ? (
                <Image
                  src={viewAttachmentUrl}
                  mode='widthFix'
                  className='w-full rounded-lg border border-border'
                  onClick={() =>
                    viewAttachmentUrl && Taro.previewImage({ urls: [viewAttachmentUrl] })
                  }
                />
              ) : (
                <Text className='text-xs text-text-muted'>{t('leaveRequest.noAttachment')}</Text>
              )}
            </>
          ) : (
            <>
              <Text className='block text-sm font-medium text-text'>
                {t('leaveRequest.reasonLabel')}
              </Text>
              {/* 外层 View 约束宽度（AGENTS.md 表单模式），内层 Textarea 透明背景铺满 */}
              <View className='mt-1 w-full overflow-hidden rounded-lg border border-border bg-surface p-2'>
                <Textarea
                  value={reason}
                  onInput={(e) => setReason(String((e.detail as { value?: string })?.value ?? ''))}
                  placeholder={t('leaveRequest.reasonPlaceholder')}
                  className='h-24 w-full bg-transparent text-sm text-text'
                />
              </View>
              <Text className='mb-1 mt-4 block text-sm font-medium text-text'>
                {t('leaveRequest.attachmentLabel')}
              </Text>
              {attachmentPreview ? (
                <View className='relative'>
                  <Image
                    src={attachmentPreview}
                    mode='widthFix'
                    className='w-full rounded-lg border border-border'
                  />
                  <View
                    className='mt-2 inline-flex items-center rounded-full bg-danger-bg px-3 py-1'
                    onClick={handleClearAttachment}
                  >
                    <Text className='text-sm text-danger'>
                      {t('leaveRequest.deleteAttachment')}
                    </Text>
                  </View>
                </View>
              ) : keepOldAttachment && viewAttachmentUrl ? (
                <View className='relative'>
                  <Image
                    src={viewAttachmentUrl}
                    mode='widthFix'
                    className='w-full rounded-lg border border-border'
                    onClick={() =>
                      viewAttachmentUrl && Taro.previewImage({ urls: [viewAttachmentUrl] })
                    }
                  />
                  <View
                    className='mt-2 inline-flex items-center rounded-full bg-danger-bg px-3 py-1'
                    onClick={handleRemoveOldAttachment}
                  >
                    <Text className='text-sm text-danger'>
                      {t('leaveRequest.deleteAttachment')}
                    </Text>
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
                <Text className='mt-1 block text-xs text-text-muted'>
                  {t('leaveRequest.keepOldAttachment')}
                </Text>
              )}
              {error && <Text className='mt-3 block text-xs text-danger'>{error}</Text>}
            </>
          )}
          <View className='mt-6'>
            <View
              className={`inline-flex h-11 w-full items-center justify-center rounded-xl px-4 text-center text-base font-medium ${submitClass} ${
                submitDisabled ? 'opacity-90' : ''
              }`}
              onClick={submitDisabled || busy ? undefined : handleSubmit}
            >
              {submitLabel}
            </View>
          </View>
          {mode === 'view' && showEdit && (
            <View className='mt-3 flex items-center justify-center'>
              <Text className='text-sm text-danger' onClick={handleEdit}>
                {current?.status === 'rejected'
                  ? t('leaveRequest.resubmit')
                  : t('leaveRequest.editLink')}{' '}
                &gt;
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
      </ScrollView>
    </View>
  )
}
