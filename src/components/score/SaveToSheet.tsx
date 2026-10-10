import { View, Text, Switch } from '@tarojs/components'
import { useT } from '@/i18n'
import { useThemeContext } from '@/context/theme-context'
import { THEME_PALETTE } from '@/lib/theme'
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
  onAnno,
  onPick,
  onClose,
}: {
  kinds: HandoffKind[]
  labels: Record<HandoffKind, string>
  /** 本地那份 PDF 是否已就绪（就绪前所有出口都不可点） */
  ready: boolean
  busy: boolean
  /** 「是否带有批注？」：开了走云端合成（见 lib/annotated-pdf） */
  withAnno: boolean
  onAnno: (v: boolean) => void
  onPick: (kind: HandoffKind) => void
  onClose: () => void
}) {
  const { t } = useT()
  const { mode } = useThemeContext()
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
        {/* 「是否带有批注？」：**开关左「是」右「否」**（用户 2026-10-10 定）——
            于是「开」= 左侧被点亮，与大多数开关的直觉相反，但这是明确要求。
            拨它要**重新备一份文件**（带批注那份是云端合成的另一个文件），
            所以点完之后出口会短暂回到不可点（见 usePdfHandoff 的 toggleAnno）。 */}
        <View className='flex flex-row items-center justify-between border-b border-border px-4 py-3'>
          <Text className='text-sm text-text'>{t('common.saveTo.withAnno')}</Text>
          <View className='flex flex-row items-center'>
            <Text className='mr-2 text-sm text-text'>{t('common.saveTo.yes')}</Text>
            {/* `color` 只能给字面色值（原生控件吃不到 CSS 变量）⇒ 取自 THEME_PALETTE，
                那份值与 --color-primary 的同值关系由 theme.test.ts 守着 */}
            <Switch
              checked={withAnno}
              disabled={busy}
              color={THEME_PALETTE[mode].primary}
              onChange={(e) => onAnno(Boolean(e.detail.value))}
            />
            <Text className='ml-2 text-sm text-text'>{t('common.saveTo.no')}</Text>
          </View>
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
        <View className='px-4 py-4' onClick={onClose}>
          <Text className='block text-center text-sm text-text-muted'>
            {t('common.saveTo.cancel')}
          </Text>
        </View>
      </View>
    </View>
  )
}
