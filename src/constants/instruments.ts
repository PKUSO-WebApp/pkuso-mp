/** 乐团声部展示顺序:严格按此顺序分组,命中者各成一组,未命中归入「其他」 */
export const INSTRUMENT_ORDER = [
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
] as const

export type Instrument = (typeof INSTRUMENT_ORDER)[number]

export const OTHER_INSTRUMENT_GROUP = '其他'

/**
 * 「总谱」——整份谱（所有声部都在里面）的标记，**不是声部**，刻意不进 INSTRUMENT_ORDER
 * （那张表是成员分声部用的）。谱务里可作为 sheet_music_parts.section 的值存在；
 * 详情页排序把它放**最前**（契约见 pkuso-web#289 / src/lib/sheet-music-sort.ts）。
 */
export const FULL_SCORE_SECTION = '总谱'

/** 声部组：用于分排创建时的联想列表分组、小程序端显示声部组名 */
export const SECTION_GROUPS = {
  弦乐: ['第一小提琴', '第二小提琴', '中提琴', '大提琴', '低音提琴'],
  木管: ['大管', '双簧管', '长笛', '单簧管'],
  铜管: ['小号', '长号', '圆号', '大号'],
  管乐: ['大管', '双簧管', '长笛', '单簧管', '小号', '长号', '圆号', '大号'],
} as const

export type SectionGroup = keyof typeof SECTION_GROUPS

/** 扁平化的所有声部列表（用于联想搜索） */
export const ALL_SECTIONS = Object.values(SECTION_GROUPS).flat() as readonly string[]

/** 给定具体声部列表，返回最匹配的声部组名 */
export function getSectionGroupLabel(targets: string[]): string {
  if (targets.length === 0) return '全团'
  // 反查：找到包含所有 targets 的最小声部组
  for (const [group, members] of Object.entries(SECTION_GROUPS)) {
    if (targets.every((t) => (members as readonly string[]).includes(t))) return group
  }
  // 无法匹配到单一组时，用顿号连接
  return targets.join('、')
}
