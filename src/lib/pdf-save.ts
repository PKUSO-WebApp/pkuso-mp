/**
 * 「保存到…」的地基：**保证本地有一份这份谱的 PDF**，并让它带一个**给人看的名字**。
 *
 * 为什么需要它：小程序里没有任何 API 能把文件写进用户可见/可指定的目录（手机端沙盒 +
 * Android 11 分区存储，平台红线）。所以「下载到某处」这件事只能靠**把文件交给用户
 * 选的地方**实现——收藏到微信 / 转发给好友 / 用其他应用打开 / 保存到电脑，四条出口
 * 都需要一个本地文件路径，这就是本模块存在的唯一理由。它**不是**给用户看的存储，
 * 只是交付前的中转。
 *
 * ⚠️ 名字是这四个出口的**粘合剂**：`openDocument` 的系统菜单、`saveFileToDisk` 的落盘名
 * 都取自沙盒里那个文件的 basename——所以只要这里的命名对了，出口各自不必再处理。
 *
 * 路径分两层，各自解决一个问题：
 * - **目录按 fileId**（`pkuso-score/<fileId>/`）⇒ 幂等：判「下过没有」看目录里有没有 pdf，
 *   与显示名解耦（曲名改了、或缺参数拿不到曲名，都不会让已下好的文件失联、白重下）；
 * - **文件名 = `{曲子}_{声部}_{文件名}.pdf`** ⇒ 交付时给人看的就是这个名字。
 */

/** `wx.env.USER_DATA_PATH`：Taro 的类型里没有它（只有 wx 上有），按仓内既有做法从全局取 */
export function userDataRoot(): string | null {
  try {
    const w = (globalThis as { wx?: { env?: { USER_DATA_PATH?: string } } }).wx
    return w?.env?.USER_DATA_PATH ?? null
  } catch {
    return null
  }
}

/** 文件名里不能出现的字符（路径分隔符 + Windows 保留字符 + 控制字符） */
const UNSAFE = /[\\/:*?"<>|\u0000-\u001f]/g
/** 名字主体（不含 .pdf）的上限：够长到不会误伤正常曲名，又不至于撞文件系统的单段上限 */
export const MAX_NAME_CHARS = 80

/**
 * 交付用的文件名：`{曲子}_{声部}_{文件名}.pdf`，缺失的部分自动省略。
 *
 * 例（都是库里的真实值）：`肖五_第一小提琴_小提琴1.pdf`；只有文件名时回退成 `小提琴1.pdf`。
 *
 * 用**库里的原始值**（不翻译）而不是界面语言的译名：文件名是分享出去给别人看的，
 * 而库里的曲名与文件名本来就是中文；跟着界面语言走会让同一份谱在英文模式下
 * 变成另一个名字（同一个文件被下两次、收到的人也对不上号）。
 *
 * ⚠️ `file_name` 在库里**本身就带 `.pdf`**（实测：`小提琴1.pdf`、`长号2.pdf`）
 * ——拼之前必须先剥掉，否则会得到 `…_小提琴1.pdf.pdf`。
 */
export function displayPdfName(p: { title?: string; section?: string; fileName: string }): string {
  const stem = sanitizeName(p.fileName ?? '').replace(/\.pdf$/i, '')
  const parts = [p.title, p.section, stem]
    .map((s) => sanitizeName(s ?? ''))
    .filter((s) => s.length > 0)
  const base = parts.join('_').slice(0, MAX_NAME_CHARS) || 'score'
  return `${base}.pdf`
}

/** 去掉文件名里非法的字符、把连续空白压成一个空格（`《红旗颂》 / 弦乐` 这类不该毁掉整个名字） */
function sanitizeName(s: string): string {
  return s.replace(UNSAFE, ' ').replace(/\s+/g, ' ').trim()
}

/** 这一册的目录（幂等的判据落在它上面，与显示名无关） */
export function savedPdfDir(root: string, fileId: string): string {
  return `${root}/pkuso-score/${fileId}`
}

/** 迁移前的老路径（`pkuso-score-<fileId>.pdf` 直接躺在根下）——只为清掉它而存在 */
export function legacyPdfPath(root: string, fileId: string): string {
  return `${root}/pkuso-score-${fileId}.pdf`
}

/** 用到的 FileSystemManager 能力（收窄成注入点，测试给假实现） */
export type FsLike = {
  access(o: { path: string; success: () => void; fail: () => void }): void
  saveFile(o: {
    tempFilePath: string
    filePath: string
    success: () => void
    fail: (e: { errMsg?: string }) => void
  }): void
  unlink(o: { filePath: string; success?: () => void; fail?: () => void }): void
  mkdir(o: {
    dirPath: string
    recursive?: boolean
    success?: () => void
    fail?: (e: { errMsg?: string }) => void
  }): void
  readdir(o: { dirPath: string; success: (res: { files: string[] }) => void; fail?: () => void }): void
}

/**
 * 下载失败后的退避重试间隔（数组长度 = 重试次数）。
 *
 * 与页图那条路同一套数值与理由（见阅读器 `page-image.ts` 的 PAGE_IMAGE_RETRY_DELAYS_MS）：
 * 跨境**直连**（storage 恒走直连，见 lib/supabase-entry.ts）在传输中途被重置是常见的瞬时
 * 失败，退避一拍再来基本就好。PDF 是全 App 最大的文件（均 2.4MB、最大 30.7MB，页图只有
 * ~500KB）⇒ 它是最容易撞上这条的那个，而这条路**此前一次重试都没有**
 * （线上实证：2026-10-09 与 10-10 各一次 iOS `errno -101 ERR_CONNECTION_RESET`）。
 */
export const PDF_RETRY_DELAYS_MS = [500, 1000]

export type SavePdfDeps = {
  root: string | null
  fs: FsLike | null
  download: (url: string) => Promise<{ statusCode: number; tempFilePath: string }>
  /** 测试注入用；默认真等 */
  sleep?: (ms: number) => Promise<void>
}

export type SavePdfResult = {
  path: string
  /** 交付用的文件名（四个出口都该用它，别各自再拼一遍） */
  name: string
  /** true = 本地已有，没再下一次（省下 2–30MB 流量） */
  reused: boolean
}

function hasFile(fs: FsLike, path: string): Promise<boolean> {
  return new Promise((resolve) => {
    fs.access({ path, success: () => resolve(true), fail: () => resolve(false) })
  })
}

/** 目录里已有的 pdf（拿不到目录/目录不存在都按「没有」处理） */
function listPdfs(fs: FsLike, dir: string): Promise<string[]> {
  return new Promise((resolve) => {
    try {
      fs.readdir({
        dirPath: dir,
        success: (res) => resolve((res?.files ?? []).filter((f) => /\.pdf$/i.test(f))),
        fail: () => resolve([]),
      })
    } catch {
      resolve([])
    }
  })
}

function mkdirp(fs: FsLike, dir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      fs.mkdir({
        dirPath: dir,
        recursive: true,
        success: () => resolve(),
        fail: (e) => reject(new Error(e?.errMsg ?? 'mkdir failed')),
      })
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)))
    }
  })
}

function saveTo(fs: FsLike, tempFilePath: string, filePath: string): Promise<void> {
  const once = () =>
    new Promise<void>((resolve, reject) => {
      fs.saveFile({
        tempFilePath,
        filePath,
        success: () => resolve(),
        fail: (e) => reject(new Error(e?.errMsg ?? 'saveFile failed')),
      })
    })
  // 目标若已存在，部分环境会直接报错——先删掉再试一次。
  // 走到这里说明 access 没看见它（竞态 / 上次留下半截），所以删是安全的。
  return once().catch(() => {
    const retry = new Promise<void>((resolve) => {
      fs.unlink({ filePath, success: () => resolve(), fail: () => resolve() })
    })
    return retry.then(once)
  })
}

/**
 * 带退避重试的下载：只在**网络层失败**时重试（`downloadFile` 抛出来的那些错误）。
 * 试满仍失败则抛**最后一次**的错误（最早的往往只是一个已被覆盖的瞬时失败）。
 */
async function downloadWithRetry(
  download: NonNullable<SavePdfDeps['download']>,
  url: string,
  sleep: (ms: number) => Promise<void>
): Promise<{ statusCode: number; tempFilePath: string }> {
  let lastErr: unknown = null
  for (let attempt = 0; attempt <= PDF_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      return await download(url)
    } catch (err) {
      lastErr = err
      if (attempt < PDF_RETRY_DELAYS_MS.length) await sleep(PDF_RETRY_DELAYS_MS[attempt] ?? 1000)
    }
  }
  throw lastErr ?? new Error('download failed')
}

/**
 * 保证本地有一份这份谱的 PDF，返回它的路径与交付用文件名。
 *
 * 复用判据是**文件在不在**（不是内存记账——冷启动后记账是空的，会让每次进册都重下一遍）：
 * 先把「按当前元数据算出的名字」试一遍，不中再退到「这个目录里任何一个 pdf」——
 * 于是曲名改了、或从缺参数的旧入口进来时，**已下好的那份仍然复用得着**，不会白重下，
 * 也不会把一份名字更全的文件降级改名。
 */
export async function ensureSavedPdf(
  opts: { fileId: string; url: string; title?: string; section?: string; fileName: string },
  deps: SavePdfDeps
): Promise<SavePdfResult> {
  const { root, fs, download } = deps
  // 拿不到根目录就别假装成功：转成错误，让上层照常报错 + 提示
  if (!root) throw new Error('no USER_DATA_PATH')
  if (!fs) throw new Error('no FileSystemManager')
  const name = displayPdfName(opts)
  const dir = savedPdfDir(root, opts.fileId)
  const path = `${dir}/${name}`
  if (await hasFile(fs, path)) return { path, name, reused: true }
  const found = await listPdfs(fs, dir)
  const first = found[0]
  if (first) return { path: `${dir}/${first}`, name: first, reused: true }

  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const res = await downloadWithRetry(download, opts.url, sleep)
  // ⚠️ 非 200 的判断在**重试之外**：那是服务端明确拒绝（403/404…），再试几次也一样，
  // 重试它只会白等两秒、白占额度。重试只该针对网络层失败（如 ERR_CONNECTION_RESET）。
  if (res.statusCode !== 200) throw new Error(`HTTP ${res.statusCode}`)
  await mkdirp(fs, dir)
  await saveTo(fs, res.tempFilePath, path)
  // 老版本的路径（根下 `pkuso-score-<id>.pdf`）已经没人读：清掉它，别白占 200MB 配额
  // （失败无所谓——它只是垃圾，不是错误）
  fs.unlink({ filePath: legacyPdfPath(root, opts.fileId) })
  return { path, name, reused: false }
}
