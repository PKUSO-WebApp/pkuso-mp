import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AnnoDoc } from '@/lib/annotation'
import { createAnnotationBackend } from './annotation-backend'

const mocks = vi.hoisted(() => ({
  loadAnnoDoc: vi.fn(),
  saveAnnoDoc: vi.fn(),
  markAnnoPending: vi.fn(),
  scheduleAnnotationSync: vi.fn(),
  flushAnnotationSync: vi.fn(),
  setAnnotationAdoptListener: vi.fn(),
  setAnnotationConflictListener: vi.fn(),
  syncAnnotationFile: vi.fn(),
  reportClientError: vi.fn(),
}))

vi.mock('@/lib/annotation', () => ({
  loadAnnoDoc: mocks.loadAnnoDoc,
  saveAnnoDoc: mocks.saveAnnoDoc,
}))

vi.mock('@/lib/annotation-sync', () => ({
  markAnnoPending: mocks.markAnnoPending,
}))

vi.mock('@/lib/annotation-sync-runner', () => ({
  scheduleAnnotationSync: mocks.scheduleAnnotationSync,
  flushAnnotationSync: mocks.flushAnnotationSync,
  setAnnotationAdoptListener: mocks.setAnnotationAdoptListener,
  setAnnotationConflictListener: mocks.setAnnotationConflictListener,
  syncAnnotationFile: mocks.syncAnnotationFile,
}))

vi.mock('@/lib/error-report', () => ({
  reportClientError: mocks.reportClientError,
}))

const callbacks = () => ({
  onAdopt: vi.fn(),
  onConflict: vi.fn(),
  onSynced: vi.fn(),
})

const order = (fn: { mock: { invocationCallOrder: number[] } }) => fn.mock.invocationCallOrder[0]

beforeEach(() => {
  vi.clearAllMocks()
  mocks.loadAnnoDoc.mockReturnValue({})
  mocks.saveAnnoDoc.mockReturnValue(true)
  mocks.syncAnnotationFile.mockResolvedValue(undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('createAnnotationBackend', () => {
  it('personal：load 委托 loadAnnoDoc，不发网络', async () => {
    const doc: AnnoDoc = { '1': [] }
    mocks.loadAnnoDoc.mockReturnValue(doc)
    const backend = createAnnotationBackend('personal', callbacks())

    await expect(backend.load('f1')).resolves.toBe(doc)
    expect(mocks.loadAnnoDoc).toHaveBeenCalledWith('f1')
    expect(backend.kind).toBe('personal')
    expect(backend.readOnly).toBe(false)
  })

  it('personal：persist 保持「记欠账 → 防抖 → 同步写盘」的顺序', () => {
    const backend = createAnnotationBackend('personal', callbacks())
    backend.persist('f1', { '1': [] })

    expect(order(mocks.markAnnoPending)).toBeLessThan(order(mocks.scheduleAnnotationSync))
    expect(order(mocks.scheduleAnnotationSync)).toBeLessThan(order(mocks.saveAnnoDoc))
  })

  it('personal：写盘超过 80ms 上报 slow 事件（字段与原来一致）', () => {
    const now = vi.spyOn(Date, 'now')
    now.mockReturnValueOnce(1000).mockReturnValueOnce(1100)
    const backend = createAnnotationBackend('personal', callbacks())

    backend.persist('f1', { '1': [], '2': [] })

    expect(mocks.reportClientError).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'score_reader_annotation_save_slow',
        detail: { fileId: 'f1', ms: 100, pages: 2 },
      })
    )
  })

  it('personal：写盘失败每次会话只报一次', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(0)
    mocks.saveAnnoDoc.mockReturnValue(false)
    const backend = createAnnotationBackend('personal', callbacks())

    backend.persist('f1', { '1': [] })
    backend.persist('f1', { '1': [] })

    expect(mocks.reportClientError).toHaveBeenCalledTimes(1)
    expect(mocks.reportClientError).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'score_reader_annotation_save_failed' })
    )
    now.mockRestore()
  })

  it('personal：onOpen 挂监听、按 fileId 过滤并触发同步；onClose 卸载', async () => {
    const cb = callbacks()
    const backend = createAnnotationBackend('personal', cb)

    backend.onOpen?.('f1')
    expect(mocks.setAnnotationAdoptListener).toHaveBeenCalledTimes(1)
    expect(mocks.setAnnotationConflictListener).toHaveBeenCalledTimes(1)
    expect(mocks.syncAnnotationFile).toHaveBeenCalledWith('f1')

    const adopt = mocks.setAnnotationAdoptListener.mock.calls[0][0] as (
      id: string,
      doc: AnnoDoc
    ) => void
    const conflict = mocks.setAnnotationConflictListener.mock.calls[0][0] as (
      id: string,
      pages: number[]
    ) => void

    adopt('f2', { '2': [] })
    expect(cb.onAdopt).not.toHaveBeenCalled()
    adopt('f1', { '1': [] })
    expect(cb.onAdopt).toHaveBeenCalledWith({ '1': [] })

    conflict('f2', [])
    expect(cb.onConflict).not.toHaveBeenCalled()
    conflict('f1', [])
    expect(cb.onConflict).toHaveBeenCalledTimes(1)

    await Promise.resolve()
    await Promise.resolve()
    expect(cb.onSynced).toHaveBeenCalledTimes(1)

    backend.onClose?.()
    expect(mocks.setAnnotationAdoptListener).toHaveBeenLastCalledWith(null)
    expect(mocks.setAnnotationConflictListener).toHaveBeenLastCalledWith(null)
  })

  it('personal：flush 委托 flushAnnotationSync', () => {
    const backend = createAnnotationBackend('personal', callbacks())
    backend.flush?.('f1')
    expect(mocks.flushAnnotationSync).toHaveBeenCalledWith('f1')
  })

  it('shared：P6a 显式拒绝，不静默降级', () => {
    expect(() => createAnnotationBackend('shared', callbacks())).toThrow(
      /shared annotation backend is not implemented/
    )
  })
})
