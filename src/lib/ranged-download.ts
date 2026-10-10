/**
 * 分片（Range）下载：把一个大文件**分几次、经反代**取回来拼成一份。
 *
 * 为什么需要它：反代（境内）的**响应包体上限约 4.5MB**（实测二分：原始 4,717,779 B 过、
 * 4,717,780 B 拒 —— 云函数 URL 把二进制按 base64 编码，撞的是那道 6MiB 的墙），
 * 而 PDF 最大 30.7MB ⇒ 整份走反代必被拒。分片后每片都在上限之内，大文件也能吃到
 * 「境内」这条可靠性。反代侧**不用改**：它是通用透传、原样转发请求头（含 `Range`）、
 * 原样回传响应头（含 `Content-Range`）。
 *
 * ⚠️⚠️ 这个模块最坏的失败不是「下不下来」，而是**静默交出一份损坏的文件**——
 * 用户会把它转发出去，「打不开」在转发之后才被发现，比当场失败糟得多。所以三条护栏
 * 一条都不能省：
 *   1. **以磁盘上文件的实际长度为准**续传（不是内存记账）—— 任何一片的写入被吞掉都能自愈；
 *   2. **空分片立刻报错**：否则 `while` 永远不会推进 = 死循环；
 *   3. **结尾逐字节校验总长**，不符就**删掉整份**再抛错 —— 宁可让用户重下一次。
 */

/** 每片大小：2MB。上限约 4.5MB（base64 后 6MiB），留一倍余量 */
export const CHUNK_BYTES = 2 * 1024 * 1024

/** 一整片失败后的退避（数组长度 = 重试轮数）。与页图/PDF 单次下载同一套数值与理由 */
export const CHUNK_RETRY_DELAYS_MS = [500, 1000]

export type RangedFs = {
  /** 文件当前长度；不存在返回 0。**续传的唯一判据** */
  size(path: string): Promise<number>
  read(path: string): Promise<ArrayBuffer>
  write(path: string, data: ArrayBuffer): Promise<void>
  append(path: string, data: ArrayBuffer): Promise<void>
  /** 整份复制（服务端忽略 Range、直接给了 200 时走它）——**不经过 JS 内存** */
  copy(src: string, dest: string): Promise<void>
  remove(path: string): Promise<void>
}

export type RangeResponse = { statusCode: number; tempFilePath: string }

export type RangedDeps = {
  fs: RangedFs
  /**
   * 发一个带 Range 头的下载。**抛错 = 网络层失败**（如 ERR_CONNECTION_RESET）。
   * `timeoutMs` 由调用方按**腿**给（见 DownloadLeg）。
   */
  fetchRange: (url: string, range: string, timeoutMs: number) => Promise<RangeResponse>
  /** 测试注入用；默认真等 */
  sleep?: (ms: number) => Promise<void>
}

/**
 * 一条下载腿，**带自己的超时**。
 *
 * 为什么必须逐腿给：反代那条腿在带 `Range` 的下载上会**干等满超时**才回退（真机实测
 * `fetchMs` = 62.6 秒 ≈ `downloadFile` 的默认 60 秒 + 直连成功的 2.5 秒），而 `taroFetch`
 * 那条路只用 8 秒就能判死 ⇒ 同一类故障，下载这条路上贵 7.5 倍。给它一个短超时，
 * 代价就从「用户等一分钟」变成「等 15 秒」。
 */
export type DownloadLeg = {
  url: string
  timeoutMs: number
  /** 诊断标签（`proxy` / `direct`）。**只进日志**，不参与任何判定 */
  label?: string
}

/** 一条腿的一次尝试（诊断用：真机上没有网络面板，只能靠日志判「哪条腿通」） */
type LegTrial = { label: string; ok: boolean; status: number | null; ms: number; err: string }

/**
 * 把这几条腿的结果打**一行**到 console。
 *
 * 存在的理由很具体（用户 2026-10-11 提出）：真机验收时**没有网络面板**，
 * 而「反代那条腿在用户所在网络上到底通不通」是判读一切超时的前提。
 * 按 (腿, 首次结果) 归并，不让分片把日志刷成几十行。
 */
function logLegs(trials: LegTrial[]): void {
  if (trials.length === 0) return
  const byLabel = new Map<string, { first: LegTrial; n: number }>()
  for (const t of trials) {
    const hit = byLabel.get(t.label)
    if (hit) hit.n += 1
    else byLabel.set(t.label, { first: t, n: 1 })
  }
  const parts = [...byLabel.entries()].map(([label, { first, n }]) => {
    const how = first.ok
      ? `✓ ${first.status} ${first.ms}ms`
      : `✗ ${first.status ?? first.err} ${first.ms}ms`
    return `${label} ${how}${n > 1 ? ` ×${n}` : ''}`
  })
  // eslint-disable-next-line no-console
  console.log(`[pkuso] 下载腿：${parts.join(' | ')}`)
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/**
 * 取一片，带**候选 URL 轮换**与退避重试。
 *
 * 候选顺序由调用方给（反代优先、直连兜底）。重试的判据分两档：
 * - **网络层抛错**（连接被重置等）⇒ 换下一个候选，一轮试完再退避重来；
 * - **5xx**（反代上游失败会回 502）⇒ 同样算可重试；
 * - **4xx** ⇒ 服务端明确说不行（不存在 / 无权限），立刻失败 —— 重试只是白等。
 */
/**
 * 取一片。返回**是哪条腿给的**——调用方据此记住「这份下载里谁通」。
 *
 * `preferred` 把它排到最前。⚠️ 没有它，一次「反代腿挂住」会按**片数**累乘：
 * 30MB 的谱子 15 片 × 15 秒 ≈ 白等近四分钟。
 * 它是**偏好**不是「判死」——首片就失败的那条腿不该被整份下载除名（网络会抖），
 * 所以只调顺序、候选仍在。
 */
async function fetchRangeWithRetry(
  legs: DownloadLeg[],
  range: string,
  deps: RangedDeps,
  preferred: string | null,
  trials: LegTrial[]
): Promise<{ res: RangeResponse; url: string }> {
  const sleep = deps.sleep ?? defaultSleep
  const ordered = preferred
    ? [...legs.filter((l) => l.url === preferred), ...legs.filter((l) => l.url !== preferred)]
    : legs
  let lastErr: unknown = null
  /**
   * **4xx 的腿**：这条腿明确拒绝了，这一次下载里不再试它。
   *
   * ⚠️ 从前 4xx 是**直接抛穿整次下载**的（「服务端明确说不行，不重试」）。有了多条腿之后
   * 这条前提不成立了：一条腿拒绝**不代表文件没了** —— 实测形态就有一种是「本机代理对那个
   * 域名回 403」，而同一个 URL 的直连腿是好的。整次判死会让用户**压根拿不到文件**，
   * 而正确做法是换腿。
   */
  const rejected = new Set<string>()
  for (let round = 0; round <= CHUNK_RETRY_DELAYS_MS.length; round += 1) {
    for (const leg of ordered) {
      if (rejected.has(leg.url)) continue
      const t0 = Date.now()
      const label = leg.label ?? leg.url
      try {
        const res = await deps.fetchRange(leg.url, range, leg.timeoutMs)
        const ok = res.statusCode === 206 || res.statusCode === 200
        trials.push({
          label,
          ok,
          status: res.statusCode,
          ms: Date.now() - t0,
          err: ok ? '' : `HTTP ${res.statusCode}`,
        })
        if (ok) return { res, url: leg.url }
        lastErr = new Error(`HTTP ${res.statusCode}`)
        if (res.statusCode < 500) rejected.add(leg.url)
      } catch (err) {
        // 网络层失败（超时/连接重置）：**不判死**，下一轮还会再试它（网络会抖）
        trials.push({
          label,
          ok: false,
          status: null,
          ms: Date.now() - t0,
          err: err instanceof Error ? err.message : String(err),
        })
        lastErr = err
      }
    }
    // 所有腿都被 4xx 拒了：再等下去也不会变，直接了结
    if (rejected.size >= legs.length) break
    if (round < CHUNK_RETRY_DELAYS_MS.length) await sleep(CHUNK_RETRY_DELAYS_MS[round] ?? 1000)
  }
  throw lastErr ?? new Error('分片下载失败')
}

/**
 * 按 `chunkBytes` 一片片取回、拼到 `dest`，返回**最后用的是哪条腿**（调用方据此记住谁通）。
 *
 * `totalBytes` 是**期望总长**（来自库里的 `file_size`）。它既是循环的终止条件，也是最后
 * 校验的依据 —— 没有它就无法判断「拼完的到底全不全」。
 */
export async function downloadInChunks(
  opts: { legs: DownloadLeg[]; dest: string; totalBytes: number; chunkBytes?: number },
  deps: RangedDeps
): Promise<string> {
  const chunk = opts.chunkBytes ?? CHUNK_BYTES
  const legs = opts.legs.filter((l) => l && l.url)
  /** 这份下载里已经证明能通的那条腿（见 fetchRangeWithRetry） */
  let preferred: string | null = null
  /** 每条腿试过什么（出去时打一行日志，见 logLegs） */
  const trials: LegTrial[] = []
  if (legs.length === 0) throw new Error('没有可用的下载地址')
  if (!(opts.totalBytes > 0)) throw new Error('缺少文件总长，无法分片')

  // 每片至少该推进 1 字节，否则一定是异常（服务端反复回空片）
  const maxRounds = Math.ceil(opts.totalBytes / chunk) + 4
  try {
  for (let round = 0; round < maxRounds; round += 1) {
    // ⚠️ 每轮都**重新读磁盘上的实际长度**（不是内存里累加的）：任何一片的写入被吞掉、
    // 或上一次运行留下半份文件，都能从这里自愈
    const have = await deps.fs.size(opts.dest)
    if (have >= opts.totalBytes) return finish(opts, deps, preferred)
    const end = Math.min(have + chunk, opts.totalBytes) - 1
    const got = await fetchRangeWithRetry(legs, `bytes=${have}-${end}`, deps, preferred, trials)
    const res = got.res
    preferred = got.url // 这一片是谁给的 ⇒ 下一片先试它（见 fetchRangeWithRetry）
    if (res.statusCode === 200) {
      // 服务端**忽略了 Range**、把整份都装在这一个临时文件里：直接复制过去。
      // （走 copyFile 而不是 readFile —— 30MB 读进 JS 内存对小程序的 isolate 是实打实的风险）
      // 先删目标：这里是**覆盖**语义，而 copyFile 在目标已存在时的行为各实现不一
      await deps.fs.remove(opts.dest)
      await deps.fs.copy(res.tempFilePath, opts.dest)
      return finish(opts, deps, preferred)
    }
    const buf = await deps.fs.read(res.tempFilePath)
    if (buf.byteLength === 0) {
      // 服务端对一段**非空区间**回了 206 却是空的 ⇒ 文件在这里就结束了：
      // 要么库里记的总长比真实文件大，要么对象被截断。两种情况都拼不出 `totalBytes`，
      // 而且再循环下去也不会推进（死循环），所以**连半成品一起清掉**再报错。
      // （注意与「网络层失败」区分：那种要**留着**半成品好续传，见上面的循环注释。）
      if (have > 0) await deps.fs.remove(opts.dest)
      throw new Error(`文件在 ${have}/${opts.totalBytes} 处提前结束（记录的总长不对，或文件被截断）`)
    }
    if (have === 0) await deps.fs.write(opts.dest, buf)
    else await deps.fs.append(opts.dest, buf)
  }
  await deps.fs.remove(opts.dest)
  throw new Error('分片轮数异常（文件长度没有推进）')
  } finally {
    logLegs(trials) // 成与不成都要打：判读超时全靠它
  }
}

/** 收尾：总长不符就**整份删掉**（宁可让用户重下，也不能交出一份损坏的文件） */
async function finish(
  opts: { dest: string; totalBytes: number },
  deps: RangedDeps,
  usedLeg: string | null
): Promise<string> {
  const size = await deps.fs.size(opts.dest)
  if (size !== opts.totalBytes) {
    await deps.fs.remove(opts.dest)
    throw new Error(`分片长度不符：${size}/${opts.totalBytes}`)
  }
  return usedLeg ?? ''
}
