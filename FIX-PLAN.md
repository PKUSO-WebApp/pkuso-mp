# 小程序仓库修复 Plan（长期任务清单 / Source of Truth）

> 本文件为 miniprogram 仓库修复工作的权威清单，由对抗性审查 + 双 agent 审计报告汇总而来。
> 执行规则：每完成单项 → 跑全门禁（build / typecheck / lint --max-warnings 0 / test）→ 本地 commit（不 push）。
> 最终交付前在开发者工具「设置 → 通用 → 清空缓存 / 重开项目」验证「暗色 + 弱网 + 切 tab」三场景。

## P0 — 真机破损 / 高频闪烁（最高优先）

- [x] **P0-1** `space-y-*` 全量替换（真机间距塌陷，最大单项风险）
  - 19 处：profile(5:235,241,381,436,483)、create-schedule-modal(5:133,134,150,159,176)、attendance-history-modal:110、theme-modal:16、feedback-modal:67、member-detail-modal:36、post-edit:251、profile-info:359、schedule-gantt:202、rehearsal-card:27
  - 做法：逐处改显式 `mt-*` / `mb-*`（首元素除外）；rehearsal-card 的 `space-y-1` 改子元素 `mt-1`
  - 验证：真机预览逐页目测间距；全门禁
  - ✅ 完成：commit `fix(ui): replace space-y-* with explicit mt-* spacing`（10 文件）

- [x] **P0-2** didShow 静默重取（消灭切 tab 整页闪烁）
  - index/community/my-activities 调用点加 `{silent:true}`；useSchedule.ts:38 补 `opts.silent` 参数
  - 四页渲染分支仿 members（members/index.tsx:86：有数据不显示 loading）加 `length === 0` 守卫
  - 验证：切 tab 来回 10 次列表零闪；下拉刷新仍显式 loading
  - ✅ 完成：commit `fix(ui): silent didShow refetch to kill tab-switch flicker`

- [x] **P0-3** 主题同步初始化（暗色冷启动白闪）
  - theme-context.tsx:67 + lib/theme.ts：新增 `readStoredThemeSync()` 基于 `getStorageSync` 塞进 `useState` 初始化器（照抄 i18n/storage.ts 模式）；themeStore/tabBar 首帧随之正确
  - 验证：清缓存→暗色偏好→冷启动录屏对比首帧
  - ✅ 完成：commit `fix(theme): sync storage init to kill dark cold-start white flash`（themeStore 初始值也改为同步解析）

- [x] **P0-4** 死类与缺类：`bg-bg`→`bg-page-bg`（实际 7 处）+ post-detail/post-edit loading/notFound 分支补 `${darkClass}`
  - 位置：post-detail:80,88,103、notification-list:61、notification-system:115、post-edit:137,145
  - 验证：暗色模式进公告详情/通知页不再透白
  - ✅ 完成：commit `fix(ui): bg-bg dead class to bg-page-bg + darkClass on load/notFound branches`

- [x] **P0-5** my-activities 三连跳：`mineLoading` 初始 true（usePosts.ts:45）+ didShow silent（并入 P0-2）
  - 验证：进页无「暂无活动」闪现
  - ✅ 完成于 P0-2 同批 commit

- [x] **P0-6** 首页公告条占位（整页下移）：index/index.tsx:127-136 外层固定高度骨架条或移入滚动区
  - 验证：有公告冷启动内容不再整体下移
  - ✅ 完成（选「移入滚动区」方案）：commit `fix(home): announcement bar into scroll region to stop content push-down`

## P1 — 视觉 token 归位 / 残留合规

- [x] **P1-1** 签到蓝 token 化：新增 `--color-signin`(+dark 变体) 或直接用 `bg-primary`；替换 rehearsal-detail:213、leave-request:201 的 `#6198CB` + `text-white`
  - ✅ 完成：app.css 新增 `--color-signin/-foreground`（亮暗同值，暗色覆盖位预留）；两处改 `bg-signin text-signin-foreground`，删除内联 style
- [x] **P1-2** 黑按钮家族：`#000000` 内联 → `bg-primary text-primary-foreground`；post-edit:253,256、profile-info:361,364（修暗色黑底黑字隐患）
  - ✅ 完成
- [x] **P1-3** 红点三写法统一 → `var(--color-danger)` + 抽最小 `<UnreadDot/>`；rehearsal-card:54(#de2626 笔误)、Toggle.tsx:39、CustomTabBar:197,212,227
  - ✅ 完成：新增 `ui/UnreadDot.tsx`（bg-danger token）；rehearsal-card/Toggle 接入；CustomTabBar 三处改用 THEME_PALETTE.tabDot（tabBar 无 .dark 祖先，走色板值而非 var()，见 P2-8）
- [x] **P1-4** leave-request Textarea 包裹：leave-request:264 按 AGENTS.md View 包裹模式
  - ✅ 完成
- [x] **P1-5** feedback-modal 漏翻：feedback-modal.tsx:47 改用 `t('profile.feedback.submitFailed')`
  - ✅ 完成
- [x] **P1-6** 签到按钮两段变色：attendance===undefined(加载中) 与 null(无记录) 分离，加载中渲染中性 disabled 态
  - ✅ 完成：rehearsal-detail 增 `attendancePending` 分支（中性灰 loading 态）
- [x] **P1-7** post-detail 配图高度预留：post-detail:148-153 固定比例容器 + widthFix
  - ✅ 完成：`aspect-[4/3]` 固定比例容器 + `aspectFill`（零布局跳动；点击预览看全图）
- [x] **P1-8** error 页 page 底色 token 化：error/index.scss:3 `#ffffff` → CSS 变量随主题
  - ✅ 完成：移除写死白色，窗口底色交由 ThemeProvider 的 setBackgroundColor 按模式同步

## P2 — 结构性还债（独立可交付）

- [ ] **P2-1** 提取 `ui/FormField` + `TextField` / `PickerField`（26 处表单行 ~230 行）
- [ ] **P2-2** 提取 `ui/ListState`（15 处三态块，统一空态文案与重试）
- [ ] **P2-3** 提取 `ui/FieldRow`（合并 DetailRow/DetailField 同名异构 5 处）
- [x] **P2-4** seen-store 泛型工厂（postSeen/rehearsalSeen 合一 ~60 行）
  - ✅ 完成：commit `refactor(lib): unify postSeen/rehearsalSeen into createSeenStore factory`
- [x] **P2-5** useAttendance 死接口清理（list 死 state + 4 恒错 stub 删除；fetchMyAttendances 补 fetchSeq 防竞态）
  - ✅ 完成：commit `refactor(hooks): drop dead attendance stubs, add fetchSeq, expose notifications error`
- [x] **P2-6** useNotifications 补 error 面（查询失败不再静默）
  - ✅ 完成于上一同批 commit
- [x] **P2-7** hooks 错误文案错误码化（error 改稳定码枚举 AppErrorCode，页面侧 tAppError(t,code) 映射；消中文变体 + DB 原文透传）
  - 新增 `src/lib/appError.ts`（`APP_ERROR` 码 + `tAppError`）；`common.errors.loadFailed/saveFailed`
  - 8 hooks 读路径 error→`AppErrorCode|null`，DB 原文走 `console.error`；页面 `ListState` 用 `tAppError` 映射
  - 写路径业务中文（useLeaveRequests/usePosts 提交/删除）保留 `string` 状态（页面直渲染），延期统一
  - ✅ 完成：commit `refactor(hooks): error-code refactor for read paths (P2-7)`
- [x] **P2-8** tabBar 色板单一真相源（CustomTabBar LIGHT/DARK 从共享常量/theme-context 导入）
  - ✅ 完成：lib/theme.ts 新增 `THEME_PALETTE`（nav/window/tab/dot 全量），theme-context 与 CustomTabBar 共用；commit `refactor(theme): single-source THEME_PALETTE for nav/window/tabBar colors`
- [ ] **P2-9** 其余低优先提取：ActionBar、StatusChip、`runContentCheckAndUpload`

## P3 — 基建与测试

- [ ] **P3-1** GitHub Actions：跑 `pnpm verify` + build:weapp（对齐 web 仓 CI=verify 哲学）
- [ ] **P3-2** README.md（架构 / 闸门 / 环境变量）
- [ ] **P3-3** 补测试：签到状态机组件测试（最优先）、postSeen 时间戳、theme-context 切换、dataSync 心跳
- [ ] **P3-4** en 字典静态打进主包评估（消 en 冷启动中文闪）
