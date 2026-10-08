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

/** 一页已加载的页图（尺寸在 onload 之后才有） */
export type LoadedPageImage = { img: CanvasImage; width: number; height: number }

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
/** 单个 URL 的加载（onload 才算完成） */
function loadOnePageImage(
  node: CanvasNode,
  url: string,
  timeoutMs: number
): Promise<LoadedPageImage> {
  const img = node.createImage!()
  return new Promise<LoadedPageImage>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('页图加载超时')), timeoutMs)
    img.onload = () => {
      clearTimeout(timer)
      resolve({ img, width: img.width ?? 0, height: img.height ?? 0 })
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
 * 已下载过的页图本地路径（会话内记账）。**有界**：微信的本地文件有配额（200MB，
 * 与 pdf 缓存同池），只留最近用到的几十张，免得读一整册把配额吃满。
 * 值可能失效（微信会清临时文件）——用之前先试，失败就把这条记账删掉重新下。
 */
const FILE_CACHE_LIMIT = 40
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
 * 预取（预热泵用）：图片层能用就照旧走它（吃微信图片缓存）；**已判定它坏了就改成把图
 * 下进本地记账**——前台随后直接命中那份文件，翻页仍然不疼。流量与从前一致：健康设备上
 * `getImageInfo` 本来也是整张下回来。
 */
export function prefetchPageImage(url: string, deps: PageImageDeps = {}): Promise<unknown> {
  if (!imageLayerBroken) return Taro.getImageInfo({ src: url })
  return warmPageImageFile(url, deps.downloadFile ?? defaultDownloadFile)
}

/** 把一页图下进本地记账（不画，只为让它进缓存）；已有记账就不重复下 */
async function warmPageImageFile(
  url: string,
  download: NonNullable<PageImageDeps['downloadFile']>
): Promise<void> {
  if (fileCache.has(url)) return
  const res = await download(url, PAGE_IMAGE_TIMEOUT_MS)
  if (res.statusCode !== 200) throw new Error(`页图下载失败：HTTP ${res.statusCode}`)
  rememberFile(url, res.tempFilePath)
}

/**
 * 兜底那条路：downloadFile 落成临时文件，再从**本地路径**解码（见文件头「兜底」）。
 * 本地路径也交给同一个 `loadOnePageImage` —— 只是 src 不同，onload/onerror 语义一样。
 */
async function loadOnePageImageFromFile(
  node: CanvasNode,
  url: string,
  timeoutMs: number,
  download: NonNullable<PageImageDeps['downloadFile']>
): Promise<LoadedPageImage> {
  const cached = fileCache.get(url)
  if (cached) {
    try {
      return await loadOnePageImage(node, cached, timeoutMs)
    } catch {
      fileCache.delete(url) // 临时文件没了：这一条记账作废，往下重新下
    }
  }
  const res = await download(url, timeoutMs)
  if (res.statusCode !== 200) throw new Error(`页图下载失败：HTTP ${res.statusCode}`)
  const loaded = await loadOnePageImage(node, res.tempFilePath, timeoutMs)
  rememberFile(url, res.tempFilePath)
  return loaded
}

/**
 * 加载一页页图：**先图片层（吃缓存），全失败再走 downloadFile 兜底**；本会话已判定
 * 图片层坏了的话，直接走兜底那轮（见 `imageLayerBroken`）。
 *
 * 图片层那轮**依次尝试候选 URL**（见 `pageImageUrls`：反代优先、直连兜底）：第一个
 * （反代）用较短超时——它该快，慢了说明这条腿不通；后面的（直连）给足 30 秒，弱网下
 * 500KB 确实可能要几十秒。兜底那轮用同一组 URL、同样的顺序，理由相同。
 */
export async function loadPageImage(
  node: CanvasNode,
  urls: string[],
  deps: PageImageDeps = {}
): Promise<LoadedPageImage> {
  if (typeof node.createImage !== 'function') {
    throw new Error('canvas node 不支持 createImage（无法显示页图）')
  }
  const download = deps.downloadFile ?? defaultDownloadFile
  const trace: string[] = []
  let lastErr: PageImageError | null = null
  // 已判定图片层坏了 ⇒ 这一轮直接跳过它（判据与复位见 imageLayerBroken 的注释）
  if (!imageLayerBroken) {
    for (let i = 0; i < urls.length; i += 1) {
      try {
        return await loadOnePageImage(
          node,
          urls[i],
          i === 0 ? PROXY_LEG_TIMEOUT_MS : PAGE_IMAGE_TIMEOUT_MS
        )
      } catch (err) {
        lastErr = noteFailure(err, 'image', i, trace)
      }
    }
  }
  for (let i = 0; i < urls.length; i += 1) {
    try {
      const loaded = await loadOnePageImageFromFile(node, urls[i], PAGE_IMAGE_TIMEOUT_MS, download)
      // 图片层刚失败、兜底却拿得到 ⇒ 坏的是图片层这一层（地址与网络都好）：记下结论，
      // 本会话余下的取图不再白撞它。trace 为空说明这一轮压根没试图片层，别误判。
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
    /** 透传给 loadPageImage（测试注入 downloadFile 用） */
    deps?: PageImageDeps
  } = {}
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
