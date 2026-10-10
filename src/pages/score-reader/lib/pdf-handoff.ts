import Taro from '@tarojs/taro'

/**
 * 「保存到…」的四个出口：把本地那份 PDF **交给用户能看见的地方**。
 *
 * 为什么只能这样：小程序写不了用户可见/可指定的目录（手机端沙盒 + Android 11 分区存储），
 * 所以「用户知道文件在哪」在小程序里的唯一解是**不让文件停在小程序里**。
 *
 * 四个出口的落点各不相同，`name` 都必须显式传：
 * - `favorites` → **微信收藏**（我 → 收藏），留在微信里、会同步到电脑微信；
 * - `chat` → **微信聊天**（选好友或文件传输助手发出）；
 * - `app` → 交给系统（iOS「存储到文件」能进文件 App；Android 交给 WPS/文件管理器后可另存为）；
 * - `disk` → **PC 磁盘**（Windows/Mac 微信）。
 *
 * ⚠️ `name` 传的是带 `.pdf` 后缀的完整文件名。前三个 API 都有 `fileName` 参数可以覆盖
 * 沙盒里的 basename——显式传是**双保险**（`openDocument` 没有这个参数，它只认 basename，
 * 所以 pdf-save 那边的命名才是根本）。
 *
 * ⚠️ 平台能力（都是实测过或官方文档明写的，别再假设）：
 * - `disk` **仅 PC**（Windows/Mac 版微信）；手机上没有这个 API。
 * - `favorites` / `chat` 需要基础库 2.16.1+；`chat` 在 Android 上要求路径**带正确后缀**
 *   （临时路径不带，会认不出文件类型）——这正是我们要先落成 `…/xxx.pdf` 的原因。
 */

export type HandoffKind = 'favorites' | 'chat' | 'app' | 'disk'

export type HandoffDeps = {
  addFileToFavorites?: (o: {
    filePath: string
    fileName?: string
    success?: () => void
    fail?: (e: { errMsg?: string }) => void
  }) => unknown
  shareFileMessage?: (o: {
    filePath: string
    fileName?: string
    success?: () => void
    fail?: (e: { errMsg?: string }) => void
  }) => unknown
  openDocument?: (o: {
    filePath: string
    showMenu?: boolean
    success?: () => void
    fail?: (e: { errMsg?: string }) => void
  }) => unknown
  saveFileToDisk?: (o: { filePath: string }) => Promise<unknown> | unknown
}

/**
 * 这台设备上该给出哪几个出口（顺序即面板里的顺序）。
 *
 * 纯函数：**PC 才加「保存到电脑」**——手机上那个 API 不存在，给了按钮只会报错
 * （见 pdf-handoff 头部的平台能力说明）。
 */
export function handoffKindsFor(platform: string | undefined): HandoffKind[] {
  const kinds: HandoffKind[] = ['favorites', 'chat', 'app']
  if (platform === 'windows' || platform === 'mac') kinds.push('disk')
  return kinds
}

function taroHandoffDeps(): HandoffDeps {
  // `addFileToFavorites` / `saveFileToDisk` 不一定在 Taro 的类型里（版本差异），
  // 按仓内既有做法显式收窄后可选取用——拿不到就是「这台设备不支持」，由调用方报错
  const T = Taro as unknown as HandoffDeps
  return {
    addFileToFavorites: T.addFileToFavorites?.bind(Taro),
    shareFileMessage: T.shareFileMessage?.bind(Taro),
    openDocument: T.openDocument?.bind(Taro),
    saveFileToDisk: T.saveFileToDisk?.bind(Taro),
  }
}

/** 把回调风格的 API 包成 Promise（失败时把 errMsg 带出来——上报要它） */
function promisify(
  call: (cb: { success: () => void; fail: (e: { errMsg?: string }) => void }) => unknown,
  what: string
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    try {
      call({
        success: () => resolve(),
        fail: (e) => reject(new Error(e?.errMsg ?? `${what} failed`)),
      })
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)))
    }
  })
}

/**
 * 执行一次交付。**不支持 / 未实现**一律抛错（而不是静默什么都不做）——
 * 静默的话用户看到的是「点了没反应」，那比一句明确的失败提示糟得多。
 */
export async function handOffPdf(
  kind: HandoffKind,
  opts: { path: string; name: string },
  deps: HandoffDeps = taroHandoffDeps()
): Promise<void> {
  const { path, name } = opts
  switch (kind) {
    case 'favorites': {
      const api = deps.addFileToFavorites
      if (!api) throw new Error('addFileToFavorites 不可用（需基础库 2.16.1+）')
      await promisify((cb) => api({ filePath: path, fileName: name, ...cb }), 'addFileToFavorites')
      return
    }
    case 'chat': {
      const api = deps.shareFileMessage
      if (!api) throw new Error('shareFileMessage 不可用（需基础库 2.16.1+）')
      await promisify((cb) => api({ filePath: path, fileName: name, ...cb }), 'shareFileMessage')
      return
    }
    case 'app': {
      const api = deps.openDocument
      if (!api) throw new Error('openDocument 不可用')
      // showMenu 必须显式给：不给的话用户只能在预览页干看，什么都带不走
      await promisify((cb) => api({ filePath: path, showMenu: true, ...cb }), 'openDocument')
      return
    }
    case 'disk': {
      const api = deps.saveFileToDisk
      if (!api) throw new Error('saveFileToDisk 不可用（仅 PC 版微信）')
      await api({ filePath: path })
      return
    }
    default: {
      // 穷尽检查：新增出口时这里会编译不过，而不是悄悄什么都不做
      const never: never = kind
      throw new Error(`未知出口：${String(never)}`)
    }
  }
}
