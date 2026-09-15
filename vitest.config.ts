import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  // Taro webpack 构建时通过 DefinePlugin 注入这些常量；vitest 不走 webpack，
  // 需手动定义，否则 @tarojs/runtime 的 dom-external 会在运行时抛 ReferenceError。
  define: {
    ENABLE_INNER_HTML: 'true',
    ENABLE_ADJACENT_HTML: 'true',
    ENABLE_CLONE_NODE: 'true',
    ENABLE_CONTAINS: 'true',
    ENABLE_SIZE_APIS: 'true',
    ENABLE_TEMPLATE_CONTENT: 'true',
  },
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'node',
    passWithNoTests: true,
  },
})
