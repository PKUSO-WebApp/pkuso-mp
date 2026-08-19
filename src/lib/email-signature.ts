/**
 * app_settings 键值表中的邮件签名 key。
 * 该表仅允许 service role（API route）访问，客户端不可见；
 * 设置/读取入口见 src/app/api/admin/settings/route.ts。
 */
export const EMAIL_SIGNATURE_KEY = 'email_signature'

/**
 * 邮件签名最大长度（字符数）。
 * 签名是邮件落款短文本，超长可能导致 SMTP/Resend 拒收、全团通知失败，
 * 因此 PUT 保存时校验 + 前端 textarea maxLength 双重限制。
 */
export const EMAIL_SIGNATURE_MAX_LENGTH = 500

/**
 * 邮件签名默认兜底文案：app_settings 未设置 email_signature（或读取失败）时，
 * 排练通知邮件落款使用此文案。
 */
export const DEFAULT_EMAIL_SIGNATURE = '北京大学交响乐团管理团队'
