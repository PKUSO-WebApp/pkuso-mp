import { useCallback, useEffect, useState } from 'react'
import { Button, ScrollView, Text, View } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { supabase } from '@/lib/supabase'
import { usePageRestore } from '@/hooks/usePageRestore'
import { useRehearsalById } from '@/hooks/useRehearsalById'
import { useThemeClass } from '@/context/theme-context'
import { useNavTitle, useT } from '@/i18n'
import { formatRehearsalRange, normalizeScheduleTime } from '@/lib/date-utils'
import { getSectionGroupLabel } from '@/constants/instruments'
import { normalizeTargets } from '@/lib/rehearsal-utils'
import type { RehearsalRepertoireRow } from '@/types/database'
import './index.scss'

export default function PresidentRehearsalDetailPage() {
  const { t } = useT()
  useNavTitle('president.rehearsal.detailTitle')
  const darkClass = useThemeClass()
  const cachedId = usePageRestore<string>('id')
  const id = Number(cachedId)
  const { rehearsal, status, retry } = useRehearsalById(Number.isFinite(id) && id > 0 ? id : null)
  const [pieces, setPieces] = useState<RehearsalRepertoireRow[]>([])
  const [deleting, setDeleting] = useState(false)

  const loadPieces = useCallback(async () => {
    if (!Number.isFinite(id) || id <= 0) return
    const { data, error } = await supabase
      .from('rehearsal_repertoire')
      .select('*')
      .eq('rehearsal_id', id)
      .order('sort_order')
    if (error) {
      console.error('[PresidentRehearsalDetail] 曲目加载失败', error.message)
      return
    }
    setPieces((data as RehearsalRepertoireRow[]) ?? [])
  }, [id])

  useEffect(() => {
    void loadPieces()
  }, [loadPieces])

  useDidShow(() => {
    retry()
    void loadPieces()
  })

  const handleDelete = () => {
    if (deleting || !rehearsal) return
    void Taro.showModal({
      title: t('president.rehearsal.delete'),
      content: t('president.rehearsal.deleteConfirm'),
      success: async (res) => {
        if (!res.confirm) return
        setDeleting(true)
        const { data, error } = await supabase.rpc('president_delete_rehearsal', {
          p_rehearsal_id: rehearsal.id,
        })
        setDeleting(false)
        if (error || !(data as { ok?: boolean } | null)?.ok) {
          void Taro.showToast({ title: t('president.rehearsal.deleteFailed'), icon: 'none' })
          return
        }
        void Taro.showToast({ title: t('president.rehearsal.saved'), icon: 'success' })
        setTimeout(() => void Taro.navigateBack(), 300)
      },
    })
  }

  if (!rehearsal) {
    const message =
      status === 'not-found'
        ? t('president.rehearsal.notFound')
        : status === 'error'
          ? t('president.rehearsal.loadFailed')
          : t('common.actions.loading')
    return (
      <View className={`${darkClass} flex h-full items-center justify-center bg-page-bg px-6`}>
        <Text className='text-xs text-text-muted'>{message}</Text>
        {status === 'error' && (
          <Button
            hoverClass='none'
            className='mt-4 w-auto rounded-full border border-border bg-surface px-4 py-1.5 text-xs leading-normal text-text'
            onClick={retry}
          >
            {t('common.actions.retry')}
          </Button>
        )}
      </View>
    )
  }

  const start = rehearsal.start_time ? normalizeScheduleTime(rehearsal.start_time) : null
  const end = rehearsal.end_time ? normalizeScheduleTime(rehearsal.end_time) : null
  const timeText = start ? formatRehearsalRange(start, end) : t('president.rehearsal.timeUnset')
  const typeText =
    rehearsal.type === 'section'
      ? `${t('president.rehearsal.section')}${
          rehearsal.target_section?.length
            ? ` · ${getSectionGroupLabel(normalizeTargets(rehearsal.target_section))}`
            : ''
        }`
      : t('president.rehearsal.full')

  return (
    <View className={`${darkClass} flex h-full flex-col bg-page-bg`}>
      <ScrollView scrollY className='flex-1 min-h-0'>
        <View className='px-4 pb-6 pt-4'>
          <Text className='block text-2xl font-semibold leading-snug text-text'>{timeText}</Text>
          <Text className='mt-1 block text-sm text-text-muted'>{typeText}</Text>
          <View className='my-4 h-px w-full bg-border' />

          <Text className='mb-3 block text-sm font-medium text-text'>
            {t('president.rehearsal.detailLocation')}
          </Text>
          <Text className='mb-4 block text-sm leading-relaxed text-text-muted'>
            {rehearsal.location || t('president.rehearsal.detailNone')}
          </Text>

          <Text className='mb-3 block text-sm font-medium text-text'>
            {t('president.rehearsal.detailRepertoire')}
          </Text>
          {pieces.length === 0 ? (
            <Text className='block text-sm leading-relaxed text-text-muted'>
              {rehearsal.repertoire || t('president.rehearsal.detailNone')}
            </Text>
          ) : (
            pieces.map((piece) => (
              <View
                key={piece.id}
                className='mb-2 rounded-xl border border-border bg-card px-3 py-2'
              >
                <Text className='block text-sm text-text'>{piece.title}</Text>
                {piece.content ? (
                  <Text className='mt-1 block text-xs text-text-muted'>{piece.content}</Text>
                ) : null}
              </View>
            ))
          )}
        </View>
      </ScrollView>

      <View className='flex gap-2 border-t border-border bg-surface px-4 pb-safe pt-3'>
        <Button
          hoverClass='none'
          className='m-0 flex-1 rounded-xl border border-border bg-surface py-2 text-sm leading-normal text-text'
          onClick={() =>
            void Taro.navigateTo({
              url: `/pages/president-rehearsal-edit/index?id=${rehearsal.id}`,
            })
          }
        >
          {t('common.actions.edit')}
        </Button>
        <Button
          hoverClass='none'
          disabled={deleting}
          className='m-0 flex-1 rounded-xl border border-danger bg-surface py-2 text-sm leading-normal text-danger disabled:opacity-50'
          onClick={handleDelete}
        >
          {deleting ? t('common.actions.loading') : t('president.rehearsal.delete')}
        </Button>
      </View>
    </View>
  )
}
