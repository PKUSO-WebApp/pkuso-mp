/**
 * 「等画布的**布局尺寸**落到目标值」。
 *
 * 为什么需要（2026-10-11 真机，iOS）：首帧是在 `setViewSize({ w, h })` 刚发出去、
 * **视图层还没应用**的那一刻画的 —— 那一拍画布的布局盒还是 `boxW × 0`
 * （`boxH = viewSize.h || 0`，见 index.tsx）。真机表现是屏幕上出现一块没有结构的糊色块，
 * 而**画布里的像素是好的**：同一块画布在后续换帧（`promoteFrame`，不重画）时显示完全正常。
 *
 * 首帧与其余渲染的唯一差别就在这一处：其余渲染时布局盒早就是对的，只有首帧的「盒子从 0 高
 * 变成满高」与「画布从屏外摆回屏幕」挤在同一拍。所以让首帧**等到布局盒真的等于目标尺寸**再画，
 * 把这一拍错开。
 *
 * 返回**等了几拍**（0 = 第一次查就已经到位）；`-1` = 拍到上限还没落地 —— 调用方照画不误，
 * **绝不能因为等不到就不上屏**（宁可糊，也不能白）。
 */

export type CanvasSize = { width: number; height: number }

/** 问一次当前布局尺寸；拿不到（节点没挂载 / 查询失败）返回 null */
export type SizeProbe = () => Promise<CanvasSize | null>

/** 拍数上限：每拍 = 一次查询（视图层一个来回）+ 一个 tick，12 拍 ≈ 300~500ms，
 *  够 setData 走完；真机上正常情况下第 1~3 拍就到位，这个上限只在设备卡顿时才碰到 */
export const DEFAULT_TRIES = 12

/** 尺寸容差（CSS px）：rpx 换算与舍入会差 1 个像素以内，不值得再等 */
export const SIZE_TOLERANCE = 1

const defaultTick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 16))

export async function waitForLayoutSize(
  probe: SizeProbe,
  want: CanvasSize,
  opts: { tries?: number; tolerance?: number; tick?: () => Promise<void> } = {}
): Promise<number> {
  const tries = opts.tries ?? DEFAULT_TRIES
  const tolerance = opts.tolerance ?? SIZE_TOLERANCE
  const tick = opts.tick ?? defaultTick
  for (let i = 0; i < tries; i += 1) {
    const got = await probe()
    if (
      got &&
      Math.abs(got.width - want.width) <= tolerance &&
      Math.abs(got.height - want.height) <= tolerance
    ) {
      return i
    }
    // 最后一拍不再空等：等也白等，直接把 -1 交出去
    if (i < tries - 1) await tick()
  }
  return -1
}
