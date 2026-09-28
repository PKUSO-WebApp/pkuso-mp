import { useEffect, useRef, useState } from 'react'
import { View, Text, Input, Textarea, Image, ScrollView } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { usePosts } from '@/hooks/usePosts'
import { usePageRestore } from '@/hooks/usePageRestore'
import { useEditDraft } from '@/hooks/useEditDraft'
import { useThemeClass } from '@/context/theme-context'
import { useT, useNavTitle } from '@/i18n'
import type { PostRowWithAuthor, PostType } from '@/types/database'
import type { UploadFileLike } from '@/hooks/useLeaveRequests'
import './index.scss'

const MAX_IMAGE_BYTES = 1024 * 1024

/** 编辑现场的草稿快照：chooseMedia 往返后用它还原，避免被服务端旧值覆盖 */
type PostEditDraft = {
  type: PostType
  title: string
  content: string
  currentSections: string
  missingSections: string
  contactInfo: string
  imageFile: UploadFileLike | null
  imagePreview: string | null
  removeImage: boolean
}

/**
 * 编辑活动页（「我的活动」卡片「编辑 ›」进入，带 id 参数）。
 * 类型固定（不可改）；可编辑 标题 / 内容 /（重奏）已有声部·缺声部 / 联系方式 / 配图；
 * 底部大按钮「取消 / 保存」。保存走内容安全审核 + 可选图片上传替换。
 */
export default function PostEditPage() {
  // usePageRestore 缓存 id，防止 chooseMedia 销毁页面后丢失
  const cachedId = usePageRestore<string>('id')
  const id = cachedId
  const { fetchOne, updatePost, saving } = usePosts()
  const darkClass = useThemeClass()
  const { t } = useT()
  useNavTitle('postEdit.navTitle')

  // 编辑现场草稿：按 id 隔离，chooseMedia 往返（页面重建）后靠它还原用户已敲的内容，
  // 否则下方 fetchOne 会把标题/正文写回服务端旧值。
  const editDraft = useEditDraft<PostEditDraft>(`post-edit:${id ?? 'none'}`, {
    type: 'ensemble',
    title: '',
    content: '',
    currentSections: '',
    missingSections: '',
    contactInfo: '',
    imageFile: null,
    imagePreview: null,
    removeImage: false,
  })
  const initialDraft = editDraft.hasDraft() ? editDraft.get() : null

  const [post, setPost] = useState<PostRowWithAuthor | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [type, setType] = useState<PostType>(initialDraft?.type ?? 'ensemble')
  const [title, setTitle] = useState(initialDraft?.title ?? '')
  const [content, setContent] = useState(initialDraft?.content ?? '')
  const [currentSections, setCurrentSections] = useState(initialDraft?.currentSections ?? '')
  const [missingSections, setMissingSections] = useState(initialDraft?.missingSections ?? '')
  const [contactInfo, setContactInfo] = useState(initialDraft?.contactInfo ?? '')
  const [imageFile, setImageFile] = useState<UploadFileLike | null>(initialDraft?.imageFile ?? null)
  const [imagePreview, setImagePreview] = useState<string | null>(
    initialDraft?.imagePreview ?? null
  )
  const [removeImage, setRemoveImage] = useState(initialDraft?.removeImage ?? false)
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const submittingRef = useRef(false)

  /** 落一次草稿：写**完整快照**（当前 state + 显式覆盖的 patch），理由见 useEditDraft */
  const saveDraft = (patch: Partial<PostEditDraft> = {}) => {
    editDraft.save({
      type,
      title,
      content,
      currentSections,
      missingSections,
      contactInfo,
      imageFile,
      imagePreview,
      removeImage,
      ...patch,
    })
  }

  useEffect(() => {
    if (!id) {
      setLoading(false)
      setNotFound(true)
      return
    }
    let active = true
    void fetchOne(id).then((p) => {
      if (!active) return
      setLoading(false)
      if (!p) {
        setNotFound(true)
        return
      }
      setPost(p)
      // 有草稿 = 用户正在编辑（含重建后还原）：只补 post 元数据，**不能**把服务端
      // 旧值写回表单，否则用户选图前敲的标题/正文会被抹掉
      if (editDraft.hasDraft()) return
      setType(p.type as PostType)
      setTitle(p.title)
      setContent(p.content ?? '')
      setCurrentSections(p.current_sections ?? '')
      setMissingSections(p.missing_sections ?? '')
      setContactInfo(p.contact_info ?? '')
      setImagePreview(p.image_url ?? null)
    })
    return () => {
      active = false
    }
  }, [id, fetchOne, editDraft])

  const handleChooseImage = () => {
    // 选图前先落盘：chooseMedia 可能销毁页面，草稿是唯一能跨过去的东西
    saveDraft()
    Taro.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const f = res.tempFiles?.[0] as unknown as UploadFileLike & { size?: number }
        if (!f) return
        if (typeof f.size === 'number' && f.size > MAX_IMAGE_BYTES) {
          Taro.showToast({ title: t('postEdit.imageTooLarge'), icon: 'none' })
          return
        }
        setImageFile(f)
        setImagePreview(f.tempFilePath)
        setRemoveImage(false)
        saveDraft({ imageFile: f, imagePreview: f.tempFilePath, removeImage: false })
      },
    })
  }
  const handleClearImage = () => {
    setImageFile(null)
    setImagePreview(null)
    setRemoveImage(true)
    saveDraft({ imageFile: null, imagePreview: null, removeImage: true })
  }

  const handleSubmit = async () => {
    if (submittingRef.current || isSubmitting || !id) return
    const titleTrim = title.trim()
    const c = content.trim()
    if (!titleTrim) {
      setError(t('postEdit.errorTitle'))
      return
    }
    if (!c) {
      setError(t('postEdit.errorContent'))
      return
    }
    submittingRef.current = true
    setIsSubmitting(true)
    setError(null)
    try {
      const res = await updatePost(id, {
        type,
        title: title,
        content: c,
        current_sections: type === 'ensemble' ? currentSections : '',
        missing_sections: type === 'ensemble' ? missingSections : '',
        contact_info: contactInfo,
        imageFile: removeImage ? null : (imageFile ?? undefined),
      })
      if (!res.ok) {
        setError(res.error)
        return
      }
      editDraft.clear()
      Taro.showToast({ title: t('postEdit.saved'), icon: 'success' })
      setTimeout(() => Taro.navigateBack(), 300)
    } finally {
      submittingRef.current = false
      setIsSubmitting(false)
    }
  }

  const busy = isSubmitting || saving
  const showSections = type === 'ensemble'
  const previewSrc = imageFile ? imageFile.tempFilePath : imagePreview

  if (loading) {
    return (
      <View className={`${darkClass} flex min-h-screen items-center justify-center bg-page-bg`}>
        <Text className='text-xs text-text-muted'>{t('common.actions.loading')}</Text>
      </View>
    )
  }

  if (notFound || !post) {
    return (
      <View
        className={`${darkClass} flex min-h-screen flex-col items-center justify-center bg-page-bg px-4`}
      >
        <Text className='text-sm text-text-muted'>{t('postEdit.notFound')}</Text>
        <View
          className='mt-4 rounded-full bg-primary px-4 py-2 text-xs font-medium text-primary-foreground'
          onClick={() => void Taro.navigateBack()}
        >
          {t('postEdit.back')}
        </View>
      </View>
    )
  }

  return (
    <View className={`${darkClass} flex h-full min-h-0 flex-col bg-page-bg pb-safe`}>
      <ScrollView scrollY className='flex-1 min-h-0'>
        <View className='w-full px-4 pt-2 pb-4'>
          {/* 标题 */}
          <Text className='block text-sm font-medium text-text'>{t('postEdit.titleLabel')}</Text>
          <View className='mt-1 w-full overflow-hidden rounded-lg border border-border bg-surface px-3'>
            <Input
              value={title}
              onInput={(e) => {
                const value = String(e.detail.value ?? '')
                setTitle(value)
                saveDraft({ title: value })
              }}
              placeholder={t('postEdit.titlePlaceholder')}
              maxlength={50}
              className='h-10 w-full bg-transparent text-sm text-text'
            />
          </View>

          {/* 内容 */}
          <Text className='mb-1 mt-4 block text-sm font-medium text-text'>
            {t('postEdit.contentLabel')}
          </Text>
          <View className='mt-1 w-full overflow-hidden rounded-lg border border-border bg-surface px-3'>
            <Textarea
              value={content}
              onInput={(e) => {
                const value = String((e.detail as { value?: string })?.value ?? '')
                setContent(value)
                saveDraft({ content: value })
              }}
              placeholder={t('postEdit.contentPlaceholder')}
              className='w-full bg-transparent py-2 text-sm text-text'
              style={{ minHeight: '120px' }}
            />
          </View>

          {/* 重奏专属：声部 */}
          {showSections && (
            <>
              <Text className='mb-1 mt-4 block text-sm font-medium text-text'>
                {t('postEdit.currentSectionsLabel')}
              </Text>
              <View className='mt-1 w-full overflow-hidden rounded-lg border border-border bg-surface px-3'>
                <Input
                  value={currentSections}
                  onInput={(e) => {
                    const value = String(e.detail.value ?? '')
                    setCurrentSections(value)
                    saveDraft({ currentSections: value })
                  }}
                  placeholder={t('postEdit.currentSectionsPlaceholder')}
                  className='h-10 w-full bg-transparent text-sm text-text'
                />
              </View>
              <Text className='mb-1 mt-4 block text-sm font-medium text-text'>
                {t('postEdit.missingSectionsLabel')}
              </Text>
              <View className='mt-1 w-full overflow-hidden rounded-lg border border-border bg-surface px-3'>
                <Input
                  value={missingSections}
                  onInput={(e) => {
                    const value = String(e.detail.value ?? '')
                    setMissingSections(value)
                    saveDraft({ missingSections: value })
                  }}
                  placeholder={t('postEdit.missingSectionsPlaceholder')}
                  className='h-10 w-full bg-transparent text-sm text-text'
                />
              </View>
            </>
          )}

          {/* 联系方式 */}
          <Text className='mb-1 mt-4 block text-sm font-medium text-text'>
            {t('postEdit.contactLabel')}
          </Text>
          <View className='mt-1 w-full overflow-hidden rounded-lg border border-border bg-surface px-3'>
            <Input
              value={contactInfo}
              onInput={(e) => {
                const value = String(e.detail.value ?? '')
                setContactInfo(value)
                saveDraft({ contactInfo: value })
              }}
              placeholder={t('postEdit.contactPlaceholder')}
              className='h-10 w-full bg-transparent text-sm text-text'
            />
          </View>

          {/* 配图 */}
          <Text className='mb-1 mt-4 block text-sm font-medium text-text'>
            {t('postEdit.imageLabel')}
          </Text>
          {previewSrc ? (
            <View className='relative'>
              <Image
                src={previewSrc}
                mode='widthFix'
                className='w-full rounded-lg border border-border'
              />
              <View
                className='mt-2 inline-flex items-center rounded-full bg-danger-bg px-3 py-1'
                onClick={handleClearImage}
              >
                <Text className='text-sm text-danger'>{t('postEdit.deleteImage')}</Text>
              </View>
            </View>
          ) : (
            <View
              className='inline-flex items-center rounded-full border border-border bg-surface px-3 py-1'
              onClick={handleChooseImage}
            >
              <Text className='text-sm text-text'>{t('postEdit.addImage')}</Text>
            </View>
          )}

          {error && <Text className='mt-3 block text-xs text-danger'>{error}</Text>}

          {/* 底部大按钮：保存 / 取消（各自独立大按钮，不拆分同级） */}
          <View className='mt-6'>
            <View
              className={`flex h-11 w-full items-center justify-center rounded-xl bg-primary text-base font-medium text-primary-foreground ${
                busy ? 'opacity-90' : ''
              }`}
              onClick={busy ? undefined : handleSubmit}
            >
              {busy ? t('postEdit.saving') : t('common.actions.save')}
            </View>
            <View
              className='mt-3 flex h-11 w-full items-center justify-center rounded-xl border border-border bg-card text-base font-medium text-text'
              onClick={() => void Taro.navigateBack()}
            >
              {t('common.actions.cancel')}
            </View>
          </View>
        </View>
      </ScrollView>
    </View>
  )
}
