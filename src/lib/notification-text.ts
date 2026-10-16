import type { TFn } from '@/i18n'

/**
 * 一条系统通知该显示什么 —— **服务端只落一条行，语言由客户端在渲染时决定**。
 *
 * 背景：`notifications` 的 title / content 是**服务端写死的中文**（`touch_session_v2` 拼的
 * 「新设备登录」那条），英文模式下用户看到的是整段中文。所以服务端同时存了机读的 `kind`
 * 与渲染参数 `meta`（见 pkuso-backend 的 `20261016140000_notifications_kind_meta.sql`），
 * 这里按**当前语言**挑文案 —— 中英共用同一条通知，不是各落一行（用户 2026-10-16 定）。
 *
 * 兜底：认不得的 `kind`（以及 `kind` 为空的老行）**原样显示服务端给的 title / content**。
 * 两个方向都不脆：服务端先加新 kind 时客户端照旧能显示；客户端先发版也不会白屏。
 */
export type NoticeText = { title: string; content: string }

/**
 * `meta.deviceName` 的契约是 `string | null` —— 服务端对空设备名给 **JSON null**，
 * 好让英文端自己挑词（而不是收到一句中文的「未知设备」）。
 * 这里把 null / 缺字段 / 空串 / 类型不对统一收敛成 null。
 */
export function deviceNameOf(meta: unknown): string | null {
  if (!meta || typeof meta !== 'object') return null
  const v = (meta as { deviceName?: unknown }).deviceName
  return typeof v === 'string' && v.trim() !== '' ? v : null
}

/**
 * @param time 已经本地化好的时刻串（调用方传 `formatDateTimeInChina(created_at)`）——
 *   由调用方格式化，这个函数才不依赖当前语言，可以拿一个固定的串直接测。
 */
/**
 * 只需要这四个字段。⚠️ `meta` 特意收 **`unknown`**：它是服务端来的 JSON，形状由 `deviceNameOf`
 * 现验 —— 生成类型里它是 `Json`（本身就含 null），但**渲染层不该假设任何形状**：库里那条行
 * 可能是老数据、可能是别的写入方留的，猜形状只会把「显示不出来」变成「崩在这一句」。
 */
export type NoticeRow = {
  kind: string | null
  meta: unknown
  title: string
  content: string
}

export function noticeText(row: NoticeRow, time: string, t: TFn): NoticeText {
  if (row.kind === 'device_login') {
    return {
      title: t('notification.kind.deviceLogin.title'),
      content: t('notification.kind.deviceLogin.body', {
        name: deviceNameOf(row.meta) ?? t('notification.kind.deviceLogin.unknownDevice'),
        time,
      }),
    }
  }
  return { title: row.title, content: row.content }
}
