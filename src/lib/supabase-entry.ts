import Taro from '@tarojs/taro'

// ============================================================
// 「后端走哪个入口」的唯一定义处。
//
// 两个入口指的是同一个 Supabase 项目的两条到达路径：
//   proxy  —— 境内反代（微信云开发的 HTTP 访问服务 → 云函数 → Supabase）
//   direct —— 直连 `https://<ref>.supabase.co`（跨境）
//
// 为什么需要它：小程序的 URL 是**构建期烧进包里**的，request 白名单也是静态的，
// 所以入口一旦切错，回滚要走 1–3 天的审核。反代的对手是「云开发默认域名被风控关停」，
// 直连的对手是「抽到坏落点 / 跨境那一跳整个不通」——**两者都需要一条不经过审核的退路**，
// 这就是自动回退存在的全部理由。
//
// ⚠️ 这里是**唯一的**入口判断处。别在别处再写一遍 `process.env.TARO_APP_SUPABASE_*`，
// 否则「当前生效的是哪个入口」会有两个互相不知道的答案。
//
// --- 为什么 `TARO_APP_SUPABASE_URL` 保持「直连规范地址」的语义 ---
//
// 曾经考虑过按 `.proxy-research/cloudbase/操作手册.md` 的措辞，直接把
// `TARO_APP_SUPABASE_URL` 改成反代域名、另加一个 `..._DIRECT_URL` 做回退。没有那样做：
// 那样一来**两份 .env 都必须显式配 DIRECT_URL**，而漏配的 dev 构建会经反代打到生产库——
// 一个配置疏忽就把环境隔离打穿了。现在的形状是「直连地址永远正确，反代是可选的加分项」，
// 漏配的后果只是「没启用反代」，与今天的行为完全一致。
// ============================================================

/**
 * ⚠️ 这两次读取**必须是字面量的 `process.env.TARO_APP_XXX`**——写成 `process.env[key]` 就永远读不到。
 *
 * Taro 只把 **.env 文件里声明过**的键在构建期内联成字面量（@tarojs/helper 的 dotenvParse →
 * `defineConstants['process.env.<key>']`）；**没声明过的会原样留着**，落到 webpack 注入的
 * `process/browser` 垫片上（Taro 给小程序补的那个），于是取到 `undefined` —— **不会抛错**。
 * 现成的反证就在隔壁：`TARO_APP_SESSION_DIAG` 同样是可选开关，CI 写 `.env.production` 时
 * 压根不带它，线上照样跑。所以可选变量是安全的，用 `?? ''` 兜住 undefined 即可。
 *
 * 反过来说，**别为了「更稳」加 `typeof process !== 'undefined'` 守卫**：内联成功之后那句会
 * 变成 `typeof process !== 'undefined' && "https://…"`，而真机上 `process` 并不在全局作用域里
 * （它只是被 require 进来的一个模块）⇒ 恒为 false，配置得好好的值被静默丢掉。
 */
const DIRECT_BASE = trimBase(process.env.TARO_APP_SUPABASE_URL)
const PROXY_BASE = trimBase(process.env.TARO_APP_SUPABASE_PROXY_URL)

function trimBase(value: string | undefined): string {
  return typeof value === 'string' ? value.trim().replace(/\/+$/, '') : ''
}

export type EntryName = 'proxy' | 'direct'

/** 配了反代域名才算双入口；否则一切新逻辑短路，行为与从前完全一致 */
export const hasProxy = PROXY_BASE !== '' && DIRECT_BASE !== ''

/**
 * supabase-js 拼 URL 用的基址（`createClient` 的入参）——**永远是直连地址**。
 *
 * 为什么不直接给它反代：supabase-js 不只用它拼 API 请求，**storage 的 `getPublicUrl` /
 * `createSignedUrl` 也从它派生**，而那些 URL 会被直接交给 `Taro.downloadFile`、`<Image src>`
 * 或裸的 `Taro.request`（全部绕过 taroFetch），根本走不到这里的重写。基址取反代的话，
 * 大文件下载就会从后门重新走回云函数 —— 「storage 走直连」那条就白设了。
 *
 * 所以分工是：**rest / auth / functions 三条腿在出口处（taroFetch）重写到当前生效入口；
 * storage 与一切由它派生的文件 URL 天然留在直连上。**
 *
 * 基址固定、把「谁生效」留给重写，还有第二个理由：supabase-js 在 createClient 时就把基址
 * 闭包进去了，而入口可能在之后的任何时刻变化（启动探针、请求级回退）。
 */
export const directBase = DIRECT_BASE

export function baseFor(entry: EntryName): string {
  return entry === 'proxy' ? PROXY_BASE || DIRECT_BASE : DIRECT_BASE
}

/** 单入口时没有「另一个入口」可言——所有回退分支都据此短路 */
export function otherEntry(entry: EntryName): EntryName | null {
  if (!hasProxy) return null
  return entry === 'proxy' ? 'direct' : 'proxy'
}

const STORAGE_KEY = 'pkuso_supabase_entry'

/**
 * 读上次的选择。
 *
 * 默认是 proxy：配了反代就是以它为主（切到境内是这次改造的目的本身），
 * 只有它被证明不可用才会落到 direct。
 */
function readPersisted(): EntryName {
  if (!hasProxy) return 'direct'
  try {
    const raw = Taro.getStorageSync(STORAGE_KEY)
    return raw === 'direct' || raw === 'proxy' ? raw : 'proxy'
  } catch {
    // 存储读不到（从未写过 / 存储被清）不是错误，用默认值
    return 'proxy'
  }
}

let active: EntryName = readPersisted()

export function activeEntry(): EntryName {
  return active
}

/** 把 supabase-js 拼出来的 URL 落到当前生效入口；不是本项目的基址就原样返回 */
export function rewriteToActive(url: string): string {
  return rewriteTo(url, active)
}

export function rewriteTo(url: string, entry: EntryName): string {
  const to = baseFor(entry)
  if (!DIRECT_BASE || !to || DIRECT_BASE === to) return url
  // 带前缀判断而不是简单的 replace：`https://x.supabase.co.evil.com/...` 这种
  // 前缀相同、域名不同的 URL 不能被当成自家地址改写
  if (url.indexOf(DIRECT_BASE) !== 0) return url
  const rest = url.slice(DIRECT_BASE.length)
  if (rest !== '' && rest[0] !== '/' && rest[0] !== '?') return url
  return to + rest
}

export type SwitchRecord = { from: EntryName; to: EntryName }

/**
 * 切到另一个入口并持久化。返回发生了切换才返回记录，否则 null。
 *
 * 持久化是有意的：一次断流可能只持续几秒，但「当前入口不可用」这件事在分钟级上仍然成立，
 * 不该让每个请求都先撞一次墙。回到另一个入口由启动探针负责（见 colo-probe）。
 */
export function switchTo(entry: EntryName, opts: { persist?: boolean } = {}): SwitchRecord | null {
  if (!hasProxy || entry === active) return null
  const from = active
  active = entry
  if (opts.persist !== false) {
    try {
      Taro.setStorageSync(STORAGE_KEY, entry)
    } catch {
      // 持久化失败只影响下次启动的初值，不影响本次会话——不能因此让请求本身出错
    }
  }
  return { from, to: entry }
}

/** 仅供测试：把内存态恢复到初始值（含重新读一次持久化），否则用例之间会互相影响 */
export function __resetEntryForTest(): void {
  active = readPersisted()
}
