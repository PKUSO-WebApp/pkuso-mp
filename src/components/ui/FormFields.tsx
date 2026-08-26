import type { ReactNode } from 'react'
import { Input, Text, View } from '@tarojs/components'
import type { InputProps } from '@tarojs/components'

const DEFAULT_LABEL_CLASS = 'mb-1 block text-xs font-medium text-text-muted'
const DEFAULT_BOX_CLASS =
  'mt-1 w-full overflow-hidden rounded-xl border border-border bg-muted px-3'

type FormFieldProps = {
  /** 字段标签；不传则仅渲染控件容器 */
  label?: ReactNode
  labelClass?: string
  /** 外层间距类（如 mb-3） */
  className?: string
  /** 控件容器类（边框盒） */
  boxClass?: string
  children: ReactNode
}

/** 表单字段壳（P2-1）：标签 + 边框盒；控件由 children 提供（Input/Textarea/Picker 均可）。
 *  盒子承担宽度约束与圆角边框（AGENTS.md 表单模式），内层控件透明背景铺满。 */
export function FormField({
  label,
  labelClass = DEFAULT_LABEL_CLASS,
  className = '',
  boxClass = DEFAULT_BOX_CLASS,
  children,
}: FormFieldProps) {
  return (
    <View className={className}>
      {label != null && <Text className={labelClass}>{label}</Text>}
      <View className={boxClass}>{children}</View>
    </View>
  )
}

type TextFieldProps = {
  label?: ReactNode
  labelClass?: string
  className?: string
  boxClass?: string
  inputClass?: string
} & Omit<InputProps, 'className' | 'style'>

/** 文本输入字段：FormField + 标准样式 Input，其余 Input props 全量透传 */
export function TextField({
  label,
  labelClass,
  className,
  boxClass,
  inputClass = 'h-10 w-full bg-transparent text-sm text-text',
  ...inputProps
}: TextFieldProps) {
  return (
    <FormField label={label} labelClass={labelClass} className={className} boxClass={boxClass}>
      <Input className={inputClass} {...(inputProps as object)} />
    </FormField>
  )
}

type PickerFieldProps = {
  label?: ReactNode
  labelClass?: string
  className?: string
  boxClass?: string
  children: ReactNode
}

/** 选择器字段：FormField + py-2 盒内的 Picker 触发行（children 放 <Picker>） */
export function PickerField({
  label,
  labelClass,
  className,
  boxClass = 'mt-1 rounded-xl border border-border bg-muted px-3 py-2',
  children,
}: PickerFieldProps) {
  return (
    <FormField label={label} labelClass={labelClass} className={className} boxClass={boxClass}>
      {children}
    </FormField>
  )
}
