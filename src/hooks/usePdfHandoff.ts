import { useRef, useState } from 'react'
import Taro from '@tarojs/taro'
import { useT } from '@/i18n'
import { describeError, reportClientError } from '@/lib/error-report'
import { ensureSavedPdf, userDataRoot, type FsLike } from '@/lib/pdf-save'
import { handOffPdf, handoffKindsFor, type HandoffKind } from '@/lib/pdf-handoff'

export type PdfHandoffMeta = {
  fileId: string
  /** **惰性取**本地 PDF 的下载源：阅读器里它在 `load()` 之后才有值（存在 ref 里，不是 state），
   *  渲染期读会拿到空串。所以传函数，别传值。 */
  url: () => string
  title?: string
  section?: string
  fileName: string
  /**
   * 库里的 `file_size`。**给了才走分片下载**（见 lib/ranged-download.ts）——
   * 它是分片的终止条件与长度校验依据。旧入口（早先分享出去的链接）没有这个参数 ⇒
   * 退回单次下载，属预期。
   */
  expectedBytes?: number
}

/**
 * 「保存到…」的共用逻辑：**两个入口**（阅读器顶栏、声部页每个文件行）必须同形，否则
 * 迟早只有一处是对的。屏幕外壳见 `components/score/SaveToSheet.tsx`。
 *
 * ⚠️ 这里唯一的设计约束来自微信：`addFileToFavorites` / `shareFileMessage` /
 * `saveFileToDisk` **必须在用户点击的同步调用栈里发起**，否则真机报
 * `can only be invoked by user TAP gesture`。所以分两步：
 *   1. `open()` 时就把这份文件备到本地（探活 + 可能下载），面板显示「正在准备文件…」；
 *   2. `pick()` 只读那份**已经就绪**的记账，**到 `handOffPdf` 之间一行 `await` 都没有**
 *      （`handOffPdf` 虽是 async，但函数体在首个 await 之前是同步执行的）。
 *
 * 记账按 `fileId` 归属：换册 / 换一行时旧的自动作废，不会把**上一份**文件交出去。
 */
export function usePdfHandoff() {
  const { t } = useT()
  /**
   * 当前这一份的元数据：**在 `open()` 时定**，不是构造时传。
   *
   * 声部页上每行都可能开面板，而 `setTarget(f)` 与紧跟着的 `open()` 之间差一拍渲染
   * （state 更新是异步的）——构造时传就只能拿到上一行。改成 open 时显式给，
   * 这个失配的类别直接不存在。`pick` 读的是渲染闭包里的它：用户点出口时那一拍渲染早就到了。
   */
  const [meta, setMeta] = useState<PdfHandoffMeta | null>(null)
  const [sheetOn, setSheetOn] = useState(false)
  const [busy, setBusy] = useState(false)
  /** 已就绪的那份是哪个文件；`ready` 还要再核对 `pdfRef`，两者都指向当前 `fileId` 才算数 */
  const [readyId, setReadyId] = useState<string | null>(null)
  const pdfRef = useRef<{ fileId: string; path: string; name: string } | null>(null)
  const preparingRef = useRef<string | null>(null)

  const ready = !!meta && readyId === meta.fileId && pdfRef.current?.fileId === meta.fileId

  // `platform` 一并进上报：面板里出现哪几项完全由它决定（PC 才多「保存到电脑」），
  // 而「为什么这台设备上少一项 / 多一项」这类问题只能靠它判读——`getDeviceInfo().platform`
  // 在开发者工具里是 `devtools`，手机上是 `ios`/`android`。
  const platform = (Taro.getDeviceInfo?.() as { platform?: string } | undefined)?.platform
  const kinds = handoffKindsFor(platform)
  const labels: Record<HandoffKind, string> = {
    favorites: t('common.saveTo.favorites'),
    chat: t('common.saveTo.chat'),
    app: t('common.saveTo.app'),
    disk: t('common.saveTo.disk'),
  }

  /** 备好本地那份 PDF（幂等：同一文件只做一次；出错就 toast + 上报，面板保持不可点） */
  const prepare = async (m: PdfHandoffMeta) => {
    const id = m.fileId
    if (!id) return
    if (pdfRef.current?.fileId === id) {
      setReadyId(id)
      return
    }
    if (preparingRef.current === id) return
    const url = m.url()
    if (!url) {
      void Taro.showToast({ title: t('common.saveTo.notReady'), icon: 'none' })
      return
    }
    preparingRef.current = id
    try {
      const res = await ensureSavedPdf(
        {
          fileId: id,
          url,
          title: m.title,
          section: m.section,
          fileName: m.fileName,
          expectedBytes: m.expectedBytes,
        },
        {
          root: userDataRoot(),
          fs: (Taro.getFileSystemManager?.() as FsLike | undefined) ?? null,
          // 分片下载要带 `Range` 头；单次下载不传第二个参数（保持与从前完全一致）
          download: (u, header) => Taro.downloadFile(header ? { url: u, header } : { url: u }),
        }
      )
      pdfRef.current = { fileId: id, path: res.path, name: res.name }
      setReadyId(id)
    } catch (err) {
      const msg = describeError(err)
      reportClientError({
        event: 'score_reader_pdf_save_failed',
        message: msg,
        detail: { fileId: id, kind: 'prepare', platform },
      })
      void Taro.showToast({ title: t('common.saveTo.failed', { error: msg }), icon: 'none' })
    } finally {
      preparingRef.current = null
    }
  }

  /** 打开面板（针对 `m` 这一份文件），并立刻开始备文件（面板会显示「正在准备文件…」） */
  const open = (m: PdfHandoffMeta) => {
    if (busy) return
    setMeta(m)
    setSheetOn(true)
    void prepare(m)
  }

  const close = () => setSheetOn(false)

  /**
   * 点了某个出口。
   *
   * ⚠️⚠️ **从这里到 `handOffPdf(...)` 之间一行 `await` 都不能有**（理由见文件头）。
   * 插进任何异步都会退化成 `can only be invoked by user TAP gesture`。
   */
  const pick = (kind: HandoffKind) => {
    const pdf = pdfRef.current
    if (!pdf || !meta || pdf.fileId !== meta.fileId || busy) return
    setSheetOn(false)
    setBusy(true)
    void handOffPdf(kind, { path: pdf.path, name: pdf.name })
      .catch((err) => {
        const msg = describeError(err)
        // 这条路径失败常常意味着「本地那份没了」：清掉记账，下次点会重新备一份
        pdfRef.current = null
        setReadyId(null)
        reportClientError({
          event: 'score_reader_pdf_save_failed',
          message: msg,
          detail: { fileId: pdf.fileId, kind, platform },
        })
        void Taro.showToast({ title: t('common.saveTo.failed', { error: msg }), icon: 'none' })
      })
      .finally(() => setBusy(false))
  }

  return { sheetOn, ready, busy, kinds, labels, open, close, pick }
}
