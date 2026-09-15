import { useEffect, useRef, useState } from 'react'
import { View, Text, ScrollView, Image, Input } from '@tarojs/components'
import { TextField } from '@/components/ui/FormFields'
import Taro, { useDidShow } from '@tarojs/taro'
import { useUser } from '@/context/user-context'
import { useThemeClass } from '@/context/theme-context'
import { useT, useNavTitle } from '@/i18n'
import { translateInstrument } from '@/lib/instrument-i18n'
import { useProfiles } from '@/hooks/useProfiles'
import { useAuth } from '@/hooks/useAuth'
import { isSyntheticEmail } from '@/lib/profile-gate'
import { useNotifications } from '@/hooks/useNotifications'
import { supabase } from '@/lib/supabase'
import { logDiag } from '@/lib/session-diag'
import { AdminBlockedPage } from '@/components/admin-blocked-page'
import { Modal } from '@/components/ui/Modal'
import { Toggle } from '@/components/ui/Toggle'
import { isValidEmail } from '@/lib/validation'
import { getAppVersionLabel } from '@/lib/version'
import type { NotificationCategory } from '@/types/database'
import { dataSyncBump } from '@/lib/dataSync'
import { usePlaceholderStyle } from '@/hooks/usePlaceholderStyle'

import { ThemeModal } from './components/theme-modal'
import './index.scss'

// 邮箱与密码弹窗 tab：换绑邮箱（默认）/ 修改密码
const ACCOUNT_TAB_OPTIONS = ['email', 'password'] as const
type AccountTab = (typeof ACCOUNT_TAB_OPTIONS)[number]

/**
 * 我的页：
 * - 头像卡（姓名/声部/邮箱）
 * - 通知信箱：三分类未读徽章 + 信箱列表（打开即标已读）
 * - 设置列表：个人信息编辑（独立页面 pages/profile-info） / 账号与密码（改密 + 换绑邮箱双 tab）/
 *   考勤查看 / 外观（亮色·暗色·跟随系统）/ 问题与反馈（匿名提交）/ 退出登录
 * - 已发布的活动暂缓（后续任务补）
 * - 管理端登录显示阻断页（规划 §1：admin 留在 Web）
 */

// 验证码冷却：模块级时间戳，跨 modal 关闭/打开持久化
let codeSentAt = 0

export default function Profile() {
  const { user } = useUser()
  const { signOut } = useAuth()
  const darkClass = useThemeClass()
  const { t, locale, setLocale } = useT()
  const placeholderStyle = usePlaceholderStyle()
  useNavTitle('profile.title')

  // 通知栏目：信箱按钮 → 通知分类映射（Issue #188 语义）
  const notificationItems: { label: string; category: NotificationCategory }[] = [
    { label: t('profile.notifications.attendance'), category: 'attendance' },
    { label: t('profile.notifications.system'), category: 'system' },
  ]
  // 邮箱与密码弹窗 tab 文案
  const accountTabLabel = (v: AccountTab) =>
    v === 'password' ? t('profile.account.tabPassword') : t('profile.account.tabEmail')

  const [isLangOpen, setIsLangOpen] = useState(false)

  // 资料：头像卡 / 邮箱展示 / 换绑邮箱同步
  const {
    data: profileData,
    update: updateProfile,
    fetch: refetchProfiles,
  } = useProfiles({ userId: user?.id })
  const myProfile = profileData[0]

  // 头像卡展示信息
  const fullName = myProfile?.full_name ?? '—'
  const instrument = myProfile?.instrument ?? '—'
  // 邮箱优先显示 profiles.email：微信注册用户的 auth 邮箱是合成占位地址
  // （wechat_<openid>@placeholder.local），资料补全写入的真实邮箱在 profiles.email；
  // 邮箱注册用户两者一致（换绑邮箱确认后由同步 effect 对齐），无感知差异
  const email = myProfile?.email ?? user?.email ?? '—'
  // 中文名：仅取首字；非中文：取前 2 字，兜底 1 字
  const isChineseName = fullName !== '—' && /[\u4e00-\u9fff]/.test(fullName)
  const initials =
    fullName !== '—'
      ? isChineseName
        ? fullName.slice(0, 1)
        : fullName.slice(0, 2) || fullName.slice(0, 1) || '--'
      : '--'
  const avatarUrl = myProfile?.avatar_url ?? null

  // 显示用邮箱：若为合成占位邮箱，显示「未填写」
  const displayEmail = isSyntheticEmail(email) ? t('profile.common.notFilled') : email

  // ---- 邮箱与密码弹窗：修改密码 / 换绑邮箱 双 tab ----
  const [isPwdModalOpen, setIsPwdModalOpen] = useState(false)
  const [accountTab, setAccountTab] = useState<AccountTab>('email')
  // 修改密码
  const [newPwd, setNewPwd] = useState('')
  const [pwdError, setPwdError] = useState<string | null>(null)
  const [isUpdatingPwd, setIsUpdatingPwd] = useState(false)
  const pwdSubmittingRef = useRef(false)
  // 换绑邮箱
  const [newEmail, setNewEmail] = useState('')
  const [isRebindingEmail, setIsRebindingEmail] = useState(false)
  const rebindSubmittingRef = useRef(false)
  const newEmailRef = useRef('')
  // 验证码通用状态
  const [verifyCode, setVerifyCode] = useState('')
  const [codeSent, setCodeSent] = useState(false)
  const [codeCountdown, setCodeCountdown] = useState(0)
  const [codeTarget, setCodeTarget] = useState<'bound' | 'new' | null>(null)
  const [codeSending, setCodeSending] = useState(false)
  const codeSendingRef = useRef(false)
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // ---- 外观 ----
  const [isThemeOpen, setIsThemeOpen] = useState(false)

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
    void refetchProfiles()
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

  // 发送验证码：调用 Edge Function
  const handleSendCode = async () => {
    if (codeSendingRef.current || codeSending) return

    if (accountTab === 'password') {
      // 修改密码：先校验密码格式
      if (!newPwd.trim()) {
        setPwdError(t('profile.account.pwdMinLength'))
        return
      }
      if (newPwd.trim().length < 6) {
        setPwdError(t('profile.account.pwdMinLength'))
        return
      }
    } else {
      // 换绑邮箱：先校验邮箱格式
      if (!newEmail.trim()) {
        void Taro.showToast({ title: t('profile.account.emailEmpty'), icon: 'none' })
        return
      }
      if (!isValidEmail(newEmail.trim())) {
        void Taro.showToast({ title: t('profile.account.emailInvalid'), icon: 'none' })
        return
      }
      if (newEmail.trim().toLowerCase() === (user?.email ?? '').toLowerCase()) {
        void Taro.showToast({ title: t('profile.account.emailSame'), icon: 'none' })
        return
      }
    }

    codeSendingRef.current = true
    setCodeSending(true)
    try {
      const purpose = accountTab === 'password' ? 'password_change' : 'email_change'
      const payload: Record<string, unknown> = { purpose }
      if (purpose === 'email_change') {
        payload.new_email = newEmail.trim()
      }
      logDiag('send_code_invoke', { purpose, hasNewEmail: purpose === 'email_change' })
      const { data, error } = await supabase.functions.invoke('send-verification-code', {
        body: payload,
      })
      logDiag('send_code_result', {
        hasData: !!data,
        dataError: data?.error ?? null,
        sdkError: error?.message ?? null,
        status: data?.success ? 'ok' : 'fail',
      })
      const errMsg = (data?.error as string) ?? error?.message ?? ''
      if (data?.error || error) {
        if (errMsg.includes('email_taken')) {
          void Taro.showToast({ title: t('profile.account.emailTaken'), icon: 'none' })
        } else if (errMsg.includes('invalid email')) {
          void Taro.showToast({ title: t('profile.account.emailInvalid'), icon: 'none' })
        } else if (errMsg.includes('same as current')) {
          void Taro.showToast({ title: t('profile.account.emailSame'), icon: 'none' })
        } else {
          void Taro.showToast({ title: t('profile.account.sendFailed'), icon: 'none' })
        }
        return
      }
      setCodeSent(true)
      setCodeTarget(accountTab === 'password' ? 'bound' : 'new')
      codeSentAt = Date.now()
      setCodeCountdown(60)
      // 启动倒计时
      if (countdownRef.current) clearInterval(countdownRef.current)
      countdownRef.current = setInterval(() => {
        setCodeCountdown((prev) => {
          if (prev <= 1) {
            if (countdownRef.current) clearInterval(countdownRef.current)
            return 0
          }
          return prev - 1
        })
      }, 1000)
    } catch (e) {
      logDiag('send_code_catch', { err: e instanceof Error ? e.message : String(e) })
      void Taro.showToast({ title: t('profile.account.sendFailed'), icon: 'none' })
    } finally {
      codeSendingRef.current = false
      setCodeSending(false)
    }
  }

  // 修改密码：调用 Edge Function 验证码 + 修改
  const handleUpdatePassword = async () => {
    if (!newPwd.trim()) {
      setPwdError(t('profile.account.pwdMinLength'))
      return
    }
    if (newPwd.trim().length < 6) {
      setPwdError(t('profile.account.pwdMinLength'))
      return
    }
    if (!verifyCode.trim()) {
      void Taro.showToast({ title: t('profile.account.codeRequired'), icon: 'none' })
      return
    }
    if (pwdSubmittingRef.current || isUpdatingPwd) return
    pwdSubmittingRef.current = true
    setIsUpdatingPwd(true)
    setPwdError(null)
    try {
      const { data, error } = await supabase.functions.invoke('verify-and-update', {
        body: {
          purpose: 'password_change',
          code: verifyCode.trim(),
          new_password: newPwd.trim(),
        },
      })
      const errMsg = (data?.error as string) ?? error?.message ?? ''
      if (data?.error || error) {
        if (errMsg.includes('expired')) {
          void Taro.showToast({ title: t('profile.account.codeExpired'), icon: 'none' })
        } else if (errMsg.includes('mismatch') || errMsg.includes('code')) {
          void Taro.showToast({ title: t('profile.account.codeInvalid'), icon: 'none' })
        } else {
          setPwdError(errMsg || 'Failed')
        }
        return
      }
      void Taro.showToast({ title: t('profile.account.pwdSuccess'), icon: 'success' })
      setNewPwd('')
      setVerifyCode('')
      setCodeSent(false)
      setCodeTarget(null)
      if (countdownRef.current) clearInterval(countdownRef.current)
      if (!rebindSubmittingRef.current && !newEmailRef.current.trim()) {
        setIsPwdModalOpen(false)
      }
    } finally {
      pwdSubmittingRef.current = false
      setIsUpdatingPwd(false)
    }
  }

  // 换绑邮箱：调用 Edge Function 验证码 + 换绑
  const handleRebindEmail = async () => {
    const emailInput = newEmail.trim()
    if (!emailInput) {
      void Taro.showToast({ title: t('profile.account.emailEmpty'), icon: 'none' })
      return
    }
    if (!isValidEmail(emailInput)) {
      void Taro.showToast({ title: t('profile.account.emailInvalid'), icon: 'none' })
      return
    }
    if (emailInput.toLowerCase() === (user?.email ?? '').toLowerCase()) {
      void Taro.showToast({ title: t('profile.account.emailSame'), icon: 'none' })
      return
    }
    if (!verifyCode.trim()) {
      void Taro.showToast({ title: t('profile.account.codeRequired'), icon: 'none' })
      return
    }
    if (rebindSubmittingRef.current || isRebindingEmail) return
    rebindSubmittingRef.current = true
    setIsRebindingEmail(true)
    try {
      const { data, error } = await supabase.functions.invoke('verify-and-update', {
        body: {
          purpose: 'email_change',
          code: verifyCode.trim(),
          new_email: emailInput,
        },
      })
      const errMsg = (data?.error as string) ?? error?.message ?? ''
      if (data?.error || error) {
        if (errMsg.includes('expired')) {
          void Taro.showToast({ title: t('profile.account.codeExpired'), icon: 'none' })
        } else if (errMsg.includes('mismatch') || errMsg.includes('code')) {
          void Taro.showToast({ title: t('profile.account.codeInvalid'), icon: 'none' })
        } else if (errMsg.includes('email_taken')) {
          void Taro.showToast({ title: t('profile.account.emailTaken'), icon: 'none' })
        } else {
          void Taro.showToast({ title: errMsg || 'Failed', icon: 'none' })
        }
        return
      }
      void Taro.showToast({ title: t('profile.account.emailSuccess'), icon: 'success' })
      setNewEmail('')
      newEmailRef.current = ''
      setVerifyCode('')
      setCodeSent(false)
      setCodeTarget(null)
      if (countdownRef.current) clearInterval(countdownRef.current)
      if (!pwdSubmittingRef.current && !newPwd.trim()) {
        setIsPwdModalOpen(false)
      }
    } finally {
      rebindSubmittingRef.current = false
      setIsRebindingEmail(false)
    }
  }

  const signingOutRef = useRef(false)
  const handleLogout = async () => {
    if (signingOutRef.current) return
    signingOutRef.current = true
    try {
      await signOut()
      void Taro.reLaunch({ url: '/pages/login/index' })
    } finally {
      signingOutRef.current = false
    }
  }

  // 弹窗打开时重置 tab 到「换绑邮箱」；若冷却未过期则恢复倒计时
  useEffect(() => {
    if (isPwdModalOpen) {
      setAccountTab('email')
      setVerifyCode('')
      setCodeSent(false)
      setCodeTarget(null)
      if (countdownRef.current) clearInterval(countdownRef.current)
      const remaining = Math.max(0, 60 - Math.floor((Date.now() - codeSentAt) / 1000))
      if (remaining > 0) {
        setCodeSent(true)
        setCodeCountdown(remaining)
        countdownRef.current = setInterval(() => {
          setCodeCountdown((prev) => {
            if (prev <= 1) {
              if (countdownRef.current) clearInterval(countdownRef.current)
              return 0
            }
            return prev - 1
          })
        }, 1000)
      } else {
        setCodeCountdown(0)
      }
    }
  }, [isPwdModalOpen])

  // 倒计时清理
  useEffect(() => {
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current)
    }
  }, [])

  // 管理端登录：不提供小程序管理端，显示阻断页（规划 §1：admin 留在 Web）
  // 注意：游客模式下 CustomTabBar 会直接跳转到 login 页，不会到达此处
  if (myProfile?.role === 'admin') {
    return <AdminBlockedPage />
  }

  return (
    <View
      className={`${darkClass} flex h-full min-h-0 flex-col bg-page-bg`}
      style={{ paddingBottom: 'calc(50px + env(safe-area-inset-bottom))' }}
    >
      <ScrollView scrollY className='flex-1 min-h-0'>
        {/* 底部留白 = 自定义底边栏高(50px)，避免末行被遮挡、滚不到底（横屏同样稳健） */}
        <View className='px-4 pt-4'>
          {/* 头像卡 */}
          <View className='flex items-center gap-3 rounded-2xl border border-border bg-card p-4'>
            <View className='flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary'>
              {avatarUrl ? (
                <Image src={avatarUrl} className='h-full w-full' mode='aspectFill' />
              ) : (
                <Text className='text-base font-medium text-primary-foreground'>{initials}</Text>
              )}
            </View>
            <View className='min-w-0 flex-1'>
              <Text className='block text-lg font-semibold text-text'>{fullName}</Text>
              <Text className='mt-1 block text-sm text-text-muted'>
                {t('profile.card.instrument', { instrument: translateInstrument(instrument, t) })}
              </Text>
              <Text className='mt-1 block overflow-hidden text-ellipsis whitespace-nowrap text-xs text-text-muted'>
                {t('profile.card.email', { email: displayEmail })}
              </Text>
            </View>
          </View>

          {/* 通知栏目：三个信箱按钮，右侧未读数字徽章（>0 时显示） */}
          <View className='mt-6'>
            <Text className='text-xs font-medium text-text-muted'>
              {t('profile.sections.notifications')}
            </Text>
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
          <View className='mt-6'>
            <Text className='text-xs font-medium text-text-muted'>
              {t('profile.sections.settings')}
            </Text>
            <View className='mt-2 overflow-hidden rounded-2xl border border-border bg-card'>
              <View
                className='border-b border-border px-4 py-3'
                onClick={() => void Taro.navigateTo({ url: '/pages/profile-info/index' })}
              >
                <Text className='text-sm font-medium text-text'>{t('profileInfo.title')}</Text>
              </View>
              <View
                className='border-b border-border px-4 py-3'
                onClick={() => {
                  setAccountTab('email')
                  setNewPwd('')
                  setVerifyCode('')
                  setCodeSent(false)
                  setCodeTarget(null)
                  if (countdownRef.current) clearInterval(countdownRef.current)
                  const remaining = Math.max(0, 60 - Math.floor((Date.now() - codeSentAt) / 1000))
                  if (remaining > 0) {
                    setCodeSent(true)
                    setCodeCountdown(remaining)
                    countdownRef.current = setInterval(() => {
                      setCodeCountdown((prev) => {
                        if (prev <= 1) {
                          if (countdownRef.current) clearInterval(countdownRef.current)
                          return 0
                        }
                        return prev - 1
                      })
                    }, 1000)
                  } else {
                    setCodeCountdown(0)
                  }
                  setPwdError(null)
                  setIsPwdModalOpen(true)
                }}
              >
                <Text className='text-sm font-medium text-text'>
                  {t('profile.settings.account')}
                </Text>
              </View>
              {/* 考勤：本人考勤历史，起止日期过滤（打开时才挂载查询组件） */}
              <View
                className='border-b border-border px-4 py-3'
                onClick={() => {
                  void Taro.navigateTo({ url: '/pages/attendance/index' })
                }}
              >
                <Text className='text-sm font-medium text-text'>
                  {t('profile.settings.attendance')}
                </Text>
              </View>
              {/* 我的活动：我发布的活动管理（锁定/删除/编辑） */}
              <View
                className='border-b border-border px-4 py-3'
                onClick={() => void Taro.navigateTo({ url: '/pages/my-activities/index' })}
              >
                <Text className='text-sm font-medium text-text'>
                  {t('profile.settings.myActivities')}
                </Text>
              </View>
              {/* 语言：中文 / English，默认跟随系统、手动覆盖并持久化 */}
              <View
                className='border-b border-border px-4 py-3'
                onClick={() => setIsLangOpen(true)}
              >
                <Text className='text-sm font-medium text-text'>语言设置 / Language Settings</Text>
              </View>
              {/* 外观：亮色 / 暗色 / 跟随系统 三态主题切换 */}
              <View
                className='border-b border-border px-4 py-3'
                onClick={() => setIsThemeOpen(true)}
              >
                <Text className='text-sm font-medium text-text'>
                  {t('profile.settings.appearance')}
                </Text>
              </View>
              {/* 问题与反馈：匿名提交，底部弹窗 */}
              <View
                className='border-b border-border px-4 py-3'
                onClick={() => void Taro.navigateTo({ url: '/pages/feedback/index' })}
              >
                <Text className='text-sm font-medium text-text'>
                  {t('profile.settings.feedback')}
                </Text>
              </View>
              <View className='px-4 py-3' onClick={() => void handleLogout()}>
                <Text className='text-sm font-medium text-danger'>
                  {t('profile.settings.logout')}
                </Text>
              </View>
            </View>
          </View>
          {/* 版本号：随时可查，报障时便于核对 */}
          <View className='mt-8 text-center'>
            <Text className='text-xs text-text-subtle'>
              {t('common.appName')} · {getAppVersionLabel(t)}
            </Text>
          </View>
        </View>
      </ScrollView>

      {/* 邮箱与密码 Modal：标题下方放置「换绑邮箱 / 修改密码」tab，激活 tab 显示对应区块 */}
      <Modal
        open={isPwdModalOpen}
        onClose={() => {
          if (isUpdatingPwd || isRebindingEmail) {
            void Taro.showToast({ title: t('profile.account.submittingClose'), icon: 'none' })
            return
          }
          setIsPwdModalOpen(false)
        }}
        title={t('profile.settings.account')}
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
            /* ---- 修改密码 tab ---- */
            <View className='mt-4'>
              <TextField
                label={t('profile.account.newPassword')}
                password
                placeholder={t('profile.account.newPasswordPlaceholder')}
                value={newPwd}
                onInput={(e) => {
                  setNewPwd(e.detail.value)
                  setPwdError(null)
                }}
                placeholderStyle={placeholderStyle}
              />
              {/* 验证码行：输入框 + 发送按钮 */}
              <View className='mt-3'>
                <Text className='mb-1 block text-xs font-medium text-text-muted'>
                  {t('profile.account.verificationCode')}
                  {codeSent && codeTarget === 'bound' && t('profile.account.codeSentToBound')}
                </Text>
                <View className='flex items-center gap-2'>
                  <View className='flex-1 overflow-hidden rounded-xl border border-border bg-muted px-3'>
                    <Input
                      className='h-10 w-full bg-transparent text-sm text-text'
                      placeholder={t('profile.account.verificationCodePlaceholder')}
                      value={verifyCode}
                      onInput={(e) => setVerifyCode(e.detail.value)}
                      placeholderStyle={placeholderStyle}
                    />
                  </View>
                  <View
                    className={`flex-shrink-0 rounded-xl px-3 py-2 text-xs font-medium ${
                      codeCountdown > 0 || codeSending
                        ? 'bg-muted text-text-muted'
                        : 'bg-primary text-primary-foreground'
                    }`}
                    onClick={
                      codeCountdown > 0 || codeSending ? undefined : () => void handleSendCode()
                    }
                  >
                    {codeSending
                      ? t('profile.account.submitting')
                      : codeCountdown > 0
                        ? t('profile.account.resendCode', { seconds: String(codeCountdown) })
                        : t('profile.account.sendCode')}
                  </View>
                </View>
              </View>
              {pwdError && <Text className='mt-3 block text-xs text-danger'>{pwdError}</Text>}
              <View className='mt-4 flex justify-end'>
                <View
                  className={`rounded-full bg-primary px-6 py-2 text-xs font-medium text-primary-foreground ${
                    isUpdatingPwd || isRebindingEmail ? 'opacity-60' : ''
                  }`}
                  onClick={
                    isUpdatingPwd || isRebindingEmail
                      ? undefined
                      : () => void handleUpdatePassword()
                  }
                >
                  {isUpdatingPwd
                    ? t('profile.account.submitting')
                    : t('profile.account.confirmChange')}
                </View>
              </View>
            </View>
          ) : (
            /* ---- 换绑邮箱 tab ---- */
            <View className='mt-4'>
              <Text className='block text-xs text-text-subtle'>
                {t('profile.account.currentEmail', { email: displayEmail })}
              </Text>
              <TextField
                className='mt-3'
                label={t('profile.account.newEmail')}
                placeholder={t('profile.account.newEmailPlaceholder')}
                value={newEmail}
                disabled={isRebindingEmail}
                onInput={(e) => {
                  setNewEmail(e.detail.value)
                  newEmailRef.current = e.detail.value
                }}
                placeholderStyle={placeholderStyle}
              />
              {/* 验证码行：输入框 + 发送按钮 */}
              <View className='mt-3'>
                <Text className='mb-1 block text-xs font-medium text-text-muted'>
                  {t('profile.account.verificationCode')}
                  {codeSent && codeTarget === 'new' && t('profile.account.codeSentToNew')}
                </Text>
                <View className='flex items-center gap-2'>
                  <View className='flex-1 overflow-hidden rounded-xl border border-border bg-muted px-3'>
                    <Input
                      className='h-10 w-full bg-transparent text-sm text-text'
                      placeholder={t('profile.account.verificationCodePlaceholder')}
                      value={verifyCode}
                      onInput={(e) => setVerifyCode(e.detail.value)}
                      placeholderStyle={placeholderStyle}
                    />
                  </View>
                  <View
                    className={`flex-shrink-0 rounded-xl px-3 py-2 text-xs font-medium ${
                      codeCountdown > 0 || codeSending
                        ? 'bg-muted text-text-muted'
                        : 'bg-primary text-primary-foreground'
                    }`}
                    onClick={
                      codeCountdown > 0 || codeSending ? undefined : () => void handleSendCode()
                    }
                  >
                    {codeSending
                      ? t('profile.account.submitting')
                      : codeCountdown > 0
                        ? t('profile.account.resendCode', { seconds: String(codeCountdown) })
                        : t('profile.account.sendCode')}
                  </View>
                </View>
              </View>
              <View className='mt-4 flex justify-end'>
                <View
                  className={`rounded-full bg-primary px-6 py-2 text-xs font-medium text-primary-foreground ${
                    isRebindingEmail || isUpdatingPwd ? 'opacity-60' : ''
                  }`}
                  onClick={
                    isRebindingEmail || isUpdatingPwd ? undefined : () => void handleRebindEmail()
                  }
                >
                  {isRebindingEmail
                    ? t('profile.account.submitting')
                    : t('profile.account.confirmChange')}
                </View>
              </View>
            </View>
          )}
        </View>
      </Modal>

      {/* 外观 Modal：亮色 / 暗色 / 跟随系统 三态主题切换 */}
      <ThemeModal open={isThemeOpen} onClose={() => setIsThemeOpen(false)} />

      {/* 语言选择：手动选择后持久化 */}
      <Modal
        open={isLangOpen}
        onClose={() => setIsLangOpen(false)}
        title={t('profile.language.title')}
      >
        <View>
          {(['zh-CN', 'en'] as const).map((l) => {
            const labels: Record<'zh-CN' | 'en', string> = {
              'zh-CN': t('profile.language.zhCN'),
              en: t('profile.language.en'),
            }
            return (
              <View
                key={l}
                className='mt-2 flex items-center justify-between rounded-xl border border-border px-4 py-3'
                onClick={() => {
                  setLocale(l)
                  setIsLangOpen(false)
                }}
              >
                <Text className='text-sm text-text'>{labels[l]}</Text>
                {locale === l && <Text className='text-sm text-primary'>✓</Text>}
              </View>
            )
          })}
        </View>
      </Modal>
    </View>
  )
}
