import { describe, expect, it } from 'vitest'
import type { AnnoDoc, AnnoStroke } from '@/lib/annotation'
import {
  inkUpdateFor,
  sameAnnoDoc,
  singleStrokeAdded,
  type InkWorld,
  type LaneSlots,
} from './anno-changes'

const stroke = (x = 0): AnnoStroke => ({
  color: '#111827',
  width: 4,
  points: [
    [x, x],
    [x + 0.1, x + 0.1],
  ],
})

const slots = (a: number | null, b: number | null, c: number | null): LaneSlots => ({ a, b, c })

/** 一个「画面世界」：默认三块分别是 1/2/3 页，视口 300×400 */
const world = (over: Partial<InkWorld> = {}): InkWorld => ({
  annos: {},
  docTick: 1,
  page: 1,
  slots: slots(1, 2, 3),
  w: 300,
  h: 400,
  penOn: true,
  gestureTick: 0,
  ...over,
})

describe('sameAnnoDoc：两份文档是不是同一份（只看引用，不扫点）', () => {
  it('同一个对象 ⇒ 同一份', () => {
    const doc: AnnoDoc = { 1: [stroke()] }
    expect(sameAnnoDoc(doc, doc)).toBe(true)
  })

  it('每页数组都是同一个引用 ⇒ 同一份（哪怕换了外层对象）', () => {
    const arr = [stroke()]
    expect(sameAnnoDoc({ 1: arr }, { 1: arr })).toBe(true)
  })

  it('有一页换了数组 ⇒ 不是同一份', () => {
    expect(sameAnnoDoc({ 1: [stroke()] }, { 1: [stroke()] })).toBe(false)
  })

  it('页数不同 ⇒ 不是同一份', () => {
    const arr = [stroke()]
    expect(sameAnnoDoc({ 1: arr }, { 1: arr, 2: [] })).toBe(false)
  })
})

describe('singleStrokeAdded：这次是不是「恰好某一页末尾多了一笔」', () => {
  it('某一页末尾多了一笔（前面每一笔都是同一个对象）⇒ 认出来', () => {
    const s1 = stroke()
    const s2 = stroke(0.5)
    expect(singleStrokeAdded({ 1: [s1] }, { 1: [s1, s2] })).toEqual({ page: 1, stroke: s2 })
  })

  it('空文档里第一笔也算（0 → 1）', () => {
    const s = stroke()
    expect(singleStrokeAdded({}, { 1: [s] })).toEqual({ page: 1, stroke: s })
  })

  it('前面某一笔换了对象（撤销 / 云端合入那一类）⇒ 不认', () => {
    const s1 = stroke()
    expect(singleStrokeAdded({ 1: [s1] }, { 1: [stroke(), stroke(0.5)] })).toBeNull()
  })

  it('一次多了两笔 ⇒ 不认', () => {
    const s = stroke()
    expect(singleStrokeAdded({ 1: [s] }, { 1: [s, stroke(0.4), stroke(0.6)] })).toBeNull()
  })

  it('两页同时多笔 ⇒ 不认', () => {
    const s = stroke()
    expect(
      singleStrokeAdded({ 1: [s], 2: [s] }, { 1: [s, stroke(0.2)], 2: [s, stroke(0.3)] })
    ).toBeNull()
  })

  it('整页没了 / 空页 → 空页 ⇒ 不认', () => {
    expect(singleStrokeAdded({ 1: [stroke()] }, {})).toBeNull()
    expect(singleStrokeAdded({}, { 1: [] })).toBeNull()
  })

  it('空白页一次来两笔 ⇒ 不认（只认 0 → 1）', () => {
    expect(singleStrokeAdded({}, { 1: [stroke(), stroke(0.5)] })).toBeNull()
  })

  it('少了一笔（撤销 / 擦除）⇒ 不认', () => {
    const s = stroke()
    expect(singleStrokeAdded({ 1: [s, stroke(0.5)] }, { 1: [s] })).toBeNull()
  })

  it('什么都没动 ⇒ 不认（返回 null，由调用方判「同一份」）', () => {
    const arr = [stroke()]
    expect(singleStrokeAdded({ 1: arr }, { 1: arr })).toBeNull()
  })

  it('⚠️ **原地改数组查不出来** —— 所以「每次改都换新对象」是这份数据的契约', () => {
    // 这条不是在测一个功能，是在钉一个**前提**：`persist` 必须每次用展开造新对象
    // （见 index.tsx 的 persist）。哪天有人改成原地 push，增量这条路会静默失效 ——
    // 失效的形态是「画面上少一笔」，所以这里把它写成一条会被看到的用例。
    const arr = [stroke()]
    const doc: AnnoDoc = { 1: arr }
    arr.push(stroke(0.5)) // 原地改：引用没变
    expect(singleStrokeAdded(doc, { 1: arr })).toBeNull()
    expect(sameAnnoDoc(doc, { 1: arr })).toBe(true)
  })
})

describe('inkUpdateFor：这次该做什么', () => {
  it('没有「之前画过什么」的记录 ⇒ 整份重画', () => {
    expect(inkUpdateFor(null, world())).toEqual({ kind: 'resync' })
  })

  it('世界没动、文档也没变 ⇒ 什么都不做', () => {
    const arr = [stroke()]
    const w = world({ annos: { 1: arr } })
    expect(inkUpdateFor(w, { ...w })).toEqual({ kind: 'none' })
  })

  it('世界没动、某页末尾多一笔、那一页正在某块上 ⇒ 只补这一笔', () => {
    const s1 = stroke()
    const s2 = stroke(0.5)
    const prev = world({ annos: { 1: [s1] }, slots: slots(1, 2, 3) })
    const now = world({ annos: { 1: [s1, s2] }, slots: slots(1, 2, 3) })
    expect(inkUpdateFor(prev, now)).toEqual({ kind: 'append', layer: 'a', stroke: s2 })
  })

  it('那一页不在任何一块上 ⇒ 什么都不做（等它被摆上来时会走 resync）', () => {
    const s1 = stroke()
    const s2 = stroke(0.5)
    const prev = world({ annos: { 5: [s1] }, slots: slots(1, 2, 3) })
    const now = world({ annos: { 5: [s1, s2] }, slots: slots(1, 2, 3) })
    expect(inkUpdateFor(prev, now)).toEqual({ kind: 'none' })
  })

  it('那不是「多一笔」的变化（撤销 / 擦除 / 清空 / 云端合入）⇒ 整份重画', () => {
    const s = stroke()
    const prev = world({ annos: { 1: [s, stroke(0.5)] } })
    const now = world({ annos: { 1: [s] } })
    expect(inkUpdateFor(prev, now)).toEqual({ kind: 'resync' })
  })

  // 世界快照少一个字段 = 该重画的时候没重画（画面会停在旧样子）⇒ 每个字段都要有用例
  it.each([
    ['换册', { docTick: 2 }],
    ['翻页', { page: 2 }],
    ['某块换了页', { slots: slots(2, 1, 3) }],
    ['换了块（同一页挪到别处）', { slots: slots(3, 2, 1) }],
    ['视口宽变了（缩放）', { w: 320 }],
    ['视口高变了', { h: 420 }],
    ['批注关了（位图随节点销毁）', { penOn: false }],
    ['双指手势结束（手势中没重画）', { gestureTick: 1 }],
  ])('世界动了 —— %s ⇒ 整份重画', (_name, over) => {
    const arr = [stroke()]
    const prev = world({ annos: { 1: arr } })
    const now = world({ annos: { 1: arr }, ...(over as Partial<InkWorld>) })
    expect(inkUpdateFor(prev, now)).toEqual({ kind: 'resync' })
  })

  it('同一页里某一笔的样式变了（不是新增）⇒ 整份重画', () => {
    const prev = world({ annos: { 1: [stroke()] } })
    const now = world({ annos: { 1: [{ ...stroke(), color: '#e5484d' }] } })
    expect(inkUpdateFor(prev, now)).toEqual({ kind: 'resync' })
  })
})
