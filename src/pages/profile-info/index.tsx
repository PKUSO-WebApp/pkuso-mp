import { useRef, useState, useCallback } from 'react'
import { View, Text, Input, Picker, Image, Button } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useUser } from '@/context/user-context'
import { useThemeClass } from '@/context/theme-context'
import { useT, useNavTitle } from '@/i18n'
import { useProfiles } from '@/hooks/useProfiles'
import { isValidPhoneNumber } from '@/lib/validation'
import { translateInstrument } from '@/lib/instrument-i18n'
import { translateJoinDate } from '@/lib/join-date-i18n'
import { INSTRUMENT_ORDER, OTHER_INSTRUMENT_GROUP } from '@/constants/instruments'
import { supabase } from '@/lib/supabase'
import { uploadLocalFile } from '@/lib/uploadLocalFile'
import eyeIcon from '@/assets/icons/eye.png'
import eyeOffIcon from '@/assets/icons/eye-off.png'
import eyeDarkIcon from '@/assets/icons/eye-dark.png'
import eyeOffDarkIcon from '@/assets/icons/eye-off-dark.png'
import pencilIcon from '@/assets/icons/pencil-line.png'
import pencilDarkIcon from '@/assets/icons/pencil-line-dark.png'
import './index.scss'

// 入团时间选择器：年份区间 + 春/秋两季；存储恒为规范值「YYYY春/YYYY秋」，展示层经 translateJoinDate 本地化
const CURRENT_YEAR = new Date().getFullYear()
const JOIN_YEARS = Array.from({ length: CURRENT_YEAR - 1990 + 2 }, (_, i) => String(1990 + i))

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
  const { t } = useT()
  useNavTitle('profileInfo.title')

  const notFilled = t('common.notFilled')

  const [isEditing, setIsEditing] = useState(false)
  const [editInstrument, setEditInstrument] = useState('')
  const [editPhone, setEditPhone] = useState('')
  const [editCollege, setEditCollege] = useState('')
  const [editHideEmail, setEditHideEmail] = useState(false)
  const [editHidePhone, setEditHidePhone] = useState(false)
  const [editHideCollege, setEditHideCollege] = useState(false)
  const [editJoinYear, setEditJoinYear] = useState(String(CURRENT_YEAR))
  const [editJoinSeason, setEditJoinSeason] = useState<string>('秋')
  const [editIsInOrchestra, setEditIsInOrchestra] = useState(false)
  const [isJoinTouched, setIsJoinTouched] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const submittingRef = useRef(false)

  // 头像上传相关状态
  const [avatarUploading, setAvatarUploading] = useState(false)

  const fullName = myProfile?.full_name ?? notFilled
  const email = myProfile?.email ?? notFilled
  const initials = fullName !== notFilled ? fullName.slice(0, 2) || fullName.slice(0, 1) || '--' : '--'
  // 视图态用资料实际隐藏状态；编辑态用本地草稿
  const hideEmail = isEditing ? editHideEmail : (myProfile?.hide_email ?? false)
  const hidePhone = isEditing ? editHidePhone : (myProfile?.hide_phone ?? false)
  const hideCollege = isEditing ? editHideCollege : (myProfile?.hide_college ?? false)
  // 暗色模式换用高亮暗版眼图标，避免与深底色融为一体
  const isDark = darkClass === 'dark'
  const eyeImg = isDark ? eyeDarkIcon : eyeIcon
  const eyeOffImg = isDark ? eyeOffDarkIcon : eyeOffIcon
  const pencilImg = isDark ? pencilDarkIcon : pencilIcon

  const avatarUrl = myProfile?.avatar_url ?? null

  const instrumentOptions = [...INSTRUMENT_ORDER, OTHER_INSTRUMENT_GROUP]
  const instrumentLabels = instrumentOptions.map((o) => translateInstrument(o, t))
  const selectedInstrumentIndex = Math.max(0, instrumentOptions.indexOf(editInstrument))

  // 在团情况选择器（与乐器同款滚动选择）：true=在团，false=不在团
  const orchestraStatusLabels = [
    t('profileInfo.statusActive'),
    t('profileInfo.statusInactive'),
  ]
  // 季节滚轮：显示用本地化标签，索引 ↔ 规范值「春/秋」（存储格式受 DB CHECK 约束）
  const seasonLabels = [t('common.joinDate.season.spring'), t('common.joinDate.season.fall')]

  const startEdit = () => {
    if (!myProfile) {
      void Taro.showToast({ title: t('profileInfo.profileLoading'), icon: 'none' })
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
    setEditIsInOrchestra(myProfile.is_in_orchestra === true)
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
      setError(t('profileInfo.phoneInvalid'))
      return
    }

    const newJoin = `${editJoinYear}${editJoinSeason}`
    const originalJoinDate = myProfile.join_date ?? ''
    const willWriteJoin = isJoinTouched && newJoin !== originalJoinDate
    if (willWriteJoin) {
      const source = originalJoinDate.trim() || t('profileInfo.emptyJoinDate')
      const res = await Taro.showModal({
        title: t('profileInfo.confirmJoinTitle'),
        content: t('profileInfo.confirmJoinContent', { source, new: newJoin }),
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
        is_in_orchestra: editIsInOrchestra,
        ...(willWriteJoin ? { join_date: newJoin } : {}),
      })
      if (ok) {
        setIsEditing(false)
        void Taro.showToast({ title: t('profileInfo.saved'), icon: 'success' })
      } else {
        setError(t('profileInfo.saveFailed'))
      }
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  // 头像上传：读本地临时文件 → 上传 Supabase Storage → 更新本地状态
  const uploadAvatar = useCallback(async (tempFilePath: string) => {
    if (!user || avatarUploading) return
    setAvatarUploading(true)
    try {
      const userId = user.id
      const fileName = `${userId}/avatar.jpg`

      const { error: uploadError } = await uploadLocalFile(
        supabase, 'avatar_images', fileName, tempFilePath, 'image/jpeg', true
      )
      if (uploadError) throw uploadError

      const { data: urlData } = supabase.storage.from('avatar_images').getPublicUrl(fileName)
      const publicUrl = `${urlData.publicUrl}?t=${Date.now()}`

      const { error: profileError } = await supabase
        .from('profiles')
        .update({ avatar_url: publicUrl })
        .eq('id', userId)
      if (profileError) throw profileError

      updateProfile(userId, { avatar_url: publicUrl })
      void Taro.showToast({ title: t('profile.avatarSaved'), icon: 'success' })
    } catch (e) {
      console.error('[ProfileInfo] 头像上传失败:', e)
      void Taro.showToast({ title: t('profile.avatarSaveFailed'), icon: 'none' })
    } finally {
      setAvatarUploading(false)
    }
  }, [user, avatarUploading, updateProfile, t])

  // 微信头像选择回调：chooseAvatar 返回本地临时路径，直接上传
  const handleWechatAvatar = useCallback((e: any) => {
    const tempPath = e.detail?.avatarUrl
    if (tempPath) void uploadAvatar(tempPath)
  }, [uploadAvatar])

  if (!myProfile) {
    return (
      <View className={`${darkClass} flex h-full items-center justify-center bg-page-bg`}>
        <Text className='text-sm text-text-muted'>{t('common.actions.loading')}</Text>
      </View>
    )
  }

  return (
    <View className={`${darkClass} min-h-full bg-page-bg pb-safe`}>
      {/* 编辑入口（右上角） */}
      <View className='flex items-center justify-end px-4 pb-2 pt-3'>
        {!isEditing && (
          <Text className='text-sm font-medium text-primary' onClick={startEdit}>
            {t('common.actions.edit')}
          </Text>
        )}
      </View>

      {/* 居中头像：编辑态下整体是 chooseAvatar 按钮 */}
      <View className='flex flex-col items-center py-6'>
        <View className='relative'>
          {isEditing ? (
            <>
              <Button
                openType='chooseAvatar'
                onChooseAvatar={handleWechatAvatar}
                className='h-20 w-20 rounded-full overflow-hidden bg-primary p-0 m-0 leading-normal min-h-0'
              >
                {avatarUrl ? (
                  <Image src={avatarUrl} className='h-full w-full rounded-full' mode='aspectFill' />
                ) : (
                  <View className='flex h-full w-full items-center justify-center'>
                    <Text className='text-2xl font-medium text-primary-foreground'>{initials}</Text>
                  </View>
                )}
              </Button>
              <Button
                openType='chooseAvatar'
                onChooseAvatar={handleWechatAvatar}
                className='absolute bottom-0 right-0 z-10 flex h-8 w-8 items-center justify-center rounded-full border-2 border-primary p-0 m-0 leading-normal min-h-0'
                style={{ backgroundColor: 'var(--color-page-bg)' }}
              >
                <Image src={pencilImg} className='h-4 w-4' />
              </Button>
            </>
          ) : (
            <View className='h-20 w-20 rounded-full overflow-hidden bg-primary'>
              {avatarUrl ? (
                <Image src={avatarUrl} className='h-full w-full rounded-full' mode='aspectFill' />
              ) : (
                <View className='flex h-full w-full items-center justify-center'>
                  <Text className='text-2xl font-medium text-primary-foreground'>{initials}</Text>
                </View>
              )}
            </View>
          )}
        </View>
      </View>

      <View className='px-4'>
        {/* 姓名（不可编辑） */}
        <View className='flex items-center gap-3 border-b border-border py-3'>
          <Text className='w-20 shrink-0 text-sm text-primary'>{t('profileInfo.nameLabel')}</Text>
          <View className='flex-1 rounded-xl border border-border bg-muted px-3 py-2'>
            <Text className='block text-sm text-text'>{fullName}</Text>
          </View>
        </View>

        {/* 乐器（编辑态从声部列表选择） */}
        <View className='flex items-center gap-3 border-b border-border py-3'>
          <Text className='w-20 shrink-0 text-sm text-primary'>{t('profileInfo.instrumentLabel')}</Text>
          {isEditing ? (
            <Picker
              className='flex-1'
              mode='selector'
              range={instrumentLabels}
              value={selectedInstrumentIndex}
              onChange={(e) => setEditInstrument(instrumentOptions[Number(e.detail.value)] ?? '')}
            >
              <View className='rounded-xl border border-border bg-muted px-3 py-2'>
                <Text className='text-sm text-text'>{translateInstrument(editInstrument, t) || t('profileInfo.selectInstrument')}</Text>
              </View>
            </Picker>
          ) : (
            <View className='flex-1 rounded-xl border border-border bg-muted px-3 py-2'>
                <Text className='block text-sm text-text'>{translateInstrument(myProfile.instrument, t) || notFilled}</Text>
            </View>
          )}
        </View>

        {/* 入团时间（编辑态年份 + 春/秋） */}
        <View className='flex items-center gap-3 border-b border-border py-3'>
          <Text className='w-20 shrink-0 text-sm text-primary'>{t('profileInfo.joinTimeLabel')}</Text>
          {isEditing ? (
            <Picker
              className='flex-1'
              mode='multiSelector'
              range={[JOIN_YEARS, seasonLabels]}
              value={[JOIN_YEARS.indexOf(editJoinYear), editJoinSeason === '春' ? 0 : 1]}
              onChange={(e) => {
                const [yi, si] = e.detail.value as number[]
                setEditJoinYear(JOIN_YEARS[yi] ?? String(CURRENT_YEAR))
                setEditJoinSeason(si === 0 ? '春' : '秋')
                setIsJoinTouched(true)
              }}
            >
              <View className='rounded-xl border border-border bg-muted px-3 py-2'>
                <Text className='text-sm text-text'>
                  {translateJoinDate(`${editJoinYear}${editJoinSeason}`, t)}
                </Text>
              </View>
            </Picker>
          ) : (
            <View className='flex-1 rounded-xl border border-border bg-muted px-3 py-2'>
              <Text className='block text-sm text-text'>
                {myProfile.join_date ? translateJoinDate(myProfile.join_date, t) : notFilled}
              </Text>
            </View>
          )}
        </View>

        {/* 在团情况（编辑态与乐器同款滚动选择：在团/不在团） */}
        <View className='flex items-center gap-3 border-b border-border py-3'>
          <Text className='w-20 shrink-0 text-sm text-primary'>{t('profileInfo.statusLabel')}</Text>
          {isEditing ? (
            <Picker
              className='flex-1'
              mode='selector'
              range={orchestraStatusLabels}
              value={editIsInOrchestra ? 0 : 1}
              onChange={(e) => setEditIsInOrchestra(Number(e.detail.value) === 0)}
            >
              <View className='rounded-xl border border-border bg-muted px-3 py-2'>
                <Text className='text-sm text-text'>
                  {editIsInOrchestra ? t('profileInfo.statusActive') : t('profileInfo.statusInactive')}
                </Text>
              </View>
            </Picker>
          ) : (
            <View className='flex-1 rounded-xl border border-border bg-muted px-3 py-2'>
              <Text className='block text-sm text-text'>
                {myProfile.is_in_orchestra === true
                  ? t('profileInfo.statusActive')
                  : t('profileInfo.statusInactive')}
              </Text>
            </View>
          )}
        </View>

        {/* 分隔线：文字置于线中，标识下方信息可对外隐藏 */}
        <View className='mt-4 flex items-center gap-3'>
          <View className='h-px flex-1 bg-border' />
          <Text className='text-xs text-text-subtle'>{t('profileInfo.hideHint')}</Text>
          <View className='h-px flex-1 bg-border' />
        </View>

        {/* 绑定邮箱（不可编辑 + 隐藏开关） */}
        <View className='flex items-center gap-3 border-b border-border py-3'>
          <Text className='w-20 shrink-0 text-sm text-primary'>{t('profileInfo.emailLabel')}</Text>
          <View className='flex-1 truncate rounded-xl border border-border bg-muted px-3 py-2'>
            <Text className='block truncate text-sm text-text'>{email}</Text>
          </View>
          {isEditing && (
            <Image
              src={hideEmail ? eyeOffImg : eyeImg}
              className='h-5 w-5 shrink-0'
              onClick={() => setEditHideEmail((v) => !v)}
            />
          )}
        </View>

        {/* 联系方式（可编辑 + 隐藏开关） */}
        <View className='flex items-center gap-3 border-b border-border py-3'>
          <Text className='w-20 shrink-0 text-sm text-primary'>{t('profileInfo.contactLabel')}</Text>
          {isEditing ? (
            <View className='flex-1 overflow-hidden rounded-xl border border-border bg-muted px-3'>
              <Input
                className='h-10 w-full bg-transparent text-sm text-text'
                placeholder={t('profileInfo.phonePlaceholder')}
                value={editPhone}
                onInput={(e) => {
                  setEditPhone(e.detail.value)
                  setError(null)
                }}
              />
            </View>
          ) : (
            <View className='flex-1 rounded-xl border border-border bg-muted px-3 py-2'>
              <Text className='block text-sm text-text'>{myProfile.phone_number ?? notFilled}</Text>
            </View>
          )}
          {isEditing && (
            <Image
              src={hidePhone ? eyeOffImg : eyeImg}
              className='h-5 w-5 shrink-0'
              onClick={() => setEditHidePhone((v) => !v)}
            />
          )}
        </View>

        {/* 学院（可编辑 + 隐藏开关） */}
        <View className='flex items-center gap-3 border-b border-border py-3'>
          <Text className='w-20 shrink-0 text-sm text-primary'>{t('profileInfo.collegeLabel')}</Text>
          {isEditing ? (
            <View className='flex-1 overflow-hidden rounded-xl border border-border bg-muted px-3'>
              <Input
                className='h-10 w-full bg-transparent text-sm text-text'
                placeholder={t('profileInfo.collegePlaceholder')}
                value={editCollege}
                onInput={(e) => {
                  setEditCollege(e.detail.value)
                  setError(null)
                }}
              />
            </View>
          ) : (
            <View className='flex-1 rounded-xl border border-border bg-muted px-3 py-2'>
              <Text className='block text-sm text-text'>{myProfile.college ?? notFilled}</Text>
            </View>
          )}
          {isEditing && (
            <Image
              src={hideCollege ? eyeOffImg : eyeImg}
              className='h-5 w-5 shrink-0'
              onClick={() => setEditHideCollege((v) => !v)}
            />
          )}
        </View>

        {error && <Text className='mt-3 block text-xs text-danger'>{error}</Text>}

        {/* 编辑态底部操作：保存（大按钮·primary）/ 取消（大按钮·card） */}
        {isEditing && (
          <View className='mt-6 pb-4'>
            <View
              className={`flex h-11 w-full items-center justify-center rounded-xl bg-primary text-base font-medium text-primary-foreground ${
                submitting ? 'opacity-60' : ''
              }`}
              onClick={submitting ? undefined : handleSave}
            >
              {submitting ? t('profileInfo.saving') : t('common.actions.save')}
            </View>
            <View
              className={`mt-3 flex h-11 w-full items-center justify-center rounded-xl border border-border bg-card text-base font-medium text-text ${
                submitting ? 'opacity-60' : ''
              }`}
              onClick={submitting ? undefined : cancelEdit}
            >
              {t('common.actions.cancel')}
            </View>
          </View>
        )}

      </View>
    </View>
  )
}
