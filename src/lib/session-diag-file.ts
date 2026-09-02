// session-diag 的 weapp 文件落盘实现（独立模块：仅 app 层引入，避免污染纯逻辑依赖链）
import Taro from '@tarojs/taro'
import { logDiag, setSessionDiagFileSink } from './session-diag'

const MAX_FILE_BYTES = 10 * 1024 * 1024

function filePath(): { path: string; dir: string } | null {
  try {
    const w = (globalThis as { wx?: { env?: { USER_DATA_PATH?: string } } }).wx
    const root = w?.env?.USER_DATA_PATH
    if (!root) return null
    // 写入 USER_DATA_PATH 的子目录（部分环境——尤其开发者工具的 http://usr 根目录
    // 并不真实存在，直接写根会报 no such file or directory，必须先建子目录）
    const dir = `${root}/diag`
    return { dir, path: `${dir}/session-diag.log` }
  } catch {
    return null
  }
}

/** 注入文件 sink：先确保目录存在；超限轮转（丢弃旧档，诊断日志允许有损）；FS 异常不外抛 */
export function installSessionDiagFileSink(): void {
  try {
    const target = filePath()
    logDiag('file_sink_install_begin', { ...target })
    if (!target) {
      logDiag('file_sink_skip_no_path')
      return
    }
    const fs = Taro.getFileSystemManager?.()
    if (!fs) {
      logDiag('file_sink_skip_no_fs')
      return
    }
    ensureDir(fs, target.dir)
    setSessionDiagFileSink((chunk) => {
      writeChunk(fs, target, chunk)
    })
    logDiag('file_sink_installed', { path: target.path })
  } catch (err) {
    logDiag('file_sink_install_error', {
      err: err instanceof Error ? err.message : String(err),
    })
  }
}

type FsLike = ReturnType<() => Taro.FileSystemManager>

function ensureDir(fs: FsLike, dir: string): void {
  try {
    fs.mkdirSync(dir, true)
  } catch {
    /* 已存在或其他错误交由写入重试兜底 */
  }
}

function writeChunk(fs: FsLike, target: { path: string; dir: string }, chunk: string): void {
  try {
    // 模拟器的 appendFileSync 不自动创建缺失文件：先探测，缺档则用 writeFileSync 建档
    let exists = true
    try {
      const stat = fs.statSync(target.path)
      const size =
        stat && typeof stat === 'object' && 'size' in stat ? (stat as { size: number }).size : 0
      if (size > MAX_FILE_BYTES) fs.unlinkSync(target.path)
    } catch {
      exists = false
    }
    if (exists) fs.appendFileSync(target.path, chunk, 'utf8')
    else fs.writeFileSync(target.path, chunk, 'utf8')
    // 成功不记日志：sink 内部打点会与 flush 形成自激（见 session-diag 重入守卫）
  } catch (firstErr) {
    // 目录可能被清理等：重建目录后按同样「无档则创建」策略重试一次
    try {
      ensureDir(fs, target.dir)
      let exists = true
      try {
        fs.statSync(target.path)
      } catch {
        exists = false
      }
      if (exists) fs.appendFileSync(target.path, chunk, 'utf8')
      else fs.writeFileSync(target.path, chunk, 'utf8')
    } catch (retryErr) {
      logDiag('file_write_error', {
        first: firstErr instanceof Error ? firstErr.message : String(firstErr),
        retry: retryErr instanceof Error ? retryErr.message : String(retryErr),
      })
    }
  }
}
