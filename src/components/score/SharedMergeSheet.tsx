import { ScrollView, Text, View } from '@tarojs/components'
import { useT } from '@/i18n'
import { Z_SHEET } from '@/pages/score-reader/lib/layout'
import type { MergeDirection } from '@/pages/score-reader/lib/shared-merge'

/**
 * 「合并批注」的入口面板（P6c）：
 *   - 先选方向（共享 → 我的 / 我的 → 共享；后者只有可编辑共享谱的人看得到）；
 *   - 下方列出**需要做选择的页**（两侧指纹不同且至少一侧有笔迹）；
 *   - 点一页进逐页预览页，回来时列表会刷新（见阅读器的 useDidShow）。
 *
 * 与冲突列表同款结构：蒙层与面板是兄弟节点，不依赖 stopPropagation。
 */
export function SharedMergeSheet({
  direction,
  canEditShared,
  pages,
  loading,
  error,
  onDirection,
  onPick,
  onResolvePersonalConflicts,
  onClose,
}: {
  direction: MergeDirection
  canEditShared: boolean
  pages: number[]
  loading: boolean
  error: string | null
  onDirection: (d: MergeDirection) => void
  onPick: (page: number) => void
  /** 个人批注还有未解决的同步冲突：给一条「去解决」的出口 */
  onResolvePersonalConflicts?: () => void
  onClose: () => void
}) {
  const { t } = useT()

  return (
    <View className='fixed left-0 right-0 top-0 bottom-0' style={{ zIndex: Z_SHEET }}>
      <View className='absolute inset-0 bg-overlay' onClick={onClose} />
      <View className='absolute bottom-0 left-0 right-0 rounded-t-2xl bg-surface pb-safe'>
        <View className='border-b border-border px-4 py-3'>
          <Text className='block text-base font-semibold text-text'>
            {t('scoreReader.merge.title')}
          </Text>
          <Text className='mt-1 block text-xs leading-relaxed text-text-muted'>
            {direction === 'to-personal'
              ? t('scoreReader.merge.hintToPersonal')
              : t('scoreReader.merge.hintToShared')}
          </Text>
        </View>

        {/* 方向：两个单选开关 */}
        <View className='flex flex-row items-center justify-center border-b border-border px-4 py-3'>
          {(['to-personal', 'to-shared'] as MergeDirection[]).map((d) => {
            const disabled = d === 'to-shared' && !canEditShared
            return (
              <View
                key={d}
                className={`mr-2 rounded-full border px-3 py-1.5 ${
                  direction === d ? 'border-primary bg-primary/10' : 'border-border bg-card'
                } ${disabled ? 'opacity-40' : ''}`}
                onClick={() => {
                  if (disabled) return
                  onDirection(d)
                }}
              >
                <Text className='text-xs text-text'>
                  {d === 'to-personal'
                    ? t('scoreReader.merge.directionToPersonal')
                    : t('scoreReader.merge.directionToShared')}
                </Text>
              </View>
            )
          })}
        </View>

        {loading ? (
          <View className='border-b border-border px-4 py-4'>
            <Text className='block text-center text-xs text-text-subtle'>
              {t('scoreReader.merge.loading')}
            </Text>
          </View>
        ) : error ? (
          <View className='border-b border-border px-4 py-4'>
            <Text className='block text-center text-xs text-danger'>{error}</Text>
            {onResolvePersonalConflicts ? (
              <View
                className='mt-3 flex flex-row justify-center'
                onClick={onResolvePersonalConflicts}
              >
                <View className='rounded-full border border-border bg-card px-3 py-1'>
                  <Text className='text-xs text-text'>
                    {t('scoreReader.merge.resolvePersonalConflicts')}
                  </Text>
                </View>
              </View>
            ) : null}
          </View>
        ) : (
          <>
            <View className='border-b border-border px-4 py-3'>
              <Text className='text-xs text-text-muted'>
                {t('scoreReader.merge.count', { n: pages.length })}
              </Text>
            </View>
            {pages.length === 0 ? (
              <View className='border-b border-border px-4 py-4'>
                <Text className='block text-center text-xs text-text-subtle'>
                  {t('scoreReader.merge.empty')}
                </Text>
              </View>
            ) : (
              <ScrollView scrollY className='max-h-[40vh]'>
                {pages.map((page) => (
                  <View
                    key={page}
                    className='border-b border-border px-4 py-4'
                    onClick={() => onPick(page)}
                  >
                    <Text className='text-sm text-text'>
                      {t('scoreReader.merge.pageButton', { page })}
                    </Text>
                  </View>
                ))}
              </ScrollView>
            )}
          </>
        )}

        <View className='px-4 py-4' onClick={onClose}>
          <Text className='block text-center text-sm text-text-muted'>
            {t('common.saveTo.cancel')}
          </Text>
        </View>
      </View>
    </View>
  )
}
