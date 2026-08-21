import { View, Text, Image } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { Modal } from '@/components/ui/Modal'
import { Card } from '@/components/ui/Card'
import { parseLocalISO, getLocalDateString } from '@/lib/date-utils'
import type { PostRowWithAuthor, PostType } from '@/types/database'

const TYPE_LABEL: Record<PostType, string> = {
  ensemble: '重奏',
  gathering: '团建',
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

type Props = {
  post: PostRowWithAuthor | null
  onClose: () => void
}

/**
 * 公告详情弹窗（只读，demo 阶段）。
 * 展示标题、类型、创建者、声部（已有/缺，仅重奏）、内容、配图（点击放大）、联系方式（一键复制）。
 * 编辑/删除入口 pending（规划 §1 阶段 3：发布 + 内容安全）。
 */
export function PostDetailModal({ post, onClose }: Props) {
  if (!post) return null

  const author = post.profiles?.full_name ? `创建者：${post.profiles.full_name}` : '未知'
  const showCurrent = post.type === 'ensemble' && hasSectionText(post.current_sections)
  const showMissing = post.type === 'ensemble' && hasSectionText(post.missing_sections)

  const handlePreview = () => {
    if (post.image_url) {
      void Taro.previewImage({ urls: [post.image_url], current: post.image_url })
    }
  }

  const handleCopy = () => {
    if (!post.contact_info) return
    void Taro.setClipboardData({ data: post.contact_info }).then(() => {
      void Taro.showToast({ title: '已复制', icon: 'success' })
    })
  }

  return (
    <Modal open={!!post} onClose={onClose} title={post.title} position='bottom'>
      <View className='mt-1 space-y-3'>
        <Text className='block text-label text-text-muted'>
          {TYPE_LABEL[post.type as PostType]} · {author}
        </Text>

        {(showCurrent || showMissing) && (
          <View className='flex flex-wrap gap-1.5'>
            {showCurrent && (
              <Text className='rounded-full bg-muted px-2 py-0.5 text-caption text-text-muted'>
                已有：{post.current_sections!.trim()}
              </Text>
            )}
            {showMissing && (
              <Text className='rounded-full bg-primary px-2 py-0.5 text-caption font-bold text-primary-foreground'>
                缺：{post.missing_sections!.trim()}
              </Text>
            )}
          </View>
        )}

        {hasSectionText(post.content) && (
          <Text className='block whitespace-pre-line text-xs leading-relaxed text-text'>
            {post.content}
          </Text>
        )}

        {post.image_url && (
          <Image
            src={post.image_url}
            mode='aspectFit'
            className='max-h-64 w-full rounded-2xl border border-border'
            onClick={handlePreview}
          />
        )}

        {hasSectionText(post.contact_info) && (
          <Card className='flex items-center justify-between gap-2'>
            <View>
              <Text className='block text-label font-medium text-text-muted'>联系方式</Text>
              <Text className='block text-xs text-text'>{post.contact_info}</Text>
            </View>
            <View
              className='shrink-0 rounded-full bg-primary px-3 py-1.5 text-label font-medium text-primary-foreground'
              onClick={handleCopy}
            >
              一键复制
            </View>
          </Card>
        )}

        {formatPostDate(post.created_at) && (
          <Text className='block text-caption text-text-subtle'>
            {formatPostDate(post.created_at)}
          </Text>
        )}
      </View>
    </Modal>
  )
}
