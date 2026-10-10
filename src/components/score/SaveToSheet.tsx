import { View, Text } from '@tarojs/components'
import { useT } from '@/i18n'
import { Z_SHEET } from '@/pages/score-reader/lib/layout'
import type { HandoffKind } from '@/lib/pdf-handoff'

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
    // `fixed`（而不是 absolute）：两个宿主页面的根节点底衬垫不一样（声部页为 tabBar 留了
    // 50px+safe-area），`absolute inset-0` 会被那层衬垫顶起来、蒙层也盖不住 tabBar。
    // z 序 70 > tabBar 的 50 ⇒ 打开时底边栏一并被盖住，点不到（与 force-offline-modal 同款）。
    <View className='fixed left-0 right-0 top-0 bottom-0' style={{ zIndex: Z_SHEET }}>
      {/* 蒙层：点它关闭。它在 DOM 上排在面板**之前**，所以面板盖在它上面 */}
      <View className='absolute inset-0 bg-overlay' onClick={onClose} />
      <View className='absolute bottom-0 left-0 right-0 rounded-t-2xl bg-surface pb-safe'>
        {/*
          **没有标题**（用户 2026-10-10 定）。最初有一行「保存到…」，而它和选项长得一样，
          真机上被当成一个叫「保存到…」的第四项 —— 面板里每一项都该是能点的动作，
          标题这种不动作的东西只会制造歧义。
          「正在准备文件…」只在**未就绪**时出现（那是状态不是标题，且是暂态）。
        */}
        {!ready ? (
          <View className='border-b border-border px-4 py-3'>
            <Text className='block text-center text-xs text-text-subtle'>
              {t('common.saveTo.preparing')}
            </Text>
          </View>
        ) : null}
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
            {t('common.saveTo.cancel')}
          </Text>
        </View>
      </View>
    </View>
  )
}
