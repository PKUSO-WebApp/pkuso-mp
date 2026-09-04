import { supabase } from '@/lib/supabase'
import { logDiag } from '@/lib/session-diag'

export type SyncEntity = 'rehearsals' | 'announcements' | 'notifications' | 'leave' | 'post'

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

const BASE_INTERVAL = 30_000
const JITTER_MAX = 10_000

type Versions = {
  rehearsals: string | null
  announcements: string | null
  notificationsUnread: number | null
  leave: string | null
  post: string | null
}

type DataVersionsRow = {
  rehearsals: string | null
  announcements: string | null
  leave: string | null
  post: string | null
  notifications_unread: number | null
}

let timer: ReturnType<typeof setTimeout> | null = null
let running = false
let versions: Versions | null = null
let lastKnownUnread: number | null = null

// 每个用户启动时生成固定随机偏移，避免 100 人同时请求
const jitter = Math.floor(Math.random() * JITTER_MAX)

function schedule() {
  if (timer) clearTimeout(timer)
  timer = setTimeout(tick, BASE_INTERVAL + jitter)
}

// 合并 5 个查询为 1 个 RPC 调用，将 HTTP 请求数从 5 降到 1
async function tick() {
  if (!running) return
  try {
    const { data, error } = await supabase.rpc('check_data_versions' as never)
    if (error) {
      logDiag('sync_tick_error', { message: error.message })
      return
    }
    const row = data as DataVersionsRow | null
    const next: Versions = {
      rehearsals: row?.rehearsals ?? null,
      announcements: row?.announcements ?? null,
      notificationsUnread: row?.notifications_unread ?? null,
      leave: row?.leave ?? null,
      post: row?.post ?? null,
    }
    if (versions) {
      if (next.rehearsals !== versions.rehearsals) emitSync('rehearsals')
      if (next.announcements !== versions.announcements) emitSync('announcements')
      if (next.leave !== versions.leave) emitSync('leave')
      if (next.post !== versions.post) emitSync('post')
    }
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
    logDiag('sync_tick_error', { err: err instanceof Error ? err.message : String(err) })
  } finally {
    if (running) schedule()
  }
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
