import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ANNO_PENDING_KEY,
  EMPTY_FP,
  annoConflictKey,
  annoSyncKey,
  clearAnnoPending,
  clearConflictPage,
  contentCovers,
  isAnnoPending,
  listAnnotatedFileIds,
  loadConflicts,
  loadSyncBase,
  markAnnoPending,
  mergeStrokes,
  pageFingerprint,
  planSync,
  saveConflicts,
  saveSyncBase,
  strokeKey,
  type BaseEntry,
  type RemotePage,
  type SyncBase,
} from './annotation-sync'
import type { AnnoDoc, AnnoStroke } from './annotation'

const storage = new Map<string, string>()

vi.mock('@tarojs/taro', () => ({
  default: {
    getStorageSync: (key: string) => storage.get(key) ?? '',
    setStorageSync: (key: string, value: unknown) => {
      storage.set(key, value as string)
    },
    removeStorageSync: (key: string) => {
      storage.delete(key)
    },
    getStorageInfoSync: () => ({ keys: [...storage.keys()] }),
  },
}))

const stroke = (x: number, y = 0.5, color = '#e5484d'): AnnoStroke => ({
  color,
  width: 0.004,
  points: [
    [x, y],
    [x + 0.1, y],
  ],
})

const doc = (pages: Record<string, AnnoStroke[]>): AnnoDoc => pages

/** 服务端一行（新版：带 version） */
const row = (
  page: number,
  strokes: AnnoStroke[],
  version: string | null = `v${page}`
): RemotePage => ({
  page,
  strokes,
  version,
  updatedAt: 0,
})

const entry = (strokes: AnnoStroke[], version?: string): BaseEntry =>
  version === undefined
    ? { fp: pageFingerprint(strokes) }
    : { fp: pageFingerprint(strokes), version }

const baseWith = (page: number, strokes: AnnoStroke[], version?: string): SyncBase => ({
  [String(page)]: entry(strokes, version),
})

beforeEach(() => {
  storage.clear()
})

describe('pageFingerprint', () => {
  it('同一内容指纹相同', () => {
    expect(pageFingerprint([stroke(0.1)])).toBe(pageFingerprint([stroke(0.1)]))
  })

  it('顺序敏感：交换两笔要算出不同的指纹', () => {
    const a = pageFingerprint([stroke(0.1), stroke(0.2)])
    const b = pageFingerprint([stroke(0.2), stroke(0.1)])
    expect(a).not.toBe(b)
  })

  it('内容差一点（坐标、颜色、线宽）都要变', () => {
    const base = pageFingerprint([stroke(0.1)])
    expect(pageFingerprint([stroke(0.1, 0.6)])).not.toBe(base)
    expect(pageFingerprint([stroke(0.1, 0.5, '#2f6fed')])).not.toBe(base)
    expect(pageFingerprint([{ ...stroke(0.1), width: 0.008 }])).not.toBe(base)
  })

  it('先压缩再算：内存里的原始触点与落盘后的压缩结果必须同指纹', () => {
    // 这正是「不压缩就会每次进册白推一次」那个坑的判据
    const raw: AnnoStroke = {
      color: '#e5484d',
      width: 0.004,
      points: [
        [0.123456789, 0.5],
        [0.123457, 0.5000001], // 近重复点，压缩时会被丢掉
        [0.2, 0.6],
      ],
    }
    expect(pageFingerprint([raw])).toBe(
      pageFingerprint([
        {
          ...raw,
          points: [
            [0.1235, 0.5],
            [0.2, 0.6],
          ],
        },
      ])
    )
  })

  it('只有不透明度不同也算改过（荧光笔与画笔不是同一份内容）', () => {
    const pen = [{ ...stroke(0.1), alpha: undefined }]
    const marker = [{ ...stroke(0.1), alpha: 0.5 }]
    expect(pageFingerprint(pen)).not.toBe(pageFingerprint(marker))
    // 缺省与显式 1 等价：旧数据没有这个字段，不能因为补了默认值就被判成「改过」
    expect(pageFingerprint([{ ...stroke(0.1), alpha: 1 }])).toBe(pageFingerprint(pen))
  })

  it('空页 / 没有笔迹 / 零点的笔迹，指纹都是 EMPTY_FP', () => {
    expect(pageFingerprint([])).toBe(EMPTY_FP)
    expect(pageFingerprint([{ color: '#111827', width: 0.004, points: [] }])).toBe(EMPTY_FP)
  })

  it('坏输入降级成空页，不抛', () => {
    expect(pageFingerprint(undefined as unknown as AnnoStroke[])).toBe(EMPTY_FP)
  })
})

describe('包含关系（自动裁决的唯一依据）', () => {
  it('超集包含子集；一笔之差就不算包含', () => {
    expect(contentCovers([stroke(0.1)], [stroke(0.1), stroke(0.2)])).toBe(true)
    expect(contentCovers([stroke(0.1), stroke(0.2)], [stroke(0.1)])).toBe(false)
    // 空集被任何内容包含（「这一边什么都没有」不该挡住自动裁决）
    expect(contentCovers([], [stroke(0.1)])).toBe(true)
    expect(contentCovers([], [])).toBe(true)
  })

  it('⚠️ 按**份数**比而不是按集合：同一笔少画一遍也算「不含」', () => {
    // 按集合比会把「擦掉一遍重复的笔迹」也算成包含 ⇒ 那等于静默丢一笔
    expect(contentCovers([stroke(0.1), stroke(0.1)], [stroke(0.1)])).toBe(false)
    expect(contentCovers([stroke(0.1)], [stroke(0.1), stroke(0.1)])).toBe(true)
  })

  it('零点笔迹与指纹同源：它不参与包含判定', () => {
    const empty: AnnoStroke = { color: '#111827', width: 0.004, points: [] }
    expect(strokeKey(empty)).toBeNull()
    expect(contentCovers([empty], [])).toBe(true)
  })

  it('归一化同源：未压缩的原始触点与压缩后的同一笔互相包含', () => {
    const raw: AnnoStroke = {
      color: '#e5484d',
      width: 0.004,
      points: [
        [0.10000001, 0.5],
        [0.2, 0.5],
      ],
    }
    const packed: AnnoStroke = {
      color: '#e5484d',
      width: 0.004,
      points: [
        [0.1, 0.5],
        [0.2, 0.5],
      ],
    }
    expect(contentCovers([raw], [packed])).toBe(true)
    expect(contentCovers([packed], [raw])).toBe(true)
  })
})

describe('mergeStrokes（「合并两版」取并集）', () => {
  it('两边各自独有的笔都留下，本地在前、远端在后', () => {
    const a = stroke(0.1)
    const b = stroke(0.6)
    expect(mergeStrokes([a], [b])).toEqual([a, b])
  })

  it('⚠️ 两端都有的同一笔只留一条（否则半透明荧光笔叠起来深一层）', () => {
    const same = stroke(0.3, 0.4, '#f5d90a')
    // 两版的数据分别读自本地与远端 ⇒ 必然是**不同对象、相同内容**：判重必须看内容
    const copy: AnnoStroke = { ...same, points: same.points.map((p) => [p[0], p[1]]) }
    expect(mergeStrokes([same], [copy])).toEqual([same])
  })

  it('零点笔迹不占位（与指纹 / 包含关系同一套归一化）', () => {
    const empty: AnnoStroke = { color: '#e5484d', width: 0.004, points: [] }
    expect(mergeStrokes([empty], [empty])).toEqual([])
  })

  it('两版都空 ⇒ 空', () => {
    expect(mergeStrokes([], [])).toEqual([])
  })
})

describe('planSync', () => {
  const L = [stroke(0.1)]
  const R = [stroke(0.9)]
  const BOTH = [stroke(0.1), stroke(0.9)]
  const other = [stroke(0.5)]

  it('只有本地变（远端 == 基线）⇒ 上传，expected 取基线里记的版本', () => {
    const plan = planSync(doc({ '1': L }), baseWith(1, R, 'v9'), [row(1, R, 'v9')])
    expect(plan.toPush.map((p) => p.page)).toEqual([1])
    expect(plan.toPush[0].strokes).toEqual(L)
    expect(plan.toPush[0].expected).toBe('v9')
    expect(plan.toAdopt).toEqual([])
    expect(plan.conflicts).toEqual([])
  })

  it('⚠️ 基线里没有版本（本机制之前的老数据）⇒ expected = null（无条件写，不挡）', () => {
    const plan = planSync(doc({ '1': L }), baseWith(1, R), [row(1, R)])
    expect(plan.toPush.map((p) => p.page)).toEqual([1])
    expect(plan.toPush[0].expected).toBeNull()
  })

  it('⚠️ 首次写（远端没有这一页）⇒ expected = 空串（期望「这一页还不存在」）', () => {
    const plan = planSync(doc({ '1': L }), {}, [])
    expect(plan.toPush.map((p) => p.page)).toEqual([1])
    expect(plan.toPush[0].expected).toBe('')
  })

  it('只有远端变（本地 == 基线）⇒ 落回本地，并带上远端版本', () => {
    const plan = planSync(doc({ '1': L }), baseWith(1, L, 'v1'), [row(1, R, 'v2')])
    expect(plan.toAdopt.map((p) => p.page)).toEqual([1])
    expect(plan.toAdopt[0].strokes).toEqual(R)
    expect(plan.toAdopt[0].version).toBe('v2')
    expect(plan.toPush).toEqual([])
  })

  it('⚠️ 两边都改、互不包含 ⇒ 冲突：**两边都不动**（不再替用户按时间选一个）', () => {
    const plan = planSync(doc({ '1': L }), baseWith(1, other, 'v1'), [row(1, R, 'v2')])
    expect(plan.conflicts).toEqual([1])
    expect(plan.toPush).toEqual([])
    expect(plan.toAdopt).toEqual([])
    expect(plan.autoMerged).toEqual([])
  })

  it('⚠️ 远端 ⊆ 本地 ⇒ 自动推（用刚读到的远端版本 CAS），不弹窗', () => {
    // 另一台设备在我画的基础上又画了几笔，而我这边是它的超集
    const plan = planSync(doc({ '1': BOTH }), baseWith(1, other, 'v1'), [row(1, L, 'v2')])
    expect(plan.conflicts).toEqual([])
    expect(plan.toPush.map((p) => p.page)).toEqual([1])
    expect(plan.toPush[0].expected).toBe('v2')
    expect(plan.autoMerged).toEqual([{ page: 1, took: 'local' }])
  })

  it('⚠️ 「一边擦空」不算包含：基线证明这一页原本有内容 ⇒ 交用户选，不替他撤销擦除', () => {
    // 我这一页擦空了、别人在这一页上又画了 —— 空集被一切内容包含，
    // 按包含关系判就会「收下远端」= 把用户的擦除悄悄恢复（方案 §4：这种只能问）
    const localErased = planSync(doc({ '1': [] }), baseWith(1, [stroke(0.5)], 'v1'), [
      row(1, [stroke(0.5), stroke(0.9)], 'v2'),
    ])
    expect(localErased.conflicts).toEqual([1])
    expect(localErased.toAdopt).toEqual([])
    expect(localErased.toPush).toEqual([])
    expect(localErased.autoMerged).toEqual([])

    // 反方向同理：远端被擦空、本地有内容 ⇒ 也不许自动推上去（那等于替另一台撤销擦除）
    const remoteErased = planSync(
      doc({ '1': [stroke(0.5), stroke(0.9)] }),
      baseWith(1, [stroke(0.5)], 'v1'),
      [row(1, [], 'v2')]
    )
    expect(remoteErased.conflicts).toEqual([1])
    expect(remoteErased.toAdopt).toEqual([])
    expect(remoteErased.toPush).toEqual([])
  })

  it('基线里这一页本来就是空的 ⇒ 「一边擦空」不成立，照旧按包含关系自动裁决', () => {
    // 原本就空的页不可能「被擦掉」⇒ 两边都动过时仍按包含关系走（不因为「空」就一律弹窗）
    const plan = planSync(doc({ '1': [stroke(0.1)] }), baseWith(1, [], 'v1'), [
      row(1, [stroke(0.1), stroke(0.2)], 'v2'),
    ])
    expect(plan.conflicts).toEqual([])
    expect(plan.autoMerged).toEqual([{ page: 1, took: 'remote' }])
  })

  it('⚠️ 本地 ⊆ 远端 ⇒ 自动收下远端（本地那几笔远端都有，什么都没丢）', () => {
    const plan = planSync(doc({ '1': L }), baseWith(1, other, 'v1'), [row(1, BOTH, 'v2')])
    expect(plan.conflicts).toEqual([])
    expect(plan.toAdopt.map((p) => p.page)).toEqual([1])
    expect(plan.toAdopt[0].strokes).toEqual(BOTH)
    expect(plan.autoMerged).toEqual([{ page: 1, took: 'remote' }])
  })

  it('两边都改、内容恰好一样 ⇒ inSync（不算冲突）', () => {
    const plan = planSync(doc({ '1': L }), baseWith(1, other, 'v1'), [row(1, L, 'v2')])
    expect(plan.inSync.map((p) => p.page)).toEqual([1])
    expect(plan.inSync[0].version).toBe('v2')
    expect(plan.conflicts).toEqual([])
  })

  it('两边一致 ⇒ inSync（哪怕基线是别的、或压根没有基线）', () => {
    const plan = planSync(doc({ '1': L }), baseWith(1, R, 'v1'), [row(1, L, 'v2')])
    expect(plan.inSync.map((p) => p.page)).toEqual([1])
    const noBase = planSync(doc({ '1': L }), {}, [row(1, L, 'v2')])
    expect(noBase.inSync.map((p) => p.page)).toEqual([1])
  })

  it('没有基线时按包含关系定向（一边有内容一边空）', () => {
    const push = planSync(doc({ '1': L }), {}, [])
    expect(push.toPush.map((p) => p.page)).toEqual([1])

    const adopt = planSync(doc({}), {}, [row(1, R)])
    expect(adopt.toAdopt.map((p) => p.page)).toEqual([1])
  })

  it('没有基线、两边都有内容且互不包含 ⇒ 冲突（不敢猜谁新）', () => {
    const plan = planSync(doc({ '1': L }), {}, [row(1, R)])
    expect(plan.conflicts).toEqual([1])
    expect(plan.toPush).toEqual([])
    expect(plan.toAdopt).toEqual([])
  })

  it('本地整页擦空也要推（擦除是「这一页少了几笔」，不是删除操作）', () => {
    const plan = planSync(doc({ '1': [] }), baseWith(1, L, 'v1'), [row(1, L, 'v1')])
    expect(plan.toPush.map((p) => p.page)).toEqual([1])
    expect(plan.toPush[0].strokes).toEqual([])
    expect(plan.toPush[0].expected).toBe('v1')
  })

  it('远端为空、本地有内容、基线也空 ⇒ 本地是新增，上传', () => {
    const plan = planSync(doc({ '1': L }), baseWith(1, [], 'v1'), [])
    expect(plan.toPush.map((p) => p.page)).toEqual([1])
    expect(plan.toPush[0].expected).toBe('v1')
  })

  it('基线里那一页现在两边都没了 ⇒ inSync，不产生任何动作', () => {
    const plan = planSync(doc({}), baseWith(1, L, 'v1'), [])
    expect(plan.inSync.map((p) => p.page)).toEqual([1])
    expect(plan.toPush).toEqual([])
    expect(plan.toAdopt).toEqual([])
  })

  it('页码取并集：本地 / 基线 / 远端各自独有的页都要参与判定', () => {
    const plan = planSync(doc({ '1': L, '2': L }), { '1': entry(L, 'v1'), '3': entry(L, 'v1') }, [
      row(2, L, 'v2'),
      row(3, BOTH, 'v2'),
    ])
    // 1：本地有内容且 == 基线，远端「没有行」= 空 ⇒ 远端变成了空、本地没变 ⇒ 收下（清掉）
    expect(plan.toAdopt.map((p) => p.page)).toEqual([1])
    // 2：本地有内容、远端也有同样的内容 ⇒ 无事
    expect(plan.inSync.map((p) => p.page)).toEqual([2])
    // 3：基线说这一页有内容，而本地这一页**空了**（擦掉 / 本机丢过数据），远端还长了内容
    //    ⇒ 空集不算包含 ⇒ 冲突（不能让「收下远端」把本地那一页的消失无声地反转回去）
    expect(plan.conflicts).toEqual([3])
    expect(plan.autoMerged).toEqual([])
  })

  it('坏页码的键被忽略，不参与也不炸', () => {
    const plan = planSync(doc({ '0': L, abc: L, '-3': L }), { '0': entry(L), abc: entry(L) }, [])
    expect(plan.toPush).toEqual([])
    expect(plan.toAdopt).toEqual([])
    expect(plan.inSync).toEqual([])
    expect(plan.conflicts).toEqual([])
  })

  it('服务端没给版本（异常形态）⇒ 当成没有版本，而不是把 undefined 当期望值', () => {
    const plan = planSync(doc({ '1': L }), baseWith(1, R, 'v9'), [row(1, R, null)])
    expect(plan.toPush[0].expected).toBe('v9')
    // 远端那一页没有版本 ⇒ 收下时基线里的版本也得是「空」，否则下一次会拿它去 CAS
    const adopt = planSync(doc({ '1': L }), baseWith(1, L, 'v9'), [row(1, R, null)])
    expect(adopt.toAdopt[0].version).toBeNull()
  })
})

describe('同步记账的读写', () => {
  it('基线往返（带版本）', () => {
    expect(loadSyncBase('f1', 'u1')).toEqual({})
    expect(
      saveSyncBase('f1', 'u1', { '1': { fp: 'aaa', version: 'v1' }, '2': { fp: 'bbb' } })
    ).toBe(true)
    expect(loadSyncBase('f1', 'u1')).toEqual({
      '1': { fp: 'aaa', version: 'v1' },
      '2': { fp: 'bbb' },
    })
    expect(annoSyncKey('u1', 'f1')).toBe('score-annotation-sync-v2:u1:f1')
  })

  it('⭐ 旧版基线（纯字符串表）读得进来：补成 { fp }（version 缺 = 本机制之前的老数据）', () => {
    storage.set(annoSyncKey('u1', 'f1'), JSON.stringify({ userId: 'u1', base: { '1': 'aaa' } }))
    expect(loadSyncBase('f1', 'u1')).toEqual({ '1': { fp: 'aaa' } })
  })

  it('基线坏了当没有，不抛', () => {
    storage.set(annoSyncKey('u1', 'f1'), 'not json')
    expect(loadSyncBase('f1', 'u1')).toEqual({})
    storage.set(annoSyncKey('u1', 'f1'), '["a"]')
    expect(loadSyncBase('f1', 'u1')).toEqual({})
    storage.set(annoSyncKey('u1', 'f1'), JSON.stringify({ userId: 'u1', base: ['x'] }))
    expect(loadSyncBase('f1', 'u1')).toEqual({})
  })

  it('⚠️ 基线按账号隔离：换了账号，旧基线一律不算数', () => {
    saveSyncBase('f1', 'u1', { '1': { fp: 'aaa', version: 'v1' } })
    expect(loadSyncBase('f1', 'u1')).toEqual({ '1': { fp: 'aaa', version: 'v1' } })
    // 换账号后当成「从没同步过」⇒ 本地会被判成「本地有、远端空」而推给新账号，
    // 而不是被判成「远端删了这一页」把本地抹掉
    expect(loadSyncBase('f1', 'u2')).toEqual({})
  })

  it('冲突记录：往返 / 排序去重 / 空数组 = 删掉记录', () => {
    expect(annoConflictKey('u1', 'f1')).toBe('score-annotation-conflict-v2:u1:f1')
    expect(loadConflicts('f1', 'u1')).toEqual([])
    saveConflicts('f1', 'u1', [7, 3, 7])
    expect(loadConflicts('f1', 'u1')).toEqual([3, 7])
    saveConflicts('f1', 'u1', [])
    expect(storage.has(annoConflictKey('u1', 'f1'))).toBe(false)
    expect(loadConflicts('f1', 'u1')).toEqual([])
  })

  it('⚠️ 冲突记录也按账号隔离（换账号后不该提示上一个账号的冲突）', () => {
    saveConflicts('f1', 'u1', [3])
    expect(loadConflicts('f1', 'u2')).toEqual([])
  })

  it('冲突记录坏了当没有；摘一页只动那一页', () => {
    storage.set(annoConflictKey('u1', 'f1'), 'not json')
    expect(loadConflicts('f1', 'u1')).toEqual([])
    saveConflicts('f1', 'u1', [3, 7, 9])
    clearConflictPage('f1', 'u1', 7)
    expect(loadConflicts('f1', 'u1')).toEqual([3, 9])
    clearConflictPage('f1', 'u1', 99)
    expect(loadConflicts('f1', 'u1')).toEqual([3, 9])
  })

  it('列册只看批注键：同步键 / 冲突键 / 欠账标记都不算', () => {
    storage.set('score-annotation-v2:u1:a', '{}')
    storage.set('score-annotation-v2:u1:b', '{}')
    storage.set(annoSyncKey('u1', 'a'), '{}')
    storage.set(annoConflictKey('u1', 'b'), '{}')
    storage.set(ANNO_PENDING_KEY('u1'), 'true')
    storage.set('pkuso_error_queue', '[]')
    expect(listAnnotatedFileIds('u1').sort()).toEqual(['a', 'b'])
    // 别的账号的册不出现在这个账号的扫描结果里
    expect(listAnnotatedFileIds('u2')).toEqual([])
  })

  it('欠账标记：置位 / 读取 / 清除', () => {
    expect(isAnnoPending('u1')).toBe(false)
    markAnnoPending('u1')
    expect(isAnnoPending('u1')).toBe(true)
    expect(isAnnoPending('u2')).toBe(false)
    clearAnnoPending('u1')
    expect(isAnnoPending('u1')).toBe(false)
  })
})
