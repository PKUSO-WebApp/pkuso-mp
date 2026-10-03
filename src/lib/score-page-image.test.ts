import { describe, expect, it } from 'vitest'
import { pageImageUrl } from './score-page-image'

/**
 * 跨仓契约：页图路径规则必须与 web 端的 `sheetMusicPagePath`
 * （`pkuso-web/src/lib/storage.ts`）**逐字一致** —— 那边写文件、这边读文件，
 * 两边各写一份规则，漂移了就是「读不到页图」（且只在真机上才发现）。
 */
describe('pageImageUrl（与 web 端 sheetMusicPagePath 的跨仓契约）', () => {
  it('PDF 的 publicUrl 去 .pdf + /p{n}.jpg', () => {
    expect(
      pageImageUrl('https://x.supabase.co/storage/v1/object/public/sheet-music/score-1/abc.pdf', 3)
    ).toBe('https://x.supabase.co/storage/v1/object/public/sheet-music/score-1/abc/p3.jpg')
  })

  it('多落点的 `-1` 后缀前缀同样成立（页图挂在各自落点目录下）', () => {
    expect(pageImageUrl('https://h/sheet-music/s/abc-1.pdf', 1)).toBe(
      'https://h/sheet-music/s/abc-1/p1.jpg'
    )
  })
})
