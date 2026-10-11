// @vitest-environment jsdom

import { describe, it, expect, beforeAll, vi } from 'vitest'

/**
 * tab 清单的**一致性守卫**。
 *
 * 本仓的 tab 定义散在**三处**，而且三份互指（每份的注释都说「与另一份保持同步」）：
 *
 * | 位置 | 作用 |
 * | --- | --- |
 * | `src/app.config.ts` 的 `tabBar.list` | 框架用：决定哪些页面是 tab 页（含原生图标路径） |
 * | `src/components/CustomTabBar.tsx` 的 `LIST` | 自绘底边栏：图标三色 + i18n key |
 * | `src/lib/tabBarConfig.ts` 的 `TAB_PAGE_PATHS` | 把当前路由换算成选中索引 |
 *
 * 没有哪一份是权威，而**漂移的后果是静默的**：少一份就少一个 tab 的图标、
 * 顺序不同则点「成员」跳到「日程」。所以这里把三份钉在一起：**顺序也算**。
 *
 * ⚠️ 这条测试**不改任何运行时行为** —— 它只是让「三份互指」这件事有机器判据，
 * 而不是靠那句注释。
 */

const PATHS_FROM_CONFIG: string[] = []
let appConfig: { pages?: string[]; tabBar?: { list?: { pagePath: string }[] } }
let TAB_PAGE_PATHS: readonly string[] = []
let LIST: ReadonlyArray<{
  pagePath: string
  key: string
  icon: string
  selectedIcon: string
  selectedIconDark: string
}> = []

beforeAll(async () => {
  // `app.config.ts` 用的是 Taro 的编译期宏（webpack 里由 Taro 注入），
  // vitest 不走 webpack ⇒ 自己提供一个恒等实现。
  vi.stubGlobal('defineAppConfig', (x: unknown) => x)
  appConfig = (await import('../../app.config')).default as typeof appConfig
  for (const item of appConfig.tabBar?.list ?? []) PATHS_FROM_CONFIG.push('/' + item.pagePath)
  // ⚠️ 这两个 import 必须留在 beforeAll（钩子预算 10s）里，别挪进测试体：
  // CustomTabBar 会拉起 @tarojs/runtime + i18n，是整条链上最重的一次模块转换（实测 ~2.7s）。
  // 放进第一条用例，它的 5s 测试预算在满量跑（并发 worker 抢资源）时会被踩穿
  // ——实测 5015ms / 5112ms 两次超时，而单跑该文件必过。
  TAB_PAGE_PATHS = (await import('../tabBarConfig')).TAB_PAGE_PATHS
  LIST = (await import('@/components/CustomTabBar')).LIST
})

describe('三份 tab 清单必须一致', () => {
  it('路径与顺序完全一致（app.config ↔ CustomTabBar ↔ tabBarConfig）', () => {
    const fromBar = LIST.map((t) => t.pagePath)
    const fromRoute = [...TAB_PAGE_PATHS]

    expect(fromBar, 'CustomTabBar 的 LIST 与 tabBarConfig 的 TAB_PAGE_PATHS 不一致').toEqual(
      fromRoute
    )
    expect(PATHS_FROM_CONFIG, 'app.config 的 tabBar.list 与另两份不一致（顺序也算）').toEqual(
      fromRoute
    )
  })

  it('每个 tab 都必须在 pages 里注册过（否则点了跳不过去）', () => {
    const pages = appConfig.pages ?? []
    for (const p of PATHS_FROM_CONFIG) {
      expect(pages, `${p} 不在 app.config 的 pages 里`).toContain(p.slice(1))
    }
  })

  it('三份都不为空（防止「三份都变成空数组」也判通过）', () => {
    expect(TAB_PAGE_PATHS.length).toBeGreaterThan(0)
    expect(LIST.length).toBe(TAB_PAGE_PATHS.length)
    expect(PATHS_FROM_CONFIG.length).toBe(TAB_PAGE_PATHS.length)
  })

  it('CustomTabBar 的每一项都要有 i18n key 与三色图标（缺一个就是白块或裸 key）', () => {
    for (const t of LIST) {
      expect(t.key, `${t.pagePath} 缺 i18n key`).toMatch(/^ui\.tabBar\./)
      expect(t.icon, `${t.pagePath} 缺图标`).toBeTruthy()
      expect(t.selectedIcon, `${t.pagePath} 缺选中图标`).toBeTruthy()
      expect(t.selectedIconDark, `${t.pagePath} 缺暗色选中图标`).toBeTruthy()
    }
  })
})
