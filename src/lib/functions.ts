// 必须为首个 import：与 lib/supabase.ts 同理——@supabase/supabase-js 模块初始化会裸引用
// 全局 Headers，而小程序 JSCore 没有它（启动即 ReferenceError）。本文件要用到 FunctionRegion
// （一个**运行时**枚举，不是类型），所以也会求值 supabase-js；不装 polyfill 的话，
// 「谁先被 import」就会决定启动崩不崩。
import '@/lib/weapp-polyfills'
import {
  FunctionRegion,
  type FunctionInvokeOptions,
  type SupabaseClient,
} from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'

/**
 * Edge Function 的默认执行区域 = **数据库所在地**（`ap-southeast-2` 悉尼）。
 *
 * 为什么需要它：函数的执行区域默认不跟着数据库走。实测 `wechat-auth` 那一次墙钟 2502ms，
 * 而同期的 CPU **只用了 47ms**——从 `code2session` 完成（ms 674）到 `rotate_password` 完成
 * （ms 2161）之间有 1487ms，全是「跑在 us-west-1 的函数**串行往返**悉尼的库」：profile 查询、
 * getUserById、updateUserById，每个来回约 170ms，几个 await 就吃掉了 1.5 秒。
 * 把函数调度到库旁边，这段塌缩为同机房往返。
 *
 * 为什么必须**逐次传**：`SupabaseClientOptions` 里根本没有 `functions` 键（`FunctionRegion`
 * 只是被 re-export），而 `client.functions` 每次访问都会 `new FunctionsClient(url, { headers,
 * customFetch })` —— **不带 region**。所以不存在「配置一次、全局生效」的写法。
 *
 * 个别函数若更需要贴近境外 API（而非贴近库），可在调用处传自己的 `region` 覆盖——
 * `{ region: DEFAULT, ...options }` 的展开顺序就是为此留的。
 */
const DEFAULT_REGION = FunctionRegion.ApSoutheast2

/**
 * 所有 Edge Function 调用的唯一出口。
 *
 * 收敛到一层的理由有两个，第二个才是长期的：
 * 1. region 只能逐次传（见上），散在 18 个调用点里迟早有人漏写，而漏写不会有任何报错，
 *    只是那一个函数悄悄退回「离库半个地球」的默认区域；
 * 2. 将来要加的失败探测字段（网络类型、Cloudflare colo）也收在这里，埋点与 region
 *    在同一处维护。
 *
 * 接受 `client` 参数而不是直接 import 单例：现有 hook 已有「client 可注入」的模式
 * （useWechatLogin / useSendLoginCode / useSchedule 都参数化了 client），硬绑单例会破坏
 * 它们的可测试性——而且会让 `useWechatLogin.test.ts` 里那条「断言请求头带上了同一个 diag」
 * 的用例失去着力点。
 *
 * 泛型默认 `any`（**不是 `unknown`**）是为了与 SDK 的 `invoke<T = any>` 保持一致：现有调用点
 * 大量直接读 `data.error` / `data.access_token`，收窄成 `unknown` 会让它们全部报错——那属于
 * 「顺手改了别人的类型契约」，不该混在这条改动里。
 */
export function invokeFunction<T = any>(
  client: SupabaseClient<Database>,
  name: string,
  options: FunctionInvokeOptions = {}
) {
  return client.functions.invoke<T>(name, { region: DEFAULT_REGION, ...options })
}
