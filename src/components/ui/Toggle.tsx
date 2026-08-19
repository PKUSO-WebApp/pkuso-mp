import { Button, View } from '@tarojs/components'

type ToggleProps<T extends string> = {
  options: readonly T[] | T[]
  value: T
  onChange: (value: T) => void
  getLabel?: (option: T) => string
}

export function Toggle<T extends string>({ options, value, onChange, getLabel }: ToggleProps<T>) {
  return (
    <View className='inline-flex rounded-full bg-muted p-1'>
      {options.map((opt) => {
        const active = value === opt
        return (
          <Button
            key={opt}
            hoverClass='none'
            // 基础库 button 默认 font-size:18px 直接作用于元素、不随容器继承，必须逐按钮显式指定字号
            className={`m-0 w-auto min-w-16 rounded-full px-3 py-1 text-center text-xs leading-normal ${
              active
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'bg-transparent text-text-muted'
            }`}
            onClick={() => onChange(opt)}
          >
            {getLabel ? getLabel(opt) : opt}
          </Button>
        )
      })}
    </View>
  )
}
