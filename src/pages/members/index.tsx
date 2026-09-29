import { useMemo, useState } from 'react'
import { View, Text, ScrollView } from '@tarojs/components'
import { TextField } from '@/components/ui/FormFields'
import { tAppError } from '@/lib/appError'
import Taro, { useDidShow, usePullDownRefresh } from '@tarojs/taro'
import { useUser } from '@/context/user-context'
import { useThemeClass } from '@/context/theme-context'
import { useProfiles } from '@/hooks/useProfiles'
import { useMyProfile } from '@/hooks/useMyProfile'
import { StaffBlockedPage } from '@/components/staff-blocked-page'
import { isOrchestraMember } from '@/lib/role-gate'
import { usePlaceholderStyle } from '@/hooks/usePlaceholderStyle'

import { ListState } from '@/components/ui/ListState'
import { StatusChip } from '@/components/ui/StatusChip'
import { groupProfilesByInstrument } from '@/lib/roster-utils'
import { filterByName } from '@/lib/name-search'
import { useT, useNavTitle } from '@/i18n'
import { translateInstrument, matchInstrumentSection } from '@/lib/instrument-i18n'
import { translateJoinDate } from '@/lib/join-date-i18n'
import type { ProfileRow } from '@/types/database'
import { MemberDetailModal } from './components/member-detail-modal'
import './index.scss'

export default function Members() {
  const { t } = useT()
  useNavTitle('members.navTitle')
  const placeholderStyle = usePlaceholderStyle()
  const { user: currentUser } = useUser()
  const { profile: myProfile } = useMyProfile()
  const {
    data: allProfiles,
    loading: rosterLoading,
    error: rosterError,
    fetch,
  } = useProfiles({ status: 'approved' })

  const darkClass = useThemeClass()

  // 游客模式：未登录时显示空态提示
  const isGuest = !currentUser

  // 切回本 tab 时重新拉取花名册（Taro tab 页常驻内存不卸载，仅靠挂载时一次
  // 拉取会导致「改完资料回来仍是旧数据」；回到本页静默刷新，旧数据仍展示不闪加载）
  useDidShow(() => {
    void fetch()
  })

  // 下拉刷新：重取花名册
  usePullDownRefresh(() => {
    void fetch()
    Taro.stopPullDownRefresh()
  })

  // 拼音/首字母搜索：输入为空时显示全部
  const [searchQuery, setSearchQuery] = useState('')
  // 详情弹窗：点击花名册成员打开（只读）
  const [selectedUser, setSelectedUser] = useState<ProfileRow | null>(null)

  // 花名册只列团员：判据是「**是** member」（不是「不是 admin」）—— admin 与谱务账号都
  // 不是团员，将来新增角色也不必回来改这里。role 列可空，空值按**列默认值** member 算，
  // 别写 `?? ''`：那会让 role 为空的老账号从花名册里静默消失。
  // 另排除测试账号（姓名以 test 开头，不区分大小写）
  const rosterRows = useMemo(
    () =>
      (allProfiles ?? []).filter((r) => {
        if (!isOrchestraMember(r.role)) return false
        const name = (r.full_name ?? '').trim().toLowerCase()
        if (name.startsWith('test')) return false
        return true
      }) as ProfileRow[],
    [allProfiles]
  )

  const sectionMatch = useMemo(() => matchInstrumentSection(searchQuery), [searchQuery])

  const filteredRows = useMemo(
    () =>
      sectionMatch
        ? rosterRows.filter((r) => sectionMatch.includes(r.instrument ?? ''))
        : filterByName(rosterRows, searchQuery),
    [rosterRows, searchQuery, sectionMatch]
  )

  const grouped = useMemo(() => groupProfilesByInstrument(filteredRows), [filteredRows])

  // 游客模式：未登录时显示空态提示（必须在 admin 检查之前）
  if (isGuest) {
    return (
      <View
        className={`${darkClass} flex h-full min-h-0 flex-col bg-page-bg`}
        style={{ paddingBottom: 'calc(50px + env(safe-area-inset-bottom))' }}
      >
        <View className='flex flex-1 items-center justify-center px-4'>
          <Text className='text-center text-sm text-text-muted'>{t('common.guestHint')}</Text>
        </View>
      </View>
    )
  }

  // 非团员账号（admin / score_manager 等专职账号）一律阻断：小程序只服务乐团成员。
  // 判据走共用的 isOrchestraMember —— 黑名单式每加一个角色都要回来改 6 处，漏改即静默放行。
  if (!isOrchestraMember(myProfile?.role)) {
    return <StaffBlockedPage role={myProfile?.role} />
  }

  return (
    /* 根容器 flex 化（矮屏布局）：头部固定，搜索框 + 列表整体独立滚动 */
    <View
      className={`${darkClass} flex h-full min-h-0 flex-col bg-page-bg`}
      style={{ paddingBottom: 'calc(50px + env(safe-area-inset-bottom))' }}
    >
      <ScrollView scrollY className='flex-1 min-h-0'>
        {/* 底部留白：底边栏固定覆盖在页面底部（高 50px + 安全区），
            花名册成员多时 ScrollView 末行会被底边栏遮挡、无法滚到底，故内容底部补足留白 */}
        <View className='px-4'>
          <TextField
            boxClass='mt-3 mb-4 w-full overflow-hidden rounded-xl border border-border bg-muted px-3'
            placeholder={t('members.searchPlaceholder')}
            value={searchQuery}
            onInput={(e) => setSearchQuery(e.detail.value)}
            placeholderStyle={placeholderStyle}
          />

          {/* 两种空态（花名册本身为空 / 搜索无匹配）各自取词，故 emptyText 分情况；
              loading 沿用「仅内容为空才显示」——切回本 tab 是静默刷新，不该闪加载 */}
          <ListState
            loading={rosterLoading}
            isEmpty={grouped.length === 0}
            error={tAppError(t, rosterError)}
            emptyText={
              rosterRows.length === 0 ? t('members.emptyApproved') : t('members.emptyMatch')
            }
            onRetry={() => void fetch()}
          >
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
                            <Text className='text-base font-normal text-text'>
                              {u.full_name ?? '—'}
                            </Text>
                            {u.is_section_leader && (
                              <StatusChip tone='warning'>{t('members.sectionLeader')}</StatusChip>
                            )}
                          </View>
                          {u.college?.trim() && !(u.hide_college && !isSelf) && (
                            <Text className='mt-1 block text-xs text-text-muted'>
                              {t('members.collegeLabel')}
                              {u.college}
                            </Text>
                          )}
                          {u.email && !(u.hide_email && !isSelf) && (
                            <Text className='mt-1 block text-xs text-text-muted'>
                              {t('members.emailLabel')}
                              {u.email}
                            </Text>
                          )}
                          {u.join_date && !(u.hide_join_date && !isSelf) && (
                            <Text className='mt-1 block text-xs text-text-muted'>
                              {t('members.joinDateLabel')}
                              {translateJoinDate(u.join_date, t)}
                              {/* 在团标记（"-" 连接）：true=团员，false=团友；null 未填写则不追加 */}
                              {u.is_in_orchestra == null
                                ? ''
                                : `-${u.is_in_orchestra ? t('members.tagMember') : t('members.tagAlumni')}`}
                            </Text>
                          )}
                        </View>
                      )
                    })}
                  </View>
                </View>
              ))}
            </View>
          </ListState>
          <View style={{ height: '8px' }} />
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
