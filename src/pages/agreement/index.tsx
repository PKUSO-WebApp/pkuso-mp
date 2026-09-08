import { Text, View } from '@tarojs/components'
import { useThemeClass } from '@/context/theme-context'
import { useNavTitle } from '@/i18n'
import { agreementZh, agreementEn } from '@/lib/agreement-content'
import './index.scss'

export default function AgreementPage() {
  const darkClass = useThemeClass()
  useNavTitle('common.agreement.navTitle')

  return (
    <View className={`${darkClass} min-h-full bg-page-bg px-5 py-6 pb-safe`}>
      <View className='rounded-2xl bg-card px-5 py-6'>
        {/* 中文版 */}
        <Text className='text-base font-semibold text-text'>{agreementZh}</Text>

        {/* 分隔线 */}
        <View className='my-6 border-t border-border' />

        {/* 英文版 */}
        <Text className='text-base font-semibold text-text'>{agreementEn}</Text>
      </View>
    </View>
  )
}
