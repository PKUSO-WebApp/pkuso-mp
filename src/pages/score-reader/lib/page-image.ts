import Taro from '@tarojs/taro'
import type { CanvasImage, CanvasNode } from './types'

/**
 * 页图（上传时预渲染的整页 JPEG）的加载与绘制。
 *
 * **主路径**：把网络 URL 直接交给小程序的图片层（`canvas.createImage`）—— 微信自己有
 * 图片缓存（磁盘 LRU），重复打开同一页由它负责。这也是为什么主路径**不用**
 * `Taro.downloadFile`：它不走 HTTP 缓存，每次都是真下载。
 *
 * **兜底**（2026-10-08 加）：个别 iOS 设备上图片层**必现**失败 —— onerror 连文案都不给、
 * 两条腿（反代/直连）都一样、点重试也没用；而同一时刻服务端 storage 日志显示那张图是
 * 200 正常取到的（失败在客户端图片层，不在网络）。这类设备上 dev.128/129 用过的
 * 「先 downloadFile 落成临时文件、再从本地路径解码」是通的（那一版真机验证过），
 * 所以图片层全部失败后自动改走它。代价是不吃 HTTP 缓存 —— 只该在图片层确实坏了时发生。
 *
 * ⚠️ 路径规则与 web 端 `sheetMusicPagePath` 必须一致（`{storage_path 去 .pdf}/p{n}.jpg`）。
 */

/**
 * 页图加载超时（毫秒）。
 *
 * 弱网下 500KB 的图确实可能要几十秒，但**不能无限等**：实测有用户在 iOS 上卡了
 * 150 秒（服务端日志显示那次请求根本没到达 —— 卡在客户端网络栈）。超时后走错误态
 *（带重试），比无声等待强。
 *
 * ⚠️ 超时只是**放弃等待**，微信那边的加载还在跑（`createImage` 没有取消接口）——
 * 成功也不会再被采用，属可接受的浪费。
 */
const PAGE_IMAGE_TIMEOUT_MS = 30000

/** 反代那条腿的超时：它该快，慢了说明这条腿不通，没必要占着用户等待 */
const PROXY_LEG_TIMEOUT_MS = 15000

/**
 * 一页已加载的页图（尺寸在 onload 之后才有）。
 *
 * `via` = 这一张实际走的是哪一档：`file` 本地文件（预下载命中，**正常路径**）、
 * `image` 图片层 + 远端 URL、`download` 现下的兜底。真机验收第一眼看的就是它：
 * 滑动时要是还常常出现 `image`/`download`，说明预下载没铺到位。
 */
export type LoadedPageImage = {
  img: CanvasImage
  width: number
  height: number
  via: 'file' | 'image' | 'download'
}

/**
 * 页图加载失败时抛出的错误，额外带上**只有这里能拿到**的诊断信息：
 * - `urlIndex`：候选 URL 里第几条失败（0 = 反代、1 = 直连）——区分「哪条腿不通」；
 * - `errMsg`：图片层 `onerror` 的原始文案（部分版本会给出原因，例如
 *   `url not in domain list`）。没有它，「网络/入口」与「域名白名单/解码被拒」
 *   在事后完全分不开（onerror 不带状态码，屏幕上只有一句「加载失败」）；
 * - `via`：最后失败发生在哪条路（`image` = 小程序图片层、`file` = downloadFile 兜底）；
 * - `trace`：**两条路每一条**的失败原因按顺序串成的一行。只有 `errMsg` 时看不全
 *   （它只是最后一条腿的），而「图片层失败 + 兜底也失败」与「只有图片层失败」是
 *   两种完全不同的故障，事后必须能分开。
 */
export type PageImageError = Error & {
  urlIndex?: number
  errMsg?: string
  via?: 'image' | 'file'
  trace?: string
}

/** 从 onerror 的回传里尽量榨出可读文案（形态随版本不同，所以什么都接一下） */
function detailOf(e: unknown): string {
  try {
    if (!e) return ''
    if (typeof e === 'string') return e
    const any = e as { errMsg?: unknown; detail?: { errMsg?: unknown } }
    const msg = any.errMsg ?? any.detail?.errMsg
    if (typeof msg === 'string') return msg
    return JSON.stringify(e).slice(0, 200)
  } catch {
    return ''
  }
}

/**
 * 加载一页页图（onload 才算完成）；失败抛出，调用方走既有错误路径。
 *
 * 尺寸直接取自图片对象 —— 不需要额外的 `getImageInfo`（少一次文件/网络往返）。
 */
/** 单个 URL 的加载（onload 才算完成）；`via` 由调用方指定（见 LoadedPageImage） */
function loadOnePageImage(
  node: CanvasNode,
  url: string,
  timeoutMs: number,
  via: LoadedPageImage['via']
): Promise<LoadedPageImage> {
  const img = node.createImage!()
  return new Promise<LoadedPageImage>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('页图加载超时')), timeoutMs)
    img.onload = () => {
      clearTimeout(timer)
      resolve({ img, width: img.width ?? 0, height: img.height ?? 0, via })
    }
    img.onerror = (e) => {
      clearTimeout(timer)
      const err = new Error('页图加载失败') as PageImageError
      const msg = detailOf(e)
      if (msg) err.errMsg = msg
      reject(err)
    }
    // onload/onerror 挂好之后再赋 src —— 反过来会漏掉同步完成的加载
    img.src = url
  })
}

/** 测试注入点：默认走 `Taro.downloadFile`；失败路径无外部依赖，不注入也能跑 */
export type PageImageDeps = {
  downloadFile?: (
    url: string,
    timeoutMs: number
  ) => Promise<{ statusCode: number; tempFilePath: string }>
  /**
   * 本地文件记账的键。**必须与入口无关**（调用方传 `fileId#页号`）。
   *
   * 从前键恒取 `urls[0]`——而 `urls[0]` 是**当前生效入口**派生的：入口在一次请求失败后
   * 会被 `switchTo('direct')` 改写并持久化，键随之改变 ⇒ 整册预下载下好的本地文件在第 0 档
   * **集体失联**（前台按新键查全 miss，回落到图片层「远端 URL」那条腿——正是整册预下载要
   * 规避的东西），而泵又因为已把那些页标记成 attempted 不会重下 ⇒ 本会话里这批文件作废。
   * （评审 2026-10-09 抓出。）
   *
   * ⚠️ **它是必填的，而不是「可选 + 兜底」**：兜底值只能是 `urls[0]`，正是上面那个错误答案；
   * 而可选就意味着「某个调用点忘了传」不会有任何提示——2026-10-10 实测的形态就是预绘制那条
   * 路径漏传，于是**整册已在本地也永远命不中第 0 档**、每次都要真走一次网络。改成必填之后，
   * 漏传是**编译错误**。
   */
  key: string
}

function defaultDownloadFile(url: string, timeoutMs: number) {
  return Taro.downloadFile({ url, timeout: timeoutMs })
}

/**
 * 记一次腿失败：写 urlIndex / via，并把原因攒进 trace。
 *
 * trace 里的原因要**当场**取：`e.errMsg` 只有最后一条腿的，而 rethrow 之后没人再知道
 * 前面那几条是怎么死的。
 */
function noteFailure(
  err: unknown,
  via: 'image' | 'file',
  urlIndex: number,
  trace: string[]
): PageImageError {
  const e = (err instanceof Error ? err : new Error(String(err))) as PageImageError
  e.urlIndex = urlIndex
  e.via = via
  const why = e.errMsg ? `${e.message}（${e.errMsg}）` : e.message
  trace.push(`${via}#${urlIndex} ${why}`.slice(0, 80))
  return e
}

/**
 * 已下载过的页图本地路径（本会话记账，键 = 该页的**第一条 URL**，两条腿指向同一张图）。
 *
 * **整册记账**（2026-10-09 起）：进册即把整册下到本地临时文件（见 `prefetchPageImage`），
 * 前台渲染的第 0 档就命中它 —— 正常使用中**根本不问图片层**，「远端 URL 交给图片层」
 * 那类 iOS 必现故障因此不会出现在主路径上。上限只是防呆：`downloadFile` 的临时文件有
 * 4GB 预算且平台自己按 LRU 清（单小程序超 2GB 才动手），一册最多几十页，碰不到这个上限。
 * 值可能失效（微信会清临时文件）——用之前先试，失败就把这条记账删掉重新下。
 */
const FILE_CACHE_LIMIT = 200
const fileCache = new Map<string, string>()

function rememberFile(url: string, path: string): void {
  fileCache.delete(url)
  fileCache.set(url, path)
  while (fileCache.size > FILE_CACHE_LIMIT) {
    const oldest = fileCache.keys().next().value
    if (oldest === undefined) break
    fileCache.delete(oldest)
  }
}

/**
 * 登记一条**上次会话留下、且已探活通过**的本地路径（跨会话复用的入口，见
 * lib/page-file-store.ts）。与 `rememberFile` 共用同一份记账，区别只在来源：
 * 那个是「刚下完」，这个是「以前下过、文件还在」。
 */
export function registerLocalFile(key: string, path: string): void {
  rememberFile(key, path)
}

/** 读一条记账（写跨会话账时要把整册快照出来）。`undefined` = 没下过 / 已被判定失效 */
export function localFileFor(key: string): string | undefined {
  return fileCache.get(key)
}

/**
 * 本会话对「小程序图片层还能不能用」的判定：判过一次就不再每页白撞它一遍。
 *
 * ⚠️ **真正的「失败前判断」做不到** —— 判断本身就是一次取图，没有别的信息源（微信也没给
 * 查询「这个设备能不能用图片层」的接口）。能做的是**只判一次**，并且让判据尽量硬：
 * **同一条 URL 图片层刚失败、downloadFile 当场拿得到**（地址与网络都好，坏的就是图片层
 * 这一层）⇒ 本会话余下取图直接走兜底。反过来，两条路都失败时**不下结论**（可能只是网络
 * 或入口的问题），下一次仍然先试图片层——这也是「刚才那次拒绝可能只是瞬时抖动」
 * （见 PAGE_IMAGE_RETRY_DELAYS_MS 的注释）留下的余地。
 */
let imageLayerBroken = false

/** 换册 / 用户点「重试」时复位：网络换了、或用户明确要求重来时，值得重新判一次 */
export function resetPageImageStrategy(): void {
  imageLayerBroken = false
}

/** 诊断用（真机日志/用例里能看出这台设备走的是哪条路） */
export function isImageLayerBroken(): boolean {
  return imageLayerBroken
}

/**
 * 预取（预热泵用）：**一律把页图下载到本地文件**（2026-10-09 起）。
 *
 * 从前是「图片层能用就走 `getImageInfo`（吃微信图片缓存）」——改掉的理由是那条路正是
 * iOS 故障路径的入口；而且图片层的缓存不透明、容量不公开、清不清由平台说了算。
 * 本地文件是我们自己的：路径确定、可记账复用、且**不占 200MB 持久配额**
 * （`downloadFile` 的临时文件是另一个池子，4GB 预算 + 平台 LRU）。
 * 流量不增反降：健康设备上 `getImageInfo` 本来也是把整张下回来。
 */
export function prefetchPageImage(url: string, deps: PageImageDeps): Promise<unknown> {
  return warmPageImageFile(url, deps.key, deps.downloadFile ?? defaultDownloadFile)
}

/** 把一页图下进本地记账（不画，只为让它进缓存）；已有记账就不重复下。`key` 见 PageImageDeps */
async function warmPageImageFile(
  url: string,
  key: string,
  download: NonNullable<PageImageDeps['downloadFile']>
): Promise<void> {
  if (fileCache.has(key)) return
  const res = await download(url, PAGE_IMAGE_TIMEOUT_MS)
  if (res.statusCode !== 200) throw new Error(`页图下载失败：HTTP ${res.statusCode}`)
  rememberFile(key, res.tempFilePath)
}

/**
 * 兜底那条路：downloadFile 落成临时文件，再从**本地路径**解码（见文件头「兜底」）。
 * 本地路径也交给同一个 `loadOnePageImage` —— 只是 src 不同，onload/onerror 语义一样。
 *
 * `key` 与 `url` 分开：两条腿（反代/直连）指向同一张图，记账只该有一条。键由调用方给
 * （`fileId#页号`，与入口无关），否则从第 2 条腿下回来的那份第 0 档看不见，入口一换更是
 * 全部失联（见 PageImageDeps.key）。
 */
async function loadOnePageImageFromFile(
  node: CanvasNode,
  key: string,
  url: string,
  timeoutMs: number,
  download: NonNullable<PageImageDeps['downloadFile']>
): Promise<LoadedPageImage> {
  const cached = fileCache.get(key)
  if (cached) {
    try {
      return await loadOnePageImage(node, cached, timeoutMs, 'file')
    } catch {
      fileCache.delete(key) // 临时文件没了：这一条记账作废，往下重新下
    }
  }
  const res = await download(url, timeoutMs)
  if (res.statusCode !== 200) throw new Error(`页图下载失败：HTTP ${res.statusCode}`)
  const loaded = await loadOnePageImage(node, res.tempFilePath, timeoutMs, 'download')
  rememberFile(key, res.tempFilePath)
  return loaded
}

/**
 * 加载一页页图。三档，顺序即优先级：
 *   0. **本地文件**（整册预下载的产物）——主路径，命中时完全不碰图片层；
 *   1. 图片层 + 远端 URL（吃微信图片缓存）——只有「这一页还没下到本地」时才会走到
 *      （进册头几页、下载失败、或预下载被停）；
 *   2. downloadFile 落本地再解码——兜底。本会话已判定图片层坏了时，跳过第 1 档
 *      （见 `imageLayerBroken`）。
 *
 * 图片层那轮**依次尝试候选 URL**（见 `pageImageUrls`：反代优先、直连兜底）：第一个
 * （反代）用较短超时——它该快，慢了说明这条腿不通；后面的（直连）给足 30 秒，弱网下
 * 500KB 确实可能要几十秒。兜底那轮用同一组 URL、同样的顺序，理由相同。
 */
export async function loadPageImage(
  node: CanvasNode,
  urls: string[],
  deps: PageImageDeps
): Promise<LoadedPageImage> {
  if (typeof node.createImage !== 'function') {
    throw new Error('canvas node 不支持 createImage（无法显示页图）')
  }
  const download = deps.downloadFile ?? defaultDownloadFile
  const trace: string[] = []
  let lastErr: PageImageError | null = null
  // 第 0 档（**主路径**）：本地文件 —— 整册预下载的产物。命中时压根不问图片层，
  // 「远端 URL 交给图片层」那类故障（iOS 必现，见文件头）在正常使用中不会出现。
  // 记账键与入口解耦（见 PageImageDeps.key：入口一翻转 `urls[0]` 就变）
  const key = deps.key
  const cached = fileCache.get(key)
  if (cached) {
    try {
      return await loadOnePageImage(node, cached, PROXY_LEG_TIMEOUT_MS, 'file')
    } catch {
      fileCache.delete(key) // 临时文件没了：记账作废，往下走常规腿
    }
  }
  // 已判定图片层坏了 ⇒ 这一轮直接跳过它（判据与复位见 imageLayerBroken 的注释）
  if (!imageLayerBroken) {
    for (let i = 0; i < urls.length; i += 1) {
      try {
        return await loadOnePageImage(
          node,
          urls[i],
          i === 0 ? PROXY_LEG_TIMEOUT_MS : PAGE_IMAGE_TIMEOUT_MS,
          'image'
        )
      } catch (err) {
        lastErr = noteFailure(err, 'image', i, trace)
      }
    }
  }
  for (let i = 0; i < urls.length; i += 1) {
    try {
      const loaded = await loadOnePageImageFromFile(
        node,
        key,
        urls[i],
        PAGE_IMAGE_TIMEOUT_MS,
        download
      )
      // 图片层刚失败、兜底却拿得到 ⇒ 坏的是图片层这一层（地址与网络都好）：记下结论，
      // 本会话余下的取图不再白撞它。判据必须是「这一轮真的试过图片层」（trace 非空）。
      if (trace.length > 0) imageLayerBroken = true
      return loaded
    } catch (err) {
      lastErr = noteFailure(err, 'file', i, trace)
    }
  }
  if (lastErr) lastErr.trace = trace.join(' | ').slice(0, 300)
  throw lastErr ?? new Error('页图加载失败')
}

/**
 * 把已加载的页图画进画布（**位图像素坐标系** —— 与 raster.ts 的记号/探测同一坐标系，
 * 所以 `setTransform(1,0,0,1,0,0)` 后直接按位图尺寸画）。
 * 画布尺寸在这里设（另一个渲染路径已随 pdf.js 运行时一起删掉，见 index.tsx）。
 */
export function paintPageImage(
  node: CanvasNode,
  img: CanvasImage,
  bitmapW: number,
  bitmapH: number
): void {
  node.width = bitmapW
  node.height = bitmapH
  const ctx = node.getContext('2d')
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, bitmapW, bitmapH)
  ctx.drawImage(img, 0, 0, bitmapW, bitmapH)
}

/**
 * 取图失败后的退避重试间隔（数组长度 = 重试次数）。
 *
 * 为什么值得重试：图片层在**高并发或瞬时抖动**下会当场拒绝（`onerror` 连原因都不给），
 * 而这类拒绝往往是"这一刻的"——退避一拍再来基本就好。真机实测过一次：泵 4 个在飞时，
 * 前台那次取图被当场拒掉，两条腿都没到服务器（2026-10-04）。
 */
export const PAGE_IMAGE_RETRY_DELAYS_MS = [500, 1000]

/**
 * 取图 + 退避重试（默认失败后重试两次）。全部失败时抛**最后一次**的错误
 * （它带着 urlIndex / errMsg，见 loadPageImage）。
 *
 * `sleep` 可注入，测试里不用真等。
 */
export async function loadPageImageWithRetry(
  node: CanvasNode,
  urls: string[],
  opts: {
    delaysMs?: readonly number[]
    sleep?: (ms: number) => Promise<void>
    /** 透传给 loadPageImage（记账键是必填的，见 PageImageDeps.key） */
    deps: PageImageDeps
  }
): Promise<LoadedPageImage> {
  const delays = opts.delaysMs ?? PAGE_IMAGE_RETRY_DELAYS_MS
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  let lastErr: unknown
  for (let attempt = 0; attempt <= delays.length; attempt += 1) {
    try {
      return await loadPageImage(node, urls, opts.deps)
    } catch (err) {
      lastErr = err
      if (attempt < delays.length) await sleep(delays[attempt] ?? 0)
    }
  }
  throw lastErr
}

/** 预取/预热统一走 `lib/prefetch-pump.ts`（串行泵 + 优先带；此前的单页预取已由它取代）。
 *  预绘制（doPredraw）**刻意不走重试**：它是后台补充、随时可能被交互打断，重试只会白占额度。 */
