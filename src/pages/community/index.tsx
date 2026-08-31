import { useMemo, useState, useRef } from 'react'
import { View, Text } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { usePosts } from '@/hooks/usePosts'
import { useMyProfile } from '@/hooks/useMyProfile'
import { useThemeClass } from '@/context/theme-context'
import { tAppError } from '@/lib/appError'
import { useT, useNavTitle } from '@/i18n'
import { translateInstrument } from '@/lib/instrument-i18n'
import { AdminBlockedPage } from '@/components/admin-blocked-page'

import { SegmentTabs } from '@/components/ui/SegmentTabs'
import { Card } from '@/components/ui/Card'
import { ListState } from '@/components/ui/ListState'
import { parseLocalISO, getLocalDateString } from '@/lib/date-utils'
import { dismissCommunityDot } from '@/lib/postSeen'
import type { PostType } from '@/types/database'
import './index.scss'

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
  const { data: posts, loading, error, fetch } = usePosts()
  const { profile: myProfile } = useMyProfile()
  const darkClass = useThemeClass()
  const { t } = useT()
  useNavTitle('community.navTitle')
  const [view, setView] = useState<'ensemble' | 'gathering'>('ensemble')
  const viewRef = useRef<'ensemble' | 'gathering'>('ensemble')
  viewRef.current = view

  const communityTabs: { key: 'ensemble' | 'gathering'; label: string }[] = [
    { key: 'ensemble', label: t('community.type.ensemble') },
    { key: 'gathering', label: t('community.type.gathering') },
  ]

  // 切回社区 tab 时立即刷新公告（镜像 rehearsal 的 useDidShow 刷新；
  // 静默重取：已有数据时不翻 loading，避免切 tab 整页闪烁）；
  // 点击社区即消除底边栏红点，同时消除当前所在分类的红点（点击某处即消除那一处）
  useDidShow(() => {
    void fetch({ silent: true })
    dismissCommunityDot('bar')
    dismissCommunityDot(viewRef.current)
  })

  const handleCreate = () => {
    Taro.navigateTo({ url: `/pages/post-create/index?type=${view}` })
  }

  const list = useMemo(() => posts.filter((p) => (p.type as PostType) === view), [posts, view])

  const handleSwitchType = (next: 'ensemble' | 'gathering') => {
    setView(next)
    // 进入对应分类 tab 即消除该处右上角红点
    dismissCommunityDot(next)
  }

  // 管理端登录：不提供小程序管理端，显示阻断页（规划 §1：admin 留在 Web）
  if (myProfile?.role === 'admin') {
    return <AdminBlockedPage />
  }

  return (
    <View
      className={`${darkClass} flex h-full min-h-0 flex-col bg-page-bg`}
      style={{ paddingBottom: 'calc(50px + env(safe-area-inset-bottom))' }}
    >
      {/* 分类切换 */}
      <View className='mb-3 mt-1'>
        <SegmentTabs tabs={communityTabs} value={view} onChange={handleSwitchType} />
      </View>

      {/* 公告列表（可滚动） */}
      <View className='flex-1 min-h-0 overflow-y-auto px-4'>
        <ListState
          loading={loading}
          isEmpty={list.length === 0}
          error={tAppError(t, error)}
          emptyText={t('community.empty', {
            type: t(view === 'ensemble' ? 'community.type.ensemble' : 'community.type.gathering'),
          })}
          onRetry={() => void fetch({ silent: true })}
        >
          <View>
            {list.map((post) => (
              <Card
                key={post.id}
                className='relative mb-3'
                onClick={() =>
                  void Taro.navigateTo({ url: `/pages/post-detail/index?id=${post.id}` })
                }
              >
                <View className='flex items-start justify-between gap-2'>
                  <View className='min-w-0 flex-1'>
                    <Text className='block text-sm font-semibold text-text'>{post.title}</Text>
                    <Text className='mt-0.5 block text-label text-text-muted'>
                      {t(
                        post.type === 'ensemble'
                          ? 'community.type.ensemble'
                          : 'community.type.gathering'
                      )}
                      {formatPostDate(post.created_at) && ` · ${formatPostDate(post.created_at)}`}
                    </Text>

                    {post.type === 'ensemble' && hasSectionText(post.current_sections) && (
                      <Text className='mt-1.5 block text-xs text-text-muted'>
                        {t('community.haveSections', {
                          sections: (post.current_sections ?? '')
                            .split(/[,，、\s]+/)
                            .filter(Boolean)
                            .map((s) => translateInstrument(s, t))
                            .join('、'),
                        })}
                      </Text>
                    )}
                    {post.type === 'ensemble' && hasSectionText(post.missing_sections) && (
                      <Text className='mt-1 block text-xs text-text-muted'>
                        {t('community.missing', {
                          sections: (post.missing_sections ?? '')
                            .split(/[,，、\s]+/)
                            .filter(Boolean)
                            .map((s) => translateInstrument(s, t))
                            .join('、'),
                        })}
                      </Text>
                    )}
                    {hasSectionText(post.content) && (
                      <Text className='mt-1 block text-xs text-text-muted'>{post.content}</Text>
                    )}
                    {post.profiles?.full_name && (
                      <Text className='mt-1 block text-xs text-text-muted'>
                        {t('community.creator', { name: post.profiles.full_name ?? '' })}
                      </Text>
                    )}
                  </View>
                </View>
              </Card>
            ))}
          </View>
        </ListState>
      </View>

      {/* 发布悬浮按钮（右下角，浮于底边栏之上） */}
      <View
        className='fixed flex items-center justify-center rounded-full bg-primary px-4 py-2 text-label font-medium text-primary-foreground shadow-lg'
        style={{
          right: '16px',
          bottom: 'calc(50px + env(safe-area-inset-bottom) + 16px)',
          zIndex: 50,
        }}
        onClick={handleCreate}
      >
        {t('community.publish')}
      </View>
    </View>
  )
}
