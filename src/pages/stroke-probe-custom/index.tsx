import { ProbeSurface } from '../stroke-probe/probe-surface'
import './index.scss'

/** ⚠️ **临时诊断页（变体 E）**：只与 A 差一个页面配置 —— `navigationStyle: 'custom'`。
 *  多篇二手文断言它会禁掉原生右滑返回（官方页面配置文档里没写这条），值得花一分钟真机判。 */
export default function StrokeProbeCustomPage() {
  return <ProbeSurface kind='2d' variant='E' />
}
