# cloudfunctions/ —— 境内入口（反代 + 探针）

让小程序不必跨境直连 `*.supabase.co`：请求先到微信云开发的 HTTP 访问服务，由这里的云函数转发给 Supabase，再原样返回。

**为什么要有它**：跨境那一跳是「登不上 / 突然断」的主因（调研与实测结论在 `.proxy-research/`，与仓库同级）。境内入口是唯一能**删掉**那一跳的动作——换 IP、钉 colo、把函数放境外都只是减概率。

## 目录

| 目录 | 是什么 | 入库 |
| --- | --- | --- |
| `supabase-proxy/` | **唯一源码**。三个模式：`/pkuso-echo` 契约回显、`/pkuso-probe` 链路探针、其余全部反代 | ✅ |
| `supabase-proxy-dev/` | 同一份代码的**第二个部署位**（上游 = 开发库） | ❌ 生成物 |

## 为什么是两个函数

上游由环境变量 `SUPABASE_URL` 决定，而**一个云函数只有一套环境变量** —— 靠一个函数分不出 dev/prod。所以：

```
HTTP 访问服务路由  /      → 云函数 supabase-proxy      （SUPABASE_URL = 生产库）
HTTP 访问服务路由  /dev   → 云函数 supabase-proxy-dev  （SUPABASE_URL = 开发库、BASE_PATH = /dev）
```

两份代码**必须逐字相同**，差异只在控制台的环境变量。所以 dev 那份是生成的：

```bash
node scripts/sync-cloudfunctions.mjs           # 生成 / 覆盖（幂等）
node scripts/sync-cloudfunctions.mjs --check   # 只校验是否已同步
```

> **改了 `supabase-proxy/index.js` 就要重跑生成、并重新部署两个函数**，否则 dev 侧会停在旧代码上。
> 生成文件头部带源码的哈希，陈旧一眼可辨。

## 部署（没有 CI，只有手工）

这个函数不在任何 CI 里，部署方式就是**微信开发者工具里右键目录 → 上传并部署**（全量上传，别用「上传触发器」）。

每个部署位要配的环境变量：

| 变量 | `supabase-proxy` | `supabase-proxy-dev` | 说明 |
| --- | --- | --- | --- |
| `SUPABASE_URL` | 生产库地址 | **开发库**地址 | 留空 = 生产（代码里的默认值）。认环境只看这一条 |
| `SUPABASE_ANON_KEY` | 生产 publishable key | **开发库** publishable key | 探针打 `/rest/v1` 时要带 |
| `BASE_PATH` | 留空 | `/dev` | 路由前缀，见下 |
| `PROBE_TAG` | `cloudbase-v1` | 换个名字（如 `cloudbase-dev-v1`） | 写进 `app_version`，用来分辨样本来自哪个部署位 |
| `MP_APPID` | `wx4813b0549427f8c3` | 同左 | 填了就只放行 Referer 来自本小程序的请求 |

`BASE_PATH` 的取值：路由配 `/` 时留空；配 `/dev` 时填 `/dev`。**填错也不会静默出错**——剥前缀要求路径真的以它开头，而 Supabase 没有 `/dev/*` 端点，所以「网关其实已经剥掉了」只会让这一步变成空操作；反过来（网关带前缀、这里却留空）会 404。判据随时可查：打一次 `<前缀>/pkuso-echo`，回显**不剥前缀**，答案就在 `event.path` 里。

## 三个端点

- `GET /pkuso-echo`（或 `/__echo`）—— 把 event 原样吐回来。**部署后第一件事就是打它**：路径带不带前缀、query 是原始串还是 map、头全不全、body 怎么编码，这些文档里没有确切说法，问它比猜快。
- `GET /pkuso-probe`（或 `/__probe`，或定时触发）—— 四个目标（`supabase_auth` / `supabase_rest` + `control_cf` / `control_cn` 两个对照组）× 分层耗时，结果写回 `client_error_logs`（`source='probe'`）。**对照组失败 = 这次实验无效**，别拿去解释上游。
- 其余所有路径 —— 反代。

⚠️ 前两个端点**必须排在 Referer 校验之前**（代码里也是这个顺序）：它们的全部意义就是让人从浏览器排查，挡掉浏览器等于把唯一的排查入口关了。

## 已知边界

- **`/storage/v1/` 不走这里**：谱务文件最大上兆，而云函数有 body 上限。小程序端在 `taroFetch` 里把 storage 固定分流到直连。
- **响应体上限 6MB**（base64 后约 4.5MB 原始）。生产流量的 rest 响应 p95 约 455B、storage 最大 42KB，远没到；要传大文件时按路径分流。
- **上游仍跨境**。上海出口实测固定落 `SIN`（新加坡），TTFB 1.0–1.4s；也就是从「手机跨境」变成「机房跨境」——可控、可重试、看得见，但不是零成本。
- 这个函数**没有测试**。它唯一的机械保障是 `toPathAndQuery` 的本地断言入口（`exports.__internals`）。
