import { describe, expect, it } from 'vitest'
import {
  bandAt,
  pageFromSliderX,
  penBarBottom,
  sliderFracOf,
  SAFE_BOTTOM,
  zoneFor,
  zoneOnAxis,
  ZONE_SPLITS,
  ZONE_SPLITS_UD,
  Z_BAND,
  Z_STATUS,
  Z_TOOLBAR,
  Z_TUTORIAL,
} from './layout'

describe('zoneFor（点击分区）', () => {
  const W = 400

  it('左 25% 上一页、中 50% 菜单、右 25% 下一页', () => {
    expect(zoneFor(0, W)).toBe('prev')
    expect(zoneFor(99.9, W)).toBe('prev')
    expect(zoneFor(100, W)).toBe('menu') // 边界 25% 归中区
    expect(zoneFor(299.9, W)).toBe('menu')
    expect(zoneFor(300, W)).toBe('next') // 边界 75% 归右区
    expect(zoneFor(400, W)).toBe('next')
  })

  it('视口还没量到（<=0）时一律当中区：任何时刻都点得出菜单', () => {
    expect(zoneFor(0, 0)).toBe('menu')
    expect(zoneFor(999, 0)).toBe('menu')
    expect(zoneFor(0, -5)).toBe('menu')
  })

  it('分区比例是唯一事实来源（教程示意线也用它，两边不许各写一份）', () => {
    expect(ZONE_SPLITS).toEqual([0.25, 0.75])
  })
})

describe('zoneOnAxis（上下滚动模式：20/60/20）', () => {
  const H = 600

  it('上 20% 往上、中 60% 菜单、下 20% 往下——边界归**中间**那一档', () => {
    expect(zoneOnAxis(0, H, ZONE_SPLITS_UD)).toBe('prev')
    expect(zoneOnAxis(119.9, H, ZONE_SPLITS_UD)).toBe('prev')
    expect(zoneOnAxis(120, H, ZONE_SPLITS_UD)).toBe('menu') // 边界 20% 归中区
    expect(zoneOnAxis(479.9, H, ZONE_SPLITS_UD)).toBe('menu')
    expect(zoneOnAxis(480, H, ZONE_SPLITS_UD)).toBe('next') // 边界 80% 归下区
    expect(zoneOnAxis(600, H, ZONE_SPLITS_UD)).toBe('next')
  })

  it('视口没量到（<=0）时一律当中区', () => {
    expect(zoneOnAxis(0, 0, ZONE_SPLITS_UD)).toBe('menu')
  })

  it('中区确实是 60%（不是把 25/75 那组拿来用）', () => {
    expect(ZONE_SPLITS_UD).toEqual([0.2, 0.8])
    // 用左右模式的比例去判纵轴的话，30% 处会被判成 prev——这里必须是 menu
    expect(zoneOnAxis(180, H, ZONE_SPLITS_UD)).toBe('menu')
  })
})

describe('bandAt（灰带命中，高度传实测值）', () => {
  const H = 800

  it('上带含上沿、下带含下沿，其余不算', () => {
    expect(bandAt(0, H, 40, 44)).toBe('top')
    expect(bandAt(40, H, 40, 44)).toBe('top')
    expect(bandAt(40.1, H, 40, 44)).toBeNull()
    expect(bandAt(H - 45, H, 40, 44)).toBeNull() // 下带从 H-44 起
    expect(bandAt(H - 44, H, 40, 44)).toBe('bottom')
    expect(bandAt(H, H, 40, 44)).toBe('bottom')
  })

  it('工具条高还没量到（0）时不算灰带，走普通分区', () => {
    expect(bandAt(0, H, 0, 0)).toBeNull()
    expect(bandAt(H, H, 0, 0)).toBeNull()
  })

  it('视口高为 0 时不算灰带', () => {
    expect(bandAt(0, 0, 40, 44)).toBeNull()
  })
})

describe('层级与安全区', () => {
  it('灰带压在画布（1/2/3）之上、状态条之下、工具条之下、教程之下', () => {
    expect(Z_BAND).toBeGreaterThan(3)
    expect(Z_STATUS).toBeGreaterThan(Z_BAND)
    expect(Z_TOOLBAR).toBeGreaterThan(Z_STATUS)
    expect(Z_TUTORIAL).toBeGreaterThan(Z_TOOLBAR)
  })

  it('批注工具条叠在底栏之上：用底栏的实测高度（不重复叠安全区），没量到才用安全区兜底', () => {
    expect(penBarBottom(78)).toBe('78px')
    expect(penBarBottom(0)).toBe(SAFE_BOTTOM)
  })
})

describe('sliderFracOf / pageFromSliderX（进度条）', () => {
  it('两端贴边：第 1 页在 0，末页在 1（步长是 1/(n-1)，不是 1/n）', () => {
    expect(sliderFracOf(1, 10)).toBe(0)
    expect(sliderFracOf(10, 10)).toBe(1)
    expect(sliderFracOf(5, 9)).toBeCloseTo(0.5)
  })

  it('⭐ 互逆：拖到某页的位置再读回来，还是那一页（每一页都不差）', () => {
    const W = 200
    for (const n of [2, 3, 7, 34]) {
      for (let p = 1; p <= n; p += 1) {
        expect(pageFromSliderX(sliderFracOf(p, n) * W, W, n)).toBe(p)
      }
    }
  })

  it('触点越界一律钳到两端（拖出轨道不产生非法页码）', () => {
    expect(pageFromSliderX(-50, 200, 10)).toBe(1)
    expect(pageFromSliderX(9999, 200, 10)).toBe(10)
  })

  it('单页册 / 没量到宽度：恒为第 1 页，不除零', () => {
    expect(pageFromSliderX(100, 200, 1)).toBe(1)
    expect(pageFromSliderX(100, 0, 10)).toBe(1)
    expect(sliderFracOf(1, 1)).toBe(0)
  })

  it('页数越多每级越小：同样的宽度下，34 页走一格比 7 页短', () => {
    const W = 200
    const step7 = sliderFracOf(2, 7) * W - sliderFracOf(1, 7) * W
    const step34 = sliderFracOf(2, 34) * W - sliderFracOf(1, 34) * W
    expect(step34).toBeLessThan(step7)
    expect(step7).toBeCloseTo(W / 6)
    expect(step34).toBeCloseTo(W / 33)
  })
})
