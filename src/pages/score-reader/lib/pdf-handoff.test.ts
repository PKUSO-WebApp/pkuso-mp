import { describe, expect, it, vi } from 'vitest'
import { handOffPdf, handoffKindsFor, type HandoffDeps, type HandoffKind } from './pdf-handoff'

/** 假的三方 API：记下每次调用的入参，并按 `fail` 决定成败 */
function fakeApis(failOn?: HandoffKind) {
  const calls: Array<{ api: string; o: Record<string, unknown> }> = []
  const cbStyle =
    (api: string, kind: HandoffKind) =>
    (o: Record<string, unknown> & { success?: () => void; fail?: (e: { errMsg: string }) => void }) => {
      calls.push({ api, o })
      if (failOn === kind) o.fail?.({ errMsg: `${api}:fail 用户取消` })
      else o.success?.()
    }
  const deps: HandoffDeps = {
    addFileToFavorites: cbStyle('addFileToFavorites', 'favorites'),
    shareFileMessage: cbStyle('shareFileMessage', 'chat'),
    openDocument: cbStyle('openDocument', 'app'),
    saveFileToDisk: vi.fn(async (o: { filePath: string }) => {
      calls.push({ api: 'saveFileToDisk', o })
    }),
  }
  return { deps, calls }
}

const OPTS = { path: '/usr/pkuso-score/f1/肖五_第一小提琴_小提琴1.pdf', name: '肖五_第一小提琴_小提琴1.pdf' }

describe('handoffKindsFor', () => {
  it('手机端三个出口，且不含「保存到电脑」（那个 API 手机上没有）', () => {
    for (const p of ['ios', 'android', 'devtools', undefined]) {
      expect(handoffKindsFor(p)).toEqual(['favorites', 'chat', 'app'])
    }
  })

  it('PC 端多一个「保存到电脑」，排在最后', () => {
    expect(handoffKindsFor('windows')).toEqual(['favorites', 'chat', 'app', 'disk'])
    expect(handoffKindsFor('mac')).toEqual(['favorites', 'chat', 'app', 'disk'])
  })
})

describe('handOffPdf', () => {
  it('收藏到微信：带上完整文件名（不是裸 basename，也不是不带后缀）', async () => {
    const { deps, calls } = fakeApis()
    await handOffPdf('favorites', OPTS, deps)
    expect(calls).toHaveLength(1)
    expect(calls[0].api).toBe('addFileToFavorites')
    expect(calls[0].o).toMatchObject({ filePath: OPTS.path, fileName: OPTS.name })
  })

  it('转发给好友：同样带文件名', async () => {
    const { deps, calls } = fakeApis()
    await handOffPdf('chat', OPTS, deps)
    expect(calls[0].api).toBe('shareFileMessage')
    expect(calls[0].o).toMatchObject({ filePath: OPTS.path, fileName: OPTS.name })
  })

  it('用其他应用打开：**必须**带 showMenu —— 不带的话用户什么都带不走', async () => {
    const { deps, calls } = fakeApis()
    await handOffPdf('app', OPTS, deps)
    expect(calls[0].api).toBe('openDocument')
    expect(calls[0].o).toMatchObject({ filePath: OPTS.path, showMenu: true })
  })

  it('保存到电脑：只传路径（这个 API 没有 fileName 参数，落盘名取自 basename）', async () => {
    const { deps, calls } = fakeApis()
    await handOffPdf('disk', OPTS, deps)
    expect(calls[0]).toEqual({ api: 'saveFileToDisk', o: { filePath: OPTS.path } })
  })

  it('出口在当前设备上不存在时**抛错**，而不是静默什么都不做', async () => {
    // 静默的表现是「点了没反应」，比一句明确的失败提示糟得多
    await expect(handOffPdf('disk', OPTS, {})).rejects.toThrow('saveFileToDisk')
    await expect(handOffPdf('chat', OPTS, {})).rejects.toThrow('shareFileMessage')
    await expect(handOffPdf('favorites', OPTS, {})).rejects.toThrow('addFileToFavorites')
    await expect(handOffPdf('app', OPTS, {})).rejects.toThrow('openDocument')
  })

  it('用户取消（fail 回调）往外抛，且带上原始 errMsg', async () => {
    const { deps } = fakeApis('chat')
    await expect(handOffPdf('chat', OPTS, deps)).rejects.toThrow('shareFileMessage:fail 用户取消')
  })

  it('API 自己同步抛（不是走 fail 回调）也接得住', async () => {
    const deps: HandoffDeps = {
      openDocument: () => {
        throw new Error('boom')
      },
    }
    await expect(handOffPdf('app', OPTS, deps)).rejects.toThrow('boom')
  })
})
