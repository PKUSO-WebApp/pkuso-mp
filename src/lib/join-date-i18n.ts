import type { TFn } from '@/i18n/core'

export type JoinDateParts = { year: string; season: '春' | '秋' }

/** 解析库内规范值「YYYY春/YYYY秋」；空串/历史脏串/隐私占位返回 null */
export function parseJoinDateValue(value?: string | null): JoinDateParts | null {
  const m = /^(\d{4})(春|秋)$/.exec((value ?? '').trim())
  return m ? { year: m[1], season: m[2] as JoinDateParts['season'] } : null
}

/**
 * 入团时间展示翻译：zh「2024秋」/ en「Fall 2024」（语序随 common.joinDate.tpl 模板）。
 * 无法解析时原样返回——隐私占位「（被隐藏）」等非规范串由此兜底，不受影响。
 */
export function translateJoinDate(value?: string | null, t?: TFn): string {
  const raw = (value ?? '').trim()
  const parts = parseJoinDateValue(raw)
  if (!parts || !t) return raw
  const season = t(
    parts.season === '春' ? 'common.joinDate.season.spring' : 'common.joinDate.season.fall'
  )
  return t('common.joinDate.tpl', { year: parts.year, season })
}
