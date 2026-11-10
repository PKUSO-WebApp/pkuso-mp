import { useRouter } from '@tarojs/taro'
import { useT, useNavTitle } from '@/i18n'
import {
  ScoreCompareView,
  type ComparePageData,
  type CompareSide,
  type CompareSubmitResult,
} from '@/components/score/ScoreCompareView'
import {
  applyMergePage,
  loadMergePage,
  type MergeChoice,
  type MergeDirection,
  type MergePageState,
} from '../lib/shared-merge'
import './index.scss'

/**
 * 共享谱 ↔ 个人批注的逐页合并页（P6c）。
 *
 * 与冲突页同一套预览/三选一（`ScoreCompareView`），区别只在数据源与提交目标：
 *   - `to-personal`：共享 → 个人，提交写**个人层**（所有成员可用）；
 *   - `to-shared`：个人 → 共享，提交以 CAS 写**共享表**（仅 can_edit 可用）。
 *
 * 页面集合由入口的列表 sheet 算好；本页只处理参数里的那一页。
 */
export default function SharedMerge() {
  const { t } = useT()
  useNavTitle('scoreReader.merge.navTitle')
  const router = useRouter()
  const fileId = router.params.file_id ? decodeURIComponent(router.params.file_id) : ''
  const page = Math.max(1, Number(router.params.page) || 1)
  const direction: MergeDirection =
    router.params.direction === 'to-shared' ? 'to-shared' : 'to-personal'
  const presetUrl = router.params.u ? decodeURIComponent(router.params.u) : ''
  const presetName = router.params.fn ? decodeURIComponent(router.params.fn) : ''

  const labels: Record<CompareSide, string> = {
    local: t('scoreReader.merge.mine'),
    remote: t('scoreReader.merge.shared'),
    merge: t('scoreReader.merge.merge'),
  }

  const loadData = async (): Promise<ComparePageData> => {
    try {
      // ComparePageData 与 MergePageState 的字段名不同：这里转一次，
      // 提交时再转回去（两边都是同一份内容，不做任何加工）
      const s = await loadMergePage(fileId, page)
      return { local: s.personal, remote: s.shared, remoteVersion: s.sharedVersion }
    } catch (err) {
      const msg =
        err instanceof Error && err.message === 'no-user'
          ? t('scoreReader.merge.noUser')
          : t('scoreReader.merge.loadFailed')
      throw new Error(msg)
    }
  }

  const submit = async (side: CompareSide, data: ComparePageData): Promise<CompareSubmitResult> => {
    const preview: MergePageState = {
      personal: data.local,
      shared: data.remote,
      sharedVersion: data.remoteVersion,
    }
    const choice: MergeChoice = side === 'remote' ? 'shared' : side
    const result = await applyMergePage({ fileId, page, direction, choice, preview })
    if (result.ok) return { ok: true }
    if (result.reason === 'raced') return { ok: false, raced: true }
    if (result.reason === 'no-user') {
      return { ok: false, message: t('scoreReader.merge.noUser') }
    }
    return { ok: false, message: t('scoreReader.merge.failed') }
  }

  return (
    <ScoreCompareView
      fileId={fileId}
      page={page}
      presetUrl={presetUrl}
      presetName={presetName}
      hint={
        direction === 'to-personal'
          ? t('scoreReader.merge.hintToPersonal')
          : t('scoreReader.merge.hintToShared')
      }
      pageLabel={t('scoreReader.merge.pageButton', { page })}
      labels={labels}
      submitLabel={t('scoreReader.merge.useCurrent')}
      defaultSide={direction === 'to-personal' ? 'remote' : 'local'}
      racedText={t('scoreReader.merge.raced')}
      failedText={t('scoreReader.merge.failed')}
      loadData={loadData}
      submit={submit}
    />
  )
}
