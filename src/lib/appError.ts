/** 读路径错误码（P2-7）：hook 只产出稳定码，页面经 tAppError() 取本地化文案，
 *  消除「数据加载失败/公告加载失败/考勤数据加载失败/通知未读数加载失败」等中文变体
 *  与 DB 原文（error.message）透传。写路径（提交/签到等需透出服务端裁决原因的）暂保留原文。 */
export const APP_ERROR = {
  /** 查询失败（网络/权限等），原始错误仅 console.error 记录 */
  loadFailed: 'loadFailed',
  /** 写操作失败（创建/更新/删除被拒） */
  saveFailed: 'saveFailed',
} as const

export type AppErrorCode = (typeof APP_ERROR)[keyof typeof APP_ERROR]

export const APP_ERROR_MESSAGE_KEY: Record<AppErrorCode, `common.errors.${AppErrorCode}`> = {
  loadFailed: 'common.errors.loadFailed',
  saveFailed: 'common.errors.saveFailed',
}

/** 错误码 → 本地化展示文案；null/undefined 原样返回（供 ListState 的 error prop） */
export function tAppError(
  t: (key: string) => string,
  code: AppErrorCode | null | undefined
): string | null {
  return code ? t(APP_ERROR_MESSAGE_KEY[code]) : null
}
