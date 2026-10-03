import { activeEntry, rewriteTo } from './supabase-entry'

/**
 * 页图（上传时预渲染的整页 JPEG）的 URL 规则。
 *
 * 放在**主包**（`src/lib/`）而不是阅读器的分包里：两处都要用它 —— 主包的声部页
 * （跳转前预取第一页，见 `pages/score-part`）与分包的阅读器。反过来放分包、
 * 被主包引用一次，Taro 就会把它归进主包（`pages/score-reader/lib/types.ts` 顶部
 * 记着这条：分包的隔离正是为了不把 pdf 运行时算进主包的 2MB）。
 *
 * ⚠️ 规则必须与 web 端 `sheetMusicPagePath`（`pkuso-web/src/lib/storage.ts`）一致：
 * `{PDF 的 publicUrl 去 .pdf}/p{n}.jpg`。三处同一个正则，改一处要改三处。
 */
export function pageImageUrl(pdfPublicUrl: string, pageNo: number): string {
  return `${pdfPublicUrl.replace(/\.pdf$/, '')}/p${pageNo}.jpg`
}

/**
 * 页图的**候选 URL 列表**：当前生效入口优先，另一个入口兜底。
 *
 * 为什么页图（不同于 PDF）该走反代：页图是阅读的**主路径**（每次打开、每次翻页），
 * 而 PDF 只在下发打印时用一次——「直连坏了、反代好」的用户（实测有一位：反代上线前
 * 连登录都难）恰恰卡在页图这条主路径上。大小也不成问题：页图 400~700KB，
 * 反代（云函数）的响应体上限 6MB。
 *
 * ⚠️ 为什么必须**自己带兜底**：`canvas.createImage` / `getImageInfo` 不走 `taroFetch`，
 * 拿不到那里现成的「反代失败自动换直连」。而且反代另有一条「小程序链路响应包体
 * 上限 1MB」的说法（没核实到，但页图最大那张 base64 后约 950KB，贴着它）——
 * 两个入口各试一次，把「反代坏了」和「反代超限」一起兜住。
 *
 * 未配反代、或已落到直连入口时只返回一个 URL（新逻辑短路，行为与从前一致）。
 */
export function pageImageUrls(pdfPublicUrl: string, pageNo: number): string[] {
  const directUrl = pageImageUrl(pdfPublicUrl, pageNo)
  if (activeEntry() !== 'proxy') return [directUrl]
  const proxied = rewriteTo(directUrl, 'proxy')
  // 重写没生效（URL 不是本项目的直连基址）⇒ 只有直连可用
  if (proxied === directUrl) return [directUrl]
  return [proxied, directUrl]
}
