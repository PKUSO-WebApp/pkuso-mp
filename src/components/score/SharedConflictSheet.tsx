import { View, Text, ScrollView } from '@tarojs/components'
import { useT } from '@/i18n'
import { Z_SHEET } from '@/pages/score-reader/lib/layout'
import type {
  SharedAnnotationConflict,
  SharedConflictChoice,
} from '@/pages/score-reader/lib/shared-annotation-backend'

/**
 * 共享谱 CAS 冲突：逐页三选一（我的 / 远端 / 合并）。
 *
 * 不可关闭：冲突不解决就不能继续写这一页；关掉只会让状态更含糊。
 * 数据源与个人冲突页不同（共享表 vs 个人层），因此单独一个面板，不复用个人冲突页。
 */
export function SharedConflictSheet({
  conflicts,
  onResolve,
}: {
  conflicts: SharedAnnotationConflict[]
  onResolve: (page: number, choice: SharedConflictChoice) => void
}) {
  const { t } = useT()

  return (
    <View className='fixed left-0 right-0 top-0 bottom-0' style={{ zIndex: Z_SHEET }}>
      <View className='absolute inset-0 bg-overlay' />
      <View className='absolute bottom-0 left-0 right-0 flex max-h-[70vh] flex-col rounded-t-2xl bg-surface pb-safe'>
        <View className='border-b border-border px-4 py-3'>
          <Text className='block text-base font-semibold text-text'>
            {t('score.sharedConflictTitle')}
          </Text>
          <Text className='mt-1 block text-xs text-text-muted'>
            {t('score.sharedConflictHint')}
          </Text>
        </View>

        <ScrollView scrollY className='min-h-0 flex-1'>
          {conflicts.map((conflict) => (
            <View key={conflict.page} className='border-b border-border px-4 py-3'>
              <Text className='block text-sm font-medium text-text'>
                {t('score.sharedPage', { n: conflict.page })}
              </Text>
              <View className='mt-2 flex flex-row gap-2'>
                {(['local', 'remote', 'merge'] as const).map((choice) => (
                  <View
                    key={choice}
                    className='flex-1 rounded-full border border-border bg-muted px-2 py-1.5 text-center'
                    onClick={() => onResolve(conflict.page, choice)}
                  >
                    <Text className='text-xs text-text'>
                      {choice === 'local'
                        ? t('score.sharedUseLocal')
                        : choice === 'remote'
                          ? t('score.sharedUseRemote')
                          : t('score.sharedMerge')}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          ))}
        </ScrollView>
      </View>
    </View>
  )
}
