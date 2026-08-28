import { useEffect, useState } from 'react'
import { View, Text, Image } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { usePosts } from '@/hooks/usePosts'
import { markPostSeen } from '@/lib/postSeen'
import { parseLocalISO, getLocalDateString } from '@/lib/date-utils'
import type { PostRowWithAuthor, PostType } from '@/types/database'
import { useT, useNavTitle } from '@/i18n'
import { useThemeClass } from '@/context/theme-context'
import { translateInstrument } from '@/lib/instrument-i18n'
import './index.scss'

const TYPE_KEYS: Record<PostType, 'postDetail.type.ensemble' | 'postDetail.type.gathering'> = {
  ensemble: 'postDetail.type.ensemble',
  gathering: 'postDetail.type.gathering',
}

function hasSectionText(value: string | null | undefined): boolean {
  return value != null && value.trim() !== ''
}

function formatPostDate(createdAt: string | null | undefined): string {
  if (!createdAt) return ''
  const d = parseLocalISO(createdAt)
  if (Number.isNaN(d.getTime())) return ''
  return getLocalDateString(d)
}

/**
 * 公告详情页：由社区页卡片 navigateTo 进入（带 id 参数），自取数据。
 * 内容同原 PostDetailModal（只读 demo）：标题、类型、创建者、声部（重奏）、
 * 内容、配图（点击放大）、联系方式（一键复制）、发布时间。
 */
export default function PostDetailPage() {
  const { t } = useT()
  useNavTitle('postDetail.navTitle')
  const darkClass = useThemeClass()
  const id = Taro.getCurrentInstance().router?.params?.id
  const { fetchOne } = usePosts()
  const [post, setPost] = useState<PostRowWithAuthor | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

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
      if (!p) setNotFound(true)
      else {
        setPost(p)
        markPostSeen(p.id)
      }
    })
    return () => {
      active = false
    }
  }, [id, fetchOne])

  const handlePreview = () => {
    if (post?.image_url) {
      void Taro.previewImage({ urls: [post.image_url], current: post.image_url })
    }
  }

  const handleCopy = () => {
    if (!post?.contact_info) return
      void Taro.setClipboardData({ data: post.contact_info }).then(() => {
        void Taro.showToast({ title: t('postDetail.copied'), icon: 'success' })
      })
  }

  if (loading) {
    return (
      <View className={`${darkClass} flex min-h-screen items-center justify-center bg-page-bg`}>
         <Text className='text-xs text-text-muted'>{t('common.actions.loading')}</Text>
      </View>
    )
  }

  if (notFound || !post) {
    return (
      <View className={`${darkClass} flex min-h-screen flex-col items-center justify-center bg-page-bg px-4`}>
         <Text className='text-sm text-text-muted'>{t('postDetail.notFound')}</Text>
         <View
           className='mt-4 rounded-full bg-primary px-4 py-2 text-xs font-medium text-primary-foreground'
           onClick={() => void Taro.navigateBack()}
         >
           {t('postDetail.back')}
         </View>
      </View>
    )
  }

  const dateText = formatPostDate(post.created_at)

  return (
    <View className={`${darkClass} pk-page min-h-screen bg-page-bg px-4 py-4`}>
      {/* 标题（主字，中大）+ 类型（副字，中） */}
      <Text className='block text-xl font-semibold leading-snug text-text'>{post.title}</Text>
       <Text className='mt-1 block text-base text-text-muted'>
         {t(TYPE_KEYS[post.type as PostType])}
         {dateText ? ` · ${dateText}` : ''}
       </Text>

      {/* 分隔符 */}
      <View className='my-4 h-px w-full bg-border' />

      {/* 已有声部（仅重奏） */}
      {post.type === 'ensemble' && hasSectionText(post.current_sections) && (
        <View className='mb-4'>
          <Text className='block text-base font-medium text-text'>{t('postDetail.currentSections')}</Text>
          <Text className='mt-1 block whitespace-pre-line text-sm leading-relaxed text-text-muted'>
            {translateInstrument(post.current_sections, t)}
          </Text>
        </View>
      )}

      {/* 需要声部（仅重奏） */}
      {post.type === 'ensemble' && hasSectionText(post.missing_sections) && (
        <View className='mb-4'>
          <Text className='block text-base font-medium text-text'>{t('postDetail.missingSections')}</Text>
          <Text className='mt-1 block whitespace-pre-line text-sm leading-relaxed text-text-muted'>
            {translateInstrument(post.missing_sections, t)}
          </Text>
        </View>
      )}

      {/* 内容 */}
      {hasSectionText(post.content) && (
        <View className='mb-4'>
          <Text className='block text-base font-medium text-text'>{t('postDetail.content')}</Text>
          <Text className='mt-1 block whitespace-pre-line text-sm leading-relaxed text-text'>
            {post.content}
          </Text>
        </View>
      )}

      {/* 图片：整图显示（widthFix 按宽度等比缩放、完整呈现；h-auto 覆盖微信 image 默认 240px 高度，
          避免被组件盒子裁掉），点击预览看全图 */}
      {post.image_url && (
        <View className='mb-4'>
          <Text className='block text-base font-medium text-text'>{t('postDetail.image')}</Text>
          <Image
            src={post.image_url}
            mode='widthFix'
            className='mt-1 block h-auto w-full rounded-2xl border border-border'
            onClick={handlePreview}
          />
        </View>
      )}

      {/* 联系方式：复用现有组件（标签 + 值 + 一键复制） */}
      {hasSectionText(post.contact_info) && (
        <View className='mb-4 flex items-center justify-between gap-2 rounded-2xl border border-border bg-card p-3'>
          <View>
            <Text className='block text-base font-medium text-text'>{t('postDetail.contact')}</Text>
            <Text className='block text-sm text-text-muted'>{post.contact_info}</Text>
          </View>
          <View
            className='shrink-0 rounded-full bg-primary px-3 py-1.5 text-label font-medium text-primary-foreground'
            onClick={handleCopy}
          >
             {t('postDetail.copy')}
          </View>
        </View>
      )}
    </View>
  )
}
