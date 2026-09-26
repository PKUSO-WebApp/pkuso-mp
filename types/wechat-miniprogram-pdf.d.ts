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
