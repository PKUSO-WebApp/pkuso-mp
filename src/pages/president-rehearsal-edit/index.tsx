import { useEffect, useRef, useState } from 'react'
import { Button, Picker, ScrollView, Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { supabase } from '@/lib/supabase'
import { invokeFunction } from '@/lib/functions'
import { usePageRestore } from '@/hooks/usePageRestore'
import { useSchedule } from '@/hooks/useSchedule'
import { useThemeClass } from '@/context/theme-context'
import { useNavTitle, useT } from '@/i18n'
import { getLocalDateString, normalizeScheduleTime } from '@/lib/date-utils'
import { formatRepertoireSummary } from '@/lib/repertoire-summary'
import { getSectionGroupLabel } from '@/constants/instruments'
import { DateTimePicker } from '@/components/ui/DateTimePicker'
import { Toggle } from '@/components/ui/Toggle'
import { YesNoSwitch } from '@/components/ui/YesNoSwitch'
import { Modal } from '@/components/ui/Modal'
import { SectionMultiPicker } from '@/components/president/SectionMultiPicker'
import {
  RepertoireEditor,
  type PresidentPiece,
  type SheetMusicOption,
} from '@/components/president/RepertoireEditor'
import type { RehearsalRepertoireRow, RehearsalRow } from '@/types/database'
import './index.scss'

type RehearsalType = 'full' | 'section'

type LocationRow = {
  id: string
  name: string
  address: string | null
  radius_m: number
}

export default function PresidentRehearsalEditPage() {
  const { t } = useT()
  const darkClass = useThemeClass()
  const cachedId = usePageRestore<string>('id')
  const id = Number(cachedId)
  const isEdit = Number.isFinite(id) && id > 0
  useNavTitle(isEdit ? 'president.rehearsal.editTitle' : 'president.rehearsal.createTitle')

  const { checkConflict } = useSchedule()
  const [type, setType] = useState<RehearsalType>('full')
  const [targetSections, setTargetSections] = useState<string[]>([])
  const [startDate, setStartDate] = useState(getLocalDateString())
  const [startTime, setStartTime] = useState('19:00')
  const [endDate, setEndDate] = useState(getLocalDateString())
  const [endTime, setEndTime] = useState('21:00')
  const [locationId, setLocationId] = useState('')
  const [locations, setLocations] = useState<LocationRow[]>([])
  const [pieces, setPieces] = useState<PresidentPiece[]>([])
  const [sheetOptions, setSheetOptions] = useState<SheetMusicOption[]>([])
  const [notify, setNotify] = useState(false)
  const [loading, setLoading] = useState(isEdit)
  const [saving, setSaving] = useState(false)
  const [conflictOpen, setConflictOpen] = useState(false)
  const [editLocationName, setEditLocationName] = useState<string | null>(null)
  const locationInitializedRef = useRef(false)
  const savingRef = useRef(false)

  const selectedLocation = locations.find((item) => item.id === locationId) ?? null

  useEffect(() => {
    let cancelled = false
    void supabase.rpc('list_rehearsal_locations').then(({ data, error }) => {
      if (cancelled) return
      if (error) {
        console.error('[PresidentRehearsalEdit] 地点加载失败', error.message)
        return
      }
      setLocations((data as LocationRow[] | null) ?? [])
    })
    void supabase
      .from('sheet_music')
      .select('id, title, composer')
      .order('title')
      .order('composer')
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) {
          console.error('[PresidentRehearsalEdit] 谱务曲目加载失败', error.message)
          return
        }
        setSheetOptions((data as SheetMusicOption[] | null) ?? [])
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (isEdit) return
    if (!locationId && locations.length > 0) setLocationId(locations[0].id)
  }, [isEdit, locationId, locations])

  useEffect(() => {
    if (!isEdit) return
    let cancelled = false
    void Promise.all([
      supabase.from('rehearsals').select('*').eq('id', id).maybeSingle(),
      supabase.from('rehearsal_repertoire').select('*').eq('rehearsal_id', id).order('sort_order'),
    ]).then(([rehearsalResult, piecesResult]) => {
      if (cancelled) return
      setLoading(false)
      if (rehearsalResult.error || !rehearsalResult.data) {
        void Taro.showToast({ title: t('president.rehearsal.notFound'), icon: 'none' })
        return
      }
      const row = rehearsalResult.data as RehearsalRow
      setType(row.type === 'section' ? 'section' : 'full')
      setTargetSections((row.target_section as string[] | null) ?? [])
      const start = row.start_time ? normalizeScheduleTime(row.start_time) : ''
      const end = row.end_time ? normalizeScheduleTime(row.end_time) : ''
      if (start) {
        const [date, time] = start.split('T')
        setStartDate(date)
        setStartTime(time?.slice(0, 5) || '19:00')
      }
      if (end) {
        const [date, time] = end.split('T')
        setEndDate(date)
        setEndTime(time?.slice(0, 5) || '21:00')
      }
      setEditLocationName(row.location ?? null)
      if (piecesResult.error) {
        console.error('[PresidentRehearsalEdit] 曲目加载失败', piecesResult.error.message)
      }
      const rows = (piecesResult.data as RehearsalRepertoireRow[] | null) ?? []
      setPieces(
        rows.length > 0
          ? rows.map((piece) => ({
              sheetMusicId: piece.sheet_music_id,
              title: piece.title,
              content: piece.content ?? '',
            }))
          : row.repertoire
            ? [{ sheetMusicId: null, title: row.repertoire, content: '' }]
            : []
      )
    })
    return () => {
      cancelled = true
    }
  }, [id, isEdit, t])

  useEffect(() => {
    if (!isEdit || locationInitializedRef.current || editLocationName === null) return
    if (locations.length === 0) return
    const matched = locations.find((item) => item.name === editLocationName)
    if (matched) setLocationId(matched.id)
    locationInitializedRef.current = true
  }, [editLocationName, isEdit, locations])

  const handleStartDate = (value: string) => {
    setStartDate(value)
    if (endDate < value) setEndDate(value)
  }

  const submit = async () => {
    if (savingRef.current || saving) return
    if (type === 'section' && targetSections.length === 0) {
      void Taro.showToast({ title: t('president.rehearsal.sectionRequired'), icon: 'none' })
      return
    }
    if (!locationId || !selectedLocation) {
      void Taro.showToast({ title: t('president.rehearsal.locationRequired'), icon: 'none' })
      return
    }
    if (pieces.length === 0) {
      void Taro.showToast({ title: t('president.rehearsal.atLeastOne'), icon: 'none' })
      return
    }
    const start = `${startDate}T${startTime}:00`
    const end = `${endDate}T${endTime}:00`
    if (startDate !== endDate) {
      void Taro.showToast({ title: t('president.rehearsal.crossDay'), icon: 'none' })
      return
    }
    if (end <= start) {
      void Taro.showToast({ title: t('president.rehearsal.timeInvalid'), icon: 'none' })
      return
    }

    savingRef.current = true
    setSaving(true)
    try {
      const conflict = await checkConflict(
        startDate,
        startTime,
        endDate,
        endTime,
        isEdit ? id : undefined
      )
      if (conflict) {
        setConflictOpen(true)
        return
      }

      const summary = formatRepertoireSummary(pieces)
      const payload = {
        type,
        target_section: type === 'section' ? targetSections : [],
        location_id: locationId,
        start_time: start,
        end_time: end,
        repertoire: summary,
      }
      const piecesJson = pieces.map((piece, index) => ({
        sheet_music_id: piece.sheetMusicId,
        title: piece.title.trim(),
        content: piece.content.trim() || null,
        sort_order: index,
      }))

      if (isEdit) {
        const { data, error } = await supabase.rpc('president_update_rehearsal', {
          p_rehearsal_id: id,
          p_rehearsal: payload,
          p_pieces: piecesJson,
        })
        if (error || !(data as { ok?: boolean } | null)?.ok) {
          void Taro.showToast({ title: t('president.rehearsal.saveFailed'), icon: 'none' })
          return
        }
      } else {
        const { error } = await supabase.rpc('create_rehearsal_with_repertoire', {
          p_rehearsal: payload,
          p_pieces: piecesJson,
        })
        if (error) {
          void Taro.showToast({ title: t('president.rehearsal.createFailed'), icon: 'none' })
          return
        }
      }

      if (notify) {
        const mail = await invokeFunction(supabase, 'notify-rehearsal', {
          body: {
            title: summary,
            dateStr: `${startDate} ${startTime} - ${endTime}`,
            location: selectedLocation.name,
            type,
            targetSections: type === 'section' ? targetSections : undefined,
            targetSection: type === 'section' ? getSectionGroupLabel(targetSections) : undefined,
          },
        })
        if (mail.error) {
          void Taro.showToast({ title: t('president.rehearsal.savedEmailFailed'), icon: 'none' })
        } else {
          void Taro.showToast({ title: t('president.rehearsal.savedEmail'), icon: 'success' })
        }
      } else {
        void Taro.showToast({ title: t('president.rehearsal.saved'), icon: 'success' })
      }
      setTimeout(() => void Taro.navigateBack(), 400)
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <View className={`${darkClass} flex h-full items-center justify-center bg-page-bg`}>
        <Text className='text-xs text-text-muted'>{t('common.actions.loading')}</Text>
      </View>
    )
  }

  return (
    <View className={`${darkClass} flex h-full flex-col bg-page-bg`}>
      <ScrollView scrollY className='flex-1 min-h-0'>
        <View className='px-4 pb-6 pt-3'>
          <Text className='mb-1 block text-xs font-medium text-text-muted'>
            {t('president.rehearsal.type')}
          </Text>
          <Toggle
            options={['full', 'section'] as const}
            value={type}
            onChange={(value) => setType(value)}
            getLabel={(value) =>
              value === 'full' ? t('president.rehearsal.full') : t('president.rehearsal.section')
            }
          />

          <View className='mt-3'>
            <DateTimePicker
              label={t('president.rehearsal.start')}
              date={startDate}
              time={startTime}
              onDateChange={handleStartDate}
              onTimeChange={setStartTime}
            />
          </View>
          <View className='mt-3'>
            <DateTimePicker
              label={t('president.rehearsal.end')}
              date={endDate}
              time={endTime}
              onDateChange={setEndDate}
              onTimeChange={setEndTime}
            />
          </View>

          {type === 'section' && (
            <View className='mt-3'>
              <Text className='mb-1 block text-xs font-medium text-text-muted'>
                {t('president.rehearsal.targetSections')}
              </Text>
              <SectionMultiPicker
                value={targetSections}
                disabled={saving}
                onChange={setTargetSections}
              />
            </View>
          )}

          <View className='mt-3'>
            <Text className='mb-1 block text-xs font-medium text-text-muted'>
              {t('president.rehearsal.location')}
            </Text>
            <Picker
              mode='selector'
              range={locations.map((item) => item.name)}
              value={Math.max(
                0,
                locations.findIndex((item) => item.id === locationId)
              )}
              disabled={saving || locations.length === 0}
              onChange={(event) => {
                const item = locations[Number(event.detail.value)]
                if (item) setLocationId(item.id)
              }}
            >
              <View className='rounded-xl border border-border bg-muted px-3 py-2'>
                <Text className='text-sm text-text'>
                  {selectedLocation?.name ?? t('president.rehearsal.chooseLocation')}
                </Text>
                {selectedLocation && (
                  <Text className='mt-0.5 block text-[10px] text-text-muted'>
                    {t('president.rehearsal.radius')} {selectedLocation.radius_m}m
                  </Text>
                )}
              </View>
            </Picker>
          </View>

          <View className='mt-3'>
            <Text className='mb-1 block text-xs font-medium text-text-muted'>
              {t('president.rehearsal.pieces')}
            </Text>
            <RepertoireEditor
              pieces={pieces}
              options={sheetOptions}
              disabled={saving}
              onChange={setPieces}
            />
          </View>

          <View className='mt-4 flex items-center justify-between rounded-xl border border-border bg-card px-3 py-2'>
            <Text className='text-sm text-text'>{t('president.rehearsal.notify')}</Text>
            <YesNoSwitch value={notify} disabled={saving} onChange={setNotify} />
          </View>
        </View>
      </ScrollView>

      <View className='border-t border-border bg-surface px-4 pb-safe pt-3'>
        <Button
          hoverClass='none'
          disabled={saving}
          className='m-0 w-full rounded-xl bg-primary py-2.5 text-sm leading-normal text-primary-foreground disabled:opacity-60'
          onClick={() => void submit()}
        >
          {saving
            ? t('president.rehearsal.saving')
            : isEdit
              ? t('common.actions.save')
              : t('president.rehearsal.publish')}
        </Button>
      </View>

      <Modal
        open={conflictOpen}
        onClose={() => setConflictOpen(false)}
        title={t('president.rehearsal.conflictTitle')}
        position='center'
      >
        <Text className='block text-sm leading-relaxed text-text-muted'>
          {t('president.rehearsal.conflictMessage')}
        </Text>
        <View className='mt-4 flex gap-2'>
          <Button
            hoverClass='none'
            className='m-0 flex-1 rounded-xl border border-border bg-surface py-2 text-sm leading-normal text-text'
            onClick={() => setConflictOpen(false)}
          >
            {t('common.actions.cancel')}
          </Button>
          <Button
            hoverClass='none'
            className='m-0 flex-1 rounded-xl bg-primary py-2 text-sm leading-normal text-primary-foreground'
            onClick={() => {
              setConflictOpen(false)
              void Taro.switchTab({ url: '/pages/schedule/index' })
            }}
          >
            {t('president.rehearsal.goSchedule')}
          </Button>
        </View>
      </Modal>
    </View>
  )
}
