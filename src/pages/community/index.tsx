import { useMemo, useState } from 'react'
import { View, Text } from '@tarojs/components'
import { usePosts } from '@/hooks/usePosts'
import { useMyProfile } from '@/hooks/useMyProfile'
import { useThemeClass } from '@/context/theme-context'
import { AdminBlockedPage } from '@/components/admin-blocked-page'
import { useTabBarBadgeSync } from '@/components/badge-sync-context'
import { Toggle } from '@/components/ui/Toggle'
import { Card } from '@/components/ui/Card'
import { parseLocalISO, getLocalDateString } from '@/lib/date-utils'
import type { PostRowWithAuthor, PostType } from '@/types/database'
import { PostDetailModal } from './components/post-detail-modal'
import './index.scss'

const TYPE_LABEL: Record<PostType, string> = {
  ensemble: '重奏',
  gathering: '团建',
}

function formatPostDate(createdAt: string | null | undefined): string {
  if (!createdAt) return ''
  const d = parseLocalISO(createdAt)
  if (Number.isNaN(d.getTime())) return ''
  return getLocalDateString(d)
}

function hasSectionText(value: string | null | undefined): boolean {
  return value != null && value.trim() !== ''
}

/**
 * 社区公告页（demo 阶段只读）。
 * 重奏/团建分类切换 + 公告列表 + 卡片点击查看详情；发布/编辑/删除 pending（规划 §1 阶段 3）。
 * 管理端登录显示阻断页（规划 §1：admin 留在 Web）。
 */
export default function Community() {
  const { data: posts, loading, error } = usePosts()
  const { profile: myProfile } = useMyProfile()
  const darkClass = useThemeClass()
  useTabBarBadgeSync()
  const [view, setView] = useState<PostType>('ensemble')
  const [detailPost, setDetailPost] = useState<PostRowWithAuthor | null>(null)

  const list = useMemo(() => posts.filter((p) => (p.type as PostType) === view), [posts, view])

  // 管理端登录：不提供小程序管理端，显示阻断页（规划 §1：admin 留在 Web）
  if (myProfile?.role === 'admin') {
    return <AdminBlockedPage />
  }

  if (detailPost) {
    return <PostDetailModal post={detailPost} onClose={() => setDetailPost(null)} />
  }

  return (
    <View className={`${darkClass} flex h-full min-h-0 flex-col bg-page-bg px-4 pb-safe`}>
      {/* 头部 */}
      <View className='mt-1 mb-3'>
        <View className='flex items-center justify-between gap-2'>
          <View>
            <Text className='text-lg font-semibold text-text'>公告板</Text>
            <Text className='mt-1 block text-xs text-text-muted'>重奏与团建信息</Text>
          </View>
        </View>
        <View className='mt-2'>
          <Toggle
            options={['ensemble', 'gathering']}
            value={view}
            onChange={(v) => setView(v as PostType)}
            getLabel={(k) => (k === 'ensemble' ? '重奏' : '团建')}
          />
        </View>
      </View>

      {/* 公告列表（可滚动） */}
      <View className='flex-1 min-h-0 overflow-y-auto'>
        {loading ? (
          <Text className='block py-12 text-center text-xs text-text-muted'>加载中…</Text>
        ) : error ? (
          <Card className='border-danger-bg bg-danger-bg/80'>
            <Text className='block px-3 py-2 text-sm text-danger'>{error}</Text>
          </Card>
        ) : list.length === 0 ? (
          <Text className='block py-12 text-center text-xs text-text-muted'>
            暂无「{TYPE_LABEL[view]}」公告。
          </Text>
        ) : (
          <View className='space-y-3'>
            {list.map((post) => (
              <Card key={post.id} onClick={() => setDetailPost(post)}>
                <View className='flex items-start justify-between gap-2'>
                  <View className='min-w-0 flex-1'>
                    <Text className='block text-sm font-semibold text-text'>{post.title}</Text>
                    <Text className='mt-0.5 block text-label text-text-muted'>
                      {TYPE_LABEL[post.type as PostType]}
                      {formatPostDate(post.created_at) && ` · ${formatPostDate(post.created_at)}`}
                    </Text>
                    {post.type === 'ensemble' && hasSectionText(post.missing_sections) && (
                      <View className='mt-2'>
                        <Text className='inline-flex rounded-full bg-primary px-2 py-0.5 text-caption font-bold text-primary-foreground'>
                          缺：{post.missing_sections!.trim()}
                        </Text>
                      </View>
                    )}
                    {hasSectionText(post.content) && (
                      <Text className='mt-1 block text-xs text-text-muted'>{post.content}</Text>
                    )}
                  </View>
                </View>
              </Card>
            ))}
          </View>
        )}
      </View>
    </View>
  )
}
