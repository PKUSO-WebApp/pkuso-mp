// 模块实体是 vendor/wechat-miniprogram-pdf.js（构建期由
// scripts/build-pdf-runtime.mjs 从 node_modules 降级生成，已 gitignore）。
// 类型声明必须放这里且用 @vendor 别名：若与 .js 同名放 vendor/ 下，
// webpack 会把 `wechat-miniprogram-pdf.d.ts` 当作 `.d` + `.ts` 解析加载并报错。
declare module '@vendor/wechat-miniprogram-pdf' {
  export interface PdfEngine {
    open(data: ArrayBuffer | Uint8Array, options?: Record<string, unknown>): Promise<PdfDocument>
    destroy(): void
  }
  export interface PdfPageInfo {
    width: number
    height: number
    rotation: number
  }
  export interface PdfDocument {
    pageCount: number
    getPageInfo(pageNumber: number): Promise<PdfPageInfo>
    renderPage(
      pageNumber: number,
      canvas: unknown,
      options?: {
        scale?: number
        pixelRatio?: number
        rotation?: number
        background?: string
      }
    ): Promise<{ cssWidth: number; cssHeight: number; pixelWidth: number; pixelHeight: number }>
    destroy(): void
  }
  export function createPdfEngine(options?: Record<string, unknown>): PdfEngine
}

// JBIG2 回退件（构建期由 scripts/build-pdf-runtime.mjs 从 pdfjs-dist 降级生成）。
// 默认导出是一个「返回解码器」的工厂函数，由 src/app.ts 挂到 globalThis 供
// pdf 运行时取用——这样它打进主包，不占 score-reader 分包的 2MB 预算。
declare module '@vendor/jbig2_nowasm_fallback' {
  const jbig2Fallback: () => unknown
  export default jbig2Fallback
}
