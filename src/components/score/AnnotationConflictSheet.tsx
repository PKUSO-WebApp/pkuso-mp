import { ScrollView, Text, View } from '@tarojs/components'
import { useT } from '@/i18n'
import { Z_SHEET } from '@/pages/score-reader/lib/layout'

/**
 * 「有 N 页批注冲突」的列表（进册时 / 册内新发现时弹）。
 *
 * 它只是**入口**：一页一行，点进冲突解决页去看两份笔迹、选一版。这里不替用户做任何决定，
 * 也不显示预览——笔迹的差别只有画出来才看得懂（见 conflict 页）。
 *
 * 结构上把**蒙层与面板做成兄弟节点**（而不是父子）：小程序端 `bindtap` 会冒泡，而
 * `stopPropagation` 在 Taro 里并不保证映射成 `catchtap` —— 做成兄弟就完全不依赖它
 * （与 SaveToSheet 同款，别改成嵌套）。
 *
 * 「稍后处理」是**一等公民**（用户 2026-10-14 定：不能硬阻塞）：冲突不解决不影响画谱、
 * 不影响别的功能，下次进这一册还会再提示。
 */
export function AnnotationConflictSheet({
  pages,
  onPick,
  onClose,
}: {
  /** 有冲突的页码（升序） */
  pages: number[]
  onPick: (page: number) => void
  onClose: () => void
}) {
  const { t } = useT()
  return (
    <View className='fixed left-0 right-0 top-0 bottom-0' style={{ zIndex: Z_SHEET }}>
      <View className='absolute inset-0 bg-overlay' onClick={onClose} />
      <View className='absolute bottom-0 left-0 right-0 rounded-t-2xl bg-surface pb-safe'>
        <View className='border-b border-border px-4 py-3'>
          <Text className='block text-base font-semibold text-text'>
            {t('scoreReader.conflict.title', { count: pages.length })}
          </Text>
          <Text className='mt-1 block text-xs leading-relaxed text-text-muted'>
            {t('scoreReader.conflict.intro')}
          </Text>
        </View>
        {/* 页码多了要能滚（曾见过一次同步报出十几页）：面板本身不滚，只有这一块滚 */}
        <ScrollView scrollY className='max-h-[40vh]'>
          {pages.map((page) => (
            <View
              key={page}
              className='border-b border-border px-4 py-4'
              onClick={() => onPick(page)}
            >
              <Text className='text-sm text-text'>
                {t('scoreReader.conflict.pageButton', { page })}
              </Text>
            </View>
          ))}
        </ScrollView>
        <View className='px-4 py-4' onClick={onClose}>
          <Text className='block text-center text-sm text-text-muted'>
            {t('scoreReader.conflict.later')}
          </Text>
        </View>
      </View>
    </View>
  )
}
