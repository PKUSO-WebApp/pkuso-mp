/** 与 web `formatRepertoireSummary` 同一条规则：曲名 + 本次内容。 */
export type RepertoireSummaryPiece = {
  title: string
  content?: string | null
}

export function formatRepertoireSummary(pieces: RepertoireSummaryPiece[]): string {
  const normalized = pieces
    .map((piece) => {
      const title = piece.title.trim()
      const content = (piece.content ?? '').trim()
      return title ? (content ? `${title}：${content}` : title) : ''
    })
    .filter(Boolean)

  if (normalized.length === 0) return ''
  const hasContent = pieces.some((piece) => (piece.content ?? '').trim())
  return normalized.join(hasContent ? '；' : '、')
}
