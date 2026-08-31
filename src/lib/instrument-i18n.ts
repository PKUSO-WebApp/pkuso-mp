import { getLocale, type TFn } from '@/i18n/core'

// 规范中文名 → i18n code（与 messages/*/instruments.ts 的 key 对应）
const INSTRUMENT_CODE: Record<string, InstrumentCode> = {
  '第一小提琴': 'firstViolin',
  '第二小提琴': 'secondViolin',
  '中提琴': 'viola',
  '大提琴': 'cello',
  '低音提琴': 'doubleBass',
  '长笛': 'flute',
  '双簧管': 'oboe',
  '单簧管': 'clarinet',
  '大管': 'bassoon',
  '圆号': 'horn',
  '小号': 'trumpet',
  '长号': 'trombone',
  '大号': 'tuba',
  '打击乐': 'percussion',
  '键盘': 'keyboard',
  '竖琴': 'harp',
  '其他': 'other',
}

// 常见缩写 / 别名 → code。中文模式下保留原串（如「小提琴」保持「小提琴」），
// 仅英文模式映射到规范译名（如「小提琴」→ "2nd Violin"）。
const INSTRUMENT_ALIAS: Record<string, InstrumentCode> = {
  '小提琴': 'secondViolin',
  '中提': 'viola',
  '大提': 'cello',
  '低音提': 'doubleBass',
  '黑管': 'clarinet',
  '钢片琴': 'keyboard',
  '钢琴': 'keyboard',
  '一提': 'firstViolin',
  '二提': 'secondViolin',
  '贝斯': 'doubleBass',
  '欧宝': 'oboe',
}

// 英文名/缩略名 → code（支持在任意语言模式下用英文搜索声部）
const EN_INSTRUMENT_ALIAS: Record<string, InstrumentCode> = {
  '1st violin': 'firstViolin',
  'first violin': 'firstViolin',
  '2nd violin': 'secondViolin',
  'second violin': 'secondViolin',
  'violin': 'firstViolin',
  'viola': 'viola',
  'cello': 'cello',
  'double bass': 'doubleBass',
  'bass': 'doubleBass',
  'flute': 'flute',
  'oboe': 'oboe',
  'clarinet': 'clarinet',
  'bassoon': 'bassoon',
  'horn': 'horn',
  'trumpet': 'trumpet',
  'trombone': 'trombone',
  'tuba': 'tuba',
  'percussion': 'percussion',
  'keyboard': 'keyboard',
  'keys': 'keyboard',
  'harp': 'harp',
}

// 「小提琴」类搜索需同时匹配一提+二提的 code
const VIOLIN_CODES: InstrumentCode[] = ['firstViolin', 'secondViolin']

type InstrumentCode =
  | 'firstViolin'
  | 'secondViolin'
  | 'viola'
  | 'cello'
  | 'doubleBass'
  | 'flute'
  | 'oboe'
  | 'clarinet'
  | 'bassoon'
  | 'horn'
  | 'trumpet'
  | 'trombone'
  | 'tuba'
  | 'percussion'
  | 'keyboard'
  | 'harp'
  | 'other'

/**
 * 将后端存储的乐器/声部中文串翻译为当前语言展示名。
 * - 命中规范名：直接取对应语言译名（中文即原规范名）。
 * - 命中别名：英文映射到规范译名，中文保留原串。
 * - 均未命中：返回原串（兜底，避免未知乐器消失）。
 */
export function translateInstrument(value: string | null | undefined, t: TFn): string {
  const raw = Array.isArray(value) ? value.join('、') : (value ?? '')
  const v = raw.trim()
  if (!v) return ''
  const sep = getLocale() === 'zh-CN' ? '、' : ', '
  return v
    .split(/[、,，\s]+/)
    .map((tok) => {
      const code = INSTRUMENT_CODE[tok] ?? INSTRUMENT_ALIAS[tok]
      if (!code) return tok
      // 别名在中文模式下保持用户输入的原文
      if (INSTRUMENT_ALIAS[tok] && getLocale() === 'zh-CN') return tok
      return t(`instruments.${code}` as Parameters<TFn>[0])
    })
    .join(sep)
}

/**
 * 判断搜索词是否匹配某个声部（支持全名 + 中文缩略 + 英文缩略）。
 * 返回匹配到的声部规范中文名数组（如「小提琴」→ ['第一小提琴','第二小提琴']），未匹配返回 null。
 * 「小提琴」/「violin」同时匹配一提和二提。
 */
export function matchInstrumentSection(query: string): string[] | null {
  const q = query.trim().toLowerCase()
  if (!q) return null

  // 1. 完整中文名直接匹配
  for (const canonical of Object.keys(INSTRUMENT_CODE)) {
    if (q === canonical.toLowerCase()) return [canonical]
  }
  // 2. 中文隐性缩略名匹配
  for (const [alias, code] of Object.entries(INSTRUMENT_ALIAS)) {
    if (q === alias.toLowerCase()) {
      // 「小提琴」别名同时匹配一提+二提
      if (code === 'secondViolin' && (alias === '小提琴')) {
        return VIOLIN_CODES.map((c) => {
          for (const [name, v] of Object.entries(INSTRUMENT_CODE)) { if (v === c) return name }
          return ''
        }).filter(Boolean)
      }
      for (const [name, c] of Object.entries(INSTRUMENT_CODE)) {
        if (c === code) return [name]
      }
    }
  }
  // 3. 英文名/缩略名匹配（任意语言模式均可触发）
  const enCode = EN_INSTRUMENT_ALIAS[q]
  if (enCode) {
    // 「violin」同时匹配一提+二提
    if (enCode === 'firstViolin' && q === 'violin') {
      return VIOLIN_CODES.map((c) => {
        for (const [name, v] of Object.entries(INSTRUMENT_CODE)) { if (v === c) return name }
        return ''
      }).filter(Boolean)
    }
    for (const [name, c] of Object.entries(INSTRUMENT_CODE)) {
      if (c === enCode) return [name]
    }
  }
  return null
}
