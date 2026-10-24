export const score = {
  navTitle: '乐谱',
  tabs: {
    all: '全部',
    mine: '分发给我的',
    shared: '共享的乐谱',
  },
  loadFailed: '加载失败：{error}',
  emptyAll: '暂无曲目',
  emptyShared: '暂无共享乐谱',
  sharedUpdated: '此谱已更新',
  sharedReadOnly: '共享谱 · 只读',
  sharedSyncFailed: '共享谱 · 同步失败，稍后会自动重试',
  sharedConflictTitle: '共享谱有更新',
  sharedConflictHint: '选择每一页保留哪一版',
  sharedUseLocal: '用我的',
  sharedUseRemote: '用远端',
  sharedMerge: '合并',
  sharedPage: '第 {n} 页',
  // 「分发给我的」现按**我的声部**判定（见 lib/sheet-music-mine.ts），与下发记录无关。
  // 空列表的两种成因是「profile 里没设声部」与「你的声部还没有谱子」，而前者更多见、
  // 且用户自己看不出来 ⇒ 一句里把排查方向也带上（用户 2026-10-11 定）
  emptyMine: '你的声部暂无乐谱——请检查是否设置了声部',
  partsCount: '{n} 声部',
  filesCount: '{n} 份文件',
}
