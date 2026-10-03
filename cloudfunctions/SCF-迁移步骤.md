# 反代迁移到 SCF（函数 URL）——操作步骤

**为什么**：微信云开发体验版 2026-10-15 到期，续费走套餐制（个人版 19.9 元/月）；SCF 是同源代码的**纯按量**方案（按现用量 ≈0.5 元/月，无订阅、无到期）。迁完可让云开发环境**自然到期**（环境里只有反代两个函数；客户端源码零 `wx.cloud` 依赖）。

**入口**：腾讯云控制台 → 云函数 `https://console.cloud.tencent.com/scf`（与微信开发者工具里的「云开发」控制台是两个体系）。

---

## 阶段一：建函数 + 协议验证（不动 mp、不动现网）

### 1. 新建函数

- 函数服务 → 新建：地域 **上海**、类型 **事件函数**（不是 Web 函数）、运行环境 Node.js 18/20
- 代码：在线编辑粘贴或上传单文件 `cloudfunctions/supabase-proxy/index.js`，执行方法 `index.main`
- 基础配置：**内存 256MB**、**超时 60s**
  （默认 3s 兜不住：上游单跳预算 20s + 登录链路本身 2–3s）
- 环境变量（**先建开发库那份**，值抄 `.env.development`）：
  - `SUPABASE_URL`、`SUPABASE_ANON_KEY`
  - `MP_APPID=wx4813b0549427f8c3`
  - `PROBE_TAG=scf-dev-v1`
  - `BASE_PATH` **留空**（函数 URL 直达函数，没有云开发那套前缀问题）

### 2. 建函数 URL

函数详情 → 左侧「函数 URL」→ 新建 → 授权类型选 **开放**（鉴权靠代码里的 Referer 校验）→ 得到：

```
https://<app-id>-<url-id>.ap-shanghai.tencentscf.com
```

官方：**创建后端点永久不变**。

### 3. 费用护栏

费用中心 → 预算管理：绑一个「5 元/月」预算告警。

### 4. 验证清单（把 URL 交给 agent 执行；全部只读）

1. `GET /pkuso-echo` —— 比对 event 形状：path 带不带前缀、query 格式、`apikey` / `authorization` / `prefer` / `range` 头是否透传
2. `GET /pkuso-probe` —— 四目标探测（`supabase_auth` / `supabase_rest` + 两个对照组），结果写回开发库 `client_error_logs`（`source='probe'`）。**对照组失败 = 本次实验无效**
3. 真请求三连：带 apikey 的 rest 查询、**一张页图**（验 base64 响应路径）、一个 4MB PDF 的 `Range`（验头透传与大响应）

### 5. 代码适配（方向已预判，以 echo 实测为准）

- **必须改**：SCF 的 query 字段叫 `queryString`（对象），微信云开发叫 `queryStringParameters`——不改会**静默出错结果**（过滤失效，`.eq(id)` 变全表查询）
- 请求侧无 `isBase64Encoded` 字段：我们的 POST 都是 JSON 文本，天然正确
- **待实测**：响应侧 `isBase64Encoded: true` 是否被函数 URL 尊重（页图一打便知）；若不支持 → 改走 **Web 函数**（原生 HTTP server，加 ~50 行适配层）

## 阶段二：dev 真机验收（1 天）

1. mp 后台 → 开发设置 → 服务器域名：把新域名加进 request 合法域名
   （**先做这步**——顺便验证「新域名能否加白名单」这个闸门；后台填域名不带协议/端口；每月限改 5 次）
2. `.env.development` 的 `TARO_APP_SUPABASE_PROXY_URL` 换成 SCF dev 函数 URL → 推 `dev` → CI 出包 → 体验版真机
3. 回滚 = 换回旧 URL 再推一次（dev 上零成本）

## 阶段三：切生产

- `.env.production` 换 **SCF prod 函数 URL**（第二个函数，环境变量指生产库）→ 发版（审核）
- 时机二选一：
  - 赶在 10-15 前切（就算审核慢，**10-22 前都在续费找回窗口内**，有兜底）
  - 或先续费微信云开发做桥，下次自然发版时顺带切
- 切完：微信云开发环境放任到期即可（**dev 与 prod 是同一个环境**，dev 线的包也一并切）
- 回滚 = 换回旧 URL 再发一版 ⇒ 切换最好挑一次本来就要发的版本

## 已知边界（沿用实测结论）

- 响应上限：云开发侧实测 **6 MiB**（原始 ≈4.5 MiB 稳过；超限是干净的 400 快速失败）；SCF 侧同源，按验证清单第 3 条复测
- 上游跨境那一跳**不变**（上海出口落 SIN 量级，TTFB 1.0–1.4s 量级）——这是「机房跨境」方案的固有前提
- 出口 IP 不固定：对 Supabase 无影响（anon key + RLS，没有 IP 白名单）
- 成本：调用 0.0133 元/万次 + 资源 0.00011108 元/GBs + 外网 0.8 元/GB ⇒ 现用量 ≈0.5 元/月
