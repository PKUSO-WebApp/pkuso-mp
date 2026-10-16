import { describe, expect, it } from 'vitest'
import { touchEndAction, touchOf } from './touch-end'

const call = (o: Partial<Parameters<typeof touchEndAction>[0]>) =>
  touchEndAction({ touchesLeft: 0, changedIds: [], drawing: false, penId: null, ...o })

describe('touchEndAction（抬手这一刻该走哪条路）', () => {
  it('屏上一根手指都不剩 ⇒ 完整收尾 —— 哪怕没在画（drag 重置与 tap 分类还要走）', () => {
    expect(call({ touchesLeft: 0, changedIds: [7] })).toBe('full')
    expect(call({ touchesLeft: 0, changedIds: [], drawing: true, penId: 3 })).toBe('full')
  })

  it('⚠️ 还有别的手指，但**画的那根**抬起了 ⇒ 只收这一笔', () => {
    // 这就是「写着字、另一根手指搭在屏上」那一幕：改之前它会走 'none'，
    // 于是这一笔永远不提交（平板笔调研 §2-2）
    expect(call({ touchesLeft: 1, changedIds: [3], drawing: true, penId: 3 })).toBe('stroke-only')
  })

  it('抬起的是**别的手指** ⇒ 什么都不做（那一笔还在画）', () => {
    expect(call({ touchesLeft: 1, changedIds: [9], drawing: true, penId: 3 })).toBe('none')
  })

  it('没在画时抬起任何手指都不收笔', () => {
    expect(call({ touchesLeft: 1, changedIds: [3], drawing: false, penId: 3 })).toBe('none')
  })

  it('没记下 penId ⇒ 不认领（宁可少收，不可错收）', () => {
    expect(call({ touchesLeft: 1, changedIds: [3], drawing: true, penId: null })).toBe('none')
  })

  it('一次抬起多根手指时也认得出画的那根', () => {
    expect(call({ touchesLeft: 1, changedIds: [5, 3, 8], drawing: true, penId: 3 })).toBe('stroke-only')
  })

  it('多指起手（双指缩放）时不会被误认成收笔', () => {
    // 捏合期间 drawing 为 false（onTouchStart 双指那一支会 cancelStroke）⇒ 走 none
    expect(call({ touchesLeft: 1, changedIds: [3], drawing: false, penId: 3 })).toBe('none')
  })
})

describe('touchOf（按 identifier 挑出画的那一根）', () => {
  const t = (identifier: number) => ({ identifier })

  it('屏上多根手指时挑出指定的那根（顺序无关）', () => {
    expect(touchOf([t(9), t(3), t(8)], 3)).toEqual(t(3))
  })

  it('指定的那根已经不在 ⇒ null（不拿别人的坐标去画）', () => {
    expect(touchOf([t(9), t(8)], 3)).toBeNull()
  })

  it('没记 id 时退回「只有一根」那种情况', () => {
    expect(touchOf([t(9)], null)).toEqual(t(9))
    expect(touchOf([t(9), t(8)], null)).toBeNull()
    expect(touchOf([], null)).toBeNull()
  })
})
