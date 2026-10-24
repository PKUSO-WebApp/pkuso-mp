import { ScrollView, Text, View } from '@tarojs/components'
import { useT } from '@/i18n'
import { Z_SHEET } from '@/pages/score-reader/lib/layout'
import type { SharedAnnotationConflict } from '@/pages/score-reader/lib/shared-annotation-backend'

/**
 * 共享谱 CAS 冲突的**页面列表**（P6b）。
 *
 * 这里只负责选哪一页；点进去后在阅读器里用与个人冲突页同一个
 * `ScoreCompareView` 做预览（本地 / 远端 / 合并），看清再提交。
 */
export function SharedConflictSheet({
  conflicts,
  onPick,
}: {
  conflicts: SharedAnnotationConflict[]
  onPick: (page: number) => void
}) {
  const { t } = useT()

  return (
    <View className='fixed left-0 right-0 top-0 bottom-0' style={{ zIndex: Z_SHEET }}>
      <View className='absolute inset-0 bg-overlay' />
      <View className='absolute bottom-0 left-0 right-0 flex max-h-[70vh] flex-col rounded-t-2xl bg-surface pb-safe'>
        <View className='border-b border-border px-4 py-3'>
          <Text className='block text-base font-semibold text-text'>
            {t('scoreReader.conflict.title', { count: conflicts.length })}
          </Text>
          <Text className='mt-1 block text-xs leading-relaxed text-text-muted'>
            {t('score.sharedConflictHint')}
          </Text>
        </View>

        <ScrollView scrollY className='min-h-0 flex-1'>
          {conflicts.map((conflict) => (
            <View
              key={conflict.page}
              className='border-b border-border px-4 py-4'
              onClick={() => onPick(conflict.page)}
            >
              <Text className='text-sm text-text'>
                {t('scoreReader.conflict.pageButton', { page: conflict.page })}
              </Text>
            </View>
          ))}
        </ScrollView>
      </View>
    </View>
  )
}
