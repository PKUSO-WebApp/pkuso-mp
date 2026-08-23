import { View, Text, Input } from '@tarojs/components'
import { Modal } from '@/components/ui/Modal'

type Props = {
  open: boolean
  title: string
  submitting: boolean
  codeInput: string
  codeError: string | null
  onCodeChange: (v: string) => void
  onConfirm: () => void
  onClose: () => void
  /** 提醒文案（如请假后签到覆盖提醒，Issue #155），无则不渲染 */
  hint?: string | null
}

export function CodeVerifyModal({
  open,
  title,
  submitting,
  codeInput,
  codeError,
  onCodeChange,
  onConfirm,
  onClose,
  hint,
}: Props) {
  return (
    <Modal open={open} onClose={onClose} title='输入签到码' closeOnOverlay={!submitting}>
      <Text className='mb-3 block text-xs text-text-muted'>本次排练：{title}</Text>
      {hint && (
        <Text className='mb-3 block rounded-lg bg-warning-bg/80 px-3 py-2 text-xs text-warning'>
          {hint}
        </Text>
      )}
      <View className='mb-3 space-y-1'>
        <Text className='block text-xs font-medium text-text-muted'>四位数字签到码</Text>
        <View className='mt-1 w-full overflow-hidden rounded-xl border border-border bg-muted px-3'>
          <Input
            type='number'
            maxlength={4}
            value={codeInput}
            onInput={(e) => onCodeChange(e.detail.value)}
            className='h-10 w-full bg-transparent text-sm text-text'
            placeholder='如：8848'
          />
        </View>
        {codeError && <Text className='mt-1 block text-xs text-danger'>{codeError}</Text>}
      </View>
      <View className='flex items-center justify-end gap-2 text-xs'>
        <View
          className='rounded-full px-4 py-1.5 text-xs text-text-muted'
          onClick={submitting ? undefined : onClose}
        >
          取消
        </View>
        <View
          className={`rounded-full bg-primary px-4 py-1.5 text-xs font-medium text-primary-foreground ${submitting ? 'opacity-60' : ''}`}
          onClick={submitting ? undefined : onConfirm}
        >
          {submitting ? '确认中…' : '确认签到'}
        </View>
      </View>
    </Modal>
  )
}
