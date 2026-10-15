import { useEffect, useState } from 'react'
import { View, Button, Image } from '@tarojs/components'
import { useT } from '@/i18n'
import { useThemeContext } from '@/context/theme-context'
import { useUiScaleFactor } from '@/hooks/useUiScale'
import { PEN_COLORS, effectiveWidth, widthsFor, type AnnoTool } from '@/lib/annotation'
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

/** 收起 / 展开那个 V 的边长（px，再乘显示档位）与它的**视觉重心下沉量**（见 chevronV） */
const CHEVRON_PX = 9
const CHEVRON_SINK = CHEVRON_PX * 0.354

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
   * 档位与选中态都按**当前工具**算：荧光笔五档、画笔（含橡皮）两档。
   * 选中态比较的是 `effectiveWidth` 而不是原始值 —— 从荧光笔切回画笔时原始值可能仍是
   * 32‰，而画笔会按 8‰ 兜底，直接比原始值会「一个档位都没选中」。
   */
  const shownWidth = effectiveWidth(tool, width)
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
   * 收起 / 展开的那个 V —— **用两条边旋 45° 画**，不用字符、也不用图片。
   *
   * 为什么不用字符：那要赌系统字体里有没有那个字形（`⌄` / `∨` 各平台不一致，缺字形就是
   * 一个方框或一条豆腐）；画出来则处处一样。颜色跟语义 token（`currentColor` 取的是
   * 外层的 `text-text-muted`），大小跟显示档位。
   *
   * ⚠️ 转的是**盒子**：两条边（下 + 左）先构成一个「L」，绕中心转 -45° 成「v」，
   * 转 135° 成「^」。但转完的**视觉重心不在盒子中心** —— 两个端点在盒子中心那条线上，
   * 交点却在中心下方 (√2/2)·N 处 ⇒ 视觉中心比盒子中心低 **0.354N**。不补的话它就比旁边
   * 那几个图标低三四个像素（`CHEVRON_SINK`）。
   */
  const chevronV = (up: boolean) => (
    <View
      className='text-text-muted'
      style={{
        width: `${CHEVRON_PX * uiScale}px`,
        height: `${CHEVRON_PX * uiScale}px`,
        borderBottom: `${2 * uiScale}px solid currentColor`,
        borderLeft: `${2 * uiScale}px solid currentColor`,
        marginTop: `${-CHEVRON_SINK * uiScale}px`,
        transform: up ? 'rotate(135deg)' : 'rotate(-45deg)',
      }}
    />
  )

  /** 收起按钮：**没有背景**（用户 2026-10-16 定）—— 它就贴在谱面上，不该再压一块底色 */
  const toggleButton = (
    <View
      className='flex h-8 w-8 items-center justify-center'
      // 收起时整条栏被 `visibility: hidden` 罩住，这一个按钮把自己放出来 ——
      // 于是它**留在第一行的原位上**（收 / 展都不动），而其余部分既不上色也不吃触摸
      style={collapsed ? { visibility: 'visible', pointerEvents: 'auto' } : undefined}
      ariaLabel={collapsed ? t('scoreReader.penBarExpand') : t('scoreReader.penBarCollapse')}
      onClick={() => setCollapsed((c) => !c)}
    >
      {chevronV(collapsed)}
    </View>
  )

  return (
    // ⚠️ 布局：**强制两行**（用户 2026-10-16 定）。原先靠 `flex-wrap` 自动换行 —— 装得下
    // 一行、装不下两行，于是**收起按钮的位置会随屏宽 / 语言在「右上角」与「第二行」之间跳**，
    // 而它正是用户要伸手去点的那个。现在：第一行 = 工具 + 色块 …… 右上角收起按钮；
    // 第二行 = 粗细 + 撤销 + 清空，整行靠右。
    //
    // （从前必须自动换行是因为这一栏在手机宽度上本来就装不下：左组 ≈224px + 右组 ≈234px
    //  + 内边距 ≈482px，而屏宽只有 375px。分成两行之后这个约束就不存在了。）
    //
    // ⚠️ **收起 = 整条 `visibility: hidden`，不是「不渲染」**（用户 2026-10-16 订正）：
    // 不渲染会让布局盒子一起消失 ⇒ 那个 V 掉到「第一行与第二行之间」的位置（用户原话：
    // 「位置 y 太低，应当和第一行其他按钮对齐，现在几乎在第 1.5 行」）。visibility 保留
    // 布局盒 ⇒ V 原地不动；而被隐藏的节点**既不上色也不参与命中**（另加 `pointer-events`
    // 兜底）⇒ 谱面上唯一还挡着东西的就是那个 32×32 的 V，其余全能落笔。
    <View
      className='border-t border-border bg-surface'
      // ⚠️ 展开时**必须显式 `auto`**：`pointer-events` 是**继承**的，而外层容器为了收起时
      // 不吃触摸设了 `none` —— 这里不接回来，整条栏的按钮会全部点不动（静默失效）。
      style={
        collapsed ? { visibility: 'hidden', pointerEvents: 'none' } : { pointerEvents: 'auto' }
      }
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
        {/* `ml-auto` 把它推到第一行最右（= 整条的右上角） */}
        <View className='ml-auto flex flex-row items-center'>{toggleButton}</View>
      </View>
      <View className='flex flex-row items-center justify-end px-3 pb-2'>
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
  )
}
