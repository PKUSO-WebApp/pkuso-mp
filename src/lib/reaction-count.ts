/** 数据库列是 int4；计数上限与它保持一致。 */
export const REACTION_INT_MAX = 2147483647

/**
 * 点赞/送花计数的展示格式：
 *   · < 1000        → 原样（0 / 999）
 *   · < 1,000,000   → x.xxk（截断到两位小数，999999 → 999.99k，不出现 1000.00k）
 *   · < 1e9         → x.xxm
 *   · 其余          → x.xxb（int4 max ≈ 2.15b）
 *
 * 负数/非数字按 0；超过 int4 max 的值按上限截断，与服务端上限一致。
 */
export function formatReactionCount(value: number | null | undefined): string {
  const raw = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : 0
  const n = Math.max(0, Math.min(raw, REACTION_INT_MAX))
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${truncate2(n / 1_000)}k`
  if (n < 1_000_000_000) return `${truncate2(n / 1_000_000)}m`
  return `${truncate2(n / 1_000_000_000)}b`
}

/** 截断（不是四舍五入）：999999 必须留在 k 档，不能进位成 1000.00k */
function truncate2(n: number): string {
  return (Math.floor(n * 100) / 100).toFixed(2)
}
