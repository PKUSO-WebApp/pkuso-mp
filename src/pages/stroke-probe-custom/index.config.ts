export default definePageConfig({
  navigationBarTitleText: '笔画探针 E',
  // ⚠️ 要测的就是这一条：二手说法称 custom 会禁掉原生右滑返回（官方文档里没写）。
  // 与 A 的唯一差别就是它（disableScroll 与 A 相同）。
  navigationStyle: 'custom',
  disableScroll: true,
})
