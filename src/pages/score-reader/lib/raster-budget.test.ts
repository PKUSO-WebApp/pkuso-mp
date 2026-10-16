import { describe, expect, it } from 'vitest'
import { bitmapBytes, bytesToMB, createBitmapLedger } from './raster-budget'

describe('bitmapBytes', () => {
  it('按 RGBA 每像素 4 字节算', () => {
    expect(bitmapBytes(100, 50)).toBe(100 * 50 * 4)
  })

  it('尺寸取整（画布位图是整数像素）', () => {
    expect(bitmapBytes(100.4, 50.6)).toBe(100 * 51 * 4)
  })

  it('非有限值 / 负数一律 0，不产生 NaN 账', () => {
    expect(bitmapBytes(NaN, 100)).toBe(0)
    expect(bitmapBytes(Infinity, 100)).toBe(0)
    expect(bitmapBytes(-5, 100)).toBe(0)
  })
})

describe('bytesToMB', () => {
  it('保留一位小数', () => {
    expect(bytesToMB(1024 * 1024)).toBe(1)
    expect(bytesToMB(12 * 1024 * 1024)).toBe(12)
    expect(bytesToMB(0)).toBe(0)
  })
})

describe('createBitmapLedger', () => {
  it('set 之后能按 id 求和；同一 id 反复 set 是覆盖不是累加', () => {
    const led = createBitmapLedger()
    led.set('a', 10, 10)
    expect(led.sumOf(['a'])).toBe(400)
    led.set('a', 20, 20)
    expect(led.sumOf(['a'])).toBe(1600)
  })

  it('**只算传进来的那几个 id** —— 已卸载的画布不该继续记账（谁在挂载由调用方判）', () => {
    const led = createBitmapLedger()
    led.set('mounted', 10, 10)
    led.set('unmounted', 100, 100)
    expect(led.sumOf(['mounted'])).toBe(400)
  })

  it('没记过的 id 按 0 算（新挂上、还没上画的画布）', () => {
    const led = createBitmapLedger()
    expect(led.sumOf(['never'])).toBe(0)
  })

  it('detail 按字节降序、且只列有账的', () => {
    const led = createBitmapLedger()
    led.set('small', 10, 10)
    led.set('big', 100, 100)
    expect(led.detail(['small', 'big', 'never'])).toEqual([
      { id: 'big', bytes: 40000 },
      { id: 'small', bytes: 400 },
    ])
  })
})
