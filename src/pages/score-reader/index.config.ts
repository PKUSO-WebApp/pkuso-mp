export default definePageConfig({
  navigationBarTitleText: '阅读器',
  /**
   * ⚠️ 必须有，别删（2026-10-09 iOS 真机反馈）。
   *
   * iOS 上**页面本身**是可以上下拖动并回弹的（橡皮筋/露白）——与「页面里有没有可滚动
   * 内容」无关，所以整页自绘平移的阅读器会被它叠加一层位移：真机表现是「手指滑动幅度 /
   * 画面滑动幅度 / 页面滑动幅度 三个不同步」，拖到尽头还会露出页面底色，像是
   * 「列表滑到了最低端」（用户原话）。
   *
   * 只在**页面配置**里有效——写进 app.json 的 globalStyle 不管用。
   */
  disableScroll: true,
})
