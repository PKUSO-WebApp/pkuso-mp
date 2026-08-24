import { useRef, useState } from 'react'
import { View, Text, Input, Textarea, Image } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { usePosts, type CreatePostInput } from '@/hooks/usePosts'
import { useMyProfile } from '@/hooks/useMyProfile'
import { useThemeClass } from '@/context/theme-context'
import { AdminBlockedPage } from '@/components/admin-blocked-page'
import { Toggle } from '@/components/ui/Toggle'
import { PageHeader } from '@/components/page-header'
import type { PostType } from '@/types/database'
import type { UploadFileLike } from '@/hooks/useLeaveRequests'

const MAX_IMAGE_BYTES = 1024 * 1024

export default function PostCreatePage() {
  const router = Taro.getCurrentInstance().router
  const initialType = ((router?.params?.type as PostType) || 'ensemble') as PostType

  const { create, saving } = usePosts()
  const { profile: myProfile } = useMyProfile()
  const darkClass = useThemeClass()

  const [type, setType] = useState<PostType>(initialType)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [currentSections, setCurrentSections] = useState('')
  const [missingSections, setMissingSections] = useState('')
  const [contactInfo, setContactInfo] = useState('')
  const [imageFile, setImageFile] = useState<UploadFileLike | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const submittingRef = useRef(false)

  // 管理端登录：小程序不提供管理端，阻断（规划 §1：admin 留在 Web）
  if (myProfile?.role === 'admin') {
    return <AdminBlockedPage />
  }

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
      },
    })
  }
  const handleClearImage = () => {
    setImageFile(null)
    setImagePreview(null)
  }

  const handleSubmit = async () => {
    if (submittingRef.current || isSubmitting) return
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
      const payload: CreatePostInput = {
        type,
        title: t,
        content: c,
        current_sections: type === 'ensemble' ? currentSections : '',
        missing_sections: type === 'ensemble' ? missingSections : '',
        contact_info: contactInfo,
        imageFile,
      }
      const res = await create(payload)
      if (!res.ok) {
        setError(res.error)
        return
      }
      Taro.showToast({ title: '发布成功', icon: 'success' })
      setTimeout(() => Taro.navigateBack(), 300)
    } finally {
      submittingRef.current = false
      setIsSubmitting(false)
    }
  }

  const busy = isSubmitting || saving
  const showSections = type === 'ensemble'

  return (
    <View className={`${darkClass} flex h-full min-h-0 flex-col bg-page-bg`}>
      <View className='flex-1 overflow-y-auto px-4 pb-safe'>
        <View className='pt-2 pb-2'>
          <PageHeader title='发布帖子' subtitle='公告板 · 内容将经过微信安全审核' />

          <View className='mt-4'>
            <Text className='block text-sm font-medium text-text'>类型</Text>
            <View className='mt-2'>
              <Toggle
                options={['ensemble', 'gathering']}
                value={type}
                onChange={(v) => setType(v as PostType)}
                getLabel={(k) => (k === 'ensemble' ? '重奏' : '团建')}
              />
            </View>
          </View>

          <View className='my-4 h-px bg-border' />

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
          {imagePreview ? (
            <View className='relative'>
              <Image src={imagePreview} mode='widthFix' className='w-full rounded-lg border border-border' />
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

          <View className='mt-6'>
            <View
              className={`inline-flex h-11 w-full items-center justify-center rounded-xl bg-primary px-4 text-center text-base font-medium text-primary-foreground ${
                busy ? 'opacity-90' : ''
              }`}
              onClick={busy ? undefined : handleSubmit}
            >
              {busy ? '发布中…' : '发布'}
            </View>
          </View>
        </View>
      </View>
    </View>
  )
}
