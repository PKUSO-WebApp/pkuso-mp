import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ANNO_PENDING_KEY,
  EMPTY_FP,
  annoSyncKey,
  clearAnnoPending,
  isAnnoPending,
  listAnnotatedFileIds,
  loadSyncBase,
  markAnnoPending,
  pageFingerprint,
  planSync,
  saveSyncBase,
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
    expect(pageFingerprint([raw])).toBe(pageFingerprint([{ ...raw, points: [[0.1235, 0.5], [0.2, 0.6]] }]))
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

describe('planSync', () => {
  const L = [stroke(0.1)]
  const R = [stroke(0.9)]
  const fp = pageFingerprint
  const baseWith = (page: number, strokes: AnnoStroke[]): SyncBase => ({ [String(page)]: fp(strokes) })

  it('只有本地变（远端 == 基线）⇒ 上传', () => {
    const plan = planSync(doc({ '1': L }), baseWith(1, R), [{ page: 1, strokes: R, updatedAt: 0 }])
    expect(plan.toPush.map((p) => p.page)).toEqual([1])
    expect(plan.toPush[0].strokes).toEqual(L)
    expect(plan.toAdopt).toEqual([])
    expect(plan.conflicts).toEqual([])
  })

  it('只有远端变（本地 == 基线）⇒ 落回本地', () => {
    const plan = planSync(doc({ '1': L }), baseWith(1, L), [{ page: 1, strokes: R, updatedAt: 0 }])
    expect(plan.toAdopt.map((p) => p.page)).toEqual([1])
    expect(plan.toAdopt[0].strokes).toEqual(R)
    expect(plan.toPush).toEqual([])
  })

  it('两边都变 ⇒ 按 LWW 裁决：本地那次改动更晚 ⇒ 判给本地（上传）', () => {
    const other = [stroke(0.5)]
    const remote = [{ page: 1, strokes: R, updatedAt: 1000 }]
    const plan = planSync(doc({ '1': L }), baseWith(1, other), remote, { '1': 2000 })

    expect(plan.conflicts).toEqual([1]) // 仍然上报（诊断/对账用）
    expect(plan.toPush.map((p) => p.page)).toEqual([1])
    expect(plan.lwwRemote).toEqual([])
  })

  it('两边都变 ⇒ 云端那行更晚 ⇒ 判给云端（落回本地）', () => {
    const other = [stroke(0.5)]
    const remote = [{ page: 1, strokes: R, updatedAt: 5000 }]
    const plan = planSync(doc({ '1': L }), baseWith(1, other), remote, { '1': 2000 })

    expect(plan.conflicts).toEqual([1])
    expect(plan.toAdopt.map((p) => p.page)).toEqual([1])
    expect(plan.lwwRemote).toEqual([1])
  })

  it('时刻相等 ⇒ 判给本地（用户正看着本机这份）', () => {
    const other = [stroke(0.5)]
    const remote = [{ page: 1, strokes: R, updatedAt: 3000 }]
    const plan = planSync(doc({ '1': L }), baseWith(1, other), remote, { '1': 3000 })
    expect(plan.toPush.map((p) => p.page)).toEqual([1])
  })

  it('⚠️ 缺 mtime（改动发生在本机制之前）⇒ 判给本地：否则旧数据会永久卡在冲突里', () => {
    const other = [stroke(0.5)]
    // 远端那一行看起来很新（比如刚从另一台设备推上来），但本地无从比较 —— 仍判本地，
    // 不然「推不上去、也不自愈」那种僵局解不开
    const remote = [{ page: 1, strokes: R, updatedAt: Date.now() }]
    const plan = planSync(doc({ '1': L }), baseWith(1, other), remote)
    expect(plan.toPush.map((p) => p.page)).toEqual([1])
  })

  it('两边一致 ⇒ inSync（哪怕基线是别的、或压根没有基线）', () => {
    const plan = planSync(doc({ '1': L }), baseWith(1, R), [{ page: 1, strokes: L, updatedAt: 0 }])
    expect(plan.inSync.map((p) => p.page)).toEqual([1])
    const noBase = planSync(doc({ '1': L }), {}, [{ page: 1, strokes: L, updatedAt: 0 }])
    expect(noBase.inSync.map((p) => p.page)).toEqual([1])
  })

  it('没有基线时按「哪边是空的」定向', () => {
    const push = planSync(doc({ '1': L }), {}, [])
    expect(push.toPush.map((p) => p.page)).toEqual([1])

    const adopt = planSync(doc({}), {}, [{ page: 1, strokes: R, updatedAt: 0 }])
    expect(adopt.toAdopt.map((p) => p.page)).toEqual([1])
  })

  it('没有基线、两边都有内容且不同 ⇒ 冲突（不敢猜谁新）', () => {
    const plan = planSync(doc({ '1': L }), {}, [{ page: 1, strokes: R, updatedAt: 0 }])
    expect(plan.conflicts).toEqual([1])
  })

  it('本地整页擦空也要推（擦除是「这一页少了几笔」，不是删除操作）', () => {
    const plan = planSync(doc({ '1': [] }), baseWith(1, L), [{ page: 1, strokes: L, updatedAt: 0 }])
    expect(plan.toPush.map((p) => p.page)).toEqual([1])
    expect(plan.toPush[0].strokes).toEqual([])
  })

  it('远端为空、本地有内容、基线也空 ⇒ 本地是新增，上传', () => {
    const plan = planSync(doc({ '1': L }), baseWith(1, []), [])
    expect(plan.toPush.map((p) => p.page)).toEqual([1])
  })

  it('基线里那一页现在两边都没了 ⇒ inSync，不产生任何动作', () => {
    const plan = planSync(doc({}), baseWith(1, L), [])
    expect(plan.inSync.map((p) => p.page)).toEqual([1])
    expect(plan.toPush).toEqual([])
    expect(plan.toAdopt).toEqual([])
  })

  it('页码取并集：本地 / 基线 / 远端各自独有的页都要参与判定', () => {
    const plan = planSync(
      doc({ '1': L, '2': L }),
      { '1': fp(L), '3': fp(L) },
      [
        { page: 2, strokes: L, updatedAt: 0 },
        { page: 3, strokes: R, updatedAt: 0 },
      ]
    )
    // 1：本地有内容且 == 基线，远端「没有行」= 空 ⇒ 远端变了（L → 空）、本地没变 ⇒ 落回本地（清掉）
    expect(plan.toAdopt.map((p) => p.page)).toEqual([1])
    // 2：本地有内容、远端也有同样的内容 ⇒ 无事
    expect(plan.inSync.map((p) => p.page)).toEqual([2])
    // 3：基线是 L，本地没有这一页（= 擦空）、远端改成了 R ⇒ 两边都变过 ⇒ 冲突
    expect(plan.conflicts).toEqual([3])
  })

  it('坏页码的键被忽略，不参与也不炸', () => {
    const plan = planSync(doc({ '0': L, abc: L, '-3': L }), { '0': fp(L), abc: fp(L) }, [])
    expect(plan.toPush).toEqual([])
    expect(plan.toAdopt).toEqual([])
    expect(plan.inSync).toEqual([])
    expect(plan.conflicts).toEqual([])
  })
})

describe('同步记账的读写', () => {
  it('基线往返', () => {
    expect(loadSyncBase('f1', 'u1')).toEqual({})
    expect(saveSyncBase('f1', 'u1', { '1': 'aaa', '2': 'bbb' })).toBe(true)
    expect(loadSyncBase('f1', 'u1')).toEqual({ '1': 'aaa', '2': 'bbb' })
    expect(annoSyncKey('f1')).toBe('score-annotation-sync:f1')
  })

  it('基线坏了当没有，不抛', () => {
    storage.set(annoSyncKey('f1'), 'not json')
    expect(loadSyncBase('f1', 'u1')).toEqual({})
    storage.set(annoSyncKey('f1'), '["a"]')
    expect(loadSyncBase('f1', 'u1')).toEqual({})
    storage.set(annoSyncKey('f1'), JSON.stringify({ userId: 'u1', base: ['x'] }))
    expect(loadSyncBase('f1', 'u1')).toEqual({})
  })

  it('⚠️ 基线按账号隔离：换了账号，旧基线一律不算数', () => {
    saveSyncBase('f1', 'u1', { '1': 'aaa' })
    expect(loadSyncBase('f1', 'u1')).toEqual({ '1': 'aaa' })
    // 换账号后当成「从没同步过」⇒ 本地会被判成「本地有、远端空」而推给新账号，
    // 而不是被判成「远端删了这一页」把本地抹掉
    expect(loadSyncBase('f1', 'u2')).toEqual({})
  })

  it('列册只看批注键：同步键与欠账标记都不算', () => {
    storage.set('score-annotation:a', '{}')
    storage.set('score-annotation:b', '{}')
    storage.set(annoSyncKey('a'), '{}')
    storage.set(ANNO_PENDING_KEY, 'true')
    storage.set('pkuso_error_queue', '[]')
    expect(listAnnotatedFileIds().sort()).toEqual(['a', 'b'])
  })

  it('欠账标记：置位 / 读取 / 清除', () => {
    expect(isAnnoPending()).toBe(false)
    markAnnoPending()
    expect(isAnnoPending()).toBe(true)
    clearAnnoPending()
    expect(isAnnoPending()).toBe(false)
  })
})
