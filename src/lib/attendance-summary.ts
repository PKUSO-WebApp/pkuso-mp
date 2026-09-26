/**
 * 考勤区间统计摘要（Issue #213，需求修订后）
 *
 * 与考勤列表同源派生：直接对当前区间过滤后的考勤行计数，不额外查询。
 * 统计口径（与列表展示口径统一，占位判定共用 attendance-utils 的
 * isAbsentPlaceholder，与 getAttendanceDisplay 同源）：
 * - total 总排练数 = 区间内全部行数（含未签到/未评定行），保持用户原始语义
 *   「区间内总排练数」——total 可能大于四类之和，因未签到/未评定不参与分类；
 * - present/excused/absent/exempt 四类按展示口径计：absent 占位行（未签到 +
 *   排练未结束，列表显示「未签到」）不计入缺勤、不计入任何栏目；status 为 null
 *   （未评定/历史数据，列表显示「—」）同样不计入任何栏目——两者仅计入 total；
 * - 已结束排练的 absent（或已签到补签）占位解除，按原始 status 计入缺勤。
 * - exempt（无需出勤）由管理员设置，按原始 status 直计，不并入其他栏目。
 * - 历史数据中的 late（迟到）视为 present（出席）计入。
 */

import type { AttendanceRow } from '@/types/database'
import { isAbsentPlaceholder } from '@/lib/attendance-utils'

/** 统计栏目计数（不含 total；total 含未签到/未评定行，见文件头口径注释） */
export type AttendanceSummary = {
  total: number
  present: number
  excused: number
  absent: number
  exempt: number
}

/** 统计栏目 key（渲染统计行用；文案/颜色派生见 profile 页统计区） */
export type AttendanceSummaryKey = keyof Omit<AttendanceSummary, 'total'>

/** 已知状态白名单：只对枚举内各值（present/late/absent/excused/exempt）计数，
 *  历史 late 数据合并计入 present；未知/脏数据直接跳过，避免写入 NaN 垃圾键 */
const KNOWN_ATTENDANCE_STATUSES: ReadonlySet<string> = new Set([
  'present',
  'late',
  'absent',
  'excused',
  'exempt',
])

/** 参与统计的行（与列表同源：status/sign_in_time + join 的排练起止时间，
 *  供占位判定使用；结构是 profile 页 AttendanceWithRehearsal 的子集） */
export type AttendanceSummaryRow = Pick<AttendanceRow, 'status' | 'sign_in_time'> & {
  rehearsals?: { start_time?: string | null; end_time?: string | null } | null
}

/**
 * 单次遍历归类计数。now 可选参数透传占位判定（默认真实当前时间；
 * 测试注入固定时间，避免结果依赖运行时刻）。
 */
export function summarizeAttendance(
  rows: AttendanceSummaryRow[],
  now: Date = new Date()
): AttendanceSummary {
  const summary: AttendanceSummary = {
    total: rows.length,
    present: 0,
    excused: 0,
    absent: 0,
    exempt: 0,
  }
  for (const row of rows) {
    if (row.status === null) {
      // 未评定（历史数据等）：不计入任何栏目，仅计入 total
      continue
    }
    if (
      row.status === 'absent' &&
      isAbsentPlaceholder(
        row.sign_in_time,
        row.rehearsals?.start_time ?? null,
        row.rehearsals?.end_time ?? null,
        now
      )
    ) {
      // absent 占位行（未签到 + 排练未结束，列表显示「未签到」）：
      // 不计入缺勤、不计入任何栏目，仅计入 total
      continue
    }
    // 已评定的非占位行：按原始 status 计四类（含已结束的 absent、管理员设的 exempt）
    // 历史 late 数据合并计入 present
    if (KNOWN_ATTENDANCE_STATUSES.has(row.status)) {
      const key = row.status === 'late' ? 'present' : row.status
      summary[key] += 1
    }
  }
  return summary
}
