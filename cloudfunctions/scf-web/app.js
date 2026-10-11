/**
 * SCF「Web 函数」入口：把原生 HTTP 请求适配成 supabase-proxy 核心的 event 形状。
 *
 * 为什么不用「事件函数 + 函数 URL」：**2026-10-04 实测，响应侧 `isBase64Encoded` 不被解析**
 * ——页图回来的是 978,024 B 的 base64 文本（原图 733,518 B）、PDF Range 回来 1,333,336 B
 * 文本，二进制原样走不了。Web 函数是真透传 HTTP：请求/响应都是原始字节，这里只做一层
 * 形状适配。
 *
 * 部署包 = app.js + core.js（= cloudfunctions/supabase-proxy/index.js 原样拷贝）+ scf_bootstrap。
 * 打包用 `pack.py`（会把 scf_bootstrap 写成 0755——Windows 下普通压缩工具做不到）。
 */
const http = require('http')
const { main } = require('./core.js')

const PORT = 9000

async function handle(req, res, bodyBuf) {
  let out
  try {
    const event = {
      httpMethod: req.method,
      // 直接把原始 req.url（含 query）当 path：核心的 toPathAndQuery 会拆 `path?query`，
      // 拆出的 query **原样透传、不重新编码**——比对象重建的保真度更高。
      path: req.url,
      headers: req.headers,
      // body 按 base64 交给核心解回 Buffer：字节级保真（含二进制请求体）。
      body: bodyBuf.length ? bodyBuf.toString('base64') : '',
      isBase64Encoded: true,
    }
    out = await main(event, {})
  } catch (err) {
    out = {
      statusCode: 500,
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        error: 'web_adapter_crashed',
        detail: String((err && err.message) || err),
      }),
    }
  }

  res.statusCode = out.statusCode || 200
  for (const [k, v] of Object.entries(out.headers || {})) {
    try {
      res.setHeader(k, v)
    } catch {
      // 个别头（非法字符等）Node 会拒绝——跳过它，不让整个响应失败
    }
  }
  const body = out.body == null ? '' : out.body
  res.end(out.isBase64Encoded === true ? Buffer.from(body, 'base64') : Buffer.from(body, 'utf8'))
}

const server = http.createServer((req, res) => {
  const chunks = []
  req.on('data', (c) => chunks.push(c))
  req.on('error', () => {})
  req.on('end', () => {
    void handle(req, res, Buffer.concat(chunks))
  })
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[scf-web] listening on ${PORT}`)
})
