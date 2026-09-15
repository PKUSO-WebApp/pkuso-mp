import { useRef, useState } from 'react'
import { View, Text, Textarea, ScrollView, Button } from '@tarojs/components'
import { FormField } from '@/components/ui/FormFields'
import Taro from '@tarojs/taro'
import { supabase } from '@/lib/supabase'
import { useT, useNavTitle } from '@/i18n'
import { useThemeClass } from '@/context/theme-context'
import { useUser } from '@/context/user-context'
import './index.scss'

export default function FeedbackPage() {
  const { t } = useT()
  useNavTitle('profile.settings.feedback')
  const darkClass = useThemeClass()
  const { user } = useUser()
  const [content, setContent] = useState('')
  const [isAnonymous, setIsAnonymous] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const submittingRef = useRef(false)

  const handleSubmit = async () => {
    const trimmed = content.trim()
    if (!trimmed) {
      void Taro.showToast({ title: t('profile.feedback.empty'), icon: 'none' })
      return
    }
    if (submittingRef.current || submitting) return
    submittingRef.current = true
    setSubmitting(true)
    try {
      const insertData = isAnonymous
        ? { content: trimmed, is_anonymous: true, created_by: null }
        : { content: trimmed, is_anonymous: false, created_by: user?.id ?? null }
      const { error } = await supabase.from('feedback').insert(insertData)
      if (error) {
        void Taro.showToast({
          title: error.message || t('profile.feedback.submitFailed'),
          icon: 'none',
        })
        return
      }
      void Taro.showToast({ title: t('profile.feedback.submitted'), icon: 'success' })
      setContent('')
      Taro.navigateBack()
    } catch {
      void Taro.showToast({ title: t('profile.feedback.submitFailed'), icon: 'none' })
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  return (
    <View className={`${darkClass} pk-page min-h-screen bg-page-bg`}>
      <ScrollView scrollY className='min-h-0 flex-1'>
        <View className='px-4'>
          <View className='mt-3 flex items-center justify-between'>
            <Text className='text-xs text-text-muted'>
              {t('profile.feedback.anonymousLabel')}
            </Text>
            <Button
              className={`relative h-7 w-12 rounded-full border-0 p-0 ${
                isAnonymous ? 'bg-primary' : 'bg-muted'
              }`}
              onClick={() => setIsAnonymous(!isAnonymous)}
            >
              <View
                className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow-sm transition-all ${
                  isAnonymous ? 'left-[calc(100%-1.75rem)]' : 'left-0.5'
                }`}
              />
            </Button>
          </View>
          <FormField boxClass='mt-3 w-full overflow-hidden rounded-xl border border-border bg-muted'>
            <Textarea
              value={content}
              onInput={(e) => setContent(e.detail.value)}
              maxlength={2000}
              disabled={submitting}
              className='h-32 bg-transparent px-3 py-3 text-xs leading-relaxed text-text'
              placeholder={t('profile.feedback.placeholder')}
            />
          </FormField>
          <View
            className={`mt-4 inline-flex h-11 w-full items-center justify-center rounded-xl bg-primary text-center text-base font-medium text-primary-foreground ${
              submitting ? 'opacity-90' : ''
            }`}
            onClick={submitting ? undefined : () => void handleSubmit()}
          >
            {submitting ? t('profile.account.submitting') : t('common.actions.submit')}
          </View>
        </View>
      </ScrollView>
    </View>
  )
}
