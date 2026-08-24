import { useRef, useState } from 'react'
import { View, Text, Textarea } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { supabase } from '@/lib/supabase'
import { getAppVersionLabel } from '@/lib/version'
import { Modal } from '@/components/ui/Modal'

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
  const [content, setContent] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const submittingRef = useRef(false) // 同步 guard，阻断竞态窗口

  const handleSubmit = async () => {
    const trimmed = content.trim()
    if (!trimmed) {
      void Taro.showToast({ title: '请填写反馈内容', icon: 'none' })
      return
    }
    if (submittingRef.current || submitting) return
    submittingRef.current = true
    setSubmitting(true)
    try {
      const { error } = await supabase.from('feedback').insert({ content: trimmed })
      if (error) {
        void Taro.showToast({ title: error.message || '反馈提交失败，请重试', icon: 'none' })
        return
      }
      void Taro.showToast({ title: '反馈已提交，感谢你的反馈', icon: 'success' })
      setContent('')
      onClose()
    } catch {
      // 网络异常兜底：非 PostgrestError 无 message 字段，统一中文文案
      void Taro.showToast({ title: '反馈提交失败，请重试', icon: 'none' })
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
      title='问题与反馈'
      position='bottom'
      closeOnOverlay={!submitting}
    >
      <View className='mt-4 space-y-3'>
        <Text className='block text-xs text-text-muted'>匿名提交，管理员可在后台查看</Text>
        <Text className='mt-1 block text-xs text-text-subtle'>当前版本：{getAppVersionLabel()}</Text>
        <View className='mt-1 w-full overflow-hidden rounded-xl border border-border bg-muted'>
          <Textarea
            value={content}
            onInput={(e) => setContent(e.detail.value)}
            maxlength={2000}
            disabled={submitting}
            className='h-32 bg-transparent px-3 py-3 text-xs leading-relaxed text-text'
            placeholder='写下你的问题或建议'
          />
        </View>
        {/* 单主操作按钮右对齐（双按钮行规范的唯一按钮豁免） */}
        <View className='flex justify-end gap-2'>
          <View
            className={`rounded-full bg-primary px-4 py-2 text-xs font-medium text-primary-foreground ${
              submitting ? 'opacity-60' : ''
            }`}
            onClick={submitting ? undefined : () => void handleSubmit()}
          >
            {submitting ? '提交中…' : '提交'}
          </View>
        </View>
      </View>
    </Modal>
  )
}
