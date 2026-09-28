import { useEffect, useRef, useState } from 'react'
import { View, Text, Textarea, Image, ScrollView } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { useLeaveRequests, type UploadFileLike } from '@/hooks/useLeaveRequests'
import { useEditDraft } from '@/hooks/useEditDraft'
import { usePageRestore } from '@/hooks/usePageRestore'
import { useUser } from '@/context/user-context'
import { supabase } from '@/lib/supabase'
import { formatRehearsalRange } from '@/lib/date-utils'
import { useT, useNavTitle } from '@/i18n'
import { useThemeClass } from '@/context/theme-context'
import type { LeaveRequestRow, RehearsalRow } from '@/types/database'
import './index.scss'

const isActive = (r: LeaveRequestRow) => r.status !== 'withdrawn' && r.status !== 'canceled'

/** 只有这两种状态的申请可以编辑/改内容（决定是否进编辑态、以及提交走哪个分支） */
const isEditable = (s: LeaveRequestRow['status']) => s === 'pending' || s === 'rejected'

/** 请假表单的草稿快照：chooseMedia 往返导致页面重建时用它还原编辑现场 */
type LeaveDraft = {
  mode: 'form' | 'view'
  editing: LeaveRequestRow | null
  reason: string
  attachmentFile: UploadFileLike | null
  attachmentPreview: string | null
  keepOldAttachment: boolean
}

export default function LeaveRequestPage() {
  // 导航参数：chooseMedia 后 router.params 会丢，走共享 hook 缓存
  const rehearsalId = Number(usePageRestore<string>('rehearsalId'))
  const cachedStart = usePageRestore<string>('start')
  const cachedEnd = usePageRestore<string>('end')
  const decodedStart = cachedStart ? decodeURIComponent(cachedStart) : null
  const decodedEnd = cachedEnd ? decodeURIComponent(cachedEnd) : null
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
      // maybeSingle：排练可能已被删除，0 行时返回 data:null 而不是抛 406 中断流程
      const { data, error } = await supabase
        .from('rehearsals')
        .select('*')
        .eq('id', rehearsalId)
        .maybeSingle()
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

  // 表单草稿：按排练 id 隔离，防止 chooseMedia 往返（页面重建 / router.params 丢失）
  // 后用户填的理由与选好的附件一起消失。还原走 useState 惰性初值，不走 useDidShow——
  // 下方 fetchMine 的 setState 是异步的，会晚于 useDidShow 落地并把表单清空。
  const editDraft = useEditDraft<LeaveDraft>(`leave-request:${rehearsalId}`, {
    mode: 'view',
    editing: null,
    reason: '',
    attachmentFile: null,
    attachmentPreview: null,
    keepOldAttachment: false,
  })
  const initialDraft = editDraft.hasDraft() ? editDraft.get() : null

  const [mode, setMode] = useState<'form' | 'view'>(initialDraft?.mode ?? 'view')
  const [current, setCurrent] = useState<LeaveRequestRow | null>(null)
  const [editing, setEditing] = useState<LeaveRequestRow | null>(initialDraft?.editing ?? null)
  const [error, setError] = useState<string | null>(null)
  const [reason, setReason] = useState(initialDraft?.reason ?? '')
  const [attachmentFile, setAttachmentFile] = useState<UploadFileLike | null>(
    initialDraft?.attachmentFile ?? null
  )
  const [attachmentPreview, setAttachmentPreview] = useState<string | null>(
    initialDraft?.attachmentPreview ?? null
  )
  const [keepOldAttachment, setKeepOldAttachment] = useState(
    initialDraft?.keepOldAttachment ?? false
  )
  const [viewAttachmentUrl, setViewAttachmentUrl] = useState<string | null>(null)
  const [attachmentLoading, setAttachmentLoading] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const submittingRef = useRef(false)
  // 记录已加载签名 URL 对应的旧附件地址，查看态↔编辑态切换时复用、避免重复拉取
  const loadedAttUrlRef = useRef<string | null>(null)

  /**
   * 落一次草稿。**必须写完整快照**（当前 state + 显式覆盖的 patch）：草稿只有在
   * 每个字段都在场时，还原出来才是用户当时看到的那个表单。调用方传 patch 是因为
   * setState 之后闭包里的 state 还是旧值。
   */
  const saveDraft = (patch: Partial<LeaveDraft> = {}) => {
    editDraft.save({
      mode,
      editing,
      reason,
      attachmentFile,
      attachmentPreview,
      keepOldAttachment,
      ...patch,
    })
  }

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
      // 服务端状态已不允许编辑（如编辑期间被审核通过）时草稿作废并退出编辑态：
      // 否则下次进入会带着旧草稿回到编辑态，甚至对一条已通过的申请走「修改」分支。
      if (found && !isEditable(found.status) && editDraft.hasDraft()) {
        editDraft.clear()
        setMode('view')
        setEditing(null)
        setKeepOldAttachment(false)
      }
      // 表单里还有用户内容（刚被重建后还原，或用户正在编辑）→ 不能清，否则会抹掉
      // 用户填的理由与附件。viewAttachmentUrl 是纯展示缓存，交给下方 effect 自己算。
      if (editDraft.hasDraft()) return
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
  }, [rehearsalId, fetchMine, editDraft])

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

  // 页面重新可见（含被重建后首次 show）时：① 排练信息丢了就重取；② 草稿比当前
  // state 新就应用一次——chooseMedia 的回调可能落在被销毁的旧实例上（它只能写模块
  // 级草稿，写不到新实例的 state），新实例要靠这次 show 把选好的附件捞回来。
  useDidShow(() => {
    if (rehearsalId && !rehearsal && !rehearsalLoading) {
      setRehearsalLoading(true)
    }
    if (!editDraft.hasDraft()) return
    const draft = editDraft.get()
    setMode(draft.mode)
    setEditing(draft.editing)
    setReason(draft.reason)
    setAttachmentFile(draft.attachmentFile)
    setAttachmentPreview(draft.attachmentPreview)
    setKeepOldAttachment(draft.keepOldAttachment)
  })

  const handleChooseImage = () => {
    // 选图前先把完整现场落进草稿：chooseMedia 可能销毁页面，而它的回调也可能
    // 落在旧实例上——草稿是唯一能跨过去的东西
    saveDraft()
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
        saveDraft({
          attachmentFile: f,
          attachmentPreview: f.tempFilePath,
          keepOldAttachment: false,
        })
      },
    })
  }
  const handleClearAttachment = () => {
    setAttachmentFile(null)
    setAttachmentPreview(null)
    saveDraft({ attachmentFile: null, attachmentPreview: null })
  }
  const handleRemoveOldAttachment = () => {
    setKeepOldAttachment(false)
    setViewAttachmentUrl(null)
    saveDraft({ keepOldAttachment: false })
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
    saveDraft({
      mode: 'form',
      editing: current,
      reason: current.reason,
      keepOldAttachment: !!current.attachment_url,
      attachmentFile: null,
      attachmentPreview: null,
    })
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
      // 提交/撤销成功：表单已落地，草稿使命完成
      editDraft.clear()
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
      // 提交/撤销成功：表单已落地，草稿使命完成
      editDraft.clear()
      setError(null)
    } finally {
      submittingRef.current = false
      setIsSubmitting(false)
    }
  }

  const busy = isSubmitting || saving
  const leaveStatus = current?.status
  const showEdit = !!leaveStatus && isEditable(leaveStatus)

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
                  onInput={(e) => {
                    const value = String((e.detail as { value?: string })?.value ?? '')
                    setReason(value)
                    saveDraft({ reason: value })
                  }}
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
