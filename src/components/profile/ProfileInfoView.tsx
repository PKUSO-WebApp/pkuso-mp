import type { ReactNode } from 'react'
import { View, Text, Image } from '@tarojs/components'
import { useT } from '@/i18n'
import { StorageImage } from '@/components/ui/StorageImage'
import { translateInstrument } from '@/lib/instrument-i18n'
import { translateJoinDate } from '@/lib/join-date-i18n'
import defaultAvatar from '@/assets/icons/user-round.png'
import type { ProfileRow } from '@/types/database'

/**
 * 只读的个人信息视图（0.6.2）：成员详情页与考勤页顶部共用，布局对齐「我的 → 个人信息」。
 *
 * 隐私口径：
 *   · 本人看自己：所有字段都显示（空值显示「未填写」）；
 *   · 看别人：邮箱/联系方式/学院/入团时间/生日按对方的 hide_* 开关掩码；为空的字段整行不显示。
 *   · 生日在 `profiles_roster` 里已由服务端按 hide_birthday 掩码，这里再做一层客户端判断
 *     （与 join_date 同款双保险，避免视图/RPC 某天改了口径）。
 */
export function ProfileInfoView({
  profile,
  viewerId,
  className = '',
}: {
  profile: ProfileRow
  viewerId?: string | null
  className?: string
}) {
  const { t } = useT()
  const isSelf = profile.id === viewerId
  const notFilled = t('common.notFilled')

  const showJoin = isSelf || (!!profile.join_date && !profile.hide_join_date)
  const showEmail = isSelf || (!!profile.email && !profile.hide_email)
  const showPhone = isSelf || (!!profile.phone_number && !profile.hide_phone)
  const showCollege = isSelf || (!!profile.college?.trim() && !profile.hide_college)
  const showBirthday = isSelf || (!!profile.birthday && !profile.hide_birthday)

  return (
    <View className={className}>
      <View className='flex flex-col items-center py-6'>
        <View className='h-20 w-20 overflow-hidden rounded-full bg-muted'>
          {profile.avatar_url ? (
            <StorageImage src={profile.avatar_url} className='h-full w-full' mode='aspectFill' />
          ) : (
            <Image src={defaultAvatar} className='h-full w-full' mode='aspectFit' />
          )}
        </View>
      </View>

      <View>
        <InfoRow label={t('profileInfo.nameLabel')}>
          <Text className='text-sm text-text'>{profile.full_name ?? notFilled}</Text>
        </InfoRow>

        <InfoRow label={t('profileInfo.instrumentLabel')}>
          <Text className='text-sm text-text'>
            {translateInstrument(profile.instrument, t) || notFilled}
          </Text>
        </InfoRow>

        {showJoin && (
          <InfoRow label={t('profileInfo.joinTimeLabel')}>
            <Text className='text-sm text-text'>
              {profile.join_date ? translateJoinDate(profile.join_date, t) : notFilled}
            </Text>
          </InfoRow>
        )}

        <InfoRow label={t('profileInfo.statusLabel')}>
          <Text className='text-sm text-text'>
            {profile.is_in_orchestra === true
              ? t('profileInfo.statusActive')
              : t('profileInfo.statusInactive')}
          </Text>
        </InfoRow>

        {(showEmail || showPhone || showCollege || showBirthday) && (
          <View className='mt-4 flex items-center gap-3'>
            <View className='h-px flex-1 bg-border' />
            <Text className='text-xs text-text-subtle'>{t('profileInfo.hideHint')}</Text>
            <View className='h-px flex-1 bg-border' />
          </View>
        )}

        {showEmail && (
          <InfoRow label={t('profileInfo.emailLabel')}>
            <Text className='block truncate text-sm text-text'>{profile.email ?? notFilled}</Text>
          </InfoRow>
        )}

        {showPhone && (
          <InfoRow label={t('profileInfo.contactLabel')}>
            <Text className='block text-sm text-text'>
              {profile.phone_number ?? notFilled}
            </Text>
          </InfoRow>
        )}

        {showCollege && (
          <InfoRow label={t('profileInfo.collegeLabel')}>
            <Text className='block text-sm text-text'>{profile.college ?? notFilled}</Text>
          </InfoRow>
        )}

        {showBirthday && (
          <InfoRow label={t('profileInfo.birthdayLabel')}>
            <Text className='block text-sm text-text'>
              {profile.birthday ?? notFilled}
            </Text>
          </InfoRow>
        )}
      </View>
    </View>
  )
}

function InfoRow({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <View className='flex items-center gap-3 border-b border-border py-3'>
      <Text className='w-20 shrink-0 text-sm text-primary'>{label}</Text>
      <View className='min-w-0 flex-1'>{children}</View>
    </View>
  )
}
