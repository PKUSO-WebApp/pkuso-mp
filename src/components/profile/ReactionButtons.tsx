import { useEffect, useRef, useState } from 'react'
import { Text, View } from '@tarojs/components'
import { useMemberReactions, type ReactionKind } from '@/hooks/useMemberReactions'
import { formatReactionCount } from '@/lib/reaction-count'
import './ReactionButtons.scss'

type FloatItem = { id: number; kind: ReactionKind; left: number }

let nextFloatId = 1
const FLOAT_LIFETIME_MS = 1000
const MAX_FLOATS = 12

/**
 * 成员详情页头像下方的点赞 / 送花按钮。
 *
 * 点击立即 +1 并飘一个随机位置的图标；真正的 RPC 由 `useMemberReactions`
 * 合并成批次（连续点击每 1.5s 最多一次），离开页面时补发。
 */
export function ReactionButtons({
  targetUserId,
  initialLikes,
  initialFlowers,
  disabled = false,
}: {
  targetUserId: string
  initialLikes: number | null
  initialFlowers: number | null
  disabled?: boolean
}) {
  const { likes, flowers, bump } = useMemberReactions({
    targetUserId,
    initialLikes,
    initialFlowers,
  })
  const [floats, setFloats] = useState<FloatItem[]>([])
  const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map())

  // 卸载时清掉漂浮图标的定时器；已发的点击由 hook 的 cleanup 负责落库
  useEffect(() => {
    const timers = timersRef.current
    return () => {
      timers.forEach((timer) => clearTimeout(timer))
      timers.clear()
    }
  }, [])

  const spawnFloat = (kind: ReactionKind) => {
    const id = nextFloatId++
    const left = 8 + Math.random() * 84
    setFloats((prev) => [...prev.slice(-(MAX_FLOATS - 1)), { id, kind, left }])
    const timer = setTimeout(() => {
      setFloats((prev) => prev.filter((item) => item.id !== id))
      timersRef.current.delete(id)
    }, FLOAT_LIFETIME_MS)
    timersRef.current.set(id, timer)
  }

  const tap = (kind: ReactionKind) => {
    if (disabled) return
    bump(kind)
    spawnFloat(kind)
  }

  return (
    <View className='relative flex items-center justify-center gap-3'>
      <View
        hoverClass='none'
        className={`flex items-center gap-1.5 rounded-full border border-border bg-card px-4 py-2 ${
          disabled ? 'opacity-50' : ''
        }`}
        onClick={() => tap('likes')}
      >
        <Text className='text-lg leading-none'>👍</Text>
        <Text className='text-sm font-medium text-text'>{formatReactionCount(likes)}</Text>
      </View>
      <View
        hoverClass='none'
        className={`flex items-center gap-1.5 rounded-full border border-border bg-card px-4 py-2 ${
          disabled ? 'opacity-50' : ''
        }`}
        onClick={() => tap('flowers')}
      >
        <Text className='text-lg leading-none'>💐</Text>
        <Text className='text-sm font-medium text-text'>{formatReactionCount(flowers)}</Text>
      </View>

      {floats.map((item) => (
        <Text key={item.id} className='reaction-float' style={{ left: `${item.left}%` }}>
          {item.kind === 'likes' ? '👍' : '💐'}
        </Text>
      ))}
    </View>
  )
}
