import { View, Text } from '@tarojs/components'
import { Modal } from '@/components/ui/Modal'
import { maskedValue } from '@/lib/privacy'
import type { ProfileRow } from '@/types/database'

type MemberDetailModalProps = {
  open: boolean
  /** 当前查看的成员，null 时不展示内容 */
  user: ProfileRow | null
  /** 查看者（当前登录用户）id：查看自己时隐私开关不生效，显示原值 */
  viewerId?: string | null
  onClose: () => void
}

/** 展示字段：标签 + 值，值为空时显示 — */
function DetailField({ label, value }: { label: string; value: string | null }) {
  return (
    <View className='flex items-baseline justify-between gap-3'>
      <Text className='shrink-0 text-xs text-text-muted'>{label}</Text>
      <Text className='min-w-0 break-words text-right text-sm text-text'>
        {value?.trim() || '—'}
      </Text>
    </View>
  )
}

/** 用户侧成员详情弹窗：只读展示花名册成员信息 */
export function MemberDetailModal({ open, user, viewerId, onClose }: MemberDetailModalProps) {
  return (
    <Modal open={open} onClose={onClose} title='成员详情' position='bottom'>
      {user && (
        <View className='mt-2 space-y-3'>
          <View className='flex flex-wrap items-center gap-2'>
            <Text className='text-base font-semibold text-text'>{user.full_name ?? '—'}</Text>
            {user.is_section_leader && (
              <Text className='rounded-full bg-warning-bg px-2 py-1 text-xs text-warning'>
                🏅 声部长
              </Text>
            )}
          </View>
          <DetailField label='乐器' value={user.instrument} />
          <DetailField label='学院' value={user.college} />
          {/* 隐私掩码：查看自己显示原值，查看他人按对方开关掩码 */}
          <DetailField
            label='邮箱'
            value={maskedValue(user.id !== viewerId && user.hide_email, user.email)}
          />
          <DetailField
            label='联系方式'
            value={maskedValue(user.id !== viewerId && user.hide_phone, user.phone_number)}
          />
          <DetailField
            label='入团时间'
            value={maskedValue(user.id !== viewerId && user.hide_join_date, user.join_date)}
          />
        </View>
      )}
    </Modal>
  )
}
