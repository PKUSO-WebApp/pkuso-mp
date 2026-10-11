import Taro from '@tarojs/taro'

/** 单条批注笔迹：坐标归一化为 0~1（相对页面逻辑尺寸），随缩放等比显示 */
export type AnnoStroke = {
  color: string
  /** 线宽（相对页面宽度的归一化值） */
  width: number
  points: [number, number][]
  /**
   * 不透明度。**缺省 = 1（普通画笔）**——旧数据没有这个字段，按 1 读即可，
   * 所以加它不需要迁移。荧光笔恒为 `HIGHLIGHTER_ALPHA`。
   *
   * 它参与内容指纹（见 annotation-sync 的 pageFingerprint）：只在颜色/线宽/点上
   * 相同的两支笔不可能是同一份内容，指纹必须能分辨。
   */
  alpha?: number
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

/** 当前用哪支笔。橡皮擦也在里面：它和两支笔互斥，属于同一个「当前工具」 */
export type AnnoTool = 'pen' | 'highlighter' | 'eraser'

/**
 * 荧光笔的不透明度，固定 —— **不给用户调节入口**（用户 2026-10-10 定）：涂色深浅不是
 * 他要调的东西，多一个滑杆只多一件事要想。
 */
export const HIGHLIGHTER_ALPHA = 0.5

/** 画笔线宽两档（相对页宽归一化，1× 页面约 1.4px / 2.8px） */
export const PEN_WIDTHS = [0.004, 0.008] as const

/**
 * 荧光笔五档。粗的三档（16/24/32‰）**只给荧光笔**（用户 2026-10-10 定）：
 * 涂色本来就要整条盖住，而画笔那么粗只会糊。
 */
export const HIGHLIGHTER_WIDTHS = [0.004, 0.008, 0.016, 0.024, 0.032] as const

/** 画笔能用的最粗一档 —— 比它粗的一律按它兜底（见 effectiveWidth） */
export const PEN_MAX_WIDTH = 0.008

/** 当前工具能选的线宽档位 */
export function widthsFor(tool: AnnoTool): readonly number[] {
  return tool === 'highlighter' ? HIGHLIGHTER_WIDTHS : PEN_WIDTHS
}

/**
 * 真正落到笔迹上的线宽。
 *
 * 粗细是**两支笔共用一份状态**的（切工具时不用记两套选择），而画笔画不出 16‰ 以上
 * ⇒ 从荧光笔切回画笔时，选中的档位可能不在画笔的档位里。**按 8‰ 兜底**（用户 2026-10-10 定）。
 * 显示选中态的那一圈也要用它，否则会出现「一个档位都没选中」。
 */
export function effectiveWidth(tool: AnnoTool, width: number): number {
  return tool === 'highlighter' ? width : Math.min(width, PEN_MAX_WIDTH)
}

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

/**
 * 保存批注。**返回是否真的写进去了**（2026-10-09 补）：从前这个函数吞掉一切、返回 void，
 * 于是「存储满 / 单键超限 / 存储不可用」时，内存态照旧更新、画布照旧显示笔迹——用户看到的
 * 一切正常，退出重进却整段消失，而 `client_error_logs` 里**一条都没有**（评审抓出）。
 *
 * 上报交给调用方（阅读器）：这里不 import 上报模块——那会把这个纯存储模块拽上
 * `error-report → supabase`（缺 env 时**导入即抛**，测试直接加载不了）。
 */
export function saveAnnoDoc(fileId: string, doc: AnnoDoc): boolean {
  try {
    Taro.setStorageSync(annoStorageKey(fileId), JSON.stringify(compactDoc(doc)))
    return true
  } catch {
    // 存储满/失败不阻断绘制，仅放弃持久化——由调用方决定怎么让人看见
    return false
  }
}
