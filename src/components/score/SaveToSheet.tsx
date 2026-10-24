import { View, Text } from '@tarojs/components'
import { useT } from '@/i18n'
import { YesNoSwitch } from '@/components/ui/YesNoSwitch'
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
  withAnno,
  hasAnno,
  preparing,
  onAnno,
  onPick,
  onHistory,
  onSharedHistory,
  onMergeShared,
  onClose,
}: {
  kinds: HandoffKind[]
  labels: Record<HandoffKind, string>
  /** 本地那份 PDF 是否已就绪（就绪前所有出口都不可点） */
  ready: boolean
  busy: boolean
  /** 「是否带有批注？」：开了走云端合成（见 lib/annotated-pdf） */
  withAnno: boolean
  /** 这一册**有没有笔迹**（`open` 时定的）。没有就固定为「否」且不可拨：拨上去只会换来
   *  一句「这份谱还没有批注」（用户 2026-10-15 定） */
  hasAnno: boolean
  /** 正在备文件（含云端合成）：这期间**不许拨**——换了选择就要重新备一份，
   *  半途改主意既没有意义，也会让「面板上那份到底是哪个」变得含糊 */
  preparing: boolean
  onAnno: (v: boolean) => void
  onPick: (kind: HandoffKind) => void
  /**
   * 「恢复云端历史」那一行。**只有阅读器给**（声部页那份 PDF 面板只负责把文件送出去，
   * 没有"当前在哪一页、本地有哪些笔迹"这些上下文）⇒ 不给就整行不渲染。
   */
  onHistory?: () => void
  /** 「恢复共享历史」：只有共享谱阅读器给（与个人历史是两张表） */
  onSharedHistory?: () => void
  /**
   * 「合并批注…」：**只有共享谱阅读器给**（P6c）。个人谱没有共享层可合并，
   * 给了入口也只会让人点进一个空面板。
   */
  onMergeShared?: () => void
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
        {/* 「是否带有批注？」（左「是」右「否」）。拨它要**重新备一份文件**（带批注那份是
            云端合成的另一个文件），所以备文件期间这个开关是禁用的——见 usePdfHandoff */}
        <View className='flex flex-row items-center justify-between border-b border-border px-4 py-3'>
          <Text className='text-sm text-text'>{t('common.saveTo.withAnno')}</Text>
          {/* `!hasAnno` ⇒ 固定为「否」且拨不动：拨上去只会换来一句「这份谱还没有批注」 */}
          <YesNoSwitch
            value={withAnno && hasAnno}
            disabled={busy || preparing || !hasAnno}
            ariaLabel={t('common.saveTo.withAnno')}
            onChange={onAnno}
          />
        </View>
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
        {/* 「恢复云端历史」：拿到被覆盖掉的那几版，进冲突解决页挑一版（或与本地的合并）。
            它**不受 `canPick` 影响** —— 那一位管的是"本地 PDF 备好了没"，而这条走的是
            云端历史 + 冲突页，跟那份 PDF 文件没关系 */}
        {onHistory ? (
          <View className='border-b border-border px-4 py-4' onClick={onHistory}>
            <Text className='text-sm text-text'>{t('scoreReader.history.entry')}</Text>
          </View>
        ) : null}
        {onSharedHistory ? (
          <View className='border-b border-border px-4 py-4' onClick={onSharedHistory}>
            <Text className='text-sm text-text'>{t('scoreReader.sharedHistory.entry')}</Text>
          </View>
        ) : null}
        {/* 共享谱：把共享笔迹并进个人层，或把个人笔迹推到共享层（P6c） */}
        {onMergeShared ? (
          <View className='border-b border-border px-4 py-4' onClick={onMergeShared}>
            <Text className='text-sm text-text'>{t('scoreReader.merge.entry')}</Text>
          </View>
        ) : null}
        <View className='px-4 py-4' onClick={onClose}>
          <Text className='block text-center text-sm text-text-muted'>
            {t('common.saveTo.cancel')}
          </Text>
        </View>
      </View>
    </View>
  )
}
