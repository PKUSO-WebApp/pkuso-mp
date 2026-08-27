import { View, Text } from '@tarojs/components'
import { Modal } from '@/components/ui/Modal'
import { FieldRow } from '@/components/ui/FieldRow'
import { StatusChip } from '@/components/ui/StatusChip'
import { maskedValue } from '@/lib/privacy'
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
          <View className='flex flex-wrap items-center gap-2'>
            <Text className='text-base font-semibold text-text'>{user.full_name ?? '—'}</Text>
              {user.is_section_leader && (
                <StatusChip tone='warning'>{t('members.sectionLeader')}</StatusChip>
              )}
          </View>
          <FieldRow className='mt-3' label={t('members.fieldInstrument')} value={user.instrument ? translateInstrument(user.instrument, t) : user.instrument} />
          <FieldRow className='mt-3' label={t('members.fieldCollege')} value={user.college} />
          {/* 隐私掩码：查看自己显示原值，查看他人按对方开关掩码 */}
          <FieldRow
            className='mt-3'
            label={t('members.fieldEmail')}
            value={maskedValue(user.id !== viewerId && user.hide_email, user.email)}
          />
          <FieldRow
            className='mt-3'
            label={t('members.fieldContact')}
            value={maskedValue(user.id !== viewerId && user.hide_phone, user.phone_number)}
          />
          <FieldRow
            className='mt-3'
            label={t('members.fieldJoinDate')}
            value={translateJoinDate(
              maskedValue(user.id !== viewerId && user.hide_join_date, user.join_date),
              t
            )}
          />
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
