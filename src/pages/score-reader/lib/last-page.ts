/**
 * 「上次读到第几页」的存储键（书签）。
 *
 * 从 `pdf-cache.ts` 拆出来的：那份缓存是给 pdf.js 回退路径用的，已随运行时一起删掉；
 * 而**阅读位置与渲染方式无关**——图片模式同样要记住读到哪一页，下次打开直接翻回去。
 */
export const lastPageKey = (fileId: string) => `score-last-page:${fileId}`
