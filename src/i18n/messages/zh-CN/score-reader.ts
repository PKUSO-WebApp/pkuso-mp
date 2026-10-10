export const scoreReader = {
  navTitle: '阅读器',
  loadFailed: '加载失败：{error}',
  notFound: '文件不存在或已被删除',
  pageOf: '{page} / {total} 页',
  pageJump: '跳页',
  zoomIn: '放大',
  zoomOut: '缩小',
  zoomReset: '适配',
  retry: '重试',
  /** 没有页图（预渲染失败 / 还没跑迁移）：App 里渲染不了，引导「保存到…」 */
  noImages: '这份谱子还没有页图',
  // 首帧落地之前**只有这一个**状态词（原来的下载中/解析中/渲染中三档已合并）：
  // 用户反馈「加载中转完还显示渲染中」像是卡住了，而这三档对用户没有可操作的信息
  loading: '加载中…',
  ready: '就绪',
  idle: '未加载',
  annotation: '批注',
  penThin: '细',
  penThick: '粗',
  pen: '笔',
  eraser: '橡皮',
  undo: '撤销',
  /** 带页码：UD 下「本页」歧义（见 AnnotationBar 的 clearPage） */
  clear: '清空第 {page} 页',
  clearConfirm: '确认？',
  tutorialPrev: '上一页',
  tutorialNext: '下一页',
  tutorialMenuZone: '菜单',
  tutorialSwipeHint: '左滑 = 下一页，右滑 = 上一页',
  tutorialScrollHint: '上下拖动 = 滚动；点上下方 = 上/下一页',
  tutorialDismiss: '知道了',
  /**
   * 教程蒙层里那条「菜单里有什么」的图例（复刻底栏五个按钮，见 ReaderTutorial 的 MenuLegend）。
   * **不复用** pageJump / zoomPanel / modeSwitch 那几个：那些是 ariaLabel，为了无障碍可以写长，
   * 而这里的每个词要挤进屏宽的 1/5。文案本身也改过（「切换翻页方式」→「翻页」）。
   */
  tutorialMenuPage: '跳页',
  tutorialMenuZoom: '缩放',
  tutorialMenuAnno: '批注',
  tutorialMenuSave: '保存',
  tutorialMenuMode: '翻页',
  /** 荧光笔（批注栏第三支工具） */
  highlighter: '荧光笔',
  /** 底栏第一个按钮（book-open）：开页码/进度条气泡 */
  zoomPanel: '缩放',
  /** 底栏第五个按钮：图标显示的是**点下去会变成什么** */
  modeSwitch: '切换翻页方式',
}
