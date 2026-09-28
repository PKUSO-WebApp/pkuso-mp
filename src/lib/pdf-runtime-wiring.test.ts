import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 谱务是 dev 独占的未发布功能：main 上没有 score-reader 分包，也就没有这几行接线。
 * 因此「把 main 合并进 dev」时，main 版的 src/app.ts 会把这段**静默删掉**——真发生过，
 * 而且四道闸门全绿（`build:weapp` 只是按运行时读的那个全局名做字符串替换，
 * 不检查它究竟有没有被挂上）。掉线的表现是打开扫描件时抛
 * `weapp: jbig2 fallback not wired`。
 *
 * 这个用例守的就是那条断言：app.ts 必须在**模块顶层**把回退件挂到全局
 * （早于任何页面执行，页面里挂来不及）。
 */
describe('谱务 PDF 运行时的主包接线', () => {
  const appTs = readFileSync(path.resolve(__dirname, '../app.ts'), 'utf8')

  it('app.ts 引入 JBIG2 回退件并挂到 globalThis', () => {
    expect(appTs).toMatch(/^import jbig2Fallback from '@vendor\/jbig2_nowasm_fallback'$/m)
    expect(appTs).toMatch(
      /^Object\.assign\(globalThis, \{ __pkusoJbig2Fallback: jbig2Fallback \}\)$/m
    )
  })

  it('挂载写在模块顶层、早于 App 组件', () => {
    const assignAt = appTs.indexOf('Object.assign(globalThis, { __pkusoJbig2Fallback')
    const appAt = appTs.indexOf('function App(')
    expect(assignAt).toBeGreaterThan(-1)
    expect(appAt).toBeGreaterThan(-1)
    expect(assignAt).toBeLessThan(appAt)
  })
})
