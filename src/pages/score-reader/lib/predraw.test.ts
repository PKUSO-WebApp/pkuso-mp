import { describe, expect, it } from 'vitest'
import {
  pickPredrawTarget,
  predrawFallback,
  predrawGo,
  predrawMatches,
  PREDRAW_IDLE_MS,
  PREDRAW_WAIT_MS,
  PREDRAW_WARM_GRACE_MS,
  type PredrawFrame,
} from './predraw'

const frame = (o: Partial<PredrawFrame> = {}): PredrawFrame => ({
  page: 5,
  zoom: 1,
  containerW: 390,
  layer: 'b',
  cssW: 390,
  cssH: 520,
  aspect: 1.33,
  at: 1000,
  ...o,
})

describe('predrawMatches', () => {
  const want = { page: 5, zoom: 1, containerW: 390, layer: 'b' as const }

  it('四项全等才命中', () => {
    expect(predrawMatches(frame(), want)).toBe(true)
  })

  it('没有帧 / 任何一项不同都不命中', () => {
    expect(predrawMatches(null, want)).toBe(false)
    expect(predrawMatches(frame({ page: 6 }), want)).toBe(false)
    expect(predrawMatches(frame({ zoom: 1.25 }), want)).toBe(false)
    expect(predrawMatches(frame({ containerW: 391 }), want)).toBe(false)
    // 层不同最关键：那块早被别的渲染写过了，用它会直接上错页
    expect(predrawMatches(frame({ layer: 'a' }), want)).toBe(false)
  })

  it('尺寸/高宽比/时刻不参与命中判定（它们只是命中后要用的值）', () => {
    expect(predrawMatches(frame({ cssW: 999, cssH: 999, aspect: 9, at: 0 }), want)).toBe(true)
  })
})

describe('pickPredrawTarget', () => {
  it('备下一页', () => {
    expect(pickPredrawTarget(3, 10)).toBe(4)
  })

  it('末页备上一页（末页往回翻永远是冷的）', () => {
    expect(pickPredrawTarget(10, 10)).toBe(9)
    expect(pickPredrawTarget(2, 2)).toBe(1)
  })

  it('单页册子不备', () => {
    expect(pickPredrawTarget(1, 1)).toBeNull()
    expect(pickPredrawTarget(1, 0)).toBeNull()
  })
})

describe('predrawFallback（采纳失败后的兜底）', () => {
  const base = { adopt: true, target: 6, zoom: 1, currentPage: 6, currentZoom: 1 }

  it('用户还在等这一页 ⇒ 交回常规路径', () => {
    expect(predrawFallback(base)).toEqual({ page: 6, zoom: 1 })
  })

  it('没被采纳过（用户没翻到它）⇒ 不用管：备用块留着下次用', () => {
    expect(predrawFallback({ ...base, adopt: false })).toBeNull()
  })

  it('用户已经翻走 / 缩放变了 ⇒ 交回去会覆盖更新的请求，不能交', () => {
    expect(predrawFallback({ ...base, currentPage: 7 })).toBeNull()
    expect(predrawFallback({ ...base, currentZoom: 1.25 })).toBeNull()
  })

  // ⚠️ 这里**没有**「被失效打断（回前台 / 转屏 / 换册）也要交回」的用例，是刻意的：
  // predrawFallback 的入参里根本没有 cancelled / 世代，所以传进去也只是被忽略——
  // 那样的用例断言结果与第 1 条逐字相同，是恒真的，留着只会造假信心。
  // 该性质由**结构**保证：签名里没有 cancelled + 调用点只传这五个字段（见 predraw.ts 的注释）。
})

describe('预绘制的两个时间常量', () => {
  it('重新检查的间隔要明显小于等待宽限，否则「等一次」就到头了', () => {
    expect(PREDRAW_WAIT_MS).toBeLessThan(PREDRAW_WARM_GRACE_MS / 2)
  })

  it('等动画停稳的时间要大于翻页动画时长（否则会写进正在滑的那块画布）', () => {
    // TURN_MS(180) + 停靠余量(40) = 220
    expect(PREDRAW_IDLE_MS).toBeGreaterThan(220)
  })
})

describe('predrawGo', () => {
  const base = {
    imageMode: true,
    zoom: 1,
    animating: false,
    queueBusy: false,
    target: 4,
    warm: true,
    waitedMs: 0,
  }

  it('条件齐了就开工', () => {
    expect(predrawGo(base)).toBe('start')
  })

  it('非图片模式 / 没有目标页 / 放大状态 都不做', () => {
    expect(predrawGo({ ...base, imageMode: false })).toBe('skip')
    expect(predrawGo({ ...base, target: null })).toBe('skip')
    expect(predrawGo({ ...base, zoom: 1.25 })).toBe('skip')
  })

  it('动画中 / 队列忙 都不做（让位给交互任务）', () => {
    expect(predrawGo({ ...base, animating: true })).toBe('skip')
    expect(predrawGo({ ...base, queueBusy: true })).toBe('skip')
  })

  it('还没预热到就先等（抢在泵前面发是重复请求）；超过宽限就不等了', () => {
    expect(predrawGo({ ...base, warm: false, waitedMs: 0 })).toBe('wait')
    expect(predrawGo({ ...base, warm: false, waitedMs: PREDRAW_WARM_GRACE_MS })).toBe('wait')
    expect(predrawGo({ ...base, warm: false, waitedMs: PREDRAW_WARM_GRACE_MS + 1 })).toBe('start')
  })
})
