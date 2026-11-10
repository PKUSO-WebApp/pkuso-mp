import { vi } from 'vitest'
import { zhCN } from '@/i18n/messages/zh-CN'
import { en } from '@/i18n/messages/en'

/**
 * 测试用的可切换 i18n 夹具。
 *
 * 背景：2026-10-10 注册页把英文环境的 `Spring` 当值写进 `join_date`，撞了 DB CHECK ——
 * 英文路径从没跑过。所以 `vi.mock('@/i18n')` 不再写死 `zh-CN`：语言由用例切换，
 * 词表按当前语言取真词典（缺 key 回退 key，与产品 `translate()` 同语义）。
 *
 * 用法：
 *   vi.mock('@/i18n', async () => {
 *     const { createI18nMock } = await import('@/test-utils/i18n-mock')
 *     return createI18nMock()
 *   })
 *   beforeEach(() => resetTestLocale())
 *   it('英文环境…', () => { setTestLocale('en'); ... })
 *
 * 模块级状态按测试文件隔离（vitest 每个 test file 独立模块图），同一文件内靠
 * `resetTestLocale()` 复位，避免 en 用例污染后续用例。
 */

export type TestLocale = 'zh-CN' | 'en'

const state: { locale: TestLocale } = { locale: 'zh-CN' }

const DICTS: Record<TestLocale, unknown> = { 'zh-CN': zhCN, en }

export function setTestLocale(locale: TestLocale): void {
  state.locale = locale
}

export function resetTestLocale(): void {
  state.locale = 'zh-CN'
}

export function getTestLocale(): TestLocale {
  return state.locale
}

/** 与产品 `translate()` 同语义：点分路径取词、缺 key 回退 key、`{name}` 插值 */
export function testTranslate(key: string, params?: Record<string, unknown>): string {
  const value = key
    .split('.')
    .reduce<unknown>(
      (node, part) =>
        node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined,
      DICTS[state.locale]
    )
  let s = typeof value === 'string' ? value : key
  if (params)
    s = s.replace(/\{(\w+)\}/g, (_, name: string) =>
      params[name] !== undefined ? String(params[name]) : `{${name}}`
    )
  return s
}

/**
 * ⚠️ 必须是**稳定引用**：多个页面的 effect 依赖数组里有 `t`（真机上它是 useCallback），
 * 每次渲染换一个新函数会让 effect 反复重跑 —— 页面永远停在 loading，且不报错。
 */
export const testT = (key: string, params?: Record<string, unknown>): string =>
  testTranslate(key, params)

/** 组装 `vi.mock('@/i18n', ...)` 的返回值；`extra` 用于补 `loaders` 等按文件不同的字段 */
export function createI18nMock(extra: Record<string, unknown> = {}) {
  return {
    useT: () => ({ t: testT, locale: state.locale, setLocale: vi.fn() }),
    useNavTitle: vi.fn(),
    ...extra,
  }
}
