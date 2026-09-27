// 请求关联 id 的**客户端一半**（服务端见 pkuso-backend `supabase/functions/_shared/diag.ts`）。
//
// 每次请求带一个 `x-pkuso-diag` 头，失败时把**同一个 id** 写进 client_error_logs。
// 于是「请求到底有没有送到服务端」不再是猜的：
//
//   服务端日志里有这条 id  → 送到了，再去看它卡在哪一跳、共花了多久
//   只有客户端有这条 id    → 没送到（或被挡在平台网关那层，那层连我们的日志都不会有）
//
// 登录失败尤其需要它：那时客户端还没有会话，cel 行的 user_id 是 null（`auth.uid()` 取不到），
// 两端除了时间戳没有任何可对账的字段。
//
// 形如 `<install>-<t36>-<rand>`：安装级前缀让「同一台设备反复失败」聚得起来，
// 请求级后缀保证并发请求不会撞成同一个 id（撞了就会把两条日志错认成同一次请求）。
//
// ⚠️ 值是服务端**校验后才采用**的（契约 `[A-Za-z0-9._-]{1,64}`），所以这里只用
// 该字符集内的字符拼，别塞进中文或空格——那会被服务端当成「没带」而丢掉对账能力。
import Taro from '@tarojs/taro'

export const DIAG_HEADER = 'x-pkuso-diag'

const INSTALL_KEY = 'pkuso_diag_install'
// 安装 id 的长度上界：给 `<install>-<t36>-<rand>` 留出 64 的总预算
const INSTALL_RE = /^[A-Za-z0-9._-]{1,32}$/

let cachedInstallId: string | null = null
// 进程内序号：让「同一次运行里两个请求不会撞 id」是**结构性成立**的，而不是靠随机数
// 撞不上。撞了会把两次请求的日志错认成同一次，对账就反过来了——这种事不该交给概率。
let seq = 0

function randomToken(len: number): string {
  let out = ''
  while (out.length < len) out += Math.random().toString(36).slice(2)
  return out.slice(0, len)
}

/**
 * 安装级 id（持久化）。
 *
 * storage 不可用时**退化为进程内随机**而不是抛错：拿不到稳定 id 只是让「同一台设备
 * 的多次失败」聚不起来，绝不能因此让上报本身失败——上报的契约是「绝不影响业务」。
 */
export function getInstallId(): string {
  if (cachedInstallId) return cachedInstallId
  let id = ''
  try {
    const raw = Taro.getStorageSync(INSTALL_KEY)
    if (typeof raw === 'string' && INSTALL_RE.test(raw)) id = raw
  } catch {
    // 读不到就当没有
  }
  if (!id) {
    id = randomToken(8)
    try {
      Taro.setStorageSync(INSTALL_KEY, id)
    } catch {
      // 写不进去也不影响本次运行（cachedInstallId 仍然给出一个稳定值）
    }
  }
  cachedInstallId = id
  return id
}

/**
 * 一次请求一个 id；带上它去 invoke，并把同一个值写进失败记录。
 *
 * 三段：安装 id（跨启动可聚合）+ 进程内序号（同一次运行里结构性不重复）+ 时间与随机
 * （跨进程/跨重启兜底）。总长留有余量（安装 id ≤32）。
 */
export function newDiagId(): string {
  seq += 1
  return `${getInstallId()}-${seq.toString(36)}-${Date.now().toString(36)}-${randomToken(4)}`
}

/** 仅供测试：清掉进程内缓存（storage 由测试自己管）。 */
export function __resetDiagCache(): void {
  cachedInstallId = null
  seq = 0
}
