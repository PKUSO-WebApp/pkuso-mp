import { Button, View } from '@tarojs/components'
import type { ReactNode } from 'react'

type ModalProps = {
  open: boolean
  onClose: () => void
  title?: string
  children?: ReactNode
  /** 标题行右侧附加内容（位于标题与「关闭」按钮之间）；不传时行为与现状一致 */
  headerExtra?: ReactNode
  /** 底部弹出(默认)｜居中 */
  position?: 'bottom' | 'center'
  /** 点击遮罩关闭,默认 true */
  closeOnOverlay?: boolean
}

export function Modal({
  open,
  onClose,
  title,
  children,
  headerExtra,
  position = 'bottom',
  closeOnOverlay = true,
}: ModalProps) {
  if (!open) return null

  const align = position === 'center' ? 'items-center' : 'items-end'
  const radius = position === 'center' ? 'rounded-2xl' : 'rounded-t-3xl'

  return (
    // 遮罩层：fixed 全屏 + 点击关闭（Taro 无 React portal，用条件渲染挂载）。
    // 旧 iOS 不支持 inset 简写，显式四边；catchMove 阻断滚动穿透；
    // z-[60] 高于 Toast 的 z-50，与 Web 版「弹窗盖在 toast 上」一致
    <View
      role='dialog'
      ariaRole='dialog'
      aria-modal='true'
      catchMove
      className={`fixed left-0 right-0 top-0 bottom-0 z-[60] flex ${align} justify-center bg-overlay px-4 pb-safe`}
      onClick={closeOnOverlay ? onClose : undefined}
    >
      <View
        catchMove
        className={`relative w-full max-w-md ${radius} border border-border bg-surface p-4 shadow-xl`}
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <View className='mb-2 flex items-center justify-between'>
            <View className='text-base font-semibold text-text'>{title}</View>
            <View className='flex items-center gap-2'>
              {headerExtra}
              <Button
                hoverClass='none'
                className='m-0 w-auto rounded-full border-none bg-muted px-3 py-1 text-xs leading-normal text-text-muted'
                onClick={onClose}
              >
                关闭
              </Button>
            </View>
          </View>
        )}
        {children}
      </View>
    </View>
  )
}
