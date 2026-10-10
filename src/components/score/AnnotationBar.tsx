import { useEffect, useState } from 'react'
import { View, Button, Image } from '@tarojs/components'
import { useT } from '@/i18n'
import { useThemeContext } from '@/context/theme-context'
import { PEN_COLORS, PEN_WIDTHS } from '@/lib/annotation'
import penIcon from '@/assets/icons/pen.png'
import penIconDark from '@/assets/icons/pen-dark.png'
import eraserIcon from '@/assets/icons/eraser.png'
import eraserIconDark from '@/assets/icons/eraser-dark.png'
import undoIcon from '@/assets/icons/undo-2.png'
import undoIconDark from '@/assets/icons/undo-2-dark.png'

/** 工具按钮里的图标尺寸：与阅读器底栏那五个一致（素材统一 72×72，显示 18px） */
const TOOL_ICON = 18

type AnnotationBarProps = {
  color: string
  width: number
  /** 橡皮擦模式（按**整条**删除，见读者页的 eraseAtPoint） */
  eraser: boolean
  onEraser: (v: boolean) => void
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
  eraser,
  onEraser,
  canUndo,
  clearPage,
  onColor,
  onWidth,
  onUndo,
  onClear,
}: AnnotationBarProps) {
  const { t } = useT()
  const { mode } = useThemeContext()
  const dark = mode === 'dark'
  const [confirmingClear, setConfirmingClear] = useState(false)

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

  const widthDot = (w: number) => (
    <View
      key={w}
      className={`flex h-8 w-8 items-center justify-center rounded-full ${
        width === w ? 'border-2 border-primary' : 'border border-border'
      }`}
      onClick={() => onWidth(w)}
    >
      <View
        className='rounded-full bg-text'
        style={{ width: `${w * 400}px`, height: `${w * 400}px` }}
      />
    </View>
  )

  return (
    // ⚠️ 布局：**装得下就一行、装不下自动换两行**（用户 2026-10-10 定），
    // 而「粗细 / 撤销 / 清空」那一组永远靠右。
    //
    // 为什么不能只靠一行：这一栏在手机宽度上**本来就装不下** —— 左组（笔/擦 + 4 色块）
    // ≈224px、右组（2 粗细 + 撤销 + 清空第 N 页）≈234px，加内边距 ≈482px，而屏宽只有
    // 375px。行宽一旦等于内容宽，"靠右"就没有可分配的空隙，`justify-between` 也毫无效果。
    // `flex-wrap` + 右组 `margin-left: auto` 同时解决两件事：装得下时右组被推到最右；
    // 装不下时它换到第二行，并在**那一行里**靠右。宽度不再是硬约束，也就不需要横向滚了。
    <View className='border-t border-border bg-surface'>
      <View className='flex flex-row flex-wrap items-center px-3 py-2' style={{ rowGap: '8px' }}>
        <View className='flex flex-row items-center'>
          {/* 笔 / 擦：橡皮擦按整条删除，比「清空本页」好用（能只擦掉不想要的那几笔）。
                用**图标**而不是文字（用户 2026-10-10 定）：这一栏在英文下比中文长得多
                （实测约 546px vs 375px 屏宽），文字标签是溢出的主因；图标与语言无关。
                形状仍是圆角按钮、保留选中态（它俩是二选一的开关，不像底栏那五个是纯动作）。
                `ariaLabel` 仍走原 key —— 图标按钮没有可读的文字了。 */}
          <Button
            className={`mr-2 flex h-8 w-8 items-center justify-center rounded-full border p-0 ${
              eraser ? 'border-border bg-card' : 'border-primary bg-primary/10'
            }`}
            ariaLabel={t('scoreReader.pen')}
            onClick={() => onEraser(false)}
          >
            <Image
              src={dark ? penIconDark : penIcon}
              style={{ width: `${TOOL_ICON}px`, height: `${TOOL_ICON}px` }}
            />
          </Button>
          <Button
            className={`mr-2 flex h-8 w-8 items-center justify-center rounded-full border p-0 ${
              eraser ? 'border-primary bg-primary/10' : 'border-border bg-card'
            }`}
            ariaLabel={t('scoreReader.eraser')}
            onClick={() => onEraser(true)}
          >
            <Image
              src={dark ? eraserIconDark : eraserIcon}
              style={{ width: `${TOOL_ICON}px`, height: `${TOOL_ICON}px` }}
            />
          </Button>
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
        {/* `ml-auto`：装得下就把这一组推到最右；换行后它会在第二行里靠右 */}
        <View className='ml-auto flex flex-row items-center'>
          {PEN_WIDTHS.map(widthDot)}
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
                style={{ width: `${TOOL_ICON}px`, height: `${TOOL_ICON}px` }}
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
