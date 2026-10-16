import { useRouter } from '@tarojs/taro'
import { ProbeSurface } from '../stroke-probe/probe-surface'
import './index.scss'

/**
 * ⚠️ **临时诊断页（变体 B）**：与 `pages/stroke-probe` 逐字相同，**只差一个页面配置** ——
 * 这里**不设** `disableScroll`。要测的正是它：我们为了治 iOS 橡皮筋加的那条，会不会同时
 * 把微信的左沿判定带撑宽了。
 */
export default function StrokeProbeFreePage() {
  const router = useRouter()
  const k = (router.params.k ?? '2d') as '2d' | 'legacy'
  return <ProbeSurface kind={k} variant='B' />
}
