import { useEffect, useRef, useState } from 'react'
import { Button, Input, ScrollView, Text, Textarea, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { supabase } from '@/lib/supabase'
import { usePageRestore } from '@/hooks/usePageRestore'
import { useThemeClass } from '@/context/theme-context'
import { useNavTitle, useT } from '@/i18n'
import { getLocalDateString } from '@/lib/date-utils'
import { DateTimePicker } from '@/components/ui/DateTimePicker'
import { Modal } from '@/components/ui/Modal'
import type { AnnouncementRow } from '@/types/database'
import './index.scss'

function localDateParts(value: string | null): { date: string; time: string } {
  if (!value) return { date: getLocalDateString(), time: '23:59' }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return { date: getLocalDateString(), time: '23:59' }
  return {
    date: getLocalDateString(date),
    time: `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`,
  }
}

export default function PresidentAnnouncementEditPage() {
  const { t } = useT()
  const cachedId = usePageRestore<string>('id')
  const id = cachedId ?? ''
  const isEdit = id.length > 0
  useNavTitle(isEdit ? 'president.announcement.editTitle' : 'president.announcement.createTitle')
  const darkClass = useThemeClass()

  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [endDate, setEndDate] = useState(getLocalDateString())
  const [endTime, setEndTime] = useState('23:59')
  const [loading, setLoading] = useState(isEdit)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [activeTitle, setActiveTitle] = useState('')
  const [replaceOpen, setReplaceOpen] = useState(false)
  const savingRef = useRef(false)

  useEffect(() => {
    if (!isEdit) return
    let cancelled = false
    void supabase
      .from('announcements')
      .select('*')
      .eq('id', id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return
        setLoading(false)
        if (error || !data) {
          void Taro.showToast({ title: t('president.announcement.notFound'), icon: 'none' })
          return
        }
        const row = data as AnnouncementRow
        setTitle(row.title)
        setContent(row.content ?? '')
        const end = localDateParts(row.end_time)
        setEndDate(end.date)
        setEndTime(end.time)
      })
    return () => {
      cancelled = true
    }
  }, [id, isEdit, t])

  const submit = async (replaceActive = false) => {
    if (savingRef.current || saving) return
    if (!title.trim()) {
      void Taro.showToast({ title: t('president.announcement.titleRequired'), icon: 'none' })
      return
    }
    if (!content.trim()) {
      void Taro.showToast({ title: t('president.announcement.contentRequired'), icon: 'none' })
      return
    }
    const endDateObj = new Date(`${endDate}T${endTime}:00`)
    if (Number.isNaN(endDateObj.getTime()) || (!isEdit && endDateObj.getTime() <= Date.now())) {
      void Taro.showToast({ title: t('president.announcement.invalidEndTime'), icon: 'none' })
      return
    }
    const end = endDateObj.toISOString()
    savingRef.current = true
    setSaving(true)
    try {
      if (isEdit) {
        const { data, error } = await supabase.rpc('president_update_announcement', {
          p_id: id,
          p_title: title.trim(),
          p_content: content.trim(),
          p_end_time: end,
        })
        const result = data as { ok?: boolean; code?: string } | null
        if (error || !result?.ok) {
          if (result?.code === 'active_exists') {
            void Taro.showToast({
              title: t('president.announcement.activeExistsShort'),
              icon: 'none',
            })
          } else {
            void Taro.showToast({ title: t('president.announcement.saveFailed'), icon: 'none' })
          }
          return
        }
      } else {
        const { data, error } = await supabase.rpc('president_publish_announcement', {
          p_title: title.trim(),
          p_content: content.trim(),
          p_end_time: end,
          p_replace_active: replaceActive,
        })
        const result = data as {
          ok?: boolean
          code?: string
          active_title?: string
        } | null
        if (error) {
          void Taro.showToast({ title: t('president.announcement.publishFailed'), icon: 'none' })
          return
        }
        if (result?.code === 'active_exists') {
          setActiveTitle(result.active_title ?? '')
          setReplaceOpen(true)
          return
        }
        if (!result?.ok) {
          void Taro.showToast({ title: t('president.announcement.publishFailed'), icon: 'none' })
          return
        }
      }
      void Taro.showToast({ title: t('president.announcement.saved'), icon: 'success' })
      setTimeout(() => void Taro.navigateBack(), 300)
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  const handleDelete = () => {
    if (!isEdit || deleting) return
    void Taro.showModal({
      title: t('president.announcement.delete'),
      content: t('president.announcement.deleteConfirm'),
      success: async (res) => {
        if (!res.confirm) return
        setDeleting(true)
        const { data, error } = await supabase.rpc('president_delete_announcement', { p_id: id })
        setDeleting(false)
        if (error || !(data as { ok?: boolean } | null)?.ok) {
          void Taro.showToast({ title: t('president.announcement.deleteFailed'), icon: 'none' })
          return
        }
        void Taro.showToast({ title: t('president.announcement.saved'), icon: 'success' })
        setTimeout(() => void Taro.navigateBack(), 300)
      },
    })
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
            {t('president.announcement.title')}
          </Text>
          <View className='w-full overflow-hidden rounded-xl border border-border bg-muted px-3'>
            <Input
              value={title}
              maxlength={200}
              className='h-[var(--size-control-h)] w-full bg-transparent text-sm text-text'
              placeholder={t('president.announcement.title')}
              placeholderStyle='color: var(--color-text-muted)'
              onInput={(event) => setTitle(String(event.detail.value ?? ''))}
            />
          </View>

          <Text className='mb-1 mt-3 block text-xs font-medium text-text-muted'>
            {t('president.announcement.content')}
          </Text>
          <View className='w-full overflow-hidden rounded-xl border border-border bg-muted p-2'>
            <Textarea
              value={content}
              maxlength={5000}
              className='h-40 w-full bg-transparent text-sm text-text'
              placeholder={t('president.announcement.content')}
              placeholderStyle='color: var(--color-text-muted)'
              onInput={(event) => setContent(String(event.detail.value ?? ''))}
            />
          </View>

          <View className='mt-3'>
            <DateTimePicker
              label={t('president.announcement.endTime')}
              date={endDate}
              time={endTime}
              onDateChange={setEndDate}
              onTimeChange={setEndTime}
            />
          </View>
        </View>
      </ScrollView>

      <View
        className='flex gap-2 border-t border-border bg-surface px-4 pt-3'
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 16px)' }}
      >
        {isEdit && (
          <Button
            hoverClass='none'
            disabled={deleting || saving}
            className='m-0 flex-1 rounded-xl border border-danger bg-surface py-2 text-sm leading-normal text-danger disabled:opacity-50'
            onClick={handleDelete}
          >
            {deleting ? t('common.actions.loading') : t('president.announcement.delete')}
          </Button>
        )}
        <Button
          hoverClass='none'
          disabled={saving || deleting}
          className='m-0 flex-1 rounded-xl bg-primary py-2 text-sm leading-normal text-primary-foreground disabled:opacity-60'
          onClick={() => void submit(false)}
        >
          {saving ? t('common.actions.loading') : t('common.actions.save')}
        </Button>
      </View>

      <Modal
        open={replaceOpen}
        onClose={() => setReplaceOpen(false)}
        title={t('president.announcement.createTitle')}
        position='center'
      >
        <Text className='block text-sm leading-relaxed text-text-muted'>
          {t('president.announcement.activeExists', { title: activeTitle })}
        </Text>
        <View className='mt-4 flex gap-2'>
          <Button
            hoverClass='none'
            className='m-0 flex-1 rounded-xl border border-border bg-surface py-2 text-sm leading-normal text-text'
            onClick={() => setReplaceOpen(false)}
          >
            {t('common.actions.cancel')}
          </Button>
          <Button
            hoverClass='none'
            className='m-0 flex-1 rounded-xl bg-primary py-2 text-sm leading-normal text-primary-foreground'
            onClick={() => {
              setReplaceOpen(false)
              void submit(true)
            }}
          >
            {t('president.announcement.endActive')}
          </Button>
        </View>
      </Modal>
    </View>
  )
}
