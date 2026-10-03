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
