import { useRef, useState } from 'react'
import { View, Text, Input, Picker, Image } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useUser } from '@/context/user-context'
import { useThemeClass } from '@/context/theme-context'
import { useProfiles } from '@/hooks/useProfiles'
import { isValidPhoneNumber } from '@/lib/validation'
import { INSTRUMENT_ORDER, OTHER_INSTRUMENT_GROUP } from '@/constants/instruments'
import eyeIcon from '@/assets/icons/eye.png'
import eyeDashedIcon from '@/assets/icons/eye-dashed.png'
import './index.scss'

// 入团时间选择器：年份区间 + 春/秋两季，输出形如「2024秋」
const CURRENT_YEAR = new Date().getFullYear()
const JOIN_YEARS = Array.from({ length: CURRENT_YEAR - 1990 + 2 }, (_, i) => String(1990 + i))
const JOIN_SEASONS: string[] = ['春', '秋']

const parseJoinDate = (v: string | null | undefined): { year: string; season: string } => {
  if (v) {
    const m = /^(\d{4})(春|秋)$/.exec(v.trim())
    if (m) return { year: m[1], season: m[2] }
    const y = /^(\d{4})/.exec(v.trim())
    if (y) return { year: y[1], season: '秋' }
  }
  return { year: String(CURRENT_YEAR), season: '秋' }
}

/**
 * 个人信息页（从「我的」独立出来的查看 / 编辑页）：
 * - 顶部居中头像；右上角蓝色「编辑」进入编辑态并切换为「保存」+「取消」
 * - 字段自上而下：姓名 / 乐器 / 入团时间 / 分隔线（以下信息可对外隐藏）/
 *   绑定邮箱 / 联系方式 / 学院
 * - 绑定邮箱、联系方式、学院三行在编辑态尾部各有一个眼图标，切换对外隐藏
 *   （公开 = eye.png，隐藏 = eye-dashed.png）；姓名与邮箱不可编辑（灰显）
 */
export default function ProfileInfoPage() {
  const { user } = useUser()
  const darkClass = useThemeClass()
  const { data: profileData, update: updateProfile } = useProfiles({ userId: user?.id })
  const myProfile = profileData[0]

  const [isEditing, setIsEditing] = useState(false)
  const [editInstrument, setEditInstrument] = useState('')
  const [editPhone, setEditPhone] = useState('')
  const [editCollege, setEditCollege] = useState('')
  const [editHideEmail, setEditHideEmail] = useState(false)
  const [editHidePhone, setEditHidePhone] = useState(false)
  const [editHideCollege, setEditHideCollege] = useState(false)
  const [editJoinYear, setEditJoinYear] = useState(String(CURRENT_YEAR))
  const [editJoinSeason, setEditJoinSeason] = useState<string>('秋')
  const [isJoinTouched, setIsJoinTouched] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const submittingRef = useRef(false)

  const fullName = myProfile?.full_name ?? '—'
  const email = myProfile?.email ?? '—'
  const initials = fullName !== '—' ? fullName.slice(0, 2) || fullName.slice(0, 1) || '--' : '--'
  // 视图态用资料实际隐藏状态；编辑态用本地草稿
  const hideEmail = isEditing ? editHideEmail : (myProfile?.hide_email ?? false)
  const hidePhone = isEditing ? editHidePhone : (myProfile?.hide_phone ?? false)
  const hideCollege = isEditing ? editHideCollege : (myProfile?.hide_college ?? false)

  const instrumentOptions = [...INSTRUMENT_ORDER, OTHER_INSTRUMENT_GROUP]
  const selectedInstrumentIndex = Math.max(0, instrumentOptions.indexOf(editInstrument))

  const startEdit = () => {
    if (!myProfile) {
      void Taro.showToast({ title: '个人信息加载中，请稍候再试', icon: 'none' })
      return
    }
    setEditInstrument(myProfile.instrument ?? '')
    setEditPhone(myProfile.phone_number ?? '')
    setEditCollege(myProfile.college ?? '')
    setEditHideEmail(myProfile.hide_email)
    setEditHidePhone(myProfile.hide_phone)
    setEditHideCollege(myProfile.hide_college)
    const parsed = parseJoinDate(myProfile.join_date)
    setEditJoinYear(parsed.year)
    setEditJoinSeason(parsed.season)
    setIsJoinTouched(false)
    setError(null)
    setIsEditing(true)
  }

  const cancelEdit = () => {
    if (submitting) return
    setIsEditing(false)
    setError(null)
  }

  const handleSave = async () => {
    if (!user || !myProfile) return
    if (submittingRef.current || submitting) return

    const phone = editPhone.trim()
    if (phone && !isValidPhoneNumber(phone)) {
      setError('手机号格式不正确（11 位数字，以 1 开头）')
      return
    }

    const newJoin = `${editJoinYear}${editJoinSeason}`
    const originalJoinDate = myProfile.join_date ?? ''
    const willWriteJoin = isJoinTouched && newJoin !== originalJoinDate
    if (willWriteJoin) {
      const source = originalJoinDate.trim() || '当前为空'
      const res = await Taro.showModal({
        title: '确认修改入团时间',
        content: `保存将把入团时间从「${source}」变更为「${newJoin}」，确认？`,
      })
      if (!res.confirm) return
    }

    submittingRef.current = true
    setSubmitting(true)
    setError(null)
    try {
      const ok = await updateProfile(user.id, {
        instrument: editInstrument.trim() || null,
        phone_number: phone || null,
        college: editCollege.trim() || null,
        hide_email: editHideEmail,
        hide_phone: editHidePhone,
        hide_college: editHideCollege,
        ...(willWriteJoin ? { join_date: newJoin } : {}),
      })
      if (ok) {
        setIsEditing(false)
        void Taro.showToast({ title: '个人信息已更新', icon: 'success' })
      } else {
        setError('保存失败，请重试')
      }
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  if (!myProfile) {
    return (
      <View className={`${darkClass} flex h-full items-center justify-center bg-page-bg`}>
        <Text className='text-sm text-text-muted'>加载中…</Text>
      </View>
    )
  }

  return (
    <View className={`${darkClass} min-h-full bg-page-bg`}>
      {/* 顶部标题 + 编辑入口 */}
      <View className='flex items-center justify-between px-4 pb-2 pt-3'>
        <View className='w-12' />
        <Text className='text-base font-semibold text-text'>个人信息</Text>
        <View className='flex w-12 items-center justify-end'>
          {!isEditing && (
            <Text className='text-sm font-medium text-primary' onClick={startEdit}>
              编辑
            </Text>
          )}
        </View>
      </View>

      {/* 居中头像 */}
      <View className='flex flex-col items-center py-6'>
        <View className='flex h-20 w-20 items-center justify-center rounded-full bg-primary text-2xl font-medium text-primary-foreground'>
          {initials}
        </View>
      </View>

      <View className='px-4'>
        {/* 姓名（不可编辑） */}
        <View className='flex items-center gap-3 border-b border-border py-3'>
          <Text className='w-20 shrink-0 text-sm text-primary'>姓名</Text>
          <View className='flex-1 rounded-xl border border-border bg-muted px-3 py-2'>
            <Text className='block text-sm text-text'>{fullName}</Text>
          </View>
        </View>

        {/* 乐器（编辑态从声部列表选择） */}
        <View className='flex items-center gap-3 border-b border-border py-3'>
          <Text className='w-20 shrink-0 text-sm text-primary'>乐器</Text>
          {isEditing ? (
            <Picker
              className='flex-1'
              mode='selector'
              range={instrumentOptions}
              value={selectedInstrumentIndex}
              onChange={(e) => setEditInstrument(instrumentOptions[Number(e.detail.value)] ?? '')}
            >
              <View className='rounded-xl border border-border bg-muted px-3 py-2'>
                <Text className='text-sm text-text'>{editInstrument || '选择乐器'}</Text>
              </View>
            </Picker>
          ) : (
            <View className='flex-1 rounded-xl border border-border bg-muted px-3 py-2'>
              <Text className='block text-sm text-text'>{myProfile.instrument || '无'}</Text>
            </View>
          )}
        </View>

        {/* 入团时间（编辑态年份 + 春/秋） */}
        <View className='flex items-center gap-3 border-b border-border py-3'>
          <Text className='w-20 shrink-0 text-sm text-primary'>入团时间</Text>
          {isEditing ? (
            <Picker
              className='flex-1'
              mode='multiSelector'
              range={[JOIN_YEARS, JOIN_SEASONS]}
              value={[JOIN_YEARS.indexOf(editJoinYear), JOIN_SEASONS.indexOf(editJoinSeason)]}
              onChange={(e) => {
                const [yi, si] = e.detail.value as number[]
                setEditJoinYear(JOIN_YEARS[yi] ?? String(CURRENT_YEAR))
                setEditJoinSeason(JOIN_SEASONS[si] ?? '秋')
                setIsJoinTouched(true)
              }}
            >
              <View className='rounded-xl border border-border bg-muted px-3 py-2'>
                <Text className='text-sm text-text'>{`${editJoinYear}${editJoinSeason}`}</Text>
              </View>
            </Picker>
          ) : (
            <View className='flex-1 rounded-xl border border-border bg-muted px-3 py-2'>
              <Text className='block text-sm text-text'>{myProfile.join_date ?? '—'}</Text>
            </View>
          )}
        </View>

        {/* 分隔线：文字置于线中，标识下方信息可对外隐藏 */}
        <View className='mt-4 flex items-center gap-3'>
          <View className='h-px flex-1 bg-border' />
          <Text className='text-xs text-text-subtle'>以下信息可对外隐藏</Text>
          <View className='h-px flex-1 bg-border' />
        </View>

        {/* 绑定邮箱（不可编辑 + 隐藏开关） */}
        <View className='flex items-center gap-3 border-b border-border py-3'>
          <Text className='w-20 shrink-0 text-sm text-primary'>绑定邮箱</Text>
          <View className='flex-1 truncate rounded-xl border border-border bg-muted px-3 py-2'>
            <Text className='block truncate text-sm text-text'>{email}</Text>
          </View>
          <Image
            src={hideEmail ? eyeDashedIcon : eyeIcon}
            className='h-5 w-5 shrink-0'
            onClick={isEditing ? () => setEditHideEmail((v) => !v) : undefined}
          />
        </View>

        {/* 联系方式（可编辑 + 隐藏开关） */}
        <View className='flex items-center gap-3 border-b border-border py-3'>
          <Text className='w-20 shrink-0 text-sm text-primary'>联系方式</Text>
          {isEditing ? (
            <View className='flex-1 overflow-hidden rounded-xl border border-border bg-muted px-3'>
              <Input
                className='h-10 w-full bg-transparent text-sm text-text'
                placeholder='11 位手机号'
                value={editPhone}
                onInput={(e) => {
                  setEditPhone(e.detail.value)
                  setError(null)
                }}
              />
            </View>
          ) : (
            <View className='flex-1 rounded-xl border border-border bg-muted px-3 py-2'>
              <Text className='block text-sm text-text'>{myProfile.phone_number ?? '—'}</Text>
            </View>
          )}
          <Image
            src={hidePhone ? eyeDashedIcon : eyeIcon}
            className='h-5 w-5 shrink-0'
            onClick={isEditing ? () => setEditHidePhone((v) => !v) : undefined}
          />
        </View>

        {/* 学院（可编辑 + 隐藏开关） */}
        <View className='flex items-center gap-3 border-b border-border py-3'>
          <Text className='w-20 shrink-0 text-sm text-primary'>学院</Text>
          {isEditing ? (
            <View className='flex-1 overflow-hidden rounded-xl border border-border bg-muted px-3'>
              <Input
                className='h-10 w-full bg-transparent text-sm text-text'
                placeholder='所在学院'
                value={editCollege}
                onInput={(e) => {
                  setEditCollege(e.detail.value)
                  setError(null)
                }}
              />
            </View>
          ) : (
            <View className='flex-1 rounded-xl border border-border bg-muted px-3 py-2'>
              <Text className='block text-sm text-text'>{myProfile.college ?? '—'}</Text>
            </View>
          )}
          <Image
            src={hideCollege ? eyeDashedIcon : eyeIcon}
            className='h-5 w-5 shrink-0'
            onClick={isEditing ? () => setEditHideCollege((v) => !v) : undefined}
          />
        </View>

        {error && <Text className='mt-3 block text-xs text-danger'>{error}</Text>}

        {/* 编辑态底部操作：保存（大按钮·黑底）/ 取消（大按钮·白底） */}
        {isEditing && (
          <View className='mt-6 space-y-3 pb-safe'>
            <View
              className={`flex h-11 w-full items-center justify-center rounded-xl text-base font-medium text-white ${
                submitting ? 'opacity-60' : ''
              }`}
              style={{ backgroundColor: '#000000' }}
              onClick={submitting ? undefined : handleSave}
            >
              {submitting ? '保存中…' : '保存'}
            </View>
            <View
              className={`flex h-11 w-full items-center justify-center rounded-xl border border-border bg-card text-base font-medium text-text ${
                submitting ? 'opacity-60' : ''
              }`}
              onClick={submitting ? undefined : cancelEdit}
            >
              取消
            </View>
          </View>
        )}
      </View>
    </View>
  )
}
