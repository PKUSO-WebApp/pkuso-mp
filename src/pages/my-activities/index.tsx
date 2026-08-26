import { useCallback, useEffect, useState } from 'react'
import { View, Text } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { usePosts } from '@/hooks/usePosts'
import { useThemeClass } from '@/context/theme-context'
import { useT, useNavTitle } from '@/i18n'
import { translateInstrument } from '@/lib/instrument-i18n'
import { PageHeader } from '@/components/page-header'
import { Card } from '@/components/ui/Card'
import { Modal } from '@/components/ui/Modal'
import type { PostRowWithAuthor } from '@/types/database'
import './index.scss'

function hasText(value: string | null | undefined): boolean {
  return value != null && value.trim() !== ''
}

/**
 * 我的活动管理页（「我的-设置-我的活动」进入）。
 * 列出当前用户发布的活动（含已锁定，便于解锁），卡片含右上角「···」小菜单（锁定/删除）
 * 与右下角「编辑 ›」入口；删除走二次确认弹窗。锁定即置 is_locked，
 * 与社区公告过滤（is_locked=false）联动，对他人不可见。
 */
export default function MyActivitiesPage() {
  const { mine, mineLoading, mineError, fetchMine, setLocked, deletePost } = usePosts()
  const darkClass = useThemeClass()
  const { t } = useT()
  useNavTitle('myActivities.navTitle')

  const [menuId, setMenuId] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback((opts?: { silent?: boolean }) => {
    void fetchMine(opts)
  }, [fetchMine])

  useEffect(() => {
    void load()
  }, [load])
  // 切回本页静默重取：已有数据时不翻 loading，避免整页闪烁
  useDidShow(() => {
    void load({ silent: true })
  })

  const handleToggleLock = async (post: PostRowWithAuthor) => {
    setBusyId(post.id)
    const res = await setLocked(post.id, !post.is_locked)
    setBusyId(null)
    setMenuId(null)
    if (!res.ok) Taro.showToast({ title: res.error, icon: 'none' })
  }

  const handleConfirmDelete = async () => {
    if (!confirmDeleteId) return
    setBusyId(confirmDeleteId)
    const res = await deletePost(confirmDeleteId)
    setBusyId(null)
    setConfirmDeleteId(null)
    if (!res.ok) Taro.showToast({ title: res.error, icon: 'none' })
  }

  return (
    <View className={`${darkClass} flex h-full min-h-0 flex-col bg-page-bg px-4 pb-safe`}>
      <View className='mt-1 mb-3'>
        <PageHeader title={t('myActivities.title')} subtitle={t('myActivities.subtitle')} />
      </View>

      <View className='flex-1 min-h-0 overflow-y-auto'>
        {/* 仅在无数据时才显示 loading（有旧数据静默刷新不闪） */}
        {mineLoading && mine.length === 0 ? (
          <Text className='block py-12 text-center text-xs text-text-muted'>{t('common.actions.loading')}</Text>
        ) : mineError ? (
          <Text className='block px-3 py-2 text-sm text-danger'>{mineError}</Text>
        ) : mine.length === 0 ? (
          <Text className='block py-12 text-center text-xs text-text-muted'>{t('myActivities.empty')}</Text>
        ) : (
          <View className='pb-4'>
            {mine.map((post) => {
              const isEnsemble = post.type === 'ensemble'
              const contact = post.contact_info?.trim()
              const menuOpen = menuId === post.id
              return (
                <Card key={post.id} className='relative mb-3'>
                  {/* 顶行：标题 + ··· 小菜单 */}
                  <View className='flex items-start justify-between gap-2'>
                    <Text className='min-w-0 flex-1 text-sm font-semibold text-text'>{post.title}</Text>
                    <View className='relative shrink-0'>
                      <View
                        className='px-1 py-0.5 text-[10px] leading-none text-text-muted'
                        onClick={() => setMenuId(menuOpen ? null : post.id)}
                      >
                        <Text className='text-[10px] leading-none text-text-muted'>···</Text>
                      </View>
                      {menuOpen && (
                        <>
                          {/* 点击空白处关闭小菜单 */}
                          <View
                            className='fixed inset-0 z-[55]'
                            onClick={() => setMenuId(null)}
                          />
                          <View className='absolute right-0 top-6 z-[56] w-28 rounded-xl border border-border bg-surface py-1 shadow-lg'>
                            {/* 管理员锁定的帖子：用户不可解锁，不出现该菜单项 */}
                            {post.locked_by !== 'admin' && (
                              <View
                                className='px-4 py-2 text-sm text-text'
                                onClick={() => void handleToggleLock(post)}
                              >
                                {post.is_locked ? t('common.actions.unlock') : t('common.actions.lock')}
                              </View>
                            )}
                            <View
                              className='px-4 py-2 text-sm text-danger'
                              onClick={() => {
                                setConfirmDeleteId(post.id)
                                setMenuId(null)
                              }}
                            >
                              {t('common.actions.delete')}
                            </View>
                          </View>
                        </>
                      )}
                    </View>
                  </View>

                  {/* 已有声部 / 需要声部（仅重奏） */}
                  {isEnsemble && hasText(post.current_sections) && (
                    <Text className='mt-2 block text-xs text-primary'>
                      {t('myActivities.currentSectionsLabel')}
                      {translateInstrument(post.current_sections, t)}
                    </Text>
                  )}
                  {isEnsemble && hasText(post.missing_sections) && (
                    <Text className='mt-1 block text-xs text-primary'>
                      {t('myActivities.missingSectionsLabel')}
                      {translateInstrument(post.missing_sections, t)}
                    </Text>
                  )}

                  {/* 联系方式（重奏/团建均显示） */}
                  <Text className='mt-2 block text-xs text-text-muted'>
                    {t('myActivities.contactLabel')}
                    {contact || t('myActivities.contactNone')}
                  </Text>

                  {post.is_locked && (
                    <Text className='mt-1 block text-xs text-text-subtle'>
                      {post.locked_by === 'admin'
                        ? t('myActivities.lockedByAdmin')
                        : t('myActivities.lockedHint')}
                    </Text>
                  )}

                  {/* 底行：编辑 › */}
                  <View
                    className='mt-2 flex justify-end'
                    onClick={() => void Taro.navigateTo({ url: `/pages/post-edit/index?id=${post.id}` })}
                  >
                    <Text className='text-xs text-danger'>{t('common.actions.edit')} ›</Text>
                  </View>
                </Card>
              )
            })}
          </View>
        )}
      </View>

      {/* 删除确认 */}
      <Modal open={!!confirmDeleteId} onClose={() => setConfirmDeleteId(null)} title={t('myActivities.confirmDeleteTitle')}>
        <Text className='block text-sm text-text'>{t('myActivities.confirmDeleteContent')}</Text>
        <View className='mt-4 flex gap-3'>
          <View
            className='flex-1 rounded-xl border border-border bg-card py-2 text-center'
            onClick={() => setConfirmDeleteId(null)}
          >
            <Text className='text-sm text-text'>{t('common.actions.cancel')}</Text>
          </View>
          <View
            className='flex-1 rounded-xl bg-danger py-2 text-center'
            onClick={() => void handleConfirmDelete()}
          >
            <Text className='text-sm text-primary-foreground'>
              {busyId === confirmDeleteId ? t('myActivities.deleting') : t('common.actions.delete')}
            </Text>
          </View>
        </View>
      </Modal>
    </View>
  )
}
