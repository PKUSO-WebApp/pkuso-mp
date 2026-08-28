import { useMemo, useState, useEffect, useRef } from 'react'
import { View, Text } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { usePosts } from '@/hooks/usePosts'
import { useMyProfile } from '@/hooks/useMyProfile'
import { useThemeClass } from '@/context/theme-context'
import { tAppError } from '@/lib/appError'
import { useT, useNavTitle } from '@/i18n'
import { translateInstrument } from '@/lib/instrument-i18n'
import { AdminBlockedPage } from '@/components/admin-blocked-page'

import { Toggle } from '@/components/ui/Toggle'
import { Card } from '@/components/ui/Card'
import { ListState } from '@/components/ui/ListState'
import { parseLocalISO, getLocalDateString } from '@/lib/date-utils'
import {
  dismissCommunityDot,
  getCommunityDismissedAt,
  isCommunityDotOn,
  subscribePostSeen,
} from '@/lib/postSeen'
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
  const [view, setView] = useState<PostType>('ensemble')
  // 镜像当前分类：useDidShow 回调需读到进入瞬间的选择而非旧闭包
  const viewRef = useRef<PostType>('ensemble')
  viewRef.current = view

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

  const handleSwitchType = (next: PostType) => {
    setView(next)
    // 进入对应分类 tab 即消除该处右上角红点
    dismissCommunityDot(next)
  }

  // 分类红点：点亮 ⇔ 该分类最新公告晚于「最近一次进入该分类」的消除时间戳；
  // 新公告到达自然重新点亮。dotTick 用于点击消除后强制重算。
  const [dotTick, setDotTick] = useState(0)
  useEffect(() => subscribePostSeen(() => setDotTick((n) => n + 1)), [])
  const latestByType = useMemo(() => {
    const acc: Record<PostType, number> = { ensemble: 0, gathering: 0 }
    for (const p of posts) {
      if (!p.created_at) continue
      const ts = parseLocalISO(p.created_at).getTime()
      if (!Number.isNaN(ts)) {
        const key = p.type as PostType
        if (ts > (acc[key] ?? 0)) acc[key] = ts
      }
    }
    return acc
  }, [posts])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const hasUnviewedEnsemble = isCommunityDotOn(
    latestByType.ensemble || null,
    getCommunityDismissedAt('ensemble')
  )
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const hasUnviewedGathering = isCommunityDotOn(
    latestByType.gathering || null,
    getCommunityDismissedAt('gathering')
  )
  // dotTick 变化仅用于触发重算（点击消除后徽标即时消失）
  void dotTick

  // 管理端登录：不提供小程序管理端，显示阻断页（规划 §1：admin 留在 Web）
  if (myProfile?.role === 'admin') {
    return <AdminBlockedPage />
  }

  return (
    <View
      className={`${darkClass} flex h-full min-h-0 flex-col bg-page-bg px-4`}
      style={{ paddingBottom: 'calc(50px + env(safe-area-inset-bottom))' }}
    >
      {/* 分类切换 */}
      <View className='mt-1 mb-3'>
        <Toggle
          options={['ensemble', 'gathering']}
          value={view}
          onChange={(v) => handleSwitchType(v as PostType)}
          getLabel={(k) =>
            k === 'ensemble' ? t('community.type.ensemble') : t('community.type.gathering')
          }
          badges={{ ensemble: hasUnviewedEnsemble, gathering: hasUnviewedGathering }}
        />
      </View>

      {/* 公告列表（可滚动） */}
      <View className='flex-1 min-h-0 overflow-y-auto'>
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
                    {post.type === 'ensemble' && hasSectionText(post.missing_sections) && (
                      <View className='mt-2'>
                        <Text className='inline-flex rounded-full bg-primary px-2 py-0.5 text-caption font-bold text-primary-foreground'>
                          {t('community.missing', {
                            sections: (post.missing_sections ?? '')
                              .split(/[,，、\s]+/)
                              .filter(Boolean)
                              .map((s) => translateInstrument(s, t))
                              .join('、'),
                          })}
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
