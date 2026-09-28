/**
 * 编辑态草稿缓存 Hook
 *
 * 问题背景：
 * 微信小程序调用 chooseAvatar / chooseMedia 等 API 后，页面可能被销毁重建，
 * 重建后 useState 重置，编辑中的表单数据随之丢失（也可能页面实例存活、只是
 * `router.params` 被重置——两种情形在本 App 里都出现过）。
 *
 * 为什么存到组件实例之外（而不是 useRef）：
 * 草稿要防的是「useState 被重置」，而 useRef 与 useState 同属一个组件实例：
 * 页面真被销毁重建时两者会**一起**重置，存进 ref 的草稿跟着没；反过来，若 ref
 * 能活下来，useState 也能活下来，草稿就是多余的。也就是说「只有 ref 活、state
 * 死」这个假设不存在——基于它写的草稿保护等于白写。所以草稿必须放在组件实例
 * 之外，这里用模块级 Map（同 `src/lib/` 里几个模块级 store 的做法）。
 *
 * 取舍：模块级存储比页面实例活得久，因此「填了一半就退出」的草稿会在下次进入
 * 同一 key 的页面时重新出现。这是有意的——丢用户数据比多出一份草稿更糟。
 * 提交成功后调用方应 clear()。
 *
 * 返回值身份稳定：同一 key 每次渲染返回**同一个**对象（模块级缓存），因此可以
 * 安全地放进 useEffect 的依赖数组而不会导致 effect 轮轮重跑。
 *
 * 用法：
 * ```tsx
 * const editDraft = useEditDraft<DraftData>('profile-info', { phone: '', ... })
 *
 * // 进入编辑态时写**完整**当前值（不是只写改动的那一个字段）
 * const startEdit = () => {
 *   editDraft.save({ phone, college, ... })
 *   setIsEditing(true)
 * }
 *
 * // 每次 onChange 合并改动（确保 chooseMedia 销毁前草稿已是完整最新值）
 * onInput={(e) => { setPhone(v); editDraft.update({ phone: v }) }}
 *
 * // 页面 show（含重建后首次 show）时恢复
 * useDidShow(() => {
 *   if (!editDraft.hasDraft()) return
 *   const draft = editDraft.get()
 *   setPhone(draft.phone)
 *   ...
 * })
 * ```
 *
 * ⚠️ 恢复后**不要** clear：clear 之后到来的第一次 update() 只能从 defaultData
 * 起底，那些本轮没被改动的字段就会在草稿里退化成默认值——下一次恢复会把界面上
 * 的真实内容抹掉。保持「草稿始终是一份完整快照」，恢复才是幂等的。
 *
 * @param key 草稿的隔离键。同页多实例、或同页服务多个业务对象（如请假页按排练
 *            id）时，把区分标识拼进 key。**同一 key 只能配一套 defaultData**。
 */
type DraftApi<T> = {
  /** 写入完整草稿（进入编辑态、或选图前先落一次盘时调用） */
  save: (data: T) => void
  /** 局部更新草稿（合并到现有快照；无快照时以 defaultData 起底） */
  update: (patch: Partial<T>) => void
  /** 读取草稿快照（无草稿时返回 defaultData 的副本） */
  get: () => T
  /** 是否存在待恢复的草稿 */
  hasDraft: () => boolean
  /** 清除草稿（提交成功后调用） */
  clear: () => void
}

const drafts = new Map<string, unknown>()
const apis = new Map<string, unknown>()

export function useEditDraft<T extends Record<string, unknown>>(
  key: string,
  defaultData: T
): DraftApi<T> {
  let entry = apis.get(key) as { api: DraftApi<T>; defaults: T } | undefined

  if (!entry) {
    // 先建一个稳定的盒子：api 各方法闭包引用它，defaults 每次渲染刷新，
    // 于是既拿到稳定引用，又不会把默认值钉死在首帧。
    const box = { defaults: defaultData } as { api: DraftApi<T>; defaults: T }
    box.api = {
      save: (data) => {
        drafts.set(key, { ...data })
      },
      update: (patch) => {
        const current = drafts.get(key) as T | undefined
        drafts.set(key, { ...(current ?? box.defaults), ...patch })
      },
      get: () => ({ ...((drafts.get(key) as T | undefined) ?? box.defaults) }),
      hasDraft: () => drafts.has(key),
      clear: () => {
        drafts.delete(key)
      },
    }
    entry = box
    apis.set(key, box)
  }

  entry.defaults = defaultData

  return entry.api
}
