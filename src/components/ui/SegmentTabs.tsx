import { View, Text } from '@tarojs/components'

export type SegmentTab<T extends string> = { key: T; label: string }

type Props<T extends string> = {
  tabs: SegmentTab<T>[]
  value: T
  onChange: (key: T) => void
}

/**
 * 顶部分段切换（参考「我的请假」页 全部/已通过/已驳回/待审批 组件）：
 * 等宽分段、底部描边、选中项主色加粗 + 主色下划线指示。
 * 颜色仅用语义 token，禁止硬编码调色板色。
 */
export function SegmentTabs<T extends string>({ tabs, value, onChange }: Props<T>) {
  return (
    <View className='flex flex-row border-b border-border bg-surface px-2'>
      {tabs.map((t) => {
        const active = t.key === value
        return (
          <View key={t.key} className='flex-1 py-3 text-center' onClick={() => onChange(t.key)}>
            <Text className={`text-sm ${active ? 'font-medium text-primary' : 'text-text-muted'}`}>
              {t.label}
            </Text>
            {active && <View className='mx-auto mt-1 h-0.5 w-6 rounded bg-primary' />}
          </View>
        )
      })}
    </View>
  )
}
