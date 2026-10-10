import { useEffect, useState } from 'react'
import { View, Button, ScrollView, Image } from '@tarojs/components'
import { useT } from '@/i18n'
import { useThemeContext } from '@/context/theme-context'
import { PEN_COLORS, PEN_WIDTHS } from '@/lib/annotation'
import penIcon from '@/assets/icons/pen.png'
import penIconDark from '@/assets/icons/pen-dark.png'
import eraserIcon from '@/assets/icons/eraser.png'
import eraserIconDark from '@/assets/icons/eraser-dark.png'

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
    // 外层给边框与底色，**内层横向可滚**：英文文案比中文长得多（实测约 546px vs 375px 屏宽），
    // 硬排会把右侧的「清空」整个挤出屏幕。全部换成图标能省一截，但即便全图标化在 375px 上
    // 仍有 ≈412px —— 所以「不裁切」这件事只能靠可滚来保证（也顺便对所有语言、以后加控件免疫）。
    // `inline-flex`（而不是 flex）是横向滚动的关键：行要**收缩到内容宽度**才会撑出滚动区；
    // 用普通 flex 会被父容器压到同宽，内容反而被裁掉。
    <View className='border-t border-border bg-surface'>
      <ScrollView scrollX className='w-full'>
        <View className='inline-flex flex-row items-center px-3 py-2'>
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
          <View className='ml-3 flex flex-row items-center'>
            {PEN_WIDTHS.map(widthDot)}
            {/* 这一页没有任何笔迹时**根本不渲染**撤销（用户 2026-10-08 定）：一个点不动的
            按钮只会让人以为坏了。清空仍保留（它有二次确认，不会误触） */}
            {canUndo ? (
              <Button
                className='ml-2 rounded-full border border-border bg-card px-3 py-1 text-xs text-text'
                onClick={onUndo}
              >
                {t('scoreReader.undo')}
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
      </ScrollView>
    </View>
  )
}
