import { Button, View } from '@tarojs/components'
import { UnreadDot } from '@/components/ui/UnreadDot'

type ToggleProps<T extends string> = {
  options: readonly T[] | T[]
  value: T
  onChange: (value: T) => void
  getLabel?: (option: T) => string
  /** 各选项右上角的红色未读气泡（如社区重奏/团建分类未读标记） */
  badges?: Partial<Record<T, boolean>>
  /**
   * **紧凑**：选项多时用（四段的分段控件）。把每段的下限与内边距从 `min-w-16 px-3`
   * 收到 `min-w-12 px-2` —— 宽度下限与内边距都是**跟着显示大小档位缩放的**（走
   * `--spacing`），四段用默认档在 1.50x 下会比弹窗还宽、直接溢出。
   *
   * ⚠️ 不要用「等分铺满整行」来代替它：那样虽然更安全，但跟只有两段的控件（主题）
   * 摆在一起就成了两种形态，一眼看得出是凑出来的（用户 2026-10-13 反馈）。
   */
  compact?: boolean
}

export function Toggle<T extends string>({
  options,
  value,
  onChange,
  getLabel,
  badges,
  compact = false,
}: ToggleProps<T>) {
  return (
    <View className='inline-flex rounded-full bg-muted p-1'>
      {options.map((opt) => {
        const active = value === opt
        const badge = badges?.[opt]
        return (
          <View key={opt} className='relative inline-flex'>
            <Button
              hoverClass='none'
              // 基础库 button 默认 font-size:18px 直接作用于元素、不随容器继承，必须逐按钮显式指定字号
              className={`m-0 w-auto rounded-full py-1 text-center text-xs leading-normal ${
                compact ? 'min-w-12 px-2' : 'min-w-16 px-3'
              } ${
                active
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'bg-transparent text-text-muted'
              }`}
              onClick={() => onChange(opt)}
            >
              {getLabel ? getLabel(opt) : opt}
            </Button>
            {badge && (
              <UnreadDot
                className='absolute right-0 top-0 pointer-events-none'
                style={{ transform: 'translate(50%, -50%)' }}
              />
            )}
          </View>
        )
      })}
    </View>
  )
}
