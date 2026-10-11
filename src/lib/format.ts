/** 文件大小 → 人类可读（谱务文件列表共用：曲目详情 / 声部详情） */
export function formatFileSize(size: number | null | undefined): string {
  if (size == null) return ''
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`
  if (size >= 1024) return `${Math.round(size / 1024)} KB`
  return `${size} B`
}
