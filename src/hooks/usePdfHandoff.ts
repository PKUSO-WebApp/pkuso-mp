import { useRef, useState } from 'react'
import Taro from '@tarojs/taro'
import { useT } from '@/i18n'
import { describeError, reportClientError } from '@/lib/error-report'
import { docHasInk, loadAnnoDoc } from '@/lib/annotation'
import { ensureSavedPdf, userDataRoot, type FsLike } from '@/lib/pdf-save'
import { AnnotatedPdfError, composeAnnotatedPdf } from '@/lib/annotated-pdf'
import { syncAnnotationFile } from '@/lib/annotation-sync-runner'
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
  /**
   * 是否允许「带批注」出口。共享谱的合成走 P6d 的独立函数；P6b 里先禁掉，
   * 避免把**个人**批注烧进共享谱。
   */
  allowAnnotations?: boolean
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
/**
 * 一次「准备」请求的键。**选择也在里面**：带批注与不带批注是两个不同的文件，
 * 而 `ready` 与 `pick` 比的就是它（见 readyId 的注释）。
 */
const reqKeyOf = (fileId: string, anno: boolean) => `${fileId}#${anno ? 'anno' : 'orig'}`

export function usePdfHandoff(owner: string) {
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
  /**
   * 正在备文件（含云端合成那一段网络）。面板上的开关用它禁用——换了选择就得重新备一份，
   * 半途改主意既没有意义，也会让「面板上那份到底是哪个」变得含糊。
   */
  const [preparing, setPreparing] = useState(false)
  /**
   * 「是否带有批注？」。开了就走 Edge Function 在云端把批注烧进 PDF（带网络往返，
   * 面板上会多显示一会儿「正在准备文件…」），关着就是原样那份 PDF。
   *
   * 默认**关**：这条是本次新加的能力，让默认值与从前完全一致——不然每个只想存原件的人
   * 都要先等一次云端合成。在本次会话里它是**黏的**（换一行、换一册都不重置）：
   * 想要带批注的人通常每一份都想要。
   */
  const [withAnno, setWithAnno] = useState(false)
  /**
   * 这一册有没有画得出来的笔迹（**开面板那一刻**定，见 `open`）。
   *
   * 没有时「是否带有批注？」**固定为「否」且不可拨**（用户 2026-10-15 定）：拨上去只会换来
   * 一句「这份谱还没有批注」。判据见 `lib/annotation` 的 `docHasInk`。
   */
  const [hasAnno, setHasAnno] = useState(false)
  /**
   * 已就绪的那份是**哪一次准备**（`reqKeyOf`）。
   *
   * 存键而不是文件 id，是因为「就绪」这件事本身就包含**选择**：带批注与不带批注是两个
   * 不同的文件。存 id 的话拨完开关它还是旧值（同一个 id），而 React 对同值 setState 会
   * **跳过重渲染** ⇒ 判定根本不会重算，只能靠别处再清一次状态来兜（那样判定就被架空了）。
   * 存键之后，拨开关必然让这个值对不上，判定自己就说了「手上这份已经不对了」。
   */
  const [readyId, setReadyId] = useState<string | null>(null)
  /**
   * 已备好那份的记账。`fileId` 是**这一册的 id**（不是下载缓存键），`anno` 记它是哪一种——
   * 两者都要与当前选择一致才算「就绪」：拨了开关还拿旧那份交给用户，就是无声地给错文件。
   */
  const pdfRef = useRef<{ reqKey: string; fileId: string; path: string; name: string } | null>(null)
  /** 在飞的那次准备的键（`<id>#orig|anno`）：同一种请求不重复做 */
  const inFlightRef = useRef<string | null>(null)
  /**
   * 准备的序号：**最后一次请求说了算**。
   *
   * 没有它就会出一个很安静的错：用户在「正在准备文件…」期间拨了开关，而那一次准备
   * （按 id 去重时）会被直接丢掉，或者先发起的那次**后回来**、把新选择的结果覆盖掉——
   * 两种都是「拨了开关，交付的却还是另一份」。所以每次发起都领一个号，回来时对不上就作废。
   */
  const seqRef = useRef(0)

  const ready = !!meta && readyId === reqKeyOf(meta.fileId, withAnno)

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

  /**
   * 备好本地那份 PDF（幂等：同一文件只做一次；出错就 toast + 上报，面板保持不可点）。
   *
   * 带批注那份**另用一个记账键**（`<id>#anno`）：`ensureSavedPdf` 是按 fileId 分目录、
   * 有现成的就复用，两者共用键的话「先存了原件、再打开开关」会直接复用原件——用户以为
   * 拿到了带批注的，其实没有。
   */
  const prepare = async (m: PdfHandoffMeta, anno: boolean) => {
    const id = m.fileId
    if (!id) return
    const key = anno ? `${id}#anno` : id
    const reqKey = reqKeyOf(id, anno)
    if (pdfRef.current?.reqKey === reqKey) {
      setReadyId(reqKey)
      return
    }
    if (inFlightRef.current === reqKey) return
    const seq = ++seqRef.current
    inFlightRef.current = reqKey
    setPreparing(true)
    let expectedBytes = m.expectedBytes
    // 「带批注那份到底慢在哪」——**真机没有 Network 面板**，所以这段耗时只能自己报上来。
    // 三段分开计：同步 / 云端合成 / 下载，缺一段就分不清是函数慢还是链路慢。
    const t0 = Date.now()
    let tSync = 0
    let tCompose = 0
    try {
      let url = m.url()
      let fileName = m.fileName
      if (anno) {
        // ⚠️ **先同步再把批注烧进去**（用户 2026-10-10 实测提出）：合成函数读的是**服务端**
        // 那份批注，而本地刚画的还没推上去的话，产出的 PDF 就缺最新几笔——用户拿到的是
        // 「看起来对、其实少东西」的文件。这一步会带一次拉取 + 可能的推送。
        await syncAnnotationFile(id)
        tSync = Date.now() - t0
        // 云端合成：这一步要走网络，所以「正在准备文件…」会停得比平时久
        const composed = await composeAnnotatedPdf(id)
        tCompose = Date.now() - t0 - tSync
        url = composed.url
        // 签名 URL 的**长度只有服务端知道**（本地没有库里的 file_size 可比），
        // 所以分片下载的依据取响应里那个确切的字节数
        expectedBytes = composed.bytes > 0 ? composed.bytes : undefined
        // ⚠️ `m.fileName` 是库里的 `file_name`，**自带 `.pdf`**（实测 `小提琴1.pdf`）——
        // 后缀必须加在扩展名**之前**。直接拼在末尾的话，`displayPdfName` 只会剥掉最后那个
        // `.pdf`，中间那个原样留下来 ⇒ 交付出去的是 `xxx.pdf（带批注）.pdf`（2026-10-11 真机报）
        fileName = `${m.fileName.replace(/\.pdf$/i, '')}${t('common.saveTo.annoSuffix')}`
      }
      if (!url) {
        void Taro.showToast({ title: t('common.saveTo.notReady'), icon: 'none' })
        return
      }
      const res = await ensureSavedPdf(
        {
          fileId: key,
          url,
          title: m.title,
          section: m.section,
          fileName,
          expectedBytes,
          // 云端刚重新合成过 ⇒ 本地那份按定义已经过期，必须重下（见 EnsureSavedPdf 的 force）
          force: anno,
        },
        {
          root: userDataRoot(),
          fs: (Taro.getFileSystemManager?.() as FsLike | undefined) ?? null,
          // 分片下载要带 `Range` 头与**逐腿的超时**（见 DownloadLeg）；单次下载两个都不传
          // （保持与从前完全一致 —— 那时它交给平台的默认超时）
          download: (u, header, timeoutMs) =>
            Taro.downloadFile({
              url: u,
              ...(header ? { header } : {}),
              ...(timeoutMs ? { timeout: timeoutMs } : {}),
            }),
          // 探针要能**掐掉输的那条**：`Taro.downloadFile` 返回的是 Promise & DownloadTask，
          // 所以 `abort()` 直接就在这个对象上（见 lib/ranged-download 的 raceLegs）
          cancellableDownload: (u, header, timeoutMs) => {
            const task = Taro.downloadFile({ url: u, header, timeout: timeoutMs })
            return { result: task, cancel: () => task.abort?.() }
          },
        }
      )
      if (seq !== seqRef.current) return // 用户已经改主意了：这一次的结果作废
      if (anno) {
        reportClientError({
          event: 'score_reader_annotated_prepare',
          level: 'warn',
          message: `带批注准备 ${Date.now() - t0}ms（同步 ${tSync} / 合成 ${tCompose}）`,
          detail: {
            fileId: id,
            totalMs: Date.now() - t0,
            syncMs: tSync,
            composeMs: tCompose,
            fetchMs: Date.now() - t0 - tSync - tCompose,
            bytes: expectedBytes ?? 0,
            platform,
          },
        })
      }
      pdfRef.current = { reqKey, fileId: id, path: res.path, name: res.name }
      setReadyId(reqKey)
    } catch (err) {
      if (seq !== seqRef.current) return // 旧那次的失败不该弹给已经改了主意的人
      const msg = describeError(err)
      // 「这份谱根本没有批注」是**预期内**的一种（用户打开了开关但没画过东西）：
      // 它不该被当成失败上报，给一句能懂的话就够
      const noAnno = anno && err instanceof AnnotatedPdfError && err.code === 'no annotations'
      if (noAnno) {
        void Taro.showToast({ title: t('common.saveTo.noAnno'), icon: 'none' })
      } else {
        reportClientError({
          event: 'score_reader_pdf_save_failed',
          message: msg,
          // `bytes` 一并上报：>0 说明走的是**分片**那条路，0 说明退回了单次下载 ——
          // 下次再报错时，这两条路径的失败原因完全不同，先把路分清楚再查
          detail: { fileId: id, kind: 'prepare', platform, anno, bytes: expectedBytes ?? 0 },
        })
        void Taro.showToast({ title: t('common.saveTo.failed', { error: msg }), icon: 'none' })
      }
    } finally {
      if (inFlightRef.current === reqKey) inFlightRef.current = null
      // 只有**最新**那一次结束才解除：被顶掉的那次不该把「还在备」的旗子放下来
      if (seq === seqRef.current) setPreparing(false)
    }
  }

  /** 打开面板（针对 `m` 这一份文件），并立刻开始备文件（面板会显示「正在准备文件…」） */
  const open = (m: PdfHandoffMeta) => {
    if (busy) return
    // 有没有笔迹在这一刻定：没有就把开关压回「否」（它同时也是「固定为否」的落点 ——
    // 面板上那个开关会被禁用，这里再压一次值，两道闸）
    const allow = m.allowAnnotations !== false
    const has = allow && docHasInk(loadAnnoDoc(owner, m.fileId))
    setHasAnno(has)
    const anno = has && withAnno
    if (anno !== withAnno) setWithAnno(anno)
    setMeta(m)
    setSheetOn(true)
    void prepare(m, anno)
  }

  /**
   * 拨开关：**要重新备一份**——带批注与不带批注是两个不同的文件，而 `ready` 是「那份
   * 已经就绪」的断言。先把就绪态作废（面板立刻回到「正在准备文件…」、出口不可点），
   * 再按新选择重来。当前这一册的元数据用渲染闭包里的 `meta`——它正是开关所在的那一次渲染。
   */
  const toggleAnno = (next: boolean) => {
    // `!hasAnno` = 这一册根本没有笔迹：开关在面板上已经禁用了，这是第二道闸
    if (busy || !hasAnno || next === withAnno) return
    setWithAnno(next)
    // ⚠️ **刻意不动 `pdfRef` / `readyId`**：让就绪判定自己说「手上这份已经不对了」——
    // `ready` 里那条「`pdfRef.anno === withAnno`」正是为此存在的。在这里顺手清空的话，
    // 那条判据就被架空了（任何改动都测不出来），而它才是「不能把上一份交给用户」的唯一定义。
    if (meta) void prepare(meta, next)
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
    // 最后一道闸：交付出去的东西必须就是此刻那一次准备的结果（面板上的按钮在未就绪时
    // 本来就不可点，这条防的是「点下去的那一拍状态还没更新」）
    if (!pdf || !meta || pdf.reqKey !== reqKeyOf(meta.fileId, withAnno) || busy) return
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
          detail: { fileId: pdf.fileId, kind, platform, bytes: meta?.expectedBytes ?? 0 },
        })
        void Taro.showToast({ title: t('common.saveTo.failed', { error: msg }), icon: 'none' })
      })
      .finally(() => setBusy(false))
  }

  return {
    sheetOn,
    ready,
    busy,
    preparing,
    kinds,
    labels,
    platform,
    withAnno,
    /** 这一册有没有笔迹：没有时面板上「是否带有批注？」固定为「否」且不可拨 */
    hasAnno,
    toggleAnno,
    open,
    close,
    pick,
  }
}
