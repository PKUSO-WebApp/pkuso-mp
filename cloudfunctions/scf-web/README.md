# scf-web/ —— SCF「Web 函数」部署层

腾讯云 SCF 上的反代部署包（事件函数 + 函数 URL 不支持响应侧 base64，二进制走不了，2026-10-04 实测）。

| 文件 | 是什么 |
| --- | --- |
| `app.js` | Web 函数入口：把原生 HTTP 请求适配成核心的 event 形状 |
| `scf_bootstrap` | 启动文件（监听 9000，须 0755——`pack.py` 自动写入） |
| `pack.py` | 打包器：`python cloudfunctions/scf-web/pack.py <输出.zip>` |

**部署包 = app.js + core.js + scf_bootstrap**，其中 `core.js` 是
`cloudfunctions/supabase-proxy/index.js` 的**现拷**（唯一源码在那边，`pack.py` 每次打包时现拷，
不要手工复制）。改了核心逻辑 → 重新跑 `pack.py` → 上传新 zip。
