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
  /** 发一个带 Range 头的下载。**抛错 = 网络层失败**（如 ERR_CONNECTION_RESET） */
  fetchRange: (url: string, range: string) => Promise<RangeResponse>
  /** 测试注入用；默认真等 */
  sleep?: (ms: number) => Promise<void>
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
async function fetchRangeWithRetry(
  urls: string[],
  range: string,
  deps: RangedDeps
): Promise<RangeResponse> {
  const sleep = deps.sleep ?? defaultSleep
  let lastErr: unknown = null
  for (let round = 0; round <= CHUNK_RETRY_DELAYS_MS.length; round += 1) {
    for (const url of urls) {
      try {
        const res = await deps.fetchRange(url, range)
        if (res.statusCode === 206 || res.statusCode === 200) return res
        if (res.statusCode < 500) throw new Error(`HTTP ${res.statusCode}`)
        lastErr = new Error(`HTTP ${res.statusCode}`)
      } catch (err) {
        // 4xx（含上面主动抛的那个）不重试
        if (err instanceof Error && /^HTTP 4\d\d$/.test(err.message)) throw err
        lastErr = err
      }
    }
    if (round < CHUNK_RETRY_DELAYS_MS.length) await sleep(CHUNK_RETRY_DELAYS_MS[round] ?? 1000)
  }
  throw lastErr ?? new Error('分片下载失败')
}

/**
 * 把 `urls[0]`（备选依次兜底）的内容按 `chunkBytes` 一片片取回，拼到 `dest`。
 *
 * `totalBytes` 是**期望总长**（来自库里的 `file_size`）。它既是循环的终止条件，也是最后
 * 校验的依据 —— 没有它就无法判断「拼完的到底全不全」。
 */
export async function downloadInChunks(
  opts: { urls: string[]; dest: string; totalBytes: number; chunkBytes?: number },
  deps: RangedDeps
): Promise<void> {
  const chunk = opts.chunkBytes ?? CHUNK_BYTES
  const urls = opts.urls.filter(Boolean)
  if (urls.length === 0) throw new Error('没有可用的下载地址')
  if (!(opts.totalBytes > 0)) throw new Error('缺少文件总长，无法分片')

  // 每片至少该推进 1 字节，否则一定是异常（服务端反复回空片）
  const maxRounds = Math.ceil(opts.totalBytes / chunk) + 4
  for (let round = 0; round < maxRounds; round += 1) {
    // ⚠️ 每轮都**重新读磁盘上的实际长度**（不是内存里累加的）：任何一片的写入被吞掉、
    // 或上一次运行留下半份文件，都能从这里自愈
    const have = await deps.fs.size(opts.dest)
    if (have >= opts.totalBytes) return finish(opts, deps)
    const end = Math.min(have + chunk, opts.totalBytes) - 1
    const res = await fetchRangeWithRetry(urls, `bytes=${have}-${end}`, deps)
    if (res.statusCode === 200) {
      // 服务端**忽略了 Range**、把整份都装在这一个临时文件里：直接复制过去。
      // （走 copyFile 而不是 readFile —— 30MB 读进 JS 内存对小程序的 isolate 是实打实的风险）
      // 先删目标：这里是**覆盖**语义，而 copyFile 在目标已存在时的行为各实现不一
      await deps.fs.remove(opts.dest)
      await deps.fs.copy(res.tempFilePath, opts.dest)
      return finish(opts, deps)
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
}

/** 收尾：总长不符就**整份删掉**（宁可让用户重下，也不能交出一份损坏的文件） */
async function finish(
  opts: { dest: string; totalBytes: number },
  deps: RangedDeps
): Promise<void> {
  const size = await deps.fs.size(opts.dest)
  if (size !== opts.totalBytes) {
    await deps.fs.remove(opts.dest)
    throw new Error(`分片长度不符：${size}/${opts.totalBytes}`)
  }
}
