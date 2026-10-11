import { View, Text } from '@tarojs/components'
import { useT } from '@/i18n'

/**
 * 「是 / 否」二态开关：文字在开关**两侧**（左「是」、右「否」，用户 2026-10-10 定），
 * 滑块停在**当前那一边** —— 所以 `value === true` 时滑块在左。
 *
 * ⚠️ **不用原生 `<Switch>`**：它的滑块只能是「关在左、开在右」，做不出「是」在左
 * —— 那样文字与滑块会指向相反的方向（开关的两种读法之一必然是错的）。自绘还有一个
 * 好处：跟仓里别的控件同一套语义 token，不依赖原生控件的固定配色。
 *
 * 尺寸与反馈页原来那个自绘开关一致（`h-7 w-12` 的轨道 + `h-6 w-6` 的滑块），
 * 所以换过来在那一页上看不出变化。
 */
export function YesNoSwitch({
  value,
  disabled,
  onChange,
  ariaLabel,
}: {
  value: boolean
  /** 禁用时**先置灰再吞掉点击**：只吞点击的话用户会以为它坏了 */
  disabled?: boolean
  onChange: (next: boolean) => void
  ariaLabel?: string
}) {
  const { t } = useT()
  const active = 'text-text'
  const inactive = 'text-text-muted'
  return (
    <View className='flex flex-row items-center'>
      <Text className={`mr-2 text-sm ${value ? active : inactive}`}>{t('common.yes')}</Text>
      <View
        className={`relative h-7 w-12 rounded-full ${value ? 'bg-primary' : 'bg-muted'} ${
          disabled ? 'opacity-50' : ''
        }`}
        ariaLabel={ariaLabel}
        onClick={disabled ? undefined : () => onChange(!value)}
      >
        <View
          className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow-sm transition-all ${
            value ? 'left-0.5' : 'left-[calc(100%-1.75rem)]'
          }`}
        />
      </View>
      <Text className={`ml-2 text-sm ${value ? inactive : active}`}>{t('common.no')}</Text>
    </View>
  )
}
