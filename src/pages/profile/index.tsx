import { useRef, useState } from 'react'
import { View, Text, Input, Picker } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useUser } from '@/context/user-context'
import { useProfiles } from '@/hooks/useProfiles'
import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/lib/supabase'
import { AdminBlockedPage } from '@/components/admin-blocked-page'
import { Modal } from '@/components/ui/Modal'
import { Toggle } from '@/components/ui/Toggle'
import { isValidPhoneNumber } from '@/lib/validation'
import { AttendanceHistoryModal } from './components/attendance-history-modal'
import './index.scss'

// 隐私开关选项：各字段行尾的「公开 / 隐藏」分段开关，随表单一起保存
const PRIVACY_OPTIONS = ['public', 'hidden'] as const
const privacyLabel = (v: (typeof PRIVACY_OPTIONS)[number]) => (v === 'hidden' ? '隐藏' : '公开')
const privacyValue = (hide: boolean) => (hide ? 'hidden' : 'public')

/** 是否为标准 YYYY-MM-DD 日期格式（Picker 可表示的格式；历史数据可能为「2024秋」等学期格式） */
const isStandardDateString = (v: string | null | undefined): boolean =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)

/**
 * 我的页（demo 范围）：
 * - 头像卡（姓名/声部/邮箱）+ 设置列表（个人信息 / 账号与密码 / 退出登录）
 * - 通知信箱、考勤查看、问题与反馈、外观、已发布的活动暂缓（后续任务补）
 * - 管理端登录显示阻断页（规划 §1：admin 留在 Web）
 */
export default function Profile() {
  const { user } = useUser()
  const { signOut } = useAuth()

  // 编辑个人信息（联系方式 + 入团时间 + 学院 + 隐私开关）
  const { data: profileData, update: updateProfile } = useProfiles({ userId: user?.id })
  const myProfile = profileData[0]

  // 头像卡展示信息
  const fullName = myProfile?.full_name ?? '—'
  const instrument = myProfile?.instrument ?? '—'
  const email = user?.email ?? '—'
  const initials = fullName !== '—' ? fullName.slice(0, 2) || fullName.slice(0, 1) || '--' : '--'

  // ---- 个人信息编辑弹窗 ----
  const [isEditModalOpen, setIsEditModalOpen] = useState(false)
  const [editPhone, setEditPhone] = useState('')
  const [editJoinDate, setEditJoinDate] = useState('')
  const [editCollege, setEditCollege] = useState('')
  const [hideEmail, setHideEmail] = useState(false)
  const [hidePhone, setHidePhone] = useState(false)
  const [hideJoinDate, setHideJoinDate] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  const [isEditSubmitting, setIsEditSubmitting] = useState(false)
  const editSubmittingRef = useRef(false) // 同步 guard，阻断竞态窗口
  // join_date 是否被用户改动过：历史数据可能为学期格式（如「2024秋」），
  // Picker 无法表示，未改动时保存不写 join_date 字段，保留原值防误清空
  const [isJoinDateTouched, setIsJoinDateTouched] = useState(false)

  // ---- 账号与密码弹窗（demo 范围：仅修改密码）----
  const [isPwdModalOpen, setIsPwdModalOpen] = useState(false)
  const [newPwd, setNewPwd] = useState('')
  const [confirmPwd, setConfirmPwd] = useState('')
  const [pwdError, setPwdError] = useState<string | null>(null)
  const [isUpdatingPwd, setIsUpdatingPwd] = useState(false)
  const pwdSubmittingRef = useRef(false) // 同步 guard，阻断竞态窗口

  // ---- 考勤查看（打开时才条件挂载查询组件，见下方渲染）----
  const [isAttendanceOpen, setIsAttendanceOpen] = useState(false)

  // 打开弹窗时用最新 profile 预填
  const handleOpenEditModal = () => {
    // myProfile 未加载完成时为 undefined，预填会得到空值，保存会清空数据
    if (!myProfile) {
      void Taro.showToast({ title: '个人信息加载中，请稍候再试', icon: 'none' })
      return
    }
    setEditPhone(myProfile.phone_number ?? '')
    setEditJoinDate(myProfile.join_date ?? '')
    setEditCollege(myProfile.college ?? '')
    setHideEmail(myProfile.hide_email)
    setHidePhone(myProfile.hide_phone)
    setHideJoinDate(myProfile.hide_join_date)
    setIsJoinDateTouched(false)
    setEditError(null)
    setIsEditModalOpen(true)
  }

  const handleEditSubmit = async () => {
    if (!user) return
    // 双重 guard 防重复提交：ref 同步阻断 + state 异步兜底
    if (editSubmittingRef.current || isEditSubmitting) return

    const phone = editPhone.trim()
    if (phone && !isValidPhoneNumber(phone)) {
      setEditError('手机号格式不正确（11 位数字，以 1 开头）')
      return
    }

    // join_date 写入条件：用户改动过且值与原值不同（手滑点到同一天不写，保留原值）。
    // 任何实际变化（含标准 YYYY-MM-DD 原值）都需用户确认——Picker 打开默认
    // 停在「今天」，若不确认会静默覆盖原日期
    const originalJoinDate = myProfile?.join_date ?? ''
    const willWriteJoinDate = isJoinDateTouched && editJoinDate.trim() !== originalJoinDate.trim()
    if (willWriteJoinDate) {
      const source = originalJoinDate.trim() || '当前为空'
      const target = editJoinDate.trim() || '（空）'
      const res = await Taro.showModal({
        title: '确认修改入团时间',
        content: `保存将把入团时间从「${source}」变更为「${target}」，确认？`,
      })
      if (!res.confirm) return
    }

    editSubmittingRef.current = true
    setIsEditSubmitting(true)
    setEditError(null)
    try {
      const ok = await updateProfile(user.id, {
        phone_number: phone || null,
        college: editCollege.trim() || null,
        hide_email: hideEmail,
        hide_phone: hidePhone,
        hide_join_date: hideJoinDate,
        // 未改动过 join_date（如历史学期格式）或值未变化时不写入，保留原值
        ...(willWriteJoinDate ? { join_date: editJoinDate || null } : {}),
      })
      if (ok) {
        setIsEditModalOpen(false)
        void Taro.showToast({ title: '个人信息已更新', icon: 'success' })
      } else {
        setEditError('保存失败，请重试')
      }
    } finally {
      editSubmittingRef.current = false
      setIsEditSubmitting(false)
    }
  }

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
      setIsPwdModalOpen(false)
    } finally {
      // 无论成败都复位：避免抛异常时 isUpdatingPwd 卡 true，弹窗被守卫锁死无法关闭
      pwdSubmittingRef.current = false
      setIsUpdatingPwd(false)
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
    <View className='h-full overflow-y-auto overscroll-contain px-4 pb-safe'>
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

        {/* 设置栏目 */}
        <View>
          <Text className='text-xs font-medium text-text-muted'>设置</Text>
          <View className='mt-2 overflow-hidden rounded-2xl border border-border bg-card'>
            <View className='border-b border-border px-4 py-3' onClick={handleOpenEditModal}>
              <Text className='text-sm font-medium text-text'>个人信息</Text>
            </View>
            <View
              className='border-b border-border px-4 py-3'
              onClick={() => {
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
            <View className='px-4 py-3' onClick={() => void handleLogout()}>
              <Text className='text-sm font-medium text-danger'>退出登录</Text>
            </View>
          </View>
        </View>
      </View>

      {/* 编辑个人信息 Modal */}
      <Modal
        open={isEditModalOpen}
        onClose={() => {
          if (!isEditSubmitting) setIsEditModalOpen(false)
        }}
        title='编辑个人信息'
        position='bottom'
        closeOnOverlay={!isEditSubmitting}
      >
        <View className='mt-4 space-y-3'>
          {/* 邮箱：不可编辑，仅提供隐藏开关 */}
          <View>
            <View className='flex items-center justify-between gap-2'>
              <Text className='text-xs font-medium text-text-muted'>邮箱</Text>
              <Toggle
                options={PRIVACY_OPTIONS}
                value={privacyValue(hideEmail)}
                onChange={(v) => setHideEmail(v === 'hidden')}
                getLabel={privacyLabel}
              />
            </View>
            <Text className='mt-1 block truncate text-xs text-text-subtle'>
              {myProfile?.email ?? '—'}
            </Text>
          </View>
          {/* 联系方式 + 隐藏手机号开关 */}
          <View>
            <View className='flex items-center justify-between gap-2'>
              <Text className='text-xs font-medium text-text-muted'>联系方式</Text>
              <Toggle
                options={PRIVACY_OPTIONS}
                value={privacyValue(hidePhone)}
                onChange={(v) => setHidePhone(v === 'hidden')}
                getLabel={privacyLabel}
              />
            </View>
            <Input
              className='mt-1 h-10 w-full rounded-xl border border-border bg-muted px-3 text-sm text-text'
              placeholder='11 位手机号'
              value={editPhone}
              onInput={(e) => {
                setEditPhone(e.detail.value)
                setEditError(null)
              }}
            />
          </View>
          {/* 入团时间 + 隐藏入团时间开关（TEXT 列，Picker 输出 YYYY-MM-DD 与列存文本一致） */}
          <View>
            <View className='flex items-center justify-between gap-2'>
              <Text className='text-xs font-medium text-text-muted'>入团时间</Text>
              <Toggle
                options={PRIVACY_OPTIONS}
                value={privacyValue(hideJoinDate)}
                onChange={(v) => setHideJoinDate(v === 'hidden')}
                getLabel={privacyLabel}
              />
            </View>
            <Picker
              mode='date'
              value={isStandardDateString(editJoinDate) ? editJoinDate : ''}
              onChange={(e) => {
                setEditJoinDate(String(e.detail.value))
                setIsJoinDateTouched(true)
                setEditError(null)
              }}
            >
              <View className='mt-1 flex h-10 items-center rounded-xl border border-border bg-muted px-3'>
                <Text className='text-sm text-text'>{editJoinDate || '选择日期'}</Text>
              </View>
            </Picker>
            {/* 原值非标准日期格式（Picker 无法显示）时提示当前值，未修改则保存时保留 */}
            {myProfile?.join_date && !isStandardDateString(myProfile.join_date) && (
              <Text className='mt-1 block text-xs text-text-subtle'>
                当前值：{myProfile.join_date}（非日期格式，未修改则保留）
              </Text>
            )}
          </View>
          <View>
            <Text className='text-xs font-medium text-text-muted'>学院</Text>
            <Input
              className='mt-1 h-10 w-full rounded-xl border border-border bg-muted px-3 text-sm text-text'
              placeholder='所在学院'
              value={editCollege}
              onInput={(e) => {
                setEditCollege(e.detail.value)
                setEditError(null)
              }}
            />
          </View>
          {editError && <Text className='block text-xs text-danger'>{editError}</Text>}
          {/* 双按钮操作行右下角（取消 + 保存） */}
          <View className='flex justify-end gap-2'>
            <View
              className={`rounded-full border border-border bg-card px-4 py-2 text-xs font-medium text-text-muted ${
                isEditSubmitting ? 'opacity-60' : ''
              }`}
              onClick={isEditSubmitting ? undefined : () => setIsEditModalOpen(false)}
            >
              取消
            </View>
            <View
              className={`rounded-full bg-primary px-4 py-2 text-xs font-medium text-primary-foreground ${
                isEditSubmitting ? 'opacity-60' : ''
              }`}
              onClick={isEditSubmitting ? undefined : () => void handleEditSubmit()}
            >
              {isEditSubmitting ? '保存中…' : '保存'}
            </View>
          </View>
        </View>
      </Modal>

      {/* 账号与密码 Modal（demo 范围：仅修改密码；换绑邮箱后续任务补） */}
      <Modal
        open={isPwdModalOpen}
        onClose={() => {
          // 提交中不允许关闭
          if (isUpdatingPwd) {
            void Taro.showToast({ title: '提交进行中，请稍候再关闭', icon: 'none' })
            return
          }
          setIsPwdModalOpen(false)
        }}
        title='修改密码'
        position='bottom'
        closeOnOverlay={!isUpdatingPwd}
      >
        <View className='mt-4 space-y-3'>
          <View>
            <Text className='mb-1 block text-xs font-medium text-text-muted'>新密码</Text>
            <Input
              password
              className='h-10 w-full rounded-xl border border-border bg-muted px-3 text-sm text-text'
              placeholder='至少 6 位'
              value={newPwd}
              onInput={(e) => {
                setNewPwd(e.detail.value)
                setPwdError(null)
              }}
            />
          </View>
          <View>
            <Text className='mb-1 block text-xs font-medium text-text-muted'>确认新密码</Text>
            <Input
              password
              className='h-10 w-full rounded-xl border border-border bg-muted px-3 text-sm text-text'
              placeholder='再次输入'
              value={confirmPwd}
              onInput={(e) => {
                setConfirmPwd(e.detail.value)
                setPwdError(null)
              }}
            />
          </View>
          {pwdError && <Text className='block text-xs text-danger'>{pwdError}</Text>}
          {/* 双按钮操作行右下角（取消 + 确认修改） */}
          <View className='flex justify-end gap-2'>
            <View
              className={`rounded-full border border-border bg-card px-4 py-2 text-xs font-medium text-text-muted ${
                isUpdatingPwd ? 'opacity-60' : ''
              }`}
              onClick={isUpdatingPwd ? undefined : () => setIsPwdModalOpen(false)}
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
      </Modal>

      {/* 考勤查看 Modal：条件渲染挂载——打开时才挂载并查询，关闭即卸载清态 */}
      {isAttendanceOpen && user && (
        <AttendanceHistoryModal userId={user.id} onClose={() => setIsAttendanceOpen(false)} />
      )}
    </View>
  )
}
