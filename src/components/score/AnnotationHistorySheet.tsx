import { useState } from 'react'
import { ScrollView, Text, View } from '@tarojs/components'
import { useT } from '@/i18n'
import { Z_SHEET } from '@/pages/score-reader/lib/layout'
import { formatDateTimeInChina } from '@/lib/date-utils'
import {
  loadHistoryBatch,
  type HistoryBatch,
  type HistoryPage,
} from '@/lib/annotation-history'

/**
 * 「恢复云端历史」面板（从「分享」子菜单进）。
 *
 * 两级：
 *   ① **覆盖批次**（一次同步归档的那几页）—— 历史表是按页存的，而用户脑子里的一次
 *      「覆盖」是一次同步，所以先按 `replaced_at` 的间隔聚批（见 `groupHistoryBatches`）；
 *   ② 该批里**有笔迹**的页 —— 点一页就去冲突解决页，由它给出「用历史 / 用本地 / 合并」。
 *
 * ⚠️ 二级的内容**点进来才拉**：一级只有元数据（页 / 版本号 / 时刻），`strokes` 单行
 * 上限 256KB，整册一次拉回来能到几 MB，小程序端不值得。
 *
 * 结构照 `SaveToSheet`：蒙层与面板做成**兄弟节点**（`bindtap` 会冒泡，而 `stopPropagation`
 * 在 Taro 里不保证映射成 `catchtap`）；`fixed` 而不是 `absolute`（两个宿主页的底衬垫不同）。
 */
export function AnnotationHistorySheet({
  fileId,
  batches,
  loading,
  onPick,
  onClose,
}: {
  fileId: string
  /** 已按批次聚好的归档（宿主页拉好后传进来 —— 面板自己不管列表级取数） */
  batches: HistoryBatch[]
  loading: boolean
  /** 选中一页的历史版本：由宿主页导航到冲突解决页（带 `h=<version>`） */
  onPick: (page: HistoryPage) => void
  onClose: () => void
}) {
  const { t } = useT()
  /** null = 一级（批次列表）；非 null = 二级（这一批的页） */
  const [batch, setBatch] = useState<HistoryBatch | null>(null)
  const [pages, setPages] = useState<HistoryPage[] | null>(null)

  const openBatch = (b: HistoryBatch) => {
    setBatch(b)
    setPages(null)
    void loadHistoryBatch(fileId, b).then(setPages)
  }

  const rowCls = 'border-b border-border px-4 py-4'

  return (
    <View className='fixed left-0 right-0 top-0 bottom-0' style={{ zIndex: Z_SHEET }}>
      <View className='absolute inset-0 bg-overlay' onClick={onClose} />
      <View className='absolute bottom-0 left-0 right-0 rounded-t-2xl bg-surface pb-safe'>
        <View className={`${rowCls} flex flex-row items-center justify-between`}>
          {batch ? (
            <Text className='text-sm text-primary' onClick={() => setBatch(null)}>
              {t('scoreReader.history.back')}
            </Text>
          ) : (
            <Text className='text-sm font-medium text-text'>
              {t('scoreReader.history.title')}
            </Text>
          )}
          <Text className='text-xs text-text-muted'>
            {batch
              ? t('scoreReader.history.batchAt', { time: formatDateTimeInChina(batch.at) })
              : ''}
          </Text>
        </View>

        {/* 只有这一块滚（面板本身不滚）—— 与冲突列表面板同款：批次/页数多了不至于顶穿屏幕 */}
        <ScrollView scrollY className='max-h-[50vh]'>
          {loading ? (
            <View className={rowCls}>
              <Text className='block text-center text-sm text-text-muted'>
                {t('common.actions.loading')}
              </Text>
            </View>
          ) : batch ? (
            pages === null ? (
              <View className={rowCls}>
                <Text className='block text-center text-sm text-text-muted'>
                  {t('common.actions.loading')}
                </Text>
              </View>
            ) : pages.length === 0 ? (
              <View className={rowCls}>
                <Text className='block text-center text-sm text-text-muted'>
                  {t('scoreReader.history.batchEmpty')}
                </Text>
              </View>
            ) : (
              pages.map((p) => (
                <View
                  key={`${p.entry.page}-${p.entry.version}`}
                  className={rowCls}
                  onClick={() => onPick(p)}
                >
                  <Text className='text-sm text-text'>
                    {t('scoreReader.history.pageRow', {
                      page: p.entry.page,
                      n: p.strokes.length,
                    })}
                  </Text>
                </View>
              ))
            )
          ) : batches.length === 0 ? (
            <View className={rowCls}>
              <Text className='block text-center text-sm text-text-muted'>
                {t('scoreReader.history.empty')}
              </Text>
            </View>
          ) : (
            batches.map((b) => (
              <View key={b.at} className={rowCls} onClick={() => openBatch(b)}>
                <Text className='text-sm text-text'>
                  {t('scoreReader.history.batchRow', {
                    time: formatDateTimeInChina(b.at),
                    n: b.entries.length,
                  })}
                </Text>
              </View>
            ))
          )}
        </ScrollView>

        <View className='px-4 py-4' onClick={onClose}>
          <Text className='block text-center text-sm text-text-muted'>
            {t('common.saveTo.cancel')}
          </Text>
        </View>
      </View>
    </View>
  )
}
