/**
 * 「这一笔被平台抢走时，要不要留下已经画出来的墨」—— 从 `cancelStroke` 里抽出来的**判据**。
 *
 * 背景（2026-10-16 调研，报告 `pkusoweb/批注-边缘卡顿与返回手势-调研.md`）：起手落在屏幕左沿
 * 那条带内时，**微信客户端自己**的返回手势会来抢触摸。小程序侧没有任何 API 能关掉它
 *（`disableSwipeBack` 已实测无效、`popGestureDirection` 没有 `none`、`page-container` 拦的是
 * 返回**动作**而不是触摸），所以能改的只有**我们自己的反应**。
 *
 * 关键观测：平台在 `touch-cancel` 之前，通常已经把扣住的点**成批补送**回来了（真机数据里
 * 见过「17 个点挤在 6ms 内」）⇒ 我们手里是一条完整的线。从前一律抹掉，用户看到的是
 * 「画到一半整条消失」（26 笔贴左沿的笔里 13 笔如此）。
 *
 * 抽成纯函数的理由同 `touch-end.ts`：这条判据决定的是「用户的作品留不留」，
 * 长在 3000 行的页面里只能真机验；抽出来之后分支能用用例钉住。
 */

/**
 * @param reason     打断这一笔的原因（取值见 `cancelStroke` 的各个调用点）
 * @param maxTouches 这一笔期间屏上出现过的最大触点数（落笔即 1，见 `strokeDiagRef`）
 */
export function keepInkOnCancel(reason: string, maxTouches: number): boolean {
  // 只有「平台把触摸抢走」这一支保留。其余原因都是**我们自己**结束的
  //（另起一笔 / 转双指 / 收起批注 / 换页 / 换册 / 落笔失败），那一笔本来就不该留。
  if (reason !== 'touch-cancel') return false
  // 全程单指 = 用户的手一直没离开屏幕，那条线就是他要画的。
  // 期间落过第二触点（手掌 / 第二根手指）时「画到哪儿为止」是有歧义的，照旧丢弃。
  return maxTouches <= 1
}
