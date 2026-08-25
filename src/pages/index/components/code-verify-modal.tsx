import { View, Text, Input } from '@tarojs/components'
import { Modal } from '@/components/ui/Modal'
import { useT } from '@/i18n'

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
  const { t } = useT()
  return (
    <Modal open={open} onClose={onClose} title={t('activityDetail.codeModal.title')} closeOnOverlay={!submitting}>
      <Text className='mb-3 block text-xs text-text-muted'>
        {t('activityDetail.codeModal.rehearsal', { title })}
      </Text>
      {hint && (
        <Text className='mb-3 block rounded-lg bg-warning-bg/80 px-3 py-2 text-xs text-warning'>
          {hint}
        </Text>
      )}
      <View className='mb-3 space-y-1'>
        <Text className='block text-xs font-medium text-text-muted'>{t('activityDetail.codeModal.codeLabel')}</Text>
        <View className='mt-1 w-full overflow-hidden rounded-xl border border-border bg-muted px-3'>
          <Input
            type='number'
            maxlength={4}
            value={codeInput}
            onInput={(e) => onCodeChange(e.detail.value)}
            className='h-10 w-full bg-transparent text-sm text-text'
            placeholder={t('activityDetail.codeModal.placeholder')}
          />
        </View>
        {codeError && <Text className='mt-1 block text-xs text-danger'>{codeError}</Text>}
      </View>
      <View className='flex items-center justify-end gap-2 text-xs'>
        <View
          className='rounded-full px-4 py-1.5 text-xs text-text-muted'
          onClick={submitting ? undefined : onClose}
        >
          {t('activityDetail.codeModal.cancel')}
        </View>
        <View
          className={`rounded-full bg-primary px-4 py-1.5 text-xs font-medium text-primary-foreground ${submitting ? 'opacity-60' : ''}`}
          onClick={submitting ? undefined : onConfirm}
        >
          {submitting ? t('activityDetail.codeModal.confirming') : t('activityDetail.codeModal.confirm')}
        </View>
      </View>
    </Modal>
  )
}
