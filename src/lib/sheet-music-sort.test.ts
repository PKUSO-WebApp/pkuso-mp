import { describe, expect, it } from 'vitest'
import {
  FULL_SCORE_SECTION,
  INSTRUMENT_ORDER,
  OTHER_INSTRUMENT_GROUP,
} from '@/constants/instruments'
import { compareFiles, sectionSortKey, sortPartsForDisplay } from '@/lib/sheet-music-sort'

/**
 * 排序契约（pkuso-web#289，与 pkuso-web sort-parts.test.ts 同款）：
 * 声部按 INSTRUMENT_ORDER、**总谱最前**、**其他最后**；同声部内按乐器拼音；
 * 同乐器内按第一个分声部号、**没有号的最前**。
 */

type TestFile = { instrument: string | null; sub_parts: number[] }
const file = (instrument: string | null, sub_parts: number[]): TestFile => ({
  instrument,
  sub_parts,
})
const part = (section: string, files: TestFile[] = []) => ({ section, files })
const sectionsOf = (parts: { section: string }[]) => parts.map((p) => p.section)
const instrumentsOf = (files: { instrument: string | null }[]) => files.map((f) => f.instrument)

describe('sectionSortKey', () => {
  it('总谱最前，其余按 INSTRUMENT_ORDER', () => {
    expect(sectionSortKey(FULL_SCORE_SECTION)).toBeLessThan(sectionSortKey(INSTRUMENT_ORDER[0]))
    expect(sectionSortKey(INSTRUMENT_ORDER[0])).toBeLessThan(sectionSortKey(INSTRUMENT_ORDER[1]))
    expect(sectionSortKey(INSTRUMENT_ORDER[5])).toBeLessThan(sectionSortKey(INSTRUMENT_ORDER[6]))
  })

  it('「其他」与未知值排在所有标准声部之后', () => {
    const last = sectionSortKey(OTHER_INSTRUMENT_GROUP)
    expect(last).toBeGreaterThan(sectionSortKey(INSTRUMENT_ORDER[INSTRUMENT_ORDER.length - 1]))
    expect(sectionSortKey('')).toBe(last)
    expect(sectionSortKey('木管')).toBe(last)
    expect(sectionSortKey('   ')).toBe(last)
  })

  it('声部名首尾空白被 trim（" 长笛 " 落回长笛档，不是「未知」）', () => {
    expect(sectionSortKey(' 长笛 ')).toBe(sectionSortKey('长笛'))
    expect(sectionSortKey('\t圆号　')).toBe(sectionSortKey('圆号'))
  })

  it('16 个声部的顺序是跨仓契约（后端 prompt 词表与它逐字同序）', () => {
    expect([...INSTRUMENT_ORDER]).toEqual([
      '第一小提琴',
      '第二小提琴',
      '中提琴',
      '大提琴',
      '低音提琴',
      '长笛',
      '双簧管',
      '单簧管',
      '大管',
      '圆号',
      '小号',
      '长号',
      '大号',
      '打击乐',
      '键盘',
      '竖琴',
    ])
  })
})

describe('compareFiles', () => {
  it('先按乐器名拼音', () => {
    const files = [file('钟琴', []), file('定音鼓', []), file('木琴', [])]
    const sorted = [...files].sort(compareFiles)
    // d < m < zh
    expect(instrumentsOf(sorted)).toEqual(['定音鼓', '木琴', '钟琴'])
  })

  it('拼音要真的是拼音——用码点序与拼音序相反的名字对（均取自线上真实数据）', () => {
    // 长笛(changdi) < 短笛(duandi)：码点序 长 U+957F > 短 U+77ED，方向相反
    expect(instrumentsOf([file('短笛', []), file('长笛', [])].sort(compareFiles))).toEqual([
      '长笛',
      '短笛',
    ])
    // 长号(changhao) < 低音长号(diyinchanghao)
    expect(instrumentsOf([file('低音长号', []), file('长号', [])].sort(compareFiles))).toEqual([
      '长号',
      '低音长号',
    ])
    // 拉丁开头的中文名：A调(atiao…) < 降E调(jiangetiao…)——ICU 会把这类名字排到
    // 所有中文名之后，正是不能换回 Intl.Collator 的原因
    expect(
      instrumentsOf([file('降E调单簧管', []), file('A调单簧管', [])].sort(compareFiles))
    ).toEqual(['A调单簧管', '降E调单簧管'])
  })

  it('同乐器再按第一个分声部号；没有号的（空数组）排最前（0 哨兵）', () => {
    const files = [file('圆号', [4]), file('圆号', [2]), file('圆号', [1, 3])]
    expect([...files].sort(compareFiles).map((f) => f.sub_parts)).toEqual([[1, 3], [2], [4]])

    const mixed = [file('木琴', [3]), file('木琴', []), file('木琴', []), file('木琴', [1])]
    expect([...mixed].sort(compareFiles).map((f) => f.sub_parts)).toEqual([[], [], [1], [3]])
  })

  it('只有第一个号参与比较（多号文件按最小的那个定位）', () => {
    const files = [file('圆号', [2, 3, 4]), file('圆号', [1, 9])]
    expect([...files].sort(compareFiles).map((f) => f.sub_parts)).toEqual([[1, 9], [2, 3, 4]])
  })

  it('乐器名为 NULL 不抛错，按空串参与比较（排最前）', () => {
    const files = [file('圆号', []), file(null, [])]
    expect(instrumentsOf([...files].sort(compareFiles))).toEqual([null, '圆号'])
  })
})

describe('sortPartsForDisplay', () => {
  it('总谱第一、其他最后，中间按 INSTRUMENT_ORDER', () => {
    const parts = [
      part(OTHER_INSTRUMENT_GROUP),
      part('圆号'),
      part(FULL_SCORE_SECTION),
      part('第一小提琴'),
    ]
    expect(sectionsOf(sortPartsForDisplay(parts))).toEqual([
      FULL_SCORE_SECTION,
      '第一小提琴',
      '圆号',
      OTHER_INSTRUMENT_GROUP,
    ])
  })

  it('同时排好每个声部里的文件（三级排序一次到位）', () => {
    const parts = [part('圆号', [file('圆号', [4]), file('圆号', []), file('圆号', [1])])]
    expect(sortPartsForDisplay(parts)[0].files.map((f) => f.sub_parts)).toEqual([[], [1], [4]])
  })

  it('不修改入参——调用方是 React state，原地排序会让引用比较失效', () => {
    const parts = [
      part(OTHER_INSTRUMENT_GROUP, [file('木琴', [1])]),
      part('圆号', [file('圆号', [1])]),
    ]
    const out = sortPartsForDisplay(parts)
    expect(sectionsOf(parts)).toEqual([OTHER_INSTRUMENT_GROUP, '圆号'])
    expect(out).not.toBe(parts)
    for (const section of [OTHER_INSTRUMENT_GROUP, '圆号']) {
      const before = parts.find((p) => p.section === section)!
      const after = out.find((p) => p.section === section)!
      expect(after.files, `${section} 的文件数组应是新数组`).not.toBe(before.files)
      expect(after.files[0], `${section} 的文件对象可复用（只换容器）`).toBe(before.files[0])
      expect(after, `${section} 的声部对象应是新对象`).not.toBe(before)
    }
  })

  it('空列表不抛错', () => {
    expect(sortPartsForDisplay([])).toEqual([])
  })

  it('排序是稳定的：同档同乐器的保持传入顺序（传入序 = created_at，确定不跳）', () => {
    const parts = [part('圆号', [file('圆号', [1]), file('圆号', [1])])]
    const out = sortPartsForDisplay(parts)[0].files
    expect(out).toHaveLength(2)
    expect(out[0]).toBe(parts[0].files[0])
    expect(out[1]).toBe(parts[0].files[1])
  })
})
