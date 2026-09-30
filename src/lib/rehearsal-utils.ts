import { parseLocalISO } from '@/lib/date-utils'

/**
 * 判断排练是否应显示在用户侧首页（未来一周内，含今天）
 *
 * 过滤窗口：start_time 的日期在 [今天, 今天+7天] 内（含两端）。
 * - start_time 为空或无法解析 → 保留显示（无法判断时间，保守处理，不清空）
 * - start_time 日期 < 今天 → 已过去的排练，隐藏
 * - start_time 日期 > 今天+7天 → 超过一周的排练，隐藏
 *
 * 日期比较使用本地时区日期边界（今天 00:00 起、今天+7天 23:59 止），
 * 避免使用 UTC 导致日期偏移。
 *
 * @param startTime - 排练开始时间（"YYYY-MM-DDTHH:mm:ss"），可能为空
 * @param now - 当前时间，默认取真实时间；测试可传入固定时间
 * @returns 是否应显示
 */
export function isRehearsalWithinNextWeek(
  startTime: string | null,
  now: Date = new Date()
): boolean {
  // 无 start_time：无法判断时间，保守保留
  if (!startTime) return true

  const start = parseLocalISO(startTime)
  // parseLocalISO 对无法解析的字符串会退化为 1900 年附近的日期，视为无有效时间，保守保留
  if (start.getFullYear() < 2000) return true

  // 本地时区日期边界：今天 00:00 起，今天+7天 23:59:59.999 止
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0)
  const weekEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 8, 0, 0, 0, -1)

  return start.getTime() >= todayStart.getTime() && start.getTime() <= weekEnd.getTime()
}

/**
 * 把 `rehearsals.target_section` 归一成 `string[]`。
 *
 * 这一列历史上是**标量字符串**，迁移（`20260921010000_alter_rehearsals_target_section_to_array`）
 * 之后是数组 —— 所以两种形状都要认。函数在 `rehearsal-card` 与 `rehearsal-detail`
 * 里各抄过一份（逐字符相同），TS 5.9 收紧 `unknown` 的真值窄化后两份同时报错
 * （`[target]` 被窄化成 `{}[]`），正好合并成一处。
 *
 * 入参用 `unknown` 是因为它从数据库列来（类型上可能是 `string[] | string | null`，
 * 但历史数据什么都可能有）。**非字符串一律丢掉**，而不是原样塞进 `string[]` —— 后者是
 * 类型在说谎：`getSectionGroupLabel` 拿到非字符串会渲染出 `[object Object]`。
 */
export function normalizeTargets(target: unknown): string[] {
  if (Array.isArray(target)) return target.filter((x): x is string => typeof x === 'string')
  return typeof target === 'string' && target ? [target] : []
}
