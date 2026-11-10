import { activeEntry, hasProxy, rewriteTo } from './supabase-entry'

/**
 * 把一个 Supabase Storage 对象 URL 展开成**候选列表**：当前生效入口优先，另一个兜底。
 *
 * 只用于**展示**（`<Image>` / 预览）。复制/分享链接必须用原直连 URL——浏览器里没有
 * `servicewechat.com` 的 Referer，反代 URL 在浏览器侧不该被当成可分发链接。
 *
 * 存量 `avatar_url` / `image_url` / 签名 URL 都是直连形态；这里不改库、只在展示时重写。
 * 非本项目的 URL（本地临时文件、外链、已经是别的域名）原样返回一条。
 */
export function storageUrlCandidates(url: string | null | undefined): string[] {
  if (!url) return []
  if (!hasProxy) return [url]
  const primary = rewriteTo(url, activeEntry())
  const secondary = rewriteTo(url, activeEntry() === 'proxy' ? 'direct' : 'proxy')
  if (primary === secondary) return [primary]
  // 两个重写都没命中（不是本项目的直连基址）⇒ 只有原 URL 可用
  if (primary === url && secondary === url) return [url]
  return [primary, secondary]
}
