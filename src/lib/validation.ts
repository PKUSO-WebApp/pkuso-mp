/**
 * 表单校验工具（纯函数，可单测）
 */

/**
 * 手机号校验：`^1\d{10}$`（11 位、以 1 开头、数字连续无横杠）。
 *
 * 注意：这是暂时的 trade-off——只覆盖中国大陆手机号的基础格式，
 * 未校验号段合法性（如 13x/15x/18x 等）、未处理 +86 前缀或空格/横杠分隔等
 * 更复杂场景。未来如业务需要更严谨的手机号判断逻辑，应在此处迭代。
 */
export function isValidPhoneNumber(phone: string): boolean {
  return /^1\d{10}$/.test(phone.trim())
}

/**
 * 邮箱校验：本地部分 `[^\s@]+`，域名部分为「字母/数字开头结尾（可含中划线）的标签，
 * 至少一个点分标签」（对抗返工 Issue #199：拒绝连续点/首尾点，如 a@b..com、a@.com）。
 * 不做域名/邮箱存在性验证——真实性由 Supabase Auth 侧唯一约束与确认邮件兜底。
 */
export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$/.test(
    email.trim()
  )
}
