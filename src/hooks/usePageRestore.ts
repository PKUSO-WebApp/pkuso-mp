import Taro from '@tarojs/taro'

/**
 * 页面参数恢复 Hook
 *
 * 问题背景：
 * 微信小程序调用 chooseMedia / chooseAvatar / getLocation 等 API 后，页面可能
 * 被销毁重建，重建后 `Taro.getCurrentInstance().router.params` 为空——页面依赖
 * 的路由参数（如 id）随之丢失，数据再也取不回来。
 *
 * 为什么存到组件实例之外（而不是 useRef）：
 * 与 `useEditDraft` 同因——useRef 与 useState 同属一个组件实例，页面真被销毁重建
 * 时 ref 会一起重置，「只有 ref 活下来」这个假设不成立。所以缓存放在模块级 Map。
 *
 * 缓存的是**整份 params**，不是「被读到的那一个」：某参数是否被读过取决于渲染
 * 路径（条件分支、子组件先挂载等），按需缓存会让「重建后某个参数恰好没被读过」
 * 变成静默丢失。整体缓存后，重建时任何参数都还在。
 *
 * 已知局限：同一路径若同时在页面栈里存在多个实例、且各自带不同参数，后进入的会
 * 覆盖缓存，被覆盖者重建后将拿到别人的参数——本 App 目前不存在这种页面（请假页
 * 只从排练详情进入，一次只有一个）；若将来出现，需要把实例标识一并纳入 key。
 * 另一取舍：无参进入同一路径时会命中上次缓存（本 App 的路由都会带参，见上方前提）。
 *
 * 用法：
 * ```tsx
 * const cachedId = usePageRestore<string>('id')
 * const id = Number(cachedId)   // router.params 的值是字符串，务必显式转换
 * ```
 *
 * @param paramName 要读取的 router.params 键名
 * @returns 参数值（带参进入时为当前参数，参数丢失后回落到上次缓存的那一份）
 */
const paramCache = new Map<string, Record<string, unknown>>()

export function usePageRestore<T = string>(paramName: string): T | undefined {
  const router = Taro.getCurrentInstance().router
  const pageKey = router?.path ?? ''
  const params = router?.params as Record<string, unknown> | undefined
  const hasParams = !!params && Object.keys(params).length > 0

  // 带参进入：整体刷新缓存（同路径再次进入时以后者为准）
  if (hasParams) paramCache.set(pageKey, { ...params })

  // 无参 = 页面被重建（参数已丢）：回落到上次缓存的那一份，而不是当场返回 undefined
  const source = hasParams ? params : paramCache.get(pageKey)
  return source?.[paramName] as T | undefined
}
