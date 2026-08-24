import { useEffect, useRef, useState } from 'react'
import { View, Text, Input } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { useUser } from '@/context/user-context'
import { useThemeClass } from '@/context/theme-context'
import { useProfiles } from '@/hooks/useProfiles'
import { useAuth } from '@/hooks/useAuth'
import { isSyntheticEmail } from '@/lib/profile-gate'
import { useNotifications } from '@/hooks/useNotifications'
import { supabase } from '@/lib/supabase'
import { AdminBlockedPage } from '@/components/admin-blocked-page'
import { Modal } from '@/components/ui/Modal'
import { Toggle } from '@/components/ui/Toggle'
import { isValidEmail } from '@/lib/validation'
import { getAppVersionLabel } from '@/lib/version'
import type { NotificationCategory } from '@/types/database'
import { dataSyncBump } from '@/lib/dataSync'

import { AttendanceHistoryModal } from './components/attendance-history-modal'
import { ThemeModal } from './components/theme-modal'
import { FeedbackModal } from './components/feedback-modal'
import './index.scss'

// 通知栏目：信箱按钮 → 通知分类映射（Issue #188 语义）
const notificationItems: { label: string; category: NotificationCategory }[] = [
  { label: '考勤与请假', category: 'attendance' },
  { label: '活动', category: 'activity' },
  { label: '系统', category: 'system' },
]

// 账号与密码弹窗 tab（Issue #214 语义）：修改密码 / 换绑邮箱 两个区块
const ACCOUNT_TAB_OPTIONS = ['password', 'email'] as const
type AccountTab = (typeof ACCOUNT_TAB_OPTIONS)[number]
const accountTabLabel = (v: AccountTab) => (v === 'password' ? '修改密码' : '换绑邮箱')

/**
 * 我的页：
 * - 头像卡（姓名/声部/邮箱）
 * - 通知信箱：三分类未读徽章 + 信箱列表（打开即标已读）
 * - 设置列表：个人信息编辑（独立页面 pages/profile-info） / 账号与密码（改密 + 换绑邮箱双 tab）/
 *   考勤查看 / 外观（亮色·暗色·跟随系统）/ 问题与反馈（匿名提交）/ 退出登录
 * - 已发布的活动暂缓（后续任务补）
 * - 管理端登录显示阻断页（规划 §1：admin 留在 Web）
 */
export default function Profile() {
  const { user } = useUser()
  const { signOut } = useAuth()
  const darkClass = useThemeClass()

  // 资料：头像卡 / 邮箱展示 / 换绑邮箱同步
  const { data: profileData, update: updateProfile } = useProfiles({ userId: user?.id })
  const myProfile = profileData[0]

  // 头像卡展示信息
  const fullName = myProfile?.full_name ?? '—'
  const instrument = myProfile?.instrument ?? '—'
  // 邮箱优先显示 profiles.email：微信注册用户的 auth 邮箱是合成占位地址
  // （wechat_<openid>@placeholder.local），资料补全写入的真实邮箱在 profiles.email；
  // 邮箱注册用户两者一致（换绑邮箱确认后由同步 effect 对齐），无感知差异
  const email = myProfile?.email ?? user?.email ?? '—'
  const initials = fullName !== '—' ? fullName.slice(0, 2) || fullName.slice(0, 1) || '--' : '--'

  // ---- 账号与密码弹窗（Issue #214 语义：修改密码 / 换绑邮箱 双 tab）----
  // 重开弹窗默认回到「修改密码」tab；切换 tab 不清空各自输入（输入 state 在组件层，
  // 条件渲染仅影响显示）；提交中允许切换（两区块提交各自独立双重 guard 互不干扰），
  // 弹窗关闭守卫同时检查两个提交态——任一提交进行中都无法关窗
  const [isPwdModalOpen, setIsPwdModalOpen] = useState(false)
  const [accountTab, setAccountTab] = useState<AccountTab>('password')
  const [newPwd, setNewPwd] = useState('')
  const [confirmPwd, setConfirmPwd] = useState('')
  const [pwdError, setPwdError] = useState<string | null>(null)
  const [isUpdatingPwd, setIsUpdatingPwd] = useState(false)
  const pwdSubmittingRef = useRef(false) // 同步 guard，阻断竞态窗口
  // 换绑邮箱（Issue #199 语义）：新邮箱输入 + 提交中状态 + 同步 guard
  const [newEmail, setNewEmail] = useState('')
  const [isRebindingEmail, setIsRebindingEmail] = useState(false)
  const rebindSubmittingRef = useRef(false) // 同步 guard，阻断竞态窗口
  // 换绑输入最新值 ref：async 闭包读 state 是提交时的旧值，改密成功关窗需判断
  // 「换绑是否有未提交输入」，在 onChange 中与 state 同步更新（render 期写 ref
  // 被 react-hooks/refs 规则禁止），供改密成功关窗逻辑同步读取
  const newEmailRef = useRef('')

  // ---- 考勤查看（打开时才条件挂载查询组件，见下方渲染）----
  const [isAttendanceOpen, setIsAttendanceOpen] = useState(false)

  // ---- 外观 / 问题与反馈 ----
  const [isThemeOpen, setIsThemeOpen] = useState(false)
  const [isFeedbackOpen, setIsFeedbackOpen] = useState(false)

  // ---- 通知信箱 ----
  // 未读数和标记已读收敛在 useNotifications；挂载时拉取一次未读数，
  // 「我的」tab 红点：由 App 根 NotificationBadgeSync 统一维护未读数，本页进入时按当前
  // 未读数重设红点（冷启动停在登录页导致首次 show 失败，这里在切到本 tab 时补设）。
  const { unreadCounts, refresh: refreshNotifications } = useNotifications()

  useEffect(() => {
    void refreshNotifications()
  }, [refreshNotifications])

  // A：每次切回「我的」tab 重新拉未读数，并重置全局轮询计时器
  useDidShow(() => {
    void refreshNotifications()
    dataSyncBump()
  })

  // 换绑邮箱后同步 profiles.email（Issue #199 语义）：
  // 换绑只改 auth.users.email，必须用 supabase.auth.getUser() 取真实 auth email
  // 与 profiles email 对比，不同则补写 email 字段。
  // 防循环：仅在值不同时调用一次 update；成功后 useProfiles 内部把新值合并进
  // 本地 data，依赖变化后再次对比已相同，不再触发。
  // 微信注册用户例外：auth 邮箱是合成占位地址（wechat_<openid>@placeholder.local），
  // 永远不可能等于补全页写入的真实邮箱——不能反向同步，否则每次打开本页都会
  // 把真实邮箱覆盖回占位地址（用户实测：补全后邮箱变回 placeholder.local）。
  useEffect(() => {
    const userId = user?.id
    const profileEmail = myProfile?.email
    if (!userId || !profileEmail) return
    void supabase.auth
      .getUser()
      .then(({ data }) => {
        const authEmail = data.user?.email
        if (!authEmail) return
        if (isSyntheticEmail(authEmail)) return
        if (profileEmail.toLowerCase() === authEmail.toLowerCase()) return
        void updateProfile(userId, { email: authEmail })
      })
      .catch((err: unknown) => {
        console.warn('[Profile] 获取 auth 邮箱失败，跳过 profiles.email 同步', err)
      })
  }, [myProfile?.email, user?.id, updateProfile])

  const handleUpdatePassword = async () => {
    if (newPwd.trim() !== confirmPwd.trim()) {
      setPwdError('两次输入的密码不一致')
      return
    }
    if (newPwd.trim().length < 6) {
      setPwdError('新密码长度至少 6 位')
      return
    }
    // 双重 guard 防重复提交：ref 同步阻断 + state 异步兜底
    if (pwdSubmittingRef.current || isUpdatingPwd) return
    pwdSubmittingRef.current = true
    setIsUpdatingPwd(true)
    setPwdError(null)
    try {
      const { error } = await supabase.auth.updateUser({ password: newPwd.trim() })
      if (error) {
        setPwdError(error.message)
        return
      }
      void Taro.showToast({ title: '密码修改成功', icon: 'success' })
      setNewPwd('')
      setConfirmPwd('')
      // 换绑提交进行中不关闭弹窗；换绑区块存在未提交输入时也不关闭
      // （与当前 tab 无关——「提交中允许切换」使「改密飞行中切到换绑填输入」合法）。
      // newEmailRef 为 latest ref：本闭包里的 newEmail state 是提交时的旧值（空），
      // 直接判断会误关，必须同步读最新值
      if (!rebindSubmittingRef.current && !newEmailRef.current.trim()) {
        setIsPwdModalOpen(false)
      }
    } finally {
      // 无论成败都复位：避免抛异常时 isUpdatingPwd 卡 true，弹窗被守卫锁死无法关闭
      pwdSubmittingRef.current = false
      setIsUpdatingPwd(false)
    }
  }

  // 换绑邮箱（Issue #199 语义）：提交后 Supabase 向新邮箱发确认邮件，
  // 点击邮件内链接才完成换绑；未确认前 auth 仍用旧邮箱，因此只清空输入、不关闭弹窗
  const handleRebindEmail = async () => {
    if (!user) return
    const emailInput = newEmail.trim()
    if (!emailInput) {
      void Taro.showToast({ title: '请输入新邮箱', icon: 'none' })
      return
    }
    if (!isValidEmail(emailInput)) {
      void Taro.showToast({ title: '邮箱格式不正确', icon: 'none' })
      return
    }
    if (emailInput.toLowerCase() === (user.email ?? '').toLowerCase()) {
      void Taro.showToast({ title: '新邮箱与当前邮箱相同', icon: 'none' })
      return
    }
    // 双重 guard 防重复提交：ref 同步阻断 + state 异步兜底
    if (rebindSubmittingRef.current || isRebindingEmail) return
    rebindSubmittingRef.current = true
    setIsRebindingEmail(true)
    try {
      const { error } = await supabase.auth.updateUser({ email: emailInput })
      if (error) {
        void Taro.showToast({ title: error.message, icon: 'none' })
        return
      }
      void Taro.showToast({
        title: '确认邮件已发送至新邮箱，请点击邮件内链接完成换绑（未确认前仍使用旧邮箱）',
        icon: 'none',
      })
      setNewEmail('')
      // 与 onChange 同步逻辑对称：清空 state 时同步清空 ref，
      // 否则 newEmailRef 残留旧值，后续改密成功关窗条件误判「存在未提交输入」不关窗
      newEmailRef.current = ''
    } finally {
      // 无论成败都复位：避免抛异常时 isRebindingEmail 卡 true，输入被永久禁用
      rebindSubmittingRef.current = false
      setIsRebindingEmail(false)
    }
  }

  const handleLogout = async () => {
    await signOut()
    // 会话已清，回到登录页（tab 页只能用 reLaunch 切换）
    void Taro.reLaunch({ url: '/pages/login/index' })
  }

  // 管理端登录：不提供小程序管理端，显示阻断页（规划 §1：admin 留在 Web）
  if (myProfile?.role === 'admin') {
    return <AdminBlockedPage />
  }

  return (
    /* 本页豁免：整页滚动（page 根节点自身为滚动容器，tab bar 固定），与 Web 端 profile 页一致 */
    <View
      className={`${darkClass} h-full overflow-y-auto overscroll-contain bg-page-bg px-4 pb-safe`}
    >
      <View className='space-y-6 pt-4'>
        {/* 头像卡 */}
        <View className='flex items-center gap-3 rounded-2xl border border-border bg-card p-4'>
          <View className='flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary text-base font-medium text-primary-foreground'>
            {initials}
          </View>
          <View className='min-w-0 flex-1 space-y-1'>
            <Text className='block text-lg font-semibold text-text'>{fullName}</Text>
            <Text className='block text-sm text-text-muted'>声部 {instrument}</Text>
            <Text className='block text-xs text-text-muted'>邮箱 {email}</Text>
          </View>
        </View>

        {/* 通知栏目：三个信箱按钮，右侧未读数字徽章（>0 时显示） */}
        <View>
          <Text className='text-xs font-medium text-text-muted'>通知</Text>
          <View className='mt-2 overflow-hidden rounded-2xl border border-border bg-card'>
            {notificationItems.map(({ label, category }) => {
              const count = unreadCounts[category]
              return (
                <View
                  key={category}
                  className={`px-4 py-3 ${category !== 'system' ? 'border-b border-border' : ''}`}
                  onClick={() => {
                    // 「考勤与请假」改用全屏请假详情页（结构化卡片 + 状态筛选），
                    // 活动 / 系统通知改用独立信箱页，均不再弹通用通知 Modal
                    if (category === 'attendance') {
                      void Taro.navigateTo({ url: '/pages/leave-requests/index' })
                    } else if (category === 'activity') {
                      void Taro.navigateTo({ url: '/pages/notification-activity/index' })
                    } else {
                      void Taro.navigateTo({ url: '/pages/notification-system/index' })
                    }
                  }}
                >
                  <View className='flex items-center'>
                    <Text className='text-sm font-medium text-text'>{label}</Text>
                    {count > 0 && (
                      <View className='ml-auto flex h-5 min-w-[20px] items-center justify-center rounded-full bg-danger px-1.5'>
                        <Text className='text-xs font-medium leading-none text-danger-foreground'>
                          {count > 99 ? '99+' : count}
                        </Text>
                      </View>
                    )}
                  </View>
                </View>
              )
            })}
          </View>
        </View>

        {/* 设置栏目 */}
        <View>
          <Text className='text-xs font-medium text-text-muted'>设置</Text>
          <View className='mt-2 overflow-hidden rounded-2xl border border-border bg-card'>
            <View
              className='border-b border-border px-4 py-3'
              onClick={() => void Taro.navigateTo({ url: '/pages/profile-info/index' })}
            >
              <Text className='text-sm font-medium text-text'>个人信息</Text>
            </View>
            <View
              className='border-b border-border px-4 py-3'
              onClick={() => {
                // 重开弹窗默认回到「修改密码」tab（accountTab 是组件层 state，不重置会残留上次选择）
                setAccountTab('password')
                setNewPwd('')
                setConfirmPwd('')
                setPwdError(null)
                setIsPwdModalOpen(true)
              }}
            >
              <Text className='text-sm font-medium text-text'>账号与密码</Text>
            </View>
            {/* 考勤：本人考勤历史，起止日期过滤（打开时才挂载查询组件） */}
            <View
              className='border-b border-border px-4 py-3'
              onClick={() => {
                if (user) setIsAttendanceOpen(true)
              }}
            >
              <Text className='text-sm font-medium text-text'>考勤</Text>
            </View>
            {/* 外观：亮色 / 暗色 / 跟随系统 三态主题切换 */}
            <View className='border-b border-border px-4 py-3' onClick={() => setIsThemeOpen(true)}>
              <Text className='text-sm font-medium text-text'>外观</Text>
            </View>
            {/* 问题与反馈：匿名提交，底部弹窗 */}
            <View
              className='border-b border-border px-4 py-3'
              onClick={() => setIsFeedbackOpen(true)}
            >
              <Text className='text-sm font-medium text-text'>问题与反馈</Text>
            </View>
            <View className='px-4 py-3' onClick={() => void handleLogout()}>
              <Text className='text-sm font-medium text-danger'>退出登录</Text>
            </View>
          </View>
        </View>
      </View>

      {/* 账号与密码 Modal（Issue #214 语义 tab 化）：标题下方、内容上方左对齐
           放置「修改密码 / 换绑邮箱」tab，激活 tab 显示对应区块；切换 tab 不清空
           各自输入；关闭守卫仍含两个提交态（任一提交进行中不允许关闭） */}
      <Modal
        open={isPwdModalOpen}
        onClose={() => {
          // 任一提交进行中不允许关闭（改密/换绑各自守卫，互不干扰）
          if (isUpdatingPwd || isRebindingEmail) {
            void Taro.showToast({ title: '提交进行中，请稍候再关闭', icon: 'none' })
            return
          }
          setIsPwdModalOpen(false)
        }}
        title='账号与密码'
        position='bottom'
        closeOnOverlay={!isUpdatingPwd && !isRebindingEmail}
      >
        <View className='mt-4'>
          <Toggle
            options={ACCOUNT_TAB_OPTIONS}
            value={accountTab}
            onChange={(v) => setAccountTab(v as AccountTab)}
            getLabel={accountTabLabel}
          />

          {accountTab === 'password' ? (
            <View className='mt-4 space-y-3'>
              <View>
                <Text className='mb-1 block text-xs font-medium text-text-muted'>新密码</Text>
                <View className='mt-1 w-full overflow-hidden rounded-xl border border-border bg-muted px-3'>
                  <Input
                    className='h-10 w-full bg-transparent text-sm text-text'
                    password
                    placeholder='至少 6 位'
                    value={newPwd}
                    onInput={(e) => {
                      setNewPwd(e.detail.value)
                      setPwdError(null)
                    }}
                  />
                </View>
              </View>
              <View>
                <Text className='mb-1 block text-xs font-medium text-text-muted'>确认新密码</Text>
                <View className='mt-1 w-full overflow-hidden rounded-xl border border-border bg-muted px-3'>
                  <Input
                    className='h-10 w-full bg-transparent text-sm text-text'
                    password
                    placeholder='再次输入'
                    value={confirmPwd}
                    onInput={(e) => {
                      setConfirmPwd(e.detail.value)
                      setPwdError(null)
                    }}
                  />
                </View>
              </View>
              {pwdError && <Text className='block text-xs text-danger'>{pwdError}</Text>}
              {/* 双按钮操作行右下角（取消 + 确认修改）；取消按钮任一提交飞行中禁用 */}
              <View className='flex justify-end gap-2'>
                <View
                  className={`rounded-full border border-border bg-card px-4 py-2 text-xs font-medium text-text-muted ${
                    isUpdatingPwd || isRebindingEmail ? 'opacity-60' : ''
                  }`}
                  onClick={
                    isUpdatingPwd || isRebindingEmail ? undefined : () => setIsPwdModalOpen(false)
                  }
                >
                  取消
                </View>
                <View
                  className={`rounded-full bg-primary px-4 py-2 text-xs font-medium text-primary-foreground ${
                    isUpdatingPwd ? 'opacity-60' : ''
                  }`}
                  onClick={isUpdatingPwd ? undefined : () => void handleUpdatePassword()}
                >
                  {isUpdatingPwd ? '提交中…' : '确认修改'}
                </View>
              </View>
            </View>
          ) : (
            <View className='mt-4 space-y-3'>
              {/* 当前邮箱只读展示（Issue #199 语义）；「换绑邮箱」小标题由 tab 承担 */}
              <Text className='block text-xs text-text-subtle'>当前邮箱：{email}</Text>
              <View>
                <Text className='mb-1 block text-xs font-medium text-text-muted'>新邮箱</Text>
                <View className='mt-1 w-full overflow-hidden rounded-xl border border-border bg-muted px-3'>
                  <Input
                    className='h-10 w-full bg-transparent text-sm text-text'
                    placeholder='输入新邮箱'
                    value={newEmail}
                    disabled={isRebindingEmail}
                    onInput={(e) => {
                      setNewEmail(e.detail.value)
                      newEmailRef.current = e.detail.value // 同步最新值（async 闭包读 ref）
                    }}
                  />
                </View>
              </View>
              {/* 单主操作按钮右对齐（双按钮行规范的唯一按钮豁免） */}
              <View className='flex justify-end gap-2'>
                <View
                  className={`rounded-full bg-primary px-4 py-2 text-xs font-medium text-primary-foreground ${
                    isRebindingEmail ? 'opacity-60' : ''
                  }`}
                  onClick={isRebindingEmail ? undefined : () => void handleRebindEmail()}
                >
                  {isRebindingEmail ? '发送中…' : '发送确认邮件'}
                </View>
              </View>
            </View>
          )}
        </View>
      </Modal>

      {/* 考勤查看 Modal：条件渲染挂载——打开时才挂载并查询，关闭即卸载清态 */}
      {isAttendanceOpen && user && (
        <AttendanceHistoryModal userId={user.id} onClose={() => setIsAttendanceOpen(false)} />
      )}

      {/* 外观 Modal：亮色 / 暗色 / 跟随系统 三态主题切换 */}
      <ThemeModal open={isThemeOpen} onClose={() => setIsThemeOpen(false)} />

      {/* 问题与反馈 Modal：多行输入匿名提交 */}
      <FeedbackModal open={isFeedbackOpen} onClose={() => setIsFeedbackOpen(false)} />

      {/* 版本号：随时可查，报障时便于核对 */}
      <View className='mt-8 pb-10 text-center'>
        <Text className='text-xs text-text-subtle'>北大交响乐团 · {getAppVersionLabel()}</Text>
      </View>
    </View>
  )
}
