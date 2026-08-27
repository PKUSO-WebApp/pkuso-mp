import { describe, expect, it } from 'vitest'
import { distanceMeters, withinCheckinGeofence } from './geo'

describe('distanceMeters', () => {
  it('同点距离为 0', () => {
    expect(distanceMeters(39.9, 116.4, 39.9, 116.4)).toBe(0)
  })

  it('北京大学东门→西门 约 1km 量级（容差 20%）', () => {
    // 新太阳学生中心(近似) 与 百周年讲堂(近似) 的相对位置校验
    const d = distanceMeters(39.9925, 116.3105, 39.9955, 116.3045)
    expect(d).toBeGreaterThan(400)
    expect(d).toBeLessThan(800)
  })

  it('对称性', () => {
    const a = distanceMeters(31.2, 121.5, 39.9, 116.4)
    const b = distanceMeters(39.9, 116.4, 31.2, 121.5)
    expect(Math.abs(a - b)).toBeLessThan(1e-6)
  })

  it('纬度差 0.00001 ≈ 1.11m', () => {
    const d = distanceMeters(39.9, 116.4, 39.90001, 116.4)
    expect(d).toBeGreaterThan(1.05)
    expect(d).toBeLessThan(1.2)
  })
})

describe('withinCheckinGeofence', () => {
  const center = { lat: 39.99, lng: 116.31, radiusM: 200 }

  it('未配置坐标/半径 → 不限位置直接通过', () => {
    expect(
      withinCheckinGeofence({ latitude: 1, longitude: 1 }, { lat: null, lng: null, radiusM: null })
    ).toEqual({ ok: true, distanceM: 0 })
    expect(
      withinCheckinGeofence({ latitude: 1, longitude: 1 }, { lat: 39.99, lng: 116.31, radiusM: null })
    ).toEqual({ ok: true, distanceM: 0 })
  })

  it('半径内通过', () => {
    // ~0.001 度经度在北纬 40° 约 85m
    const r = withinCheckinGeofence(
      { latitude: 39.99, longitude: 116.311, accuracy: 30 },
      center
    )
    expect(r.ok).toBe(true)
    expect(r.distanceM).toBeGreaterThan(50)
    expect(r.distanceM).toBeLessThan(120)
  })

  it('半径外拒绝；accuracy 容差可救回边缘情况', () => {
    // ~0.01 度经度约 850m，远超 200m
    const far = withinCheckinGeofence(
      { latitude: 39.99, longitude: 116.32, accuracy: 10 },
      center
    )
    expect(far.ok).toBe(false)

    // 距离 ~170m、误差 60m：净距离 110m < 200m → 通过
    const edge = withinCheckinGeofence(
      { latitude: 39.99, longitude: 116.312, accuracy: 60 },
      center
    )
    expect(edge.ok).toBe(true)
  })
})
