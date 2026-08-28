import { Button, View, ScrollView } from '@tarojs/components'
import type { ReactNode } from 'react'
import { useLayoutEffect } from 'react'
import { setOverlayOpen } from '@/lib/overlayStore'
import { useT } from '@/i18n'

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
  const { t } = useT()
  // 打开时通知 custom tabBar 隐藏自身，确保弹窗盖在 tabBar 之上。
  // 用 useLayoutEffect（而非 useEffect）在「绘制前」同步隐藏底边栏，
  // 避免底边栏在 Modal 出现后、display:none 生效前的那一帧覆盖 Modal 造成闪烁（底边栏为普通 View，非 CoverView）。
  useLayoutEffect(() => {
    if (!open) return
    setOverlayOpen(true)
    return () => setOverlayOpen(false)
  }, [open])

  const align = position === 'center' ? 'items-center' : 'items-end'
  const radius = position === 'center' ? 'rounded-2xl' : 'rounded-t-3xl'

  // custom tabBar 是普通 View（见 CustomTabBar.tsx），由 overlayStore 在打开弹窗时将其
  // display:none 隐藏；上述 useLayoutEffect 保证隐藏与弹窗出现发生在同一帧，避免闪烁。
  // 弹窗遮罩自然铺满到设备屏幕底边（同时解决原 hideTabBar 闪白条问题）。

  if (!open) return null

  return (
    // 遮罩层：fixed 全屏 + 点击关闭（Taro 无 React portal，用条件渲染挂载）。
    // 旧 iOS 不支持 inset 简写，显式四边；catchMove 阻断滚动穿透；
    // z-[60] 高于 Toast 的 z-50，与 Web 版「弹窗盖在 toast 上」一致
    <View
      role='dialog'
      ariaRole='dialog'
      aria-modal='true'
      catchMove
      className={`fixed left-0 right-0 top-0 bottom-0 z-[60] flex ${align} justify-center bg-overlay px-4 pb-[env(safe-area-inset-bottom)]`}
      onClick={closeOnOverlay ? onClose : undefined}
    >
      <View
        catchMove
        className={`relative flex w-full max-w-md flex-col ${radius} border border-border bg-surface p-4 shadow-xl max-h-[85vh]`}
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
                {t('ui.modal.close')}
              </Button>
            </View>
          </View>
        )}
        <ScrollView scrollY className='min-h-0 flex-1'>
          {children}
        </ScrollView>
      </View>
    </View>
  )
}
