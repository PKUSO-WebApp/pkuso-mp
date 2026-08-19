import type { AttendanceStatus } from '@/types/database'
import { parseLocalISO } from '@/lib/date-utils'

/** 签到宽限期：开始时间后多少分钟内签到记为出席 */
export const SIGN_IN_GRACE_MINUTES = 15

/** 签到窗口：开始时间前多少分钟内允许签到 */
export const SIGN_IN_WINDOW_BEFORE_MINUTES = 30

/** 排练默认时长（end_time 缺失时按开始时间 + 3 小时计，与卡片/签到流程一致） */
const DEFAULT_DURATION_MS = 3 * 60 * 60 * 1000

/**
 * 判断当前时间是否处于签到窗口内：
 * - 已过结束时间（now > end）→ false（排练已结束）
 * - 提前开始时间超过 30 分钟（now < start - 30min）→ false（排练尚未开始）
 * - 其余时间 → true
 */
export function canSignIn(now: Date, start: Date, end: Date): boolean {
  if (now.getTime() > end.getTime()) return false
  const windowStart = start.getTime() - SIGN_IN_WINDOW_BEFORE_MINUTES * 60 * 1000
  if (now.getTime() < windowStart) return false
  return true
}

/**
 * 根据签到时间判定出勤状态：
 * - 签到时间 ≤ 开始时间 + 15分钟 → present
 * - 开始时间 + 15分钟 < 签到时间 ≤ 结束时间 → late
 * - 签到时间 > 结束时间 → absent
 */
export function judgeAttendanceStatus(signInAt: Date, start: Date, end: Date): AttendanceStatus {
  const graceEnd = start.getTime() + SIGN_IN_GRACE_MINUTES * 60 * 1000
  if (signInAt.getTime() <= graceEnd) return 'present'
  if (signInAt.getTime() <= end.getTime()) return 'late'
  return 'absent'
}

/**
 * 签到窗口判定（供卡片/详情弹窗复用，Issue #173）：
 * - 已过结束时间（now > end）→ "ended"（排练已结束）
 * - 提前超过 30 分钟（now < start - 30min）→ "not-started"（排练尚未开始）
 * - 其余（含 start_time 缺失或无法解析）→ null（签到窗口内，或无法判定）
 *
 * 原为卡片私有逻辑，详情弹窗（出勤状态判定）复用后上提至此（Issue #173 重构）。
 */
export function getSignBlockReason(
  startTime: string | null,
  endTime: string | null,
  now: Date
): 'not-started' | 'ended' | null {
  if (!startTime) return null
  const start = parseLocalISO(startTime)
  // parseLocalISO 对无法解析的字符串会退化为 1900 年附近（非 NaN），
  // 需年份守卫拦截，与 parseRehearsalTimes / isRehearsalTodayOrFuture 保持一致
  if (Number.isNaN(start.getTime()) || start.getFullYear() < 2000) return null
  const end = endTime ? parseLocalISO(endTime) : new Date(start.getTime() + DEFAULT_DURATION_MS)
  // end_time 无法解析时同样退化为 1900 年附近，视为无法判定，不得误判为已结束
  if (Number.isNaN(end.getTime()) || end.getFullYear() < 2000) return null
  if (now.getTime() > end.getTime()) return 'ended'
  if (!canSignIn(now, start, end)) return 'not-started'
  return null
}

/**
 * 签到锁定判定（Issue #141）：sign_in_time 非空即视为已签到（锁定）。
 * 用户一次签到后出勤状态在用户侧固定，不可再签到/修改——
 * 即使管理员随后把状态改为缺席/请假（sign_in_time 仍在，锁定依旧生效），
 * 规避「缺席签到 → 管理员取消 → 用户再签到」的循环。
 */
export function hasSignedIn(signInTime: string | null | undefined): boolean {
  return signInTime != null && signInTime !== ''
}

/** 「未签到」展示文案（Issue #213 对抗返工）：absent 占位行的列表标签文案。
 *  统计口径中占位行仅计入 total、不参与分类、无栏目呈现（口径见 attendance-summary.ts） */
export const UNSIGNED_LABEL = '未签到'

/**
 * 是否为 absent 占位行（Issue #213 对抗返工）：absent + 未签到 + 排练未结束。
 * 与列表展示口径同源（getAttendanceDisplay 复用本函数，见 profile 页）：
 * 占位行是新建排练的默认预生成，不构成缺勤——列表展示「未签到」；统计中仅计入
 * total、不计入任何栏目（用户指示「未签到不统计」）；排练已结束（或已签到补签）
 * 才解除占位、按原始 status 计缺勤。
 * now 可选参数：默认真实当前时间；测试可注入固定时间避免依赖运行时刻。
 */
export function isAbsentPlaceholder(
  signInTime: string | null | undefined,
  startTime: string | null,
  endTime: string | null,
  now: Date = new Date()
): boolean {
  return !hasSignedIn(signInTime) && getSignBlockReason(startTime, endTime, now) !== 'ended'
}
