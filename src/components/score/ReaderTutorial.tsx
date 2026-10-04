import { View, Text } from '@tarojs/components'
import { useT } from '@/i18n'
import { ZONE_SPLITS, Z_TUTORIAL } from '@/pages/score-reader/lib/layout'

/**
 * 阅读器首次使用教程：蒙层 + 两条分隔线讲清三个点击区，外加滑动手势说明。
 * 点任意处关闭——**关闭时才写「已看过」**（见 lib/tutorial-seen.ts），
 * 展示时就写死的话，被强杀 App 的用户下次就再也见不到教程了。
 *
 * 它是 `#reader-stage` 的**兄弟节点**：其上的触摸不会冒泡到舞台的触摸状态机，
 * 所以结构上不可能误触翻页 / 平移 / 落笔——比在状态机里塞一个「教程中」特例干净。
 *
 * ⚠️ 分隔线位置与点击分区共用 `ZONE_SPLITS`，不许各写一份（「线画在 25%、
 * 判定在 28%」这类漂移只有真机上才看得出来）。
 */
export function ReaderTutorial({ onClose }: { onClose: () => void }) {
  const { t } = useT()
  // 画在深色蒙层上：两种主题都用白，不用主题 token
  const line = 'rgb(255 255 255 / 0.75)'
  const dim = 'rgb(255 255 255 / 0.78)'

  return (
    <View className='absolute inset-0 bg-overlay' style={{ zIndex: Z_TUTORIAL }} onClick={onClose}>
      {ZONE_SPLITS.map((split) => (
        <View
          key={split}
          className='absolute top-0 bottom-0'
          style={{ left: `${split * 100}%`, width: '1px', background: line }}
        />
      ))}

      <View className='absolute left-0 right-0 flex flex-row items-center' style={{ top: '34%' }}>
        <View className='flex flex-col items-center' style={{ width: '25%' }}>
          <Text className='text-2xl text-white'>←</Text>
          <Text className='mt-1 text-sm text-white'>{t('scoreReader.tutorialPrev')}</Text>
        </View>
        <View className='flex flex-col items-center' style={{ width: '50%' }}>
          <Text className='text-sm text-white'>{t('scoreReader.tutorialMenuZone')}</Text>
        </View>
        <View className='flex flex-col items-center' style={{ width: '25%' }}>
          <Text className='text-2xl text-white'>→</Text>
          <Text className='mt-1 text-sm text-white'>{t('scoreReader.tutorialNext')}</Text>
        </View>
      </View>

      <View
        className='absolute bottom-0 left-0 right-0 px-8'
        style={{ paddingBottom: 'calc(32px + env(safe-area-inset-bottom))' }}
      >
        <View className='text-center'>
          <Text className='text-sm text-white'>{t('scoreReader.tutorialSwipeHint')}</Text>
        </View>
        <View className='mt-2 text-center'>
          <Text className='text-xs' style={{ color: dim }}>
            {t('scoreReader.tutorialZoomHint')}
          </Text>
        </View>
        <View className='mt-1 text-center'>
          <Text className='text-xs' style={{ color: dim }}>
            {t('scoreReader.tutorialPenHint')}
          </Text>
        </View>
        <View
          className='mx-auto mt-5 w-32 rounded-full border py-2 text-center'
          style={{ borderColor: line }}
          onClick={onClose}
        >
          <Text className='text-sm text-white'>{t('scoreReader.tutorialDismiss')}</Text>
        </View>
      </View>
    </View>
  )
}
