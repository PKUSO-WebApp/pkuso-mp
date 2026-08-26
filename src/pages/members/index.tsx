import { useMemo, useState } from 'react'
import { View, Text, ScrollView } from '@tarojs/components'
import { TextField } from '@/components/ui/FormFields'
import { useDidShow } from '@tarojs/taro'
import { useUser } from '@/context/user-context'
import { useThemeClass } from '@/context/theme-context'
import { useProfiles } from '@/hooks/useProfiles'
import { useMyProfile } from '@/hooks/useMyProfile'
import { AdminBlockedPage } from '@/components/admin-blocked-page'

import { Card } from '@/components/ui/Card'
import { PageHeader } from '@/components/page-header'
import { groupProfilesByInstrument } from '@/lib/roster-utils'
import { filterByName } from '@/lib/name-search'
import { maskedValue } from '@/lib/privacy'
import { useT, useNavTitle } from '@/i18n'
import { translateInstrument } from '@/lib/instrument-i18n'
import { translateJoinDate } from '@/lib/join-date-i18n'
import type { ProfileRow } from '@/types/database'
import { MemberDetailModal } from './components/member-detail-modal'
import './index.scss'

export default function Members() {
  const { t } = useT()
  useNavTitle('members.navTitle')
  const { user: currentUser } = useUser()
  const { profile: myProfile } = useMyProfile()
  const {
    data: allProfiles,
    loading: rosterLoading,
    error: rosterError,
    fetch,
  } = useProfiles({ status: 'approved' })

  const darkClass = useThemeClass()

  // 切回本 tab 时重新拉取花名册（Taro tab 页常驻内存不卸载，仅靠挂载时一次
  // 拉取会导致「改完资料回来仍是旧数据」；回到本页静默刷新，旧数据仍展示不闪加载）
  useDidShow(() => {
    void fetch()
  })

  // 拼音/首字母搜索：输入为空时显示全部
  const [searchQuery, setSearchQuery] = useState('')
  // 详情弹窗：点击花名册成员打开（只读）
  const [selectedUser, setSelectedUser] = useState<ProfileRow | null>(null)

  // 花名册不含管理端账号（与 Web 端一致）
  const rosterRows = useMemo(
    () => (allProfiles ?? []).filter((r) => (r.role ?? '') !== 'admin') as ProfileRow[],
    [allProfiles]
  )

  const filteredRows = useMemo(
    () => filterByName(rosterRows, searchQuery),
    [rosterRows, searchQuery]
  )

  const grouped = useMemo(() => groupProfilesByInstrument(filteredRows), [filteredRows])

  // 管理端登录：不提供小程序管理端，显示阻断页（规划 §1：admin 留在 Web）
  if (myProfile?.role === 'admin') {
    return <AdminBlockedPage />
  }

  return (
    /* 根容器 flex 化（矮屏布局）：头部固定，搜索框 + 列表整体独立滚动 */
    <View className={`${darkClass} flex h-full min-h-0 flex-col bg-page-bg px-4 pb-safe`}>
      <View className='mt-1 mb-3'>
        <PageHeader title={t('members.title')} subtitle={t('members.subtitle')} />
      </View>

      <ScrollView scrollY className='flex-1 min-h-0'>
        {/* 底部留白：底边栏固定覆盖在页面底部（高 50px + 安全区），
            花名册成员多时 ScrollView 末行会被底边栏遮挡、无法滚到底，故内容底部补足留白 */}
        <View className='pb-8'>
          <TextField
            boxClass='mb-4 w-full overflow-hidden rounded-xl border border-border bg-muted px-3'
            placeholder={t('members.searchPlaceholder')}
            value={searchQuery}
            onInput={(e) => setSearchQuery(e.detail.value)}
          />

          {rosterLoading && (allProfiles ?? []).length === 0 ? (
            <Text className='block py-8 text-center text-xs text-text-subtle'>
              {t('common.actions.loading')}
            </Text>
          ) : rosterError ? (
            <Card className='border-danger-bg bg-danger-bg/80'>
              <Text className='block px-3 py-2 text-sm text-danger'>{rosterError}</Text>
            </Card>
          ) : rosterRows.length === 0 ? (
            <Text className='block py-8 text-center text-xs text-text-muted'>
              {t('members.emptyApproved')}
            </Text>
          ) : grouped.length === 0 ? (
            <Text className='block py-8 text-center text-xs text-text-muted'>
              {t('members.emptyMatch')}
            </Text>
          ) : (
            <View>
              {grouped.map(({ group, users }) => (
                <View key={group} className='mb-5'>
                  <Text className='mb-2 block text-xs font-medium uppercase tracking-wide text-text-muted'>
                    {translateInstrument(group, t)}
                  </Text>
                  <View>
                    {users.map((u) => {
                      // 查看自己时隐私开关不生效，显示原值；查看他人按对方开关掩码
                      const isSelf = u.id === currentUser?.id
                      return (
                        <View
                          key={u.id}
                          className='mb-2 rounded-xl border border-border bg-card px-3 py-2'
                          onClick={() => setSelectedUser(u)}
                        >
                          <View className='flex flex-wrap items-center gap-1.5'>
                            <Text className='font-medium text-text'>
                              {(translateInstrument(u.instrument, t) || '—') +
                                ' - ' +
                                (u.full_name ?? '—')}
                            </Text>
                            {u.is_section_leader && (
                              <Text className='rounded-full bg-warning-bg px-1.5 py-1 text-xs text-warning'>
                                {t('members.sectionLeader')}
                              </Text>
                            )}
                          </View>
                          <Text className='mt-1 block text-text-muted'>
                            {t('members.collegeLabel')}
                            {u.college?.trim() || '—'}
                          </Text>
                          <Text className='mt-1 block text-text-muted'>
                            {t('members.emailLabel')}
                            {maskedValue(!isSelf && u.hide_email, u.email)}
                          </Text>
                          <Text className='mt-1 block text-text-subtle'>
                            {t('members.joinDateLabel')}
                            {translateJoinDate(
                              maskedValue(!isSelf && u.hide_join_date, u.join_date),
                              t
                            )}
                            {/* 在团标记（"-" 连接）：true=团员，false=团友；null 未填写则不追加 */}
                            {u.is_in_orchestra == null
                              ? ''
                              : `-${u.is_in_orchestra ? t('members.tagMember') : t('members.tagFriend')}`}
                          </Text>
                        </View>
                      )
                    })}
                  </View>
                </View>
              ))}
            </View>
          )}
        </View>
      </ScrollView>

      <MemberDetailModal
        open={!!selectedUser}
        user={selectedUser}
        viewerId={currentUser?.id ?? null}
        onClose={() => setSelectedUser(null)}
      />
    </View>
  )
}
