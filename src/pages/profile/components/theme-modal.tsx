import { View, Text } from '@tarojs/components'
import { Modal } from '@/components/ui/Modal'
import { Toggle } from '@/components/ui/Toggle'
import { useThemeContext } from '@/context/theme-context'
import { useT } from '@/i18n'
import { THEME_OPTIONS, themeLabel } from '@/lib/theme'

/** 外观弹窗：亮色 / 暗色 二态主题选择。
 *  切换即时生效（页面 .dark 类 + 导航栏色）并持久化（Taro storage）。 */
export function ThemeModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { preference, mode, setPreference } = useThemeContext()
  const { t } = useT()
  return (
    <Modal open={open} onClose={onClose} title={t('profile.settings.appearance')} position='bottom'>
      <View className='mt-4'>
        <Toggle
          options={THEME_OPTIONS}
          value={preference}
          onChange={setPreference}
          getLabel={themeLabel}
        />
        <Text className='mt-3 block text-xs leading-relaxed text-text-muted'>
          {t('profile.appearance.currentMode', {
            mode: t(mode === 'dark' ? 'profile.appearance.dark' : 'profile.appearance.light'),
          })}
        </Text>
      </View>
    </Modal>
  )
}
