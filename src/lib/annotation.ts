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

/**
 * 批注按**账号**分目录（D16）：同一台设备换账号后，上一账号的笔迹既读不到也写不进。
 *
 * `owner` 是 auth user id；未登录时用 `guest`（分享链接直接进阅读器仍可画）。
 * 升级前的老键（`score-annotation:<fileId>`，没有 owner）只由
 * `annotation-migration` 读取一次并迁到当前账号名下，然后删除。
 */
export const GUEST_ANNO_OWNER = 'guest'

export const annoStoragePrefix = (owner: string) => `score-annotation-v2:${owner}:`

export const annoStorageKey = (owner: string, fileId: string) =>
  `${annoStoragePrefix(owner)}${fileId}`

/** D16 之前的键：仅迁移用，不要再写入 */
export const legacyAnnoStorageKey = (fileId: string) => `score-annotation:${fileId}`

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

/**
 * 这一册有没有**画得出来的**笔迹（零点笔迹不算 —— 与 `compactStroke` 同一套归一化）。
 *
 * 用途只有一个：「保存到…」面板上「是否带有批注？」那个开关能不能拨（用户 2026-10-15 定）。
 * 没有笔迹时拨到「是」只会换来一句「这份谱还没有批注」—— 不如让它根本拨不动、固定为「否」。
 *
 * ⚠️ 判据只看**本地**（`loadAnnoDoc`）。进册时本来就有一轮拉取，所以正常路径上「本地没有」
 * 就等于「哪儿都没有」；万一拉取失败而云端其实有，代价是这一次开关拨不动 ——
 * 那比「拨了才发现合成不出来」好（少一个选项 vs 骗用户一次）。
 */
export function docHasInk(doc: AnnoDoc): boolean {
  for (const key of Object.keys(doc)) {
    const strokes = doc[key]
    if (!Array.isArray(strokes)) continue
    for (const s of strokes) {
      if ((s?.points?.length ?? 0) > 0) return true
    }
  }
  return false
}

export const PEN_COLORS = ['#e5484d', '#2f6fed', '#111827', '#f5a524'] as const

/** 当前用哪支笔。橡皮擦也在里面：它和两支笔互斥，属于同一个「当前工具」 */
export type AnnoTool = 'pen' | 'highlighter' | 'eraser'

/**
 * 荧光笔的不透明度，固定 —— **不给用户调节入口**（用户 2026-10-10 定）：涂色深浅不是
 * 他要调的东西，多一个滑杆只多一件事要想。
 */
export const HIGHLIGHTER_ALPHA = 0.5

/**
 * 画笔四档（相对页宽归一化；1× 页面下 0.002 ≈ 0.7px、0.016 ≈ 5.6px）。
 *
 * ⚠️ **两条旧口径 2026-10-16 被用户改掉了，别再按旧注释当判据**：
 * ① 粗细原先是「**两支笔共用一份状态**」（切工具会互相带着走，还要一个 `effectiveWidth`
 *    把画笔钳到 8‰）；现在是**两支笔各存各的选择**（见阅读器里的 `penWidth` / `hlWidth`）。
 * ② 档位表一度两支笔共用（为了「数量一样」）；用户当天晚些又定：**画笔去掉最粗的两档**
 *    （16/24/32‰ 里去掉 24/32 —— 画笔那么粗只会糊），**荧光笔去掉最细的两档**（2/4‰）。
 *    两支笔**各四档**，数量仍然一样。
 */
export const PEN_WIDTHS = [0.002, 0.004, 0.008, 0.016] as const

/**
 * 荧光笔四档（相对页宽归一化）。在原来的 8/16/24/32‰ 基础上**整体增粗 25%**
 * ⇒ 10/20/30/40‰（用户 2026-10-16 定：涂色整条盖住，细的不好用；最细两档已去掉）。
 */
export const HIGHLIGHTER_WIDTHS = [0.01, 0.02, 0.03, 0.04] as const

/** 当前工具能选的线宽档位（橡皮擦走画笔那一份 —— 它不画墨，只要个"当前档位"） */
export function widthsFor(tool: AnnoTool): readonly number[] {
  return tool === 'highlighter' ? HIGHLIGHTER_WIDTHS : PEN_WIDTHS
}

export function loadAnnoDoc(owner: string, fileId: string): AnnoDoc {
  try {
    const raw = Taro.getStorageSync(annoStorageKey(owner, fileId))
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
export function saveAnnoDoc(owner: string, fileId: string, doc: AnnoDoc): boolean {
  try {
    Taro.setStorageSync(annoStorageKey(owner, fileId), JSON.stringify(compactDoc(doc)))
    return true
  } catch {
    // 存储满/失败不阻断绘制，仅放弃持久化——由调用方决定怎么让人看见
    return false
  }
}
