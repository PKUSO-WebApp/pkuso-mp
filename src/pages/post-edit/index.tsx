import { useEffect, useRef, useState } from 'react'
import { View, Text, Input, Textarea, Image } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { usePosts } from '@/hooks/usePosts'
import { useThemeClass } from '@/context/theme-context'
import { PageHeader } from '@/components/page-header'
import type { PostRowWithAuthor, PostType } from '@/types/database'
import type { UploadFileLike } from '@/hooks/useLeaveRequests'
import './index.scss'

const MAX_IMAGE_BYTES = 1024 * 1024
const TYPE_LABEL: Record<PostType, string> = {
  ensemble: '重奏',
  gathering: '团建',
}

/**
 * 编辑活动页（「我的活动」卡片「编辑 ›」进入，带 id 参数）。
 * 类型固定（不可改）；可编辑 标题 / 内容 /（重奏）已有声部·缺声部 / 联系方式 / 配图；
 * 底部大按钮「取消 / 保存」。保存走内容安全审核 + 可选图片上传替换。
 */
export default function PostEditPage() {
  const id = Taro.getCurrentInstance().router?.params?.id
  const { fetchOne, updatePost, saving } = usePosts()
  const darkClass = useThemeClass()

  const [post, setPost] = useState<PostRowWithAuthor | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [type, setType] = useState<PostType>('ensemble')
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [currentSections, setCurrentSections] = useState('')
  const [missingSections, setMissingSections] = useState('')
  const [contactInfo, setContactInfo] = useState('')
  const [imageFile, setImageFile] = useState<UploadFileLike | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [removeImage, setRemoveImage] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const submittingRef = useRef(false)

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
  }, [id, fetchOne])

  const handleChooseImage = () => {
    Taro.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const f = res.tempFiles?.[0] as unknown as UploadFileLike & { size?: number }
        if (!f) return
        if (typeof f.size === 'number' && f.size > MAX_IMAGE_BYTES) {
          Taro.showToast({ title: '图片过大，请压缩至 1MB 以内', icon: 'none' })
          return
        }
        setImageFile(f)
        setImagePreview(f.tempFilePath)
        setRemoveImage(false)
      },
    })
  }
  const handleClearImage = () => {
    setImageFile(null)
    setImagePreview(null)
    setRemoveImage(true)
  }

  const handleSubmit = async () => {
    if (submittingRef.current || isSubmitting || !id) return
    const t = title.trim()
    const c = content.trim()
    if (!t) {
      setError('请填写标题')
      return
    }
    if (!c) {
      setError('请填写内容')
      return
    }
    submittingRef.current = true
    setIsSubmitting(true)
    setError(null)
    try {
      const res = await updatePost(id, {
        type,
        title: t,
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
      Taro.showToast({ title: '已保存', icon: 'success' })
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
      <View className='flex min-h-screen items-center justify-center bg-bg'>
        <Text className='text-xs text-text-muted'>加载中…</Text>
      </View>
    )
  }

  if (notFound || !post) {
    return (
      <View className='flex min-h-screen flex-col items-center justify-center bg-bg px-4'>
        <Text className='text-sm text-text-muted'>活动不存在或已删除</Text>
        <View
          className='mt-4 rounded-full bg-primary px-4 py-2 text-xs font-medium text-primary-foreground'
          onClick={() => void Taro.navigateBack()}
        >
          返回
        </View>
      </View>
    )
  }

  return (
    <View className={`${darkClass} flex h-full min-h-0 flex-col bg-page-bg`}>
      <View className='flex-1 overflow-y-auto px-4 pb-safe'>
        <View className='pt-2 pb-2'>
          <PageHeader title='编辑活动' subtitle={`公告板 · ${TYPE_LABEL[type]}`} />

          {/* 标题 */}
          <Text className='block text-sm font-medium text-text'>标题</Text>
          <View className='mt-1 w-full overflow-hidden rounded-lg border border-border bg-surface px-3'>
            <Input
              value={title}
              onInput={(e) => setTitle(String(e.detail.value ?? ''))}
              placeholder='请输入标题'
              maxlength={50}
              className='h-10 w-full bg-transparent text-sm text-text'
            />
          </View>

          {/* 内容 */}
          <Text className='mb-1 mt-4 block text-sm font-medium text-text'>内容</Text>
          <View className='mt-1 w-full overflow-hidden rounded-lg border border-border bg-surface px-3'>
            <Textarea
              value={content}
              onInput={(e) => setContent(String((e.detail as { value?: string })?.value ?? ''))}
              placeholder='请输入内容'
              className='w-full bg-transparent py-2 text-sm text-text'
              style={{ minHeight: '120px' }}
            />
          </View>

          {/* 重奏专属：声部 */}
          {showSections && (
            <>
              <Text className='mb-1 mt-4 block text-sm font-medium text-text'>已有声部</Text>
              <View className='mt-1 w-full overflow-hidden rounded-lg border border-border bg-surface px-3'>
                <Input
                  value={currentSections}
                  onInput={(e) => setCurrentSections(String(e.detail.value ?? ''))}
                  placeholder='如：小提琴'
                  className='h-10 w-full bg-transparent text-sm text-text'
                />
              </View>
              <Text className='mb-1 mt-4 block text-sm font-medium text-text'>缺声部</Text>
              <View className='mt-1 w-full overflow-hidden rounded-lg border border-border bg-surface px-3'>
                <Input
                  value={missingSections}
                  onInput={(e) => setMissingSections(String(e.detail.value ?? ''))}
                  placeholder='如：中提'
                  className='h-10 w-full bg-transparent text-sm text-text'
                />
              </View>
            </>
          )}

          {/* 联系方式 */}
          <Text className='mb-1 mt-4 block text-sm font-medium text-text'>联系方式</Text>
          <View className='mt-1 w-full overflow-hidden rounded-lg border border-border bg-surface px-3'>
            <Input
              value={contactInfo}
              onInput={(e) => setContactInfo(String(e.detail.value ?? ''))}
              placeholder='选填，供感兴趣的同学联系你'
              className='h-10 w-full bg-transparent text-sm text-text'
            />
          </View>

          {/* 配图 */}
          <Text className='mb-1 mt-4 block text-sm font-medium text-text'>配图</Text>
          {previewSrc ? (
            <View className='relative'>
              <Image src={previewSrc} mode='widthFix' className='w-full rounded-lg border border-border' />
              <View
                className='mt-2 inline-flex items-center rounded-full bg-danger-bg px-3 py-1'
                onClick={handleClearImage}
              >
                <Text className='text-sm text-danger'>删除图片</Text>
              </View>
            </View>
          ) : (
            <View
              className='inline-flex items-center rounded-full border border-border bg-surface px-3 py-1'
              onClick={handleChooseImage}
            >
              <Text className='text-sm text-text'>添加图片</Text>
            </View>
          )}

          {error && <Text className='mt-3 block text-xs text-danger'>{error}</Text>}

          {/* 底部大按钮：保存 / 取消（各自独立大按钮，不拆分同级） */}
          <View className='mt-6 space-y-3 pb-safe'>
            <View
              className={`flex h-11 w-full items-center justify-center rounded-xl text-base font-medium text-white ${
                busy ? 'opacity-90' : ''
              }`}
              style={{ backgroundColor: '#000000' }}
              onClick={busy ? undefined : handleSubmit}
            >
              {busy ? '保存中…' : '保存'}
            </View>
            <View
              className='flex h-11 w-full items-center justify-center rounded-xl border border-border bg-card text-base font-medium text-text'
              onClick={() => void Taro.navigateBack()}
            >
              取消
            </View>
          </View>
        </View>
      </View>
    </View>
  )
}
