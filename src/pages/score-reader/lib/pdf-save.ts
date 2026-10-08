/**
 * 顶栏「下载」：把**原始 PDF** 存到小程序本地文件。
 *
 * 与「原生打开」的分工：那个把文件交给系统应用（看 / 转发），这个**只落盘**
 * ——成员有时要的是文件本身（打印、存档、发出去）。
 *
 * 路径按册固定（`pkuso-score-<fileId>.pdf`），而不是用 `Taro.saveFile` 的自动命名：
 * 自动命名每次调用都是一份**新**文件，重复点会白占本地配额（一册 PDF 可达 30MB），
 * 而固定路径天然幂等，也让「存过就不再下」成为可能（一册的页图总量才几 MB，PDF 可能 30MB）。
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

export function savedPdfPath(root: string, fileId: string): string {
  return `${root}/pkuso-score-${fileId}.pdf`
}

/** 用到的 FileSystemManager 三件事（收窄成注入点，测试给假实现） */
export type FsLike = {
  access(o: { path: string; success: () => void; fail: () => void }): void
  saveFile(o: {
    tempFilePath: string
    filePath: string
    success: () => void
    fail: (e: { errMsg?: string }) => void
  }): void
  unlink(o: { filePath: string; success?: () => void; fail?: () => void }): void
}

export type SavePdfDeps = {
  root: string | null
  fs: FsLike | null
  download: (url: string) => Promise<{ statusCode: number; tempFilePath: string }>
}

export type SavePdfResult = {
  path: string
  /** true = 本地已有，没再下一次（省下 2–30MB 流量） */
  reused: boolean
}

function hasFile(fs: FsLike, path: string): Promise<boolean> {
  return new Promise((resolve) => {
    fs.access({ path, success: () => resolve(true), fail: () => resolve(false) })
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
 * 下载并落盘。已存在时**直接复用，不发请求**（判据是本地文件在不在，不是内存里的记账
 * ——后者在冷启动后是空的，会让每次进册都重下一遍）。
 */
export async function saveOriginalPdf(
  opts: { fileId: string; url: string },
  deps: SavePdfDeps
): Promise<SavePdfResult> {
  const { root, fs, download } = deps
  // 拿不到根目录就别假装成功：转成错误，让上层照常报错 + 提示
  if (!root) throw new Error('no USER_DATA_PATH')
  if (!fs) throw new Error('no FileSystemManager')
  const path = savedPdfPath(root, opts.fileId)
  if (await hasFile(fs, path)) return { path, reused: true }
  const res = await download(opts.url)
  if (res.statusCode !== 200) throw new Error(`HTTP ${res.statusCode}`)
  await saveTo(fs, res.tempFilePath, path)
  return { path, reused: false }
}
