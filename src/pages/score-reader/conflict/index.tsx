import { useRouter } from '@tarojs/taro'
import { useT, useNavTitle } from '@/i18n'
import {
  ScoreCompareView,
  type ComparePageData,
  type CompareSide,
  type CompareSubmitResult,
} from '@/components/score/ScoreCompareView'
import { loadConflictPage, resolveAnnotationConflict } from '@/lib/annotation-sync-runner'
import './index.scss'

/**
 * 批注冲突解决页：**一页两版，选一版留下**。
 *
 * 预览与三选一在 `ScoreCompareView` 里（合并页共用同一份实现）；本页只负责
 * 「数据从个人批注来、提交回个人批注」这层适配。
 *
 * 交互（2026-10-15 定稿）：
 *   - 上方实时预览，下方三个单选切「本地版 / 远端版 / 合并两版」；
 *   - 下方一个「使用这一版」提交按钮，作用于**当前选中的那一版**；
 *   - **两边都不丢**：选本地/合并时远端那份由推送 RPC 归档；选远端时本地这份
 *     先送进服务端历史再覆盖本地。
 *
 * ⚠️ 一切都以**预览时看到的那个云端版本**为前提：用户看预览的时候云端若又变了，
 * 这一页**什么都不做**，只提示重新看一眼。
 */
export default function AnnotationConflict() {
  const { t } = useT()
  // 顶栏：标题走 useNavTitle（它同时负责主题切换时的导航栏配色）；拿到文件名之后再盖成文件名
  useNavTitle('scoreReader.conflict.navTitle')
  const router = useRouter()
  const fileId = router.params.file_id ? decodeURIComponent(router.params.file_id) : ''
  const page = Math.max(1, Number(router.params.page) || 1)
  /** 这一册的 PDF 公开地址（阅读器带过来的；缺了回退查库，见 ScoreCompareView 的 load） */
  const presetUrl = router.params.u ? decodeURIComponent(router.params.u) : ''
  const presetName = router.params.fn ? decodeURIComponent(router.params.fn) : ''
  /**
   * 「恢复云端历史」入口带来的历史版本号（`h`）。
   *
   * 有它时**对照侧**换成那一版历史内容，而 CAS 基准仍是**实时远端**（见 `loadConflictPage`）——
   * UI、按钮、文案一个都不用改，三个选择照样成立（选历史那版 = 把它推上云端）。
   */
  const archiveVersion = router.params.h ? decodeURIComponent(router.params.h) : ''

  const labels: Record<CompareSide, string> = {
    local: t('scoreReader.conflict.localVersion'),
    remote: t('scoreReader.conflict.remoteVersion'),
    merge: t('scoreReader.conflict.mergeVersion'),
  }

  const loadData = () => loadConflictPage(fileId, page, archiveVersion || undefined)

  const submit = async (
    choice: CompareSide,
    data: ComparePageData
  ): Promise<CompareSubmitResult> => {
    const result = await resolveAnnotationConflict({
      fileId,
      page,
      choice,
      shownVersion: data.remoteVersion,
      // 对照侧是历史版本时，「采纳」要把它推上云端（只落本地会立刻又变成一次冲突）
      archiveVersion: archiveVersion || undefined,
    })
    if (result.ok) return { ok: true }
    if (result.reason === 'raced') return { ok: false, raced: true }
    return { ok: false, message: t('scoreReader.conflict.failed') }
  }

  return (
    <ScoreCompareView
      fileId={fileId}
      page={page}
      presetUrl={presetUrl}
      presetName={presetName}
      hint={t('scoreReader.conflict.why')}
      pageLabel={t('scoreReader.conflict.pageButton', { page })}
      labels={labels}
      submitLabel={t('scoreReader.conflict.useCurrent')}
      defaultSide='local'
      racedText={t('scoreReader.conflict.raced')}
      failedText={t('scoreReader.conflict.failed')}
      loadData={loadData}
      submit={submit}
    />
  )
}
