import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase as defaultClient } from '@/lib/supabase'
import { emitSync, subscribeSync } from '@/lib/dataSync'
import type { PostRow, PostRowWithAuthor, PostType } from '@/types/database'
import type { UploadFileLike } from '@/hooks/useLeaveRequests'

/** 发布帖子载荷（图片为小程序本地文件，由 hook 内上传后转公网 URL）。 */
export type CreatePostInput = {
  type: PostType
  title: string
  content: string
  current_sections?: string
  missing_sections?: string
  contact_info?: string
  imageFile?: UploadFileLike | null
}

export type CreatePostResult = { ok: true } | { ok: false; error: string }

/** 编辑帖子载荷；imageFile: undefined=保留原图 | null=删除原图 | UploadFileLike=新图替换。 */
export type EditPostInput = {
  type: PostType
  title: string
  content: string
  current_sections?: string
  missing_sections?: string
  contact_info?: string
  imageFile?: UploadFileLike | null
}

/**
 * 公告 hook（读 + 发布）。
 * 与 Web 版差异：无 realtime（挂载查询 + 手动重取 + 心跳 'post' 事件）；
 * 加载失败错误归一化为中文文案；卸载后不再 setState（mountedRef 标志位）。
 * 写操作：create 先经微信内容安全（文本 + 图片）拦截违规，再写库。
 *
 * 成员端默认过滤已锁定帖子（is_locked = false）；author join 可能为对象或数组，
 * 这里统一归一化为 { full_name, instrument } | null，下游渲染无需关心形态。
 */
export function usePosts(client: typeof defaultClient = defaultClient) {
  const [data, setData] = useState<PostRowWithAuthor[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [mine, setMine] = useState<PostRowWithAuthor[]>([])
  const [mineLoading, setMineLoading] = useState(false)
  const [mineError, setMineError] = useState<string | null>(null)
  const savingRef = useRef(false)
  const [saving, setSaving] = useState(false)
  const mountedRef = useRef(true)
  const fetchSeqRef = useRef(0)

  const fetch = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!mountedRef.current) return null
      const seq = ++fetchSeqRef.current
      if (!opts?.silent) setLoading(true)
      setError(null)
      const { data: rows, error: dbError } = await client
        .from('posts')
        .select(
          'id, title, type, content, image_url, author_id, created_at, contact_info, current_sections, missing_sections, is_locked, locked_by, profiles(full_name, instrument)'
        )
        .eq('is_locked', false)
        .order('created_at', { ascending: false })
      if (!mountedRef.current || seq !== fetchSeqRef.current) return null
      if (!opts?.silent) setLoading(false)
      if (dbError) {
        setError('公告加载失败，请重试')
        setData([])
        return null
      }
      const list = (rows as unknown[])?.map((row) => {
        const r = row as PostRow & { profiles?: unknown }
        const p = r.profiles as Record<string, unknown> | undefined
        const profiles =
          Array.isArray(p) && p.length > 0
            ? {
                full_name: (p[0] as Record<string, string | null>).full_name,
                instrument: (p[0] as Record<string, string | null>).instrument,
              }
            : p && typeof p === 'object' && !Array.isArray(p)
              ? (p as { full_name: string | null; instrument: string | null })
              : null
        return { ...r, profiles }
      }) as PostRowWithAuthor[]
      setData(list)
      return list
    },
    [client]
  )

  /** 按 id 取单条公告（详情页用），归一化 author join 形态。 */
  const fetchOne = useCallback(
    async (id: string): Promise<PostRowWithAuthor | null> => {
      const { data: row, error: dbError } = await client
        .from('posts')
        .select(
          'id, title, type, content, image_url, author_id, created_at, contact_info, current_sections, missing_sections, is_locked, locked_by, profiles(full_name, instrument)'
        )
        .eq('id', id)
        .maybeSingle()
      if (dbError) {
        console.error('[usePosts] 单条公告加载失败：', dbError)
        return null
      }
      const r = row as (PostRow & { profiles?: unknown }) | null
      if (!r) return null
      const p = r.profiles as Record<string, unknown> | undefined
      const profiles =
        Array.isArray(p) && p.length > 0
          ? {
              full_name: (p[0] as Record<string, string | null>).full_name,
              instrument: (p[0] as Record<string, string | null>).instrument,
            }
          : p && typeof p === 'object' && !Array.isArray(p)
            ? (p as { full_name: string | null; instrument: string | null })
            : null
      return { ...r, profiles } as PostRowWithAuthor
    },
    [client]
  )

  /** 发布帖子：内容安全（文本+图片）→ 图片上传 → 写库 → 刷新。 */
  const create = useCallback(
    async (input: CreatePostInput): Promise<CreatePostResult> => {
      if (savingRef.current) return { ok: false, error: '请勿重复提交' }
      savingRef.current = true
      setSaving(true)
      setError(null)
      try {
        const uid = (await client.auth.getUser()).data.user?.id
        if (!uid) return { ok: false, error: '登录状态失效，请重新登录' }

        const title = input.title.trim()
        const content = input.content.trim()
        if (!title || !content) return { ok: false, error: '请填写标题与内容' }

        // 1) 文本审核（标题 + 内容）
        const textRes = await client.functions.invoke('wechat-content-check', {
          body: { kind: 'text', content: `${title}\n${content}` },
        })
        if (textRes.error) {
          // 审核基础设施故障：放行发布，仅记录（避免误伤正常发帖）
          console.warn('[usePosts] 文本审核调用失败，放行：', textRes.error)
        } else if ((textRes.data as { result?: string })?.result === 'block') {
          return { ok: false, error: '内容包含违规信息，发布失败' }
        }

        // 2) 图片上传（公开桶）+ 图片审核
        let imageUrl: string | null = null
        if (input.imageFile) {
          // 动态导入：避免模块加载即拉入 Taro（@tarojs/taro 在纯逻辑单测 jsdom 环境下缺少运行时全局）
          const { uploadLocalFile, guessContentType } = await import('@/lib/uploadLocalFile')
          const rawName =
            input.imageFile.name || input.imageFile.tempFilePath.split('/').pop() || 'image'
          const safeName = rawName.replace(/[^A-Za-z0-9._-]/g, '-') || 'image'
          const path = `${uid}/${Date.now()}-${safeName}`
          const up = await uploadLocalFile(
            client,
            'community-images',
            path,
            input.imageFile.tempFilePath,
            guessContentType(safeName)
          )
          if (up.error) return { ok: false, error: `图片上传失败：${up.error.message}` }
          imageUrl = client.storage.from('community-images').getPublicUrl(path).data.publicUrl

          const imgRes = await client.functions.invoke('wechat-content-check', {
            body: { kind: 'image', imageUrl },
          })
          const imgData = imgRes.data as { result?: string; ok?: boolean; error?: string } | null
          if (imgRes.error) {
            console.warn('[usePosts] 图片审核调用失败，放行：', imgRes.error)
          } else if (imgData?.result === 'block') {
            return { ok: false, error: '图片包含违规内容，发布失败' }
          } else if (imgData?.ok === false) {
            // 微信拒收或函数侧主动拦截（如图片过大）：不放行
            return { ok: false, error: imgData.error || '图片审核未通过' }
          }
        }

        // 3) 写库
        const { error: dbError } = await client.from('posts').insert({
          author_id: uid,
          type: input.type,
          title,
          content,
          current_sections:
            input.type === 'ensemble' ? input.current_sections?.trim() || null : null,
          missing_sections:
            input.type === 'ensemble' ? input.missing_sections?.trim() || null : null,
          contact_info: input.contact_info?.trim() || null,
          image_url: imageUrl,
          is_locked: false,
        } as never)
        if (dbError) return { ok: false, error: dbError.message }

        await fetch({ silent: true })
        emitSync('post')
        return { ok: true }
      } finally {
        savingRef.current = false
        if (mountedRef.current) setSaving(false)
      }
    },
    [client, fetch]
  )

  /** 拉取「我发布的活动」（作者=当前用户，含已锁定，便于解锁），归一化 author join。 */
  const fetchMine = useCallback(
    async (opts?: { silent?: boolean }): Promise<PostRowWithAuthor[]> => {
      const uid = (await client.auth.getUser()).data.user?.id
      if (!uid) {
        if (!opts?.silent) setMineLoading(false)
        setMineError('未登录')
        setMine([])
        return []
      }
      if (!opts?.silent) setMineLoading(true)
      setMineError(null)
      const { data: rows, error: dbError } = await client
        .from('posts')
        .select(
          'id, title, type, content, image_url, author_id, created_at, contact_info, current_sections, missing_sections, is_locked, locked_by, profiles(full_name, instrument)'
        )
        .eq('author_id', uid)
        .order('created_at', { ascending: false })
      if (!opts?.silent) setMineLoading(false)
      if (dbError) {
        setMineError('加载失败，请重试')
        setMine([])
        return []
      }
      const list = (rows as unknown[] ?? []).map((row) => {
        const r = row as PostRow & { profiles?: unknown }
        const p = r.profiles as Record<string, unknown> | undefined
        const profiles =
          Array.isArray(p) && p.length > 0
            ? {
                full_name: (p[0] as Record<string, string | null>).full_name,
                instrument: (p[0] as Record<string, string | null>).instrument,
              }
            : p && typeof p === 'object' && !Array.isArray(p)
              ? (p as { full_name: string | null; instrument: string | null })
              : null
        return { ...r, profiles }
      }) as PostRowWithAuthor[]
      setMine(list)
      return list
    },
    [client]
  )

  /** 锁定/解锁自己的帖子（与社区过滤 is_locked 联动）。 */
  const setLocked = useCallback(
    async (id: string, value: boolean): Promise<{ ok: true } | { ok: false; error: string }> => {
      const { error: dbError } = await client.from('posts').update({ is_locked: value }).eq('id', id)
      if (dbError) return { ok: false, error: dbError.message }
      setMine((prev) => prev.map((p) => (p.id === id ? { ...p, is_locked: value } : p)))
      emitSync('post')
      return { ok: true }
    },
    [client]
  )

  /** 删除自己发布的帖子。 */
  const deletePost = useCallback(
    async (id: string): Promise<{ ok: true } | { ok: false; error: string }> => {
      const { error: dbError } = await client.from('posts').delete().eq('id', id)
      if (dbError) return { ok: false, error: dbError.message }
      setMine((prev) => prev.filter((p) => p.id !== id))
      emitSync('post')
      return { ok: true }
    },
    [client]
  )

  /** 编辑帖子：内容安全（文本+可选新图）→ 写库（imageFile: undefined 保留 / null 删除 / file 替换）。 */
  const updatePost = useCallback(
    async (id: string, input: EditPostInput): Promise<CreatePostResult> => {
      if (savingRef.current) return { ok: false, error: '请勿重复提交' }
      savingRef.current = true
      setSaving(true)
      setError(null)
      try {
        const title = input.title.trim()
        const content = input.content.trim()
        if (!title || !content) return { ok: false, error: '请填写标题与内容' }

        // 1) 文本审核（标题 + 内容）
        const textRes = await client.functions.invoke('wechat-content-check', {
          body: { kind: 'text', content: `${title}\n${content}` },
        })
        if (textRes.error) {
          console.warn('[usePosts] 文本审核调用失败，放行：', textRes.error)
        } else if ((textRes.data as { result?: string })?.result === 'block') {
          return { ok: false, error: '内容包含违规信息，发布失败' }
        }

        // 2) 图片：undefined=保留原图；null=删除；file=上传替换
        let imageUrl: string | null | undefined
        if (input.imageFile === null) {
          imageUrl = null
        } else if (input.imageFile) {
          const uid = (await client.auth.getUser()).data.user?.id
          if (!uid) return { ok: false, error: '登录状态失效，请重新登录' }
          const { uploadLocalFile, guessContentType } = await import('@/lib/uploadLocalFile')
          const f = input.imageFile
          const rawName = f.name || f.tempFilePath.split('/').pop() || 'image'
          const safeName = rawName.replace(/[^A-Za-z0-9._-]/g, '-') || 'image'
          const path = `${uid}/${Date.now()}-${safeName}`
          const up = await uploadLocalFile(
            client,
            'community-images',
            path,
            f.tempFilePath,
            guessContentType(safeName)
          )
          if (up.error) return { ok: false, error: `图片上传失败：${up.error.message}` }
          imageUrl = client.storage.from('community-images').getPublicUrl(path).data.publicUrl

          const imgRes = await client.functions.invoke('wechat-content-check', {
            body: { kind: 'image', imageUrl },
          })
          const imgData = imgRes.data as { result?: string; ok?: boolean; error?: string } | null
          if (imgRes.error) {
            console.warn('[usePosts] 图片审核调用失败，放行：', imgRes.error)
          } else if (imgData?.result === 'block') {
            return { ok: false, error: '图片包含违规内容，发布失败' }
          } else if (imgData?.ok === false) {
            return { ok: false, error: imgData.error || '图片审核未通过' }
          }
        }

        // 3) 写库
        const patch: Record<string, unknown> = {
          title,
          content,
          contact_info: input.contact_info?.trim() || null,
        }
        if (input.type === 'ensemble') {
          patch.current_sections = input.current_sections?.trim() || null
          patch.missing_sections = input.missing_sections?.trim() || null
        } else {
          patch.current_sections = null
          patch.missing_sections = null
        }
        if (imageUrl !== undefined) patch.image_url = imageUrl

        const { error: dbError } = await client.from('posts').update(patch as never).eq('id', id)
        if (dbError) return { ok: false, error: dbError.message }

        await fetchMine({ silent: true })
        emitSync('post')
        return { ok: true }
      } finally {
        savingRef.current = false
        if (mountedRef.current) setSaving(false)
      }
    },
    [client, fetchMine]
  )

  useEffect(() => {
    mountedRef.current = true
    void fetch()
    const unsub = subscribeSync('post', () => {
      void fetch({ silent: true })
    })
    return () => {
      mountedRef.current = false
      unsub()
    }
  }, [fetch])

  return {
    data,
    loading,
    error,
    saving,
    fetch,
    fetchOne,
    create,
    mine,
    mineLoading,
    mineError,
    fetchMine,
    updatePost,
    setLocked,
    deletePost,
  }
}
