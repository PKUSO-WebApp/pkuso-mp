import Taro from '@tarojs/taro'

/** 单条批注笔迹：坐标归一化为 0~1（相对页面逻辑尺寸），随缩放等比显示 */
export type AnnoStroke = {
  color: string
  /** 线宽（相对页面宽度的归一化值） */
  width: number
  points: [number, number][]
}

/** 一个文件的全部批注：page(字符串页码) → 笔迹数组 */
export type AnnoDoc = Record<string, AnnoStroke[]>

export const annoStorageKey = (fileId: string) => `score-annotation:${fileId}`

/** 坐标保留 4 位小数（0.0001≈0.04px@390px 宽页，亚像素精度） */
const round4 = (n: number): number => Math.round(n * 10000) / 10000

/** 近重复点过滤阈值：与上一保留点距离小于页宽千分之一（≈0.4px@1×）则丢弃 */
const MIN_POINT_DIST = 0.001

/**
 * 压缩单笔：坐标 4 位小数 + 近重复点过滤；首点与末点必留（末点与上一保留
 * 点完全重合除外）。幂等——重复应用结果不变。
 */
export function compactStroke(stroke: AnnoStroke): AnnoStroke {
  const src = Array.isArray(stroke?.points) ? stroke.points : null
  if (!src || src.length === 0) return { ...stroke, points: [] }
  const out: [number, number][] = []
  for (let i = 0; i < src.length; i++) {
    const p: [number, number] = [round4(src[i][0]), round4(src[i][1])]
    const last = out[out.length - 1]
    if (last) {
      const isLast = i === src.length - 1
      if (isLast && p[0] === last[0] && p[1] === last[1]) continue
      if (!isLast) {
        const dx = p[0] - last[0]
        const dy = p[1] - last[1]
        if (dx * dx + dy * dy < MIN_POINT_DIST * MIN_POINT_DIST) continue
      }
    }
    out.push(p)
  }
  return { ...stroke, points: out }
}

/** 压缩整篇文档（页码 → 笔迹），坏条目降级为空数组 */
export function compactDoc(doc: AnnoDoc): AnnoDoc {
  const out: AnnoDoc = {}
  for (const key of Object.keys(doc)) {
    const strokes = doc[key]
    out[key] = Array.isArray(strokes) ? strokes.map(compactStroke) : []
  }
  return out
}

export const PEN_COLORS = ['#e5484d', '#2f6fed', '#111827', '#f5a524'] as const

/** 线宽两档（相对页宽归一化，1× 页面约 1.4px / 2.8px） */
export const PEN_WIDTHS = [0.004, 0.008] as const

export function loadAnnoDoc(fileId: string): AnnoDoc {
  try {
    const raw = Taro.getStorageSync(annoStorageKey(fileId))
    if (!raw) return {}
    const parsed = JSON.parse(raw) as AnnoDoc
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return compactDoc(parsed)
  } catch {
    return {}
  }
}

export function saveAnnoDoc(fileId: string, doc: AnnoDoc): void {
  try {
    Taro.setStorageSync(annoStorageKey(fileId), JSON.stringify(compactDoc(doc)))
  } catch {
    // 存储满/失败不阻断绘制，仅放弃持久化
  }
}
