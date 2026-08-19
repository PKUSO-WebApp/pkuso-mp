/**
 * 隐私掩码（Issue #193）：hide 为 true 时返回「（被隐藏）」占位文案，否则返回原值（空值显示 —）。
 * 仅成员端花名册展示使用：查看他人时按对方隐私开关掩码；查看自己时调用方传 hide=false 直接显示原值。
 * 管理员端不受隐私开关影响，不使用本函数。
 */
export function maskedValue(hide: boolean, value: string | null | undefined): string {
  return hide ? '（被隐藏）' : value?.trim() || '—'
}
