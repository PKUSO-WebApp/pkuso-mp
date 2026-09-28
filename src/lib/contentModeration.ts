import type { supabase as defaultClient } from '@/lib/supabase'
import { invokeFunction } from '@/lib/functions'
import type { UploadFileLike } from '@/hooks/useLeaveRequests'
import type { TFn } from '@/i18n'

export type ModerationResult = { ok: true; imageUrl: string | null } | { ok: false; error: string }

/**
 * 公告发布/编辑共用的内容安全流程（P2-9 提取，原 usePosts create/updatePost 两份复制）：
 * 1) 文本审核（标题+内容+声部+联系方式）——审核基础设施故障放行，仅 console.warn（避免误伤正常发帖）；
 * 2) 有图则上传公开桶 + 图片审核——block / ok:false 拦截（微信拒收或函数侧主动拦截）。
 * 失败时 error 即页面可展示文案；成功时携带最终 imageUrl（无图为 null）。
 */
export async function moderateAndUploadPostImage(
  client: typeof defaultClient,
  input: {
    uid: string
    title: string
    content: string
    imageFile?: UploadFileLike | null
    currentSections?: string | null
    missingSections?: string | null
    contactInfo?: string | null
  },
  t: TFn
): Promise<ModerationResult> {
  // 1) 文本审核（标题 + 内容 + 声部 + 联系方式）
  const textParts = [
    input.title,
    input.content,
    input.currentSections,
    input.missingSections,
    input.contactInfo,
  ]
    .filter(Boolean)
    .join('\n')
  const textRes = await invokeFunction(client, 'wechat-content-check', {
    body: { kind: 'text', content: textParts },
  })
  if (textRes.error) {
    // 审核基础设施故障：放行发布，仅记录
    console.warn('[contentModeration] 文本审核调用失败，放行：', textRes.error)
  } else if ((textRes.data as { result?: string })?.result === 'block') {
    return { ok: false, error: t('community.postErrors.contentBlocked') }
  }

  // 2) 图片上传（公开桶）+ 图片审核
  if (!input.imageFile) return { ok: true, imageUrl: null }

  // 动态导入：避免模块加载即拉入 Taro（@tarojs/taro 在纯逻辑单测 jsdom 环境下缺少运行时全局）
  const { uploadLocalFile, guessContentType } = await import('@/lib/uploadLocalFile')
  const rawName = input.imageFile.name || input.imageFile.tempFilePath.split('/').pop() || 'image'
  const safeName = rawName.replace(/[^A-Za-z0-9._-]/g, '-') || 'image'
  const path = `${input.uid}/${Date.now()}-${safeName}`
  const up = await uploadLocalFile(
    client,
    'community-images',
    path,
    input.imageFile.tempFilePath,
    guessContentType(safeName),
    false,
    t
  )
  if (up.error)
    return {
      ok: false,
      error: t('community.postErrors.imageUploadFailed', { error: up.error.message }),
    }
  const imageUrl = client.storage.from('community-images').getPublicUrl(path).data.publicUrl

  const imgRes = await invokeFunction(client, 'wechat-content-check', {
    body: { kind: 'image', imageUrl },
  })
  const imgData = imgRes.data as { result?: string; ok?: boolean; error?: string } | null
  if (imgRes.error) {
    console.warn('[contentModeration] 图片审核调用失败，放行：', imgRes.error)
  } else if (imgData?.result === 'block') {
    return { ok: false, error: t('community.postErrors.imageBlocked') }
  } else if (imgData?.ok === false) {
    // 微信拒收或函数侧主动拦截（如图片过大）：不放行
    return { ok: false, error: imgData.error || t('community.postErrors.imageRejected') }
  }
  return { ok: true, imageUrl }
}
