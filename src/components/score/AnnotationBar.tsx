import { useEffect, useState } from 'react'
import { View, Button } from '@tarojs/components'
import { useT } from '@/i18n'
import { PEN_COLORS, PEN_WIDTHS } from '@/lib/annotation'

type AnnotationBarProps = {
  color: string
  width: number
  canUndo: boolean
  onColor: (color: string) => void
  onWidth: (width: number) => void
  onUndo: () => void
  onClear: () => void
}

/** 阅读器画笔工具条：颜色 / 粗细 / 撤销 / 清空（清空为二段确认防误触） */
export function AnnotationBar({
  color,
  width,
  canUndo,
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
          {confirmingClear ? t('scoreReader.clearConfirm') : t('scoreReader.clear')}
        </Button>
      </View>
    </View>
  )
}
