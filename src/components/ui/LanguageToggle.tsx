import { Button, View } from '@tarojs/components'
import { useT } from '@/i18n'

interface LanguageToggleProps {
  locale: 'zh-CN' | 'en'
  onChange: (l: 'zh-CN' | 'en') => void
}

export function LanguageToggle({ locale, onChange }: LanguageToggleProps) {
  const { t } = useT()
  return (
    <View className='inline-flex rounded-full bg-muted p-0.5'>
      <Button
        hoverClass='none'
        className={`m-0 w-auto min-w-16 rounded-full px-3 py-1 text-center text-xs leading-normal ${
          locale === 'zh-CN' ? 'bg-black text-white shadow-sm' : 'bg-transparent text-text-muted'
        }`}
        onClick={() => onChange('zh-CN')}
      >
        {t('common.languageToggle.zh')}
      </Button>
      <Button
        hoverClass='none'
        className={`m-0 w-auto min-w-16 rounded-full px-3 py-1 text-center text-xs leading-normal ${
          locale === 'en' ? 'bg-black text-white shadow-sm' : 'bg-transparent text-text-muted'
        }`}
        onClick={() => onChange('en')}
      >
        {t('common.languageToggle.en')}
      </Button>
    </View>
  )
}
