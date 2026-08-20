import { View, Text } from '@tarojs/components'
import { Modal } from '@/components/ui/Modal'
import { Toggle } from '@/components/ui/Toggle'
import { useThemeContext } from '@/context/theme-context'
import { THEME_OPTIONS, themeLabel } from '@/lib/theme'

/** 外观弹窗：亮色 / 暗色 / 跟随系统 三态主题选择（Web Issue #203 语义）。
 *  切换即时生效（页面 .dark 类 + 导航栏色）并持久化（Taro storage）。
 *  状态来自全局 ThemeProvider：弹窗只读共享状态，系统外观监听由根 Provider 统一持有。 */
export function ThemeModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { preference, mode, setPreference } = useThemeContext()
  return (
    <Modal open={open} onClose={onClose} title='外观' position='bottom'>
      <View className='mt-4 space-y-3'>
        <Toggle
          options={THEME_OPTIONS}
          value={preference}
          onChange={setPreference}
          getLabel={themeLabel}
        />
        <Text className='block text-xs leading-relaxed text-text-muted'>
          当前为「{mode === 'dark' ? '暗色' : '亮色'}」模式
          {preference === 'system' && '（跟随系统：随设备系统外观自动切换）'}
        </Text>
      </View>
    </Modal>
  )
}
