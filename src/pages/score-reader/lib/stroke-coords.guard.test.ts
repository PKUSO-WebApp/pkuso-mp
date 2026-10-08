import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 批注坐标换算的**结构守卫**（不是行为用例）。
 *
 * 为什么要有它：真机上连着栽了两次，都出在「页坐标 → 画布坐标」这一步——
 * ① 左右模式忘了减零点（落笔全程画在画布外、抬手才现身）；
 * ② 修①时**又**用 translate 减了一遍（减两次 ⇒ 越修越偏）。
 * 纯函数用例（`windowYOf` / `pageCoordOf`）两次都是绿的——它们钉的是换算本身，
 * 钉不住「组件里怎么组合」。所以这里直接钉源码形状：换算只有一处，且不许叠加 translate。
 */
describe('批注坐标：换算只有一处（结构守卫）', () => {
  const src = readFileSync(path.resolve(__dirname, '../index.tsx'), 'utf8')

  it('页坐标 → 画布坐标 只由 drawStrokePts 做（windowYOf 全文件只出现一次）', () => {
    const hits = src.match(/windowYOf\(/g) ?? []
    expect(hits).toHaveLength(1)
    // 且必须落在 drawStrokePts 里
    const fn = src.slice(src.indexOf('const drawStrokePts'))
    expect(fn.slice(0, fn.indexOf('\n  },'))).toContain('windowYOf(')
  })

  it('drawStrokePts 里不许出现 translate（零点只由 windowYOf 减一次）', () => {
    // 真机那次「越修越偏」就是在这个函数里又 translate 减了一遍。
    // ⚠️ 区间必须**恰好**是这一个函数体：下一个函数（redrawOverlay）里按页平移是合法的，
    // 区间取宽了会冤报（第一次就写成了到 drawLiveSegment，跨过了整整一个函数）。
    const from = src.indexOf('const drawStrokePts')
    const to = src.indexOf('const redrawOverlay', from)
    expect(from).toBeGreaterThan(-1)
    expect(to).toBeGreaterThan(from)
    expect(src.slice(from, to)).not.toContain('translate(')
  })
})
