import { useRouter } from '@tarojs/taro'
import { ProbeSurface, type ProbeKind } from './probe-surface'
import './index.scss'

/**
 * ⚠️ **临时诊断页**（2026-10-16，验完就删）：见 `probe-surface.tsx` 的头注释。
 *
 * `?k=2d|legacy|webview|pcontainer` 选承载形态，`?v=<变体名>` 只是给埋点标的标签。
 * 本页（`disableScroll: true`）承担 A（2d）/ C（legacy）/ D（webview）/ F（pcontainer）；
 * 不设 `disableScroll` 的 B 在 `pages/stroke-probe-free`，`navigationStyle: custom` 的 E 在
 * `pages/stroke-probe-custom`。变体表见 `probe-surface.tsx` 的 `VARIANTS`。
 */
export default function StrokeProbePage() {
  const router = useRouter()
  const k = (router.params.k ?? '2d') as ProbeKind
  return <ProbeSurface kind={k} variant={router.params.v ?? 'A'} />
}
