import { useRef, useState } from 'react'
import { View, Text, Textarea } from '@tarojs/components'
import { FormField } from '@/components/ui/FormFields'
import Taro from '@tarojs/taro'
import { supabase } from '@/lib/supabase'
import { getAppVersionLabel } from '@/lib/version'
import { useT } from '@/i18n'
import { Modal } from '@/components/ui/Modal'
import { ActionBar } from '@/components/ui/ActionBar'

type Props = {
  open: boolean
  onClose: () => void
}

/**
 * 问题与反馈弹窗：多行输入匿名提交（反馈表无作者列，管理员无法追溯提交人）。
 * 双重 guard 防重复提交（ref 同步 + state 异步）；
 * INSERT 不链 .select()——INSERT RETURNING 输出行受 SELECT 策略约束会 403，
 * 默认 insert 返回 { data, error }（反馈表 RLS 放行 authenticated 插入）。
 * maxLength 与 DB CHECK（feedback_content_length_check）一致。
 */
export function FeedbackModal({ open, onClose }: Props) {
  const { t } = useT()
  const [content, setContent] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const submittingRef = useRef(false) // 同步 guard，阻断竞态窗口

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
      const { error } = await supabase.from('feedback').insert({ content: trimmed })
      if (error) {
        void Taro.showToast({
          title: error.message || t('profile.feedback.submitFailed'),
          icon: 'none',
        })
        return
      }
      void Taro.showToast({ title: t('profile.feedback.submitted'), icon: 'success' })
      setContent('')
      onClose()
    } catch {
      // 网络异常兜底：非 PostgrestError 无 message 字段，统一走 i18n 文案
      void Taro.showToast({ title: t('profile.feedback.submitFailed'), icon: 'none' })
    } finally {
      // 无论成败都复位：避免抛异常时 submitting 卡 true，按钮被永久禁用
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  const handleClose = () => {
    if (!submitting) onClose()
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={t('profile.settings.feedback')}
      position='bottom'
      closeOnOverlay={!submitting}
    >
      <View className='mt-4'>
        <Text className='mt-3 block text-xs text-text-muted'>
          {t('profile.feedback.anonymousHint')}
        </Text>
        <Text className='mt-1 block text-xs text-text-subtle'>
          {t('profile.feedback.version', { version: getAppVersionLabel(t) })}
        </Text>
        <FormField boxClass='mt-1 w-full overflow-hidden rounded-xl border border-border bg-muted'>
          <Textarea
            value={content}
            onInput={(e) => setContent(e.detail.value)}
            maxlength={2000}
            disabled={submitting}
            className='h-32 bg-transparent px-3 py-3 text-xs leading-relaxed text-text'
            placeholder={t('profile.feedback.placeholder')}
          />
        </FormField>
        {/* 单主操作按钮右对齐（双按钮行规范的唯一按钮豁免） */}
        <ActionBar className='mt-3'>
          <View
            className={`rounded-full bg-primary px-4 py-2 text-xs font-medium text-primary-foreground ${
              submitting ? 'opacity-60' : ''
            }`}
            onClick={submitting ? undefined : () => void handleSubmit()}
          >
            {submitting ? t('profile.account.submitting') : t('common.actions.submit')}
          </View>
        </ActionBar>
      </View>
    </Modal>
  )
}
