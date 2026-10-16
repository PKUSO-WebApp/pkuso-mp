import { describe, expect, it } from 'vitest'
import { keepInkOnCancel } from './stroke-cancel'

describe('keepInkOnCancel：平台把触摸抢走时，留不留这一笔', () => {
  it('平台 touch-cancel + 全程单指 ⇒ 保留（手一直没离开过，那就是他要画的线）', () => {
    expect(keepInkOnCancel('touch-cancel', 1)).toBe(true)
  })

  it('平台 touch-cancel、但期间落过第二触点 ⇒ 丢弃（画到哪儿为止有歧义）', () => {
    expect(keepInkOnCancel('touch-cancel', 2)).toBe(false)
    expect(keepInkOnCancel('touch-cancel', 3)).toBe(false)
  })

  // ⚠️ 下面每一条都是**我们自己**结束的：一条都不能被误判成「保留」，
  // 否则「换页 / 换册时留下半截线」这类事故会重新出现
  it.each([
    'new-stroke',
    'two-fingers',
    'toggle-pen',
    'change-file',
    'no-live-layer',
    'begin-stroke-failed',
    'begin-erase',
    'begin-erase-failed',
  ])('%s（我们自己的原因）⇒ 丢弃', (reason) => {
    expect(keepInkOnCancel(reason, 1)).toBe(false)
  })
})
