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
}: Props) {
  return (
    <Modal open={open} onClose={onClose} title='输入签到码' closeOnOverlay={!submitting}>
      <Text className='mb-3 block text-xs text-text-muted'>本次排练：{title}</Text>
      <View className='mb-3 space-y-1'>
        <Text className='block text-xs font-medium text-text-muted'>四位数字签到码</Text>
        <Input
          type='number'
          maxlength={4}
          value={codeInput}
          onInput={(e) => onCodeChange(e.detail.value)}
          className='w-full rounded-xl border border-border bg-muted px-3 py-2 text-xs text-text'
          placeholder='如：8848'
        />
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
