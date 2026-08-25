import type { PostType } from '@/types/database'

/**
 * 活动通知分类（阶段一：纯内容匹配，不改后端）。
 * 唯一写入方为 Web 管理端删除/锁定帖子时的固定模板（pkuso-web-v2 admin/community/[id]）：
 *   content: 你的{重奏|团建}帖子《{标题}》已被管理员删除|锁定
 * 故以锚定正则提取类型；未命中的通知返回 null，仅在「全部」tab 展示，绝不强行归类。
 * 后续若后端补 post_type 字段，此处退化为 fallback。
 */
export function classifyActivityNotification(content: string | null | undefined): PostType | null {
  const m = /^你的(重奏|团建)帖子《/.exec((content ?? '').trim())
  if (!m) return null
  return m[1] === '重奏' ? 'ensemble' : 'gathering'
}
