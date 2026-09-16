import { useRef } from 'react'
import { useDidShow } from '@tarojs/taro'

/**
 * 编辑态草稿缓存 Hook
 *
 * 问题背景：
 * 微信小程序调用 chooseAvatar / chooseMedia 等 API 时会销毁页面，
 * 重建后所有 useState 重置，导致编辑中的表单数据丢失。
 *
 * 解决方案：
 * 用 useRef 持久化编辑态数据，useDidShow 检测恢复。
 *
 * 使用示例：
 * ```tsx
 * const editDraft = useEditDraft({
 *   instrument: '',
 *   phone: '',
 *   college: '',
 *   joinYear: '',
 *   joinSeason: '秋',
 * })
 *
 * // 开始编辑时：将真实数据写入 useRef，然后设置 isEditing
 * const startEdit = () => {
 *   editDraft.save({
 *     instrument: myProfile.instrument,
 *     phone: myProfile.phone_number ?? '',
 *     ...
 *   })
 *   setIsEditing(true)
 * }
 *
 * // 编辑过程中：onInput 时同步到 useRef（确保 chooseAvatar 销毁前数据已保存）
 * const handleInput = (field: string, value: string) => {
 *   editDraft.update({ [field]: value })
 *   setFormData(prev => ({ ...prev, [field]: value }))  // 同时更新 useState 用于渲染
 * }
 *
 * // 页面恢复时：从 useRef 恢复数据
 * useDidShow(() => {
 *   if (editDraft.hasDraft()) {
 *     const draft = editDraft.get()
 *     setFormData(draft)
 *     setIsEditing(true)
 *     editDraft.clear()  // 恢复后清除
 *   }
 * })
 * ```
 */
export function useEditDraft<T extends Record<string, unknown>>(defaultData: T) {
  const draftRef = useRef<T | null>(null)

  // 页面从后台回前台时，useRef 状态天然保留
  useDidShow(() => {
    // useRef 状态在页面重建后仍有效
    // 调用方在 useDidShow 中检查 hasDraft() 并恢复数据
  })

  return {
    /** 保存草稿数据（开始编辑或每次 onChange 时调用） */
    save: (data: T) => {
      draftRef.current = { ...data }
    },
    /** 局部更新草稿（合并到现有数据） */
    update: (patch: Partial<T>) => {
      if (draftRef.current) {
        draftRef.current = { ...draftRef.current, ...patch }
      } else {
        draftRef.current = { ...defaultData, ...patch }
      }
    },
    /** 获取草稿数据（页面恢复时调用） */
    get: (): T => {
      return draftRef.current ? { ...draftRef.current } : { ...defaultData }
    },
    /** 检查是否有待恢复的草稿 */
    hasDraft: (): boolean => {
      return draftRef.current !== null
    },
    /** 清除草稿（恢复成功后调用） */
    clear: () => {
      draftRef.current = null
    },
  }
}
