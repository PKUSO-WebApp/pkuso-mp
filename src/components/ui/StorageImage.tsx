import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Image, type ImageProps } from '@tarojs/components'
import { storageUrlCandidates } from '@/lib/storage-url'

type StorageImageProps = {
  src?: string | null
  className?: string
  mode?: ImageProps['mode']
  style?: ImageProps['style']
  /** 点击时回传**当前真正显示成功的那条 URL**（预览不要自己另拼直连） */
  onClick?: (url: string) => void
  /** 所有候选都失败时回调；用于埋点/占位，不负责换 URL */
  onFailure?: () => void
  fallback?: ReactNode
}

/**
 * 带候选兜底的 Storage 图片。
 *
 * 反代优先、直连兜底（顺序由 `storageUrlCandidates` 按当前入口决定）。`<Image>` 没有
 * 多 URL 能力，所以这里在 `onError` 时换下一条；预览通过 `onClick` 拿到当前成功的 URL，
 * 而不是拿原始直连 URL——否则预览会在反代已经可用时又走一遍可能不通的直连。
 */
export function StorageImage({
  src,
  className,
  mode = 'aspectFill',
  style,
  onClick,
  onFailure,
  fallback = null,
}: StorageImageProps) {
  const candidates = useMemo(() => storageUrlCandidates(src), [src])
  const [index, setIndex] = useState(0)

  // src 换了就从头试；必须在渲染后重置，否则同一个 index 会误用到新图片的候选上
  useEffect(() => {
    setIndex(0)
  }, [src])

  const safeIndex = Math.min(index, candidates.length - 1)
  const url = candidates[safeIndex]
  if (!url) return <>{fallback}</>

  return (
    <Image
      src={url}
      className={className}
      mode={mode}
      style={style}
      onClick={onClick ? () => onClick(url) : undefined}
      onError={() => {
        if (safeIndex + 1 < candidates.length) setIndex(safeIndex + 1)
        else onFailure?.()
      }}
    />
  )
}
