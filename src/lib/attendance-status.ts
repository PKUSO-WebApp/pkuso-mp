/**
 * 出勤状态中文文案与文字色（present 出席 / late 迟到 / absent 缺勤 / excused 请假）
 * 供 member 端多处复用（attendance-modal / rehearsal-detail-modal / profile 考勤弹窗），
 * 避免各文件重复内联导致文案漂移（Issue #201 抽取）。
 * 类型放宽为 Record<string, string>：调用方可能以未知/历史状态取值，取不到时自行兜底
 * （如显示原值或「—」）。
 */

/** 出勤状态中文文案 */
export const STATUS_LABEL: Record<string, string> = {
  present: '出席',
  late: '迟到',
  absent: '缺勤',
  excused: '请假',
}

/** 出勤状态文字色（语义 token，亮/暗双模式；配色语义与请假审批 STATUS_CHIP 一致
 *  ——成功/警告/危险/信息，此处为文字而非 chip，故只映射文字色，无背景类） */
export const STATUS_TEXT_COLOR: Record<string, string> = {
  present: 'text-success',
  late: 'text-warning',
  absent: 'text-danger',
  excused: 'text-info',
}
