import { loadAnnoDoc, saveAnnoDoc, type AnnoDoc } from '@/lib/annotation'
import { markAnnoPending } from '@/lib/annotation-sync'
import {
  flushAnnotationSync,
  scheduleAnnotationSync,
  setAnnotationAdoptListener,
  setAnnotationConflictListener,
  syncAnnotationFile,
} from '@/lib/annotation-sync-runner'
import { reportClientError } from '@/lib/error-report'

/**
 * 批注源接缝（P6a）：阅读器只跟这个接口打交道。
 *
 * - `personal`：本地 storage + 现有的个人云同步/冲突/历史，行为与今天逐字一致；
 * - `shared`：P6b 才实现（共享表 + CAS RPC），本阶段工厂直接抛错。
 *
 * 阅读器仍然持有 `annosRef` / `setAnnos` 与所有绘制状态；backend 只回答
 * 「从哪读、写到哪、何时同步」，不持有 React 状态。
 */
export type ReaderAnnotationBackend = {
  kind: 'personal' | 'shared'
  readOnly: boolean
  load(fileId: string): Promise<AnnoDoc>
  persist(fileId: string, doc: AnnoDoc): void | Promise<void>
  onOpen?(fileId: string): void | Promise<void>
  onClose?(): void
  /** 页面卸载时把挂着的防抖发掉（当前 useUnload 的最后一班车） */
  flush?(fileId: string): void
  /** shared 同步失败后的手动重试（personal 不实现） */
  retry?(): void
}

export type AnnotationBackendCallbacks = {
  /** 别处（全量扫描）把本册内容落回本地时，同步阅读器内存态 */
  onAdopt: (doc: AnnoDoc) => void
  /** 本册发现冲突：阅读器刷新冲突列表 */
  onConflict: () => void
  /** 进册这一次对账完成：阅读器刷新冲突列表 */
  onSynced: () => void
}

/**
 * 只有 personal 实现；shared 留给 P6b。
 * 这里显式抛错而不是静默降级——P6b 接线时少一个「以为在读写共享谱」的假象。
 */
export function createAnnotationBackend(
  kind: 'personal' | 'shared',
  callbacks: AnnotationBackendCallbacks,
  /** 批注归属（D16）：auth user id，未登录为 `guest` */
  owner: string
): ReaderAnnotationBackend {
  if (kind === 'shared') {
    throw new Error('shared annotation backend is not implemented (P6b)')
  }
  return createPersonalAnnotationBackend(callbacks, owner)
}

function createPersonalAnnotationBackend(
  callbacks: AnnotationBackendCallbacks,
  owner: string
): ReaderAnnotationBackend {
  /** 每册每次会话只报一次：存储满会一直失败，别刷表 */
  let saveFailedReported = false

  const backend: ReaderAnnotationBackend = {
    kind: 'personal',
    readOnly: false,

    load(fileId) {
      // 纯本地读，不发网络；包成 Promise 只是为了与 shared 的异步接口统一
      return Promise.resolve(loadAnnoDoc(owner, fileId))
    },

    persist(fileId, doc) {
      if (backend.readOnly) return
      // 与 P6a 之前逐字相同的顺序：先记欠账、再起停笔防抖、最后同步写盘
      markAnnoPending(owner)
      scheduleAnnotationSync(fileId)

      // 这一下是同步阻塞主线程的（整册序列化 + setStorageSync）；超阈值记一条
      const saveStart = Date.now()
      const saved = saveAnnoDoc(owner, fileId, doc)
      const saveCost = Date.now() - saveStart
      if (saveCost > 80) {
        reportClientError({
          event: 'score_reader_annotation_save_slow',
          message: 'saveAnnoDoc 阻塞超阈值',
          detail: { fileId, ms: saveCost, pages: Object.keys(doc).length },
        })
      }
      if (!saved && !saveFailedReported) {
        saveFailedReported = true
        reportClientError({
          event: 'score_reader_annotation_save_failed',
          message: 'setStorageSync 失败（存储满/超限？）',
          detail: { fileId, pages: Object.keys(doc).length },
        })
      }
    },

    onOpen(fileId) {
      setAnnotationAdoptListener((id, doc) => {
        if (id === fileId) callbacks.onAdopt(doc)
      })
      setAnnotationConflictListener((id) => {
        if (id === fileId) callbacks.onConflict()
      })
      // 进册先拉后推对一次账；完成后再刷一次冲突列表（与 P6a 之前一致）
      void syncAnnotationFile(fileId).then(() => callbacks.onSynced())
    },

    onClose() {
      setAnnotationAdoptListener(null)
      setAnnotationConflictListener(null)
    },

    flush(fileId) {
      flushAnnotationSync(fileId)
    },
  }

  return backend
}
