import { useEffect, useState } from 'react'
import { View, Button, Image } from '@tarojs/components'
import { useT } from '@/i18n'
import { useThemeContext } from '@/context/theme-context'
import { useUiScaleFactor } from '@/hooks/useUiScale'
import { PEN_COLORS, widthsFor, type AnnoTool } from '@/lib/annotation'
import penIcon from '@/assets/icons/pen.png'
import penIconDark from '@/assets/icons/pen-dark.png'
import highlighterIcon from '@/assets/icons/highlighter.png'
import highlighterIconDark from '@/assets/icons/highlighter-dark.png'
import eraserIcon from '@/assets/icons/eraser.png'
import eraserIconDark from '@/assets/icons/eraser-dark.png'
import undoIcon from '@/assets/icons/undo-2.png'
import undoIconDark from '@/assets/icons/undo-2-dark.png'

/** 工具按钮里的图标尺寸：与阅读器底栏那五个一致（素材统一 72×72，显示 18px） */
const TOOL_ICON = 18

type AnnotationBarProps = {
  color: string
  width: number
  /** 当前工具（画笔 / 荧光笔 / 橡皮擦，三选一） */
  tool: AnnoTool
  onTool: (t: AnnoTool) => void
  /** 撤销栈里还有没有可回退的操作（不是「这一页有没有笔迹」） */
  canUndo: boolean
  /** 清空按钮针对的页码：UD 下「本页」是有歧义的（写/擦按手指位置、清空按顶边页），
   *  所以文案把页码写出来，用户点之前就知道会清哪一页 */
  clearPage: number
  onColor: (color: string) => void
  onWidth: (width: number) => void
  onUndo: () => void
  onClear: () => void
  /**
   * 「完成」：**退出批注**（用户在批注栏右上角，2026-10-16 定）。
   * 与「收起」的区别：收起只把这条栏藏起来、还留在批注里（笔仍可写）；完成是真的出去。
   * ⚠️ 它**不负责收底栏菜单** —— 那是"点谱面"那两下的事（先关气泡、再关底栏）。
   */
  onDone: () => void
}

/** 阅读器画笔工具条：颜色 / 粗细 / 撤销 / 清空（清空为二段确认防误触） */
export function AnnotationBar({
  color,
  width,
  tool,
  onTool,
  canUndo,
  clearPage,
  onColor,
  onWidth,
  onUndo,
  onClear,
  onDone,
}: AnnotationBarProps) {
  const { t } = useT()
  const { mode } = useThemeContext()
  // 换行后的行距是内联 px（不吃 Tailwind token）⇒ 档位系数要自己乘
  const uiScale = useUiScaleFactor()
  const dark = mode === 'dark'
  const [confirmingClear, setConfirmingClear] = useState(false)
  /**
   * 收起状态：**只活在这一次批注会话里**，组件一卸载（退出批注）就没了。
   *
   * 这是用户 2026-10-16 定的**不是**「忘了持久化」：从底栏那个铅笔按钮进批注时，
   * 工具条**必须**是展开的 —— 否则上次收起的记忆会让人以为「点了没反应」
   *（他只看到谱面上一个很小的 V，根本不会意识到那是展开入口）。
   * 组件随 `penOn` 挂载 / 卸载，所以「进来即展开」由构造保证，不靠谁记得去重置。
   */
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    if (!confirmingClear) return
    const timer = setTimeout(() => setConfirmingClear(false), 4000)
    return () => clearTimeout(timer)
  }, [confirmingClear])

  const handleClear = () => {
    if (!confirmingClear) {
      setConfirmingClear(true)
      return
    }
    setConfirmingClear(false)
    onClear()
  }

  /**
   * 三支工具：画笔 / 荧光笔 / 橡皮擦。
   * 选中态仍是圆角按钮（它们三选一，不像底栏那五个是纯动作）——见下面布局注释。
   */
  const toolButton = (kind: AnnoTool, icon: string, iconDark: string, label: string) => (
    <Button
      className={`mr-2 flex h-8 w-8 items-center justify-center rounded-full border p-0 ${
        tool === kind ? 'border-primary bg-primary/10' : 'border-border bg-card'
      }`}
      ariaLabel={label}
      onClick={() => onTool(kind)}
    >
      <Image
        src={dark ? iconDark : icon}
        style={{ width: `${TOOL_ICON * uiScale}px`, height: `${TOOL_ICON * uiScale}px` }}
      />
    </Button>
  )

  /**
   * 档位**按当前工具取表**（画笔四档 / 荧光笔四档，`widthsFor`），而**选中的那一档各存各的**
   * （阅读器里的 `penWidth` / `hlWidth`）⇒ 传进来的 `width` 就是当前工具自己的值，
   * 直接比即可，不需要再从别的档位兜底。
   */
  const shownWidth = width
  const widthDot = (w: number) => (
    <View
      key={w}
      className={`flex h-8 w-8 items-center justify-center rounded-full ${
        shownWidth === w ? 'border-2 border-primary' : 'border border-border'
      }`}
      onClick={() => onWidth(w)}
    >
      <View
        className='rounded-full bg-text'
        style={{ width: `${w * 400 * uiScale}px`, height: `${w * 400 * uiScale}px` }}
      />
    </View>
  )

  /**
   * 文字按钮（2026-10-16 用户定：把原来那个「V」换成字）：
   * - **收起**：**不带背景** —— 它就在栏里，和色块 / 档位同一层，不需要再压一块底色；
   * - **展开**：**必须带背景** —— 收起之后它是唯一贴在谱面上的东西，没有底色时在 UD 模式下
   *   几乎看不见（用户原话：「现在在 UD 模式下，无背景的上箭头按钮很难看到」）。
   *
   * ⚠️ **尺寸与形状跟「清空」逐字一致**（用户 2026-10-16 第二次订正：那一版我给了 `h-8` +
   * flex 居中，比清空高出一截，看着像另一套控件）。所以这里就照抄清空那串：
   * `rounded-full border px-3 py-1 text-xs` —— **高度由 padding 决定，不写死**；
   * 不带背景的那个把 `border`/`bg` 都设成透明（**盒子仍然一样大**，只是看不见边框与底色）。
   *
   * `pointerEvents: 'auto'` 是显式的：外层浮层为了「不吃触摸」设了 `none`，而它是**继承**属性。
   */
  const textButton = (
    label: string,
    ariaLabel: string,
    onTap: () => void,
    tone: 'plain' | 'boxed' | 'primary'
  ) => (
    <Button
      className={`rounded-full border px-3 py-1 text-xs ${
        tone === 'primary'
          ? // 「完成」用主色实底：它才是这一栏里最该被看见的那个动作（用户 2026-10-16 定：
            // 原来的 bg-card 在 bg-surface 上太糊，看不出是个按钮）
            'border-primary bg-primary text-primary-foreground'
          : tone === 'boxed'
            ? 'border-border bg-card text-text'
            : 'border-transparent bg-transparent text-text-muted'
      }`}
      style={{ pointerEvents: 'auto' }}
      ariaLabel={ariaLabel}
      onClick={onTap}
    >
      {label}
    </Button>
  )

  // **收起**：整条栏都不在，只剩这一个「展开」。它自己那几十像素是**唯一**还被占住的地方 ——
  // 这正是「在被挡住的地方也能起笔」的做法（半透明 / 落笔让位都只能解决「看到」）。
  // ⚠️ 这一行的盒子要 `pointer-events: none`：它整行都是透明的，而盒子**按几何命中** ——
  // 不收手就留下一条**看不见的禁区**（真正接触摸的是那个按钮，它自己 `auto` 回来）。
  if (collapsed) {
    return (
      <View
        className='flex flex-row items-center justify-start px-3'
        style={{ pointerEvents: 'none' }}
      >
        {textButton(
          t('scoreReader.penBarExpandLabel'),
          t('scoreReader.penBarExpand'),
          () => setCollapsed(false),
          'boxed'
        )}
      </View>
    )
  }

  return (
    // ⚠️ 布局：**强制两行**（用户 2026-10-16 定）。原先靠 `flex-wrap` 自动换行 —— 装得下
    // 一行、装不下两行，于是收起按钮的位置会随屏宽 / 语言在「右上角」与「第二行」之间跳，
    // 而它正是用户要伸手去点的那个。现在写死两行：
    //   第一行 = 工具 + 色块 …… **右上角「完成」**
    //   第二行 = **左下角「收起」** …… 粗细 + 撤销 + 清空（整组靠右）
    // 两个出口分在两角是 2026-10-16 用户定的：右上「完成」＝**真的退出批注、回到阅览**
    //（底栏菜单也收掉），左下「收起」＝只把这条栏藏起来（还在批注里，笔仍可写）。
    //
    // （从前必须自动换行是因为这一栏在手机宽度上本来就装不下：左组 ≈224px + 右组 ≈234px
    //  + 内边距 ≈482px，而屏宽只有 375px。分成两行之后这个约束就不存在了。）
    //
    // ⚠️ 两个按钮都在**流里**（不是钉坐标）：钉坐标那条路踩过的坑是「`top-2` 与第一行的
    // `pt-2` 各自算一遍 `calc(var(--spacing) * 2)`，在 `.ui-scale` 下还要再乘档位系数，
    // 真机上就是不重合」——放进流里之后，同高由同一个 flex 行的 `items-center` 保证。
    <View
      className='border-t border-border bg-surface'
      // ⚠️ 展开时**必须显式 `auto`**：`pointer-events` 是**继承**的，而外层容器（见下面收起
      // 那一支的注释）为了不吃触摸设了 `none` —— 这里不接回来，整条栏的按钮会全部点不动。
      style={{ pointerEvents: 'auto' }}
    >
      <View className='flex flex-row items-center px-3 pt-2'>
        <View className='flex flex-row items-center'>
          {/* 笔 / 荧光笔 / 擦：橡皮擦按整条删除，比「清空本页」好用（能只擦掉不想要的那几笔）。
                用**图标**而不是文字（用户 2026-10-10 定）：这一栏在英文下比中文长得多
                （实测约 546px vs 375px 屏宽），文字标签是溢出的主因；图标与语言无关。
                形状仍是圆角按钮、保留选中态（它仨是三选一的开关，不像底栏那五个是纯动作）。
                `ariaLabel` 仍走原 key —— 图标按钮没有可读的文字了。 */}
          {toolButton('pen', penIcon, penIconDark, t('scoreReader.pen'))}
          {toolButton(
            'highlighter',
            highlighterIcon,
            highlighterIconDark,
            t('scoreReader.highlighter')
          )}
          {toolButton('eraser', eraserIcon, eraserIconDark, t('scoreReader.eraser'))}
          {PEN_COLORS.map((c) => (
            <View
              key={c}
              className={`mr-2 h-7 w-7 rounded-full ${
                color === c ? 'border-2 border-primary' : 'border border-border'
              }`}
              style={{ background: c }}
              onClick={() => onColor(c)}
            />
          ))}
        </View>
        {/* 「完成」在**右上角**（用户 2026-10-16 定）：它才是「我不想批注了」的那个出口，
            与左下角的「收起」（只是把这条栏藏起来、还在批注里）分得开 */}
        <View className='ml-auto flex flex-row items-center'>
          {textButton(t('scoreReader.penDone'), t('scoreReader.penDone'), onDone, 'primary')}
        </View>
      </View>
      <View className='flex flex-row items-center px-3 pb-2'>
        {/* 「收起」在**左下角**（用户 2026-10-16 定）：伸手可及，也不跟右边那组抢位置 */}
        {textButton(
          t('scoreReader.penBarCollapseLabel'),
          t('scoreReader.penBarCollapse'),
          () => setCollapsed(true),
          'plain'
        )}
        <View className='ml-auto flex flex-row items-center'>
          {widthsFor(tool).map(widthDot)}
          {/* 这一页没有任何笔迹时**根本不渲染**撤销（用户 2026-10-08 定）：一个点不动的
              按钮只会让人以为坏了。清空仍保留（它有二次确认，不会误触） */}
          {/* 撤销：图标（`undo-2`）。文案仍留着做 `ariaLabel` —— 图标按钮没有可读文字了 */}
          {canUndo ? (
            <Button
              className='ml-2 flex h-8 w-8 items-center justify-center rounded-full border border-border bg-card p-0'
              ariaLabel={t('scoreReader.undo')}
              onClick={onUndo}
            >
              <Image
                src={dark ? undoIconDark : undoIcon}
                style={{ width: `${TOOL_ICON * uiScale}px`, height: `${TOOL_ICON * uiScale}px` }}
              />
            </Button>
          ) : null}
          <Button
            className={`ml-2 rounded-full border px-3 py-1 text-xs ${
              confirmingClear
                ? 'border-danger bg-danger text-danger-foreground'
                : 'border-border bg-card text-text'
            }`}
            onClick={handleClear}
          >
            {confirmingClear
              ? t('scoreReader.clearConfirm')
              : t('scoreReader.clear', { page: clearPage })}
          </Button>
        </View>
      </View>
    </View>
  )
}
