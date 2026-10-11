import { describe, expect, it } from 'vitest'
import {
  blockedByEdgeGuard,
  isTap,
  snapZoom,
  swipeDir,
  swipeMinPx,
  SWIPE_MIN_CEIL_PX,
  SWIPE_MIN_FLOOR_PX,
  TAP_MAX_MOVE_PX,
  TAP_MAX_MS,
  ZOOM_SNAP_BAND,
} from './gesture'

const track = (o: Partial<{ tx: number; ty: number; startAt: number; maxMove: number }> = {}) => ({
  tx: 200,
  ty: 400,
  startAt: 1000,
  maxMove: 0,
  ...o,
})

describe('isTap', () => {
  it('短按且基本没动 = 点击', () => {
    expect(isTap(track({ maxMove: 5 }), 1200)).toBe(true)
  })

  it('动得太多 / 按得太久都不是点击', () => {
    expect(isTap(track({ maxMove: TAP_MAX_MOVE_PX + 0.5 }), 1100)).toBe(false)
    expect(isTap(track(), 1000 + TAP_MAX_MS + 1)).toBe(false)
  })

  it('边界值算点击（<= 而不是 <）', () => {
    expect(isTap(track({ maxMove: TAP_MAX_MOVE_PX }), 1000 + TAP_MAX_MS)).toBe(true)
  })

  it('长按不动不算点击：按住谱面思考不该把菜单开开关关', () => {
    expect(isTap(track(), 1600)).toBe(false)
  })
})

describe('swipeMinPx（按实测视口宽算，带上下限）', () => {
  it('常见手机宽按 12% 走', () => {
    expect(Math.round(swipeMinPx(390))).toBe(47)
  })

  it('小屏取下限、大屏取上限', () => {
    expect(swipeMinPx(200)).toBe(SWIPE_MIN_FLOOR_PX)
    expect(swipeMinPx(2000)).toBe(SWIPE_MIN_CEIL_PX)
  })

  it('还没量到视口时给下限（宁可迟钝一点，也别把抖动当翻页）', () => {
    expect(swipeMinPx(0)).toBe(SWIPE_MIN_FLOOR_PX)
  })
})

describe('swipeDir', () => {
  const MIN = swipeMinPx(390) // ≈47

  it('左滑 = 下一页、右滑 = 上一页', () => {
    expect(swipeDir(track({ tx: 300 }), 300 - 60, 400, MIN)).toBe(1)
    expect(swipeDir(track({ tx: 100 }), 100 + 60, 400, MIN)).toBe(-1)
  })

  it('竖直为主的拖动不翻页（那是滚谱）', () => {
    expect(swipeDir(track({ tx: 300, ty: 200 }), 240, 500, MIN)).toBe(0) // dx 60 / dy 300
  })

  it('斜滑只要水平占优就算翻页', () => {
    expect(swipeDir(track({ tx: 300, ty: 200 }), 240, 240, MIN)).toBe(1) // dx 60 / dy 40
  })

  it('不到阈值不算（差 1px 也不行）', () => {
    expect(swipeDir(track({ tx: 300 }), 300 - (MIN - 1), 400, MIN)).toBe(0)
    expect(swipeDir(track({ tx: 300 }), 300 - MIN, 400, MIN)).toBe(1)
  })

  it('不给滑动设时长上限：缓慢横滑也算（未放大时横滑本就没有别的含义）', () => {
    expect(swipeDir(track({ tx: 300, startAt: 0 }), 240, 400, MIN)).toBe(1)
  })
})

describe('snapZoom（100% 吸附）', () => {
  it('带内一律吸到 1（含两条边界）', () => {
    expect(snapZoom(1)).toBe(1)
    expect(snapZoom(1.05)).toBe(1)
    expect(snapZoom(0.95)).toBe(1)
    expect(snapZoom(1 + ZOOM_SNAP_BAND)).toBe(1)
    expect(snapZoom(1 - ZOOM_SNAP_BAND)).toBe(1)
  })

  it('出带子后平移 band ⇒ 连续、不打跳（刚出界时输出正好是 1）', () => {
    expect(snapZoom(1 + ZOOM_SNAP_BAND + 1e-4)).toBeCloseTo(1, 3)
    expect(snapZoom(1 + ZOOM_SNAP_BAND * 2)).toBeCloseTo(1 + ZOOM_SNAP_BAND, 6)
  })

  it('两个方向对称：放大要推过带子才动，缩小时同理', () => {
    expect(snapZoom(2)).toBeCloseTo(2 - ZOOM_SNAP_BAND, 6)
    expect(snapZoom(0.6)).toBeCloseTo(0.6 + ZOOM_SNAP_BAND, 6)
  })

  it('band 传 0 时是恒等（留作关掉吸附的开关）', () => {
    expect(snapZoom(1.05, 1, 0)).toBe(1.05)
  })
})

describe('blockedByEdgeGuard', () => {
  it('贴左沿的右滑让给系统返回手势', () => {
    expect(blockedByEdgeGuard(10, -1)).toBe(true)
    expect(blockedByEdgeGuard(30, -1)).toBe(false)
  })

  it('只作用于右滑；左滑与点击分区不受影响', () => {
    expect(blockedByEdgeGuard(5, 1)).toBe(false)
    expect(blockedByEdgeGuard(5, 0)).toBe(false)
  })
})
