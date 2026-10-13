import { View, Text } from '@tarojs/components'
import { Modal } from '@/components/ui/Modal'
import { Toggle } from '@/components/ui/Toggle'
import { useThemeContext } from '@/context/theme-context'
import { useUiScaleContext } from '@/hooks/useUiScale'
import { useT } from '@/i18n'
import { THEME_OPTIONS, themeLabel } from '@/lib/theme'
import { UI_SCALE_OPTIONS, uiScaleLabel } from '@/lib/ui-scale'

/**
 * 「外观与布局」弹窗：主题（亮色 / 暗色）+ 显示大小（0.85x ~ 1.50x）。
 *
 * 两件事放同一个弹窗（用户 2026-10-13 定）：它们都是「看起来什么样」的偏好，
 * 分开两个入口只多一次点击。**显示大小不写解释文案** —— 倍率本身就说明了一切，
 * 用户不需要知道「平板基准 / rpx 换算」这些内部口径（同一条口径见 lib/ui-scale.ts）。
 *
 * 两段都用分段控件（与主题一致，用户 2026-10-13 定：显示大小不要行式列表）。
 * 显示大小那排走 `fill`（等分铺满）：四段的下限宽度是跟着档位缩放的，1.50x 下会溢出弹窗。
 */
export function AppearanceModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { preference, setPreference } = useThemeContext()
  const { preference: uiScale, setPreference: setUiScale } = useUiScaleContext()
  const { t } = useT()
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('profile.settings.appearanceAndLayout')}
      position='bottom'
    >
      <View className='mt-4'>
        <Text className='text-xs text-text-muted'>{t('profile.appearance.theme')}</Text>
        <View className='mt-2'>
          <Toggle
            options={THEME_OPTIONS}
            value={preference}
            onChange={setPreference}
            getLabel={themeLabel}
          />
        </View>
      </View>

      <View className='mt-5'>
        <Text className='text-xs text-text-muted'>{t('profile.settings.displaySize')}</Text>
        <View className='mt-2'>
          <Toggle
            fill
            options={UI_SCALE_OPTIONS}
            value={uiScale}
            onChange={setUiScale}
            getLabel={uiScaleLabel}
          />
        </View>
      </View>
    </Modal>
  )
}
