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
   * **等分铺满整行**（默认false = 按内容宽度、每个选项不小于 64px）。
   *
   * 给「选项多」的场景用：宽度的下限 `min-w-16` 是**跟着显示大小档位缩放**的
   * （它走 `--spacing`），四段在 1.50x 下会比弹窗还宽、直接溢出。等分之后
   * 每段 = 可用宽 / 段数，档位再大也只是段内文字更挤，不会撑破容器。
   */
  fill?: boolean
}

export function Toggle<T extends string>({
  options,
  value,
  onChange,
  getLabel,
  badges,
  fill = false,
}: ToggleProps<T>) {
  return (
    <View className={`${fill ? 'flex' : 'inline-flex'} rounded-full bg-muted p-1`}>
      {options.map((opt) => {
        const active = value === opt
        const badge = badges?.[opt]
        return (
          <View key={opt} className={`relative inline-flex ${fill ? 'flex-1' : ''}`}>
            <Button
              hoverClass='none'
              // 基础库 button 默认 font-size:18px 直接作用于元素、不随容器继承，必须逐按钮显式指定字号
              className={`m-0 rounded-full px-3 py-1 text-center text-xs leading-normal ${
                fill ? 'w-full min-w-0' : 'w-auto min-w-16'
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
