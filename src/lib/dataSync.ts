import { supabase } from '@/lib/supabase'
import { logDiag } from '@/lib/session-diag'

export type SyncEntity = 'rehearsals' | 'announcements' | 'notifications' | 'leave' | 'post'

// 模块内轻量事件总线：心跳检测到某实体版本变化后通知订阅者（各数据 hook 挂载时订阅，
// 收到即静默重取）。刻意不依赖 Taro.eventCenter，避免把 @tarojs/taro 引入纯逻辑 hook
// （hook 单元测试不 mock Taro，引入会崩）。
type Listener = () => void
const listeners: Record<SyncEntity, Set<Listener>> = {
  rehearsals: new Set(),
  announcements: new Set(),
  notifications: new Set(),
  leave: new Set(),
  post: new Set(),
}

export function subscribeSync(entity: SyncEntity, handler: Listener): () => void {
  listeners[entity].add(handler)
  return () => {
    listeners[entity].delete(handler)
  }
}

export function emitSync(entity: SyncEntity) {
  listeners[entity].forEach((h) => h())
}

const POLL_INTERVAL = 30_000

type Versions = {
  rehearsals: string | null
  announcements: string | null
  notificationsUnread: number | null
  leave: string | null
  post: string | null
}

let timer: ReturnType<typeof setTimeout> | null = null
let running = false
let versions: Versions | null = null
// 进程内「上次已知的全局未读数」：跨 start/stop 保留。
// 回前台首轮 tick 不发事件（versions=null 仅建基线），但未读数若与此值不同
// （后台/关闭期间管理端写入了新通知）必须立即广播，否则红点被基线吞噬、永久漏报
let lastKnownUnread: number | null = null

// 从 maybeSingle 结果中安全取出某列的时间戳（data 为具体行类型，先转 unknown 再取索引）
function pickTimestamp(row: unknown, column: string): string | null {
  if (!row) return null
  const value = (row as unknown as Record<string, unknown>)[column]
  return value == null ? null : String(value)
}

async function unreadCount(): Promise<number | null> {
  const { count, error } = await supabase
    .from('notifications')
    .select('*', { count: 'exact', head: true })
    .is('read_at', null)
  if (error) {
    logDiag('unread_count_error', { message: error.message })
    return null
  }
  return count ?? 0
}

// 心跳：对 4 张表各取「对我可见的最新版本」（RLS 已按用户过滤），与上次比对，
// 变化则广播对应事件让挂载中的页面静默重取。用迷你查询（每表至多 1 行）替代全量拉取，
// 避免每次轮询都搬运整张表；请求数与返回体都被压到最小（配合 A/B 重置计时器更省）。
async function tick() {
  if (!running) return
  try {
    const [rehearsalsRes, announcementsRes, leaveRes, postsRes] = await Promise.all([
      supabase
        .from('rehearsals')
        .select('updated_at')
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('announcements')
        .select('created_at')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('leave_requests')
        .select('updated_at')
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('posts')
        .select('created_at')
        .eq('is_locked', false)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])
    const rehearsals = rehearsalsRes.error ? null : pickTimestamp(rehearsalsRes.data, 'updated_at')
    const announcements = announcementsRes.error
      ? null
      : pickTimestamp(announcementsRes.data, 'created_at')
    const leave = leaveRes.error ? null : pickTimestamp(leaveRes.data, 'updated_at')
    const post = postsRes.error ? null : pickTimestamp(postsRes.data, 'created_at')
    const notificationsUnread = await unreadCount()
    const next: Versions = { rehearsals, announcements, notificationsUnread, leave, post }
    if (versions) {
      if (next.rehearsals !== versions.rehearsals) emitSync('rehearsals')
      if (next.announcements !== versions.announcements) emitSync('announcements')
      if (next.leave !== versions.leave) emitSync('leave')
      if (next.post !== versions.post) emitSync('post')
    }
    // 未读数独立判定（不受首轮基线守卫影响）：与进程内上次已知值不同即广播，
    // 覆盖「后台期间新增通知、回前台首轮 tick」的漏报窗口
    if (
      lastKnownUnread !== null &&
      next.notificationsUnread !== null &&
      next.notificationsUnread !== lastKnownUnread
    ) {
      emitSync('notifications')
    }
    if (next.notificationsUnread !== null) lastKnownUnread = next.notificationsUnread
    versions = next
  } catch (err) {
    // 心跳失败不阻断下一次（已 reschedule）；记录诊断后由下次轮询自愈
    logDiag('sync_tick_error', { err: err instanceof Error ? err.message : String(err) })
  } finally {
    if (running) schedule()
  }
}

function schedule() {
  if (timer) clearTimeout(timer)
  timer = setTimeout(tick, POLL_INTERVAL)
}

/** 启动轮询（仅由 Provider 在前台 + 会话就绪后调用；幂等） */
export function dataSyncStart() {
  if (running) return
  running = true
  versions = null
  schedule()
}

/** 停止轮询并清理定时器（切入后台 / 登出时调用） */
export function dataSyncStop() {
  running = false
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
}

/** A（onShow 重取）/ B（本地写）发生后调用：重置 30s 倒计时，避免刚刷新又轮询 */
export function dataSyncBump() {
  if (running) schedule()
}
