import { View, Text } from '@tarojs/components'
import { useT } from '@/i18n'
import { Z_SHEET } from '@/pages/score-reader/lib/layout'
import type { HandoffKind } from '@/pages/score-reader/lib/pdf-handoff'

/**
 * 「保存到…」的出口面板。
 *
 * ⚠️ **刻意不用 `Taro.showActionSheet`**（2026-10-10 的真机报错换来的）：
 * `addFileToFavorites` / `shareFileMessage` / `saveFileToDisk` 都要求**在用户点击的同步
 * 调用栈里发起**，否则报 `can only be invoked by user TAP gesture`。而走系统 action sheet
 * 意味着「选完项还要先 await 下载」，手势上下文早没了。这里每个出口都是**页面内的真按钮**，
 * 点击回调里直接发 API（见 index.tsx 的 handlePick 里那条「不许 await」的告诫）。
 *
 * 结构上把**蒙层与面板做成兄弟节点**（而不是父子）：小程序端 `bindtap` 会冒泡，
 * 而 `stopPropagation` 在 Taro 里并不保证映射成 `catchtap` —— 做成兄弟就完全不依赖它，
 * 点面板内部不可能误触到蒙层的关闭。
 *
 * 文件没备好时整列置灰并给一行说明，而不是让用户点了才报错。
 */
export function SaveToSheet({
  kinds,
  labels,
  ready,
  busy,
  onPick,
  onClose,
}: {
  kinds: HandoffKind[]
  labels: Record<HandoffKind, string>
  /** 本地那份 PDF 是否已就绪（就绪前所有出口都不可点） */
  ready: boolean
  busy: boolean
  onPick: (kind: HandoffKind) => void
  onClose: () => void
}) {
  const { t } = useT()
  const canPick = ready && !busy
  return (
    <View className='absolute inset-0' style={{ zIndex: Z_SHEET }}>
      {/* 蒙层：点它关闭。它在 DOM 上排在面板**之前**，所以面板盖在它上面 */}
      <View className='absolute inset-0 bg-overlay' onClick={onClose} />
      <View className='absolute bottom-0 left-0 right-0 rounded-t-2xl bg-surface pb-safe'>
        <View className='border-b border-border px-4 py-3'>
          <Text className='text-sm font-medium text-text'>{t('scoreReader.saveTo')}</Text>
          {!ready ? (
            <Text className='mt-1 block text-xs text-text-muted'>
              {t('scoreReader.savePreparing')}
            </Text>
          ) : null}
        </View>
        {kinds.map((kind) => (
          <View
            key={kind}
            className={`border-b border-border px-4 py-4 ${canPick ? 'bg-surface' : 'bg-muted'}`}
            onClick={() => onPick(kind)}
          >
            <Text className={`text-sm ${canPick ? 'text-text' : 'text-text-subtle'}`}>
              {labels[kind]}
            </Text>
          </View>
        ))}
        <View className='px-4 py-4' onClick={onClose}>
          <Text className='block text-center text-sm text-text-muted'>
            {t('scoreReader.saveCancel')}
          </Text>
        </View>
      </View>
    </View>
  )
}
