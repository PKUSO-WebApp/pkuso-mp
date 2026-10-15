/**
 * 抬手那一刻该走哪条路 —— 从 `onTouchEnd` 里抽出来的**判据**。
 *
 * 之所以值得单独一个文件：这条判据管的事故不止一次。从前只有「所有手指都离开」才收尾
 * ⇒「写着字、另一根手指搭在屏上」时这一笔**永远不提交**，而剩下那根手指还会继续往同一条
 * 笔迹里塞点（平板笔调研 §2-2）。它长在 2700 行的页面里时只能真机验；抽成纯函数之后
 * 三种分支都能用用例钉住。
 */

export type TouchEndAction =
  /** 屏上已经没有手指：走**完整**收尾（含 drag 重置与 tap 分类） */
  | 'full'
  /** 还有别的手指，但**画的那根**抬起了：只收这一笔，drag / pinch / multiTouch 一概不动 */
  | 'stroke-only'
  /** 抬起的不是画的那根：什么都不做 */
  | 'none'

export function touchEndAction(args: {
  /** 这一刻屏上还剩几根手指 */
  touchesLeft: number
  /** 本次事件里变化的那些手指的 identifier（`changedTouches`） */
  changedIds: number[]
  /** 此刻是否真有一段绘制在进行 */
  drawing: boolean
  /** 画的那根手指的 identifier（没在画时为 null） */
  penId: number | null
}): TouchEndAction {
  const { touchesLeft, changedIds, drawing, penId } = args
  // 一根不剩 ⇒ 无论画没画，完整收尾那条路都要走（它还要重置 drag、做 tap 分类）
  if (touchesLeft === 0) return 'full'
  // 还有手指在屏上：只有当**画的那根**确实抬起了、而且我们真的在画，才单独收这一笔。
  // `penId === null`（没在画 / 是老路径没记 id）时一律不动 —— 宁可少收，不可错收。
  if (drawing && penId !== null && changedIds.includes(penId)) return 'stroke-only'
  return 'none'
}
