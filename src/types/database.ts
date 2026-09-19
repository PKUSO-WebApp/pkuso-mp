// ============================================================
// 便捷类型别名 —— 基于 supabase gen-types 生成的 database.types.ts
// database.types.ts 由 pnpm gen-types 生成,不要手动编辑。
// 本文件是纯手写层:下游组件从此导入,不受 gen-types 覆盖影响。
// ============================================================

import type { Database } from './database.types'

type PublicSchema = Database['public']

// ---- 表行类型 ----
export type ProfileRow = PublicSchema['Tables']['profiles']['Row']
export type RehearsalRow = PublicSchema['Tables']['rehearsals']['Row']
export type AttendanceRow = PublicSchema['Tables']['attendances']['Row']
export type AnnouncementRow = PublicSchema['Tables']['announcements']['Row']
export type PostRow = PublicSchema['Tables']['posts']['Row']
export type ScheduleRow = PublicSchema['Tables']['schedules']['Row']
export type ScheduleGroupRow = PublicSchema['Tables']['schedule_groups']['Row']
export type LeaveRequestRow = PublicSchema['Tables']['leave_requests']['Row']
export type NotificationRow = PublicSchema['Tables']['notifications']['Row']
export type FeedbackRow = PublicSchema['Tables']['feedback']['Row']

// ---- 枚举类型(从 database.types.ts Enums 派生) ----
export type ProfileStatus = PublicSchema['Enums']['profileStatus']
export type ProfileRole = PublicSchema['Enums']['profileRole']
export type PostType = PublicSchema['Enums']['postType']
export type AttendanceStatus = PublicSchema['Enums']['attendanceStatus']
export type LeaveStatus = PublicSchema['Enums']['leaveStatus']
export type NotificationCategory = PublicSchema['Enums']['notificationCategory']

// ---- Join 扩展(Supabase join 返回的嵌套对象不在生成 schema 中) ----
export type PostRowWithAuthor = PostRow & {
  profiles?: { full_name?: string | null; instrument?: string | null } | null
}
export type AttendanceRowWithUser = AttendanceRow & {
  profiles?: { full_name?: string | null; instrument?: string | null } | null
}
export type LeaveRequestWithDetails = LeaveRequestRow & {
  profiles?: { full_name?: string | null; instrument?: string | null } | null
  rehearsals?: {
    repertoire?: string | null
    title?: string | null
    start_time?: string | null
    end_time?: string | null
    location?: string | null
  } | null
}
