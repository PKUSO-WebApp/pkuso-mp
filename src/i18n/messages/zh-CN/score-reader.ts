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
  /** 批注栏右上角那个 V 按钮（图标按钮，没有可读文字 ⇒ 文案只做 ariaLabel）。
   *  为什么要能收起：工具条是浮层，手指落在它上面**触摸到不了画布** ——
   *  被它盖住的那一条既看不到、也起不了笔（用户 2026-10-16 报）。 */
  penBarCollapse: '收起工具条',
  penBarExpand: '展开工具条',
  /** 带页码：UD 下「本页」歧义（见 AnnotationBar 的 clearPage） */
  clear: '清空第 {page} 页',
  clearConfirm: '确认？',
  tutorialPrev: '上一页',
  tutorialNext: '下一页',
  tutorialMenuZone: '菜单',
  // 文案里用「\n」分段：教程按它在分号处换行（两条规则各自一行，也才不会被 LR 的分隔线穿过）
  tutorialSwipeHint: '左滑 = 下一页\n右滑 = 上一页',
  tutorialScrollHint: '上下拖动 = 滚动\n点上下方 = 上/下一页',
  tutorialDismiss: '知道了',
  /**
   * 教程蒙层里那条「菜单里有什么」的图例（复刻底栏五个按钮，见 ReaderTutorial 的 MenuLegend）。
   * **不复用** pageJump / zoomPanel / modeSwitch 那几个：那些是 ariaLabel，为了无障碍可以写长，
   * 而这里的每个词要挤进屏宽的 1/5。文案本身也改过（「切换翻页方式」→「翻页」）。
   */
  tutorialMenuPage: '跳页',
  tutorialMenuZoom: '缩放',
  tutorialMenuAnno: '批注',
  /** 图例里指向底栏那个 `forwardIcon` 按钮的字（用户 2026-10-15 定：叫「分享」而不是
   *  「保存」—— 那个面板里全是「把文件递出去」的出口，叫保存会让人以为只是存本地） */
  tutorialMenuSave: '分享',
  tutorialMenuMode: '翻页',
  /** 荧光笔（批注栏第三支工具） */
  highlighter: '荧光笔',
  /** 底栏第一个按钮（book-open）：开页码/进度条气泡 */
  zoomPanel: '缩放',
  /** 底栏第五个按钮：图标显示的是**点下去会变成什么** */
  modeSwitch: '切换翻页方式',
  /**
   * 批注冲突（同一页在两台设备上都改过）。**只在这一页真分叉时出现**，平时一个像素都不占。
   * 文案要把两件事说清：为什么问（没法自动合并）、以及为什么不怕选错（另一版进历史）。
   */
  /**
   * 「恢复云端历史」（分享子菜单里的入口 + 它那两级面板）。
   * 历史表是**按页**存的，一次同步会归档好几页 ⇒ 一级按「覆盖批次」聚（见 groupHistoryBatches）。
   */
  history: {
    entry: '恢复云端历史',
    title: '恢复云端历史',
    empty: '还没有云端历史',
    back: '返回',
    batchRow: '{time} · {n} 页',
    batchAt: '{time}',
    batchEmpty: '这一批里没有带笔迹的页',
    pageRow: '第 {page} 页 · {n} 笔',
  },
  conflict: {
    title: '有 {count} 页批注冲突',
    // ⚠️ 别写「随时能切回」：两份都进了服务端历史（覆盖时归档）。
    // 2026-10-16 起**有了**浏览入口（「分享 → 恢复云端历史」，见 history.*），所以
    // 「另一版会保留在云端历史里」这句是能兑现的；但仍别写成「随时切回」——它要走
    // 一次冲突解决页（选历史那版 = 把它推上去），不是一键撤销
    intro: '这些页存在版本冲突，无法自动合并。请选择一版保留 —— 另一版会保留在云端历史里。',
    pageButton: '第 {page} 页',
    later: '稍后处理',
    navTitle: '解决冲突',
    why: '这一页存在版本冲突，无法自动合并。',
    localVersion: '本地版',
    remoteVersion: '远端版',
    /** 第三个选项（2026-10-15 用户定）：两版**取并集**。它也能预览 —— 并集的后果
     *（被擦掉的那笔会回来）只有画出来才看得见，看得见再点正是这一页存在的理由 */
    mergeVersion: '合并两版',
    /** 提交按钮（2026-10-15 用户定）：作用于**当前预览的那一版**，
     *  替代原来的两个「用本地版 / 用云端版」——先看清再落库，不会误触直接裁决 */
    useCurrent: '使用这一版',
    /** 预览时云端又变了：不拿旧选择套新内容，让用户重看一眼 */
    raced: '云端刚又变了，请重新看一眼再选。',
    failed: '没成功，请检查网络后重试。',
    loadFailed: '读不到这一页的内容',
  },
}
