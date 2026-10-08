import { useEffect, useState } from 'react'
import { View, Button } from '@tarojs/components'
import { useT } from '@/i18n'
import { PEN_COLORS, PEN_WIDTHS } from '@/lib/annotation'

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
    <View className='flex flex-row items-center justify-between border-t border-border bg-surface px-3 py-2'>
      <View className='flex flex-row items-center'>
        {/* 笔 / 擦：橡皮擦按整条删除，比「清空本页」好用（能只擦掉不想要的那几笔） */}
        <Button
          className={`mr-2 rounded-full border px-3 py-1 text-xs ${
            eraser ? 'border-border bg-card text-text' : 'border-primary bg-primary/10 text-text'
          }`}
          onClick={() => onEraser(false)}
        >
          {t('scoreReader.pen')}
        </Button>
        <Button
          className={`mr-2 rounded-full border px-3 py-1 text-xs ${
            eraser ? 'border-primary bg-primary/10 text-text' : 'border-border bg-card text-text'
          }`}
          onClick={() => onEraser(true)}
        >
          {t('scoreReader.eraser')}
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
      <View className='flex flex-row items-center'>
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
  )
}
