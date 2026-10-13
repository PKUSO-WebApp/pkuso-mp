import { View, Text } from '@tarojs/components'
import { Modal } from '@/components/ui/Modal'
import { Toggle } from '@/components/ui/Toggle'
import { useUiScaleContext } from '@/hooks/useUiScale'
import { useT } from '@/i18n'
import { UI_SCALE_OPTIONS, uiScaleLabel } from '@/lib/ui-scale'

/**
 * 显示大小弹窗：紧凑 / 标准 / 宽松 三档。
 *
 * 档位改的是**同一套绝对尺寸的倍率**（口径见 lib/ui-scale.ts）：标准 = 375pt 手机上的尺寸，
 * 所有设备一致（平板不再按屏宽放大）。切换即时生效并持久化 —— 生效链路是
 * 「页根类名 → .ui-scale 覆盖 token」（app.css），加上内联 px 组件读 uiscalestore 的系数。
 */
export function UiScaleModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { preference, setPreference } = useUiScaleContext()
  const { t } = useT()
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('profile.settings.displaySize')}
      position='bottom'
    >
      <View className='mt-4'>
        <Toggle
          options={UI_SCALE_OPTIONS}
          value={preference}
          onChange={setPreference}
          getLabel={uiScaleLabel}
        />
        <Text className='mt-3 block text-xs leading-relaxed text-text-muted'>
          {t('profile.displaySize.current', { level: uiScaleLabel(preference) })}
        </Text>
      </View>
    </Modal>
  )
}
