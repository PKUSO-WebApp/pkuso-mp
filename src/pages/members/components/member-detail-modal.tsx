import { View, Text, Image } from '@tarojs/components'
import { Modal } from '@/components/ui/Modal'
import { FieldRow } from '@/components/ui/FieldRow'
import { StatusChip } from '@/components/ui/StatusChip'
import { useT } from '@/i18n'
import { translateInstrument } from '@/lib/instrument-i18n'
import { translateJoinDate } from '@/lib/join-date-i18n'
import type { ProfileRow } from '@/types/database'

type MemberDetailModalProps = {
  open: boolean
  /** 当前查看的成员，null 时不展示内容 */
  user: ProfileRow | null
  /** 查看者（当前登录用户）id：查看自己时隐私开关不生效，显示原值 */
  viewerId?: string | null
  onClose: () => void
}

/** 用户侧成员详情弹窗：只读展示花名册成员信息 */
export function MemberDetailModal({ open, user, viewerId, onClose }: MemberDetailModalProps) {
  const { t } = useT()
  return (
    <Modal open={open} onClose={onClose} title={t('members.detailTitle')} position='bottom'>
      {user && (
        <View className='mt-2'>
          {/* 头像 */}
          <View className='mb-3 flex justify-center'>
            <View className='h-16 w-16 rounded-full overflow-hidden bg-primary'>
              {user.avatar_url ? (
                <Image src={user.avatar_url} className='h-full w-full' mode='aspectFill' />
              ) : (
                <View className='flex h-full w-full items-center justify-center'>
                  <Text className='text-xl font-medium text-primary-foreground'>
                    {(user.full_name ?? '—').slice(0, 1)}
                  </Text>
                </View>
              )}
            </View>
          </View>
          <View className='flex flex-wrap items-center gap-2'>
            <Text className='text-base font-semibold text-text'>{user.full_name ?? '—'}</Text>
              {user.is_section_leader && (
                <StatusChip tone='warning'>{t('members.sectionLeader')}</StatusChip>
              )}
          </View>
          {user.instrument?.trim() && (
            <FieldRow className='mt-3' label={t('members.fieldInstrument')} value={translateInstrument(user.instrument, t)} />
          )}
          {user.college?.trim() && !(user.hide_college && user.id !== viewerId) && (
            <FieldRow className='mt-3' label={t('members.fieldCollege')} value={user.college} />
          )}
          {/* 隐私字段：被隐藏或为空时整行不显示（与成员卡片逻辑一致） */}
          {user.email && !(user.hide_email && user.id !== viewerId) && (
            <FieldRow className='mt-3' label={t('members.fieldEmail')} value={user.email} />
          )}
          {user.phone_number && !(user.hide_phone && user.id !== viewerId) && (
            <FieldRow className='mt-3' label={t('members.fieldContact')} value={user.phone_number} />
          )}
          {user.join_date && !(user.hide_join_date && user.id !== viewerId) && (
            <FieldRow className='mt-3' label={t('members.fieldJoinDate')} value={translateJoinDate(user.join_date, t)} />
          )}
          {/* 在团情况：不涉隐私开关，直接展示 */}
          <FieldRow
            className='mt-3'
            label={t('members.statusLabel')}
            value={user.is_in_orchestra === true ? t('members.statusActive') : t('members.statusInactive')}
          />
        </View>
      )}
    </Modal>
  )
}
