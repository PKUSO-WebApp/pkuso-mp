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
 * 主题用小分段控件（两个选项，放得下），显示大小改**竖排行式列表**：四档在分段控件里
 * 会挤成一片（每个选项最小 64px），而行式列表顺带能一行一个勾、点哪行选哪档。
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
        <View>
          {UI_SCALE_OPTIONS.map((opt) => (
            <View
              key={opt}
              className='mt-2 flex items-center justify-between rounded-xl border border-border px-4 py-3'
              onClick={() => setUiScale(opt)}
            >
              <Text className='text-sm text-text'>{uiScaleLabel(opt)}</Text>
              {uiScale === opt && <Text className='text-sm text-primary'>✓</Text>}
            </View>
          ))}
        </View>
      </View>
    </Modal>
  )
}
