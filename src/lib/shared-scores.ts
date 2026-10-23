/**
 * 共享谱列表的可见范围（UI 侧过滤；RLS 不按声部限制读取）。
 *
 * - 有 shared_score 能力（团长/admin）：全部文件；
 * - 声部长/首席：本作用域全部文件（含 0 页）+ 其他声部有笔迹的文件（只读）；
 * - 普通成员：只看有笔迹（annotated_pages > 0）的文件。
 */
export type SharedScoreScope = {
  managedSections: string[]
  canManageAll: boolean
}

export function filterSharedScoreFiles<
  T extends { annotated_pages: number | null; section: string | null },
>(files: T[], scope: SharedScoreScope): T[] {
  if (scope.canManageAll) return files
  const managed = new Set(scope.managedSections.map((s) => s.trim()).filter((s) => s.length > 0))
  return files.filter((f) => {
    if ((f.annotated_pages ?? 0) > 0) return true
    const section = (f.section ?? '').trim()
    return section.length > 0 && managed.has(section)
  })
}
