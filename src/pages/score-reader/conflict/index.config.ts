export default definePageConfig({
  navigationBarTitleText: '解决冲突',
  /**
   * 同阅读器：iOS 上**页面本身**能被拖动回弹（与有没有可滚动内容无关），
   * 而这一页的上半屏是自绘画布 —— 让它跟着页面橡皮筋一起位移毫无意义。
   * ⚠️ 只在**页面配置**里有效（写进 app.json 的 globalStyle 不管用）。
   */
  disableScroll: true,
})
