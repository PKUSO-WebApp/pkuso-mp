import { describe, expect, it } from 'vitest'
import { useEditDraft } from '../useEditDraft'

type Draft = {
  title: string
  content: string
  imageFile: { tempFilePath: string } | null
}

const defaults = (): Draft => ({ title: '', content: '', imageFile: null })

// 草稿存在模块级 Map 里、按 key 共享，所以每个用例用一个新 key 以免互相污染
let seq = 0
const freshKey = () => `test-draft-${++seq}`

describe('useEditDraft', () => {
  it('无草稿时 hasDraft 为假，get() 返回默认值', () => {
    const draft = useEditDraft<Draft>(freshKey(), defaults())
    expect(draft.hasDraft()).toBe(false)
    expect(draft.get()).toEqual({ title: '', content: '', imageFile: null })
  })

  it('save 后读得回，且 get() 返回副本（外部改动不会写回草稿）', () => {
    const draft = useEditDraft<Draft>(freshKey(), defaults())
    draft.save({ title: '标题', content: '正文', imageFile: null })
    expect(draft.hasDraft()).toBe(true)

    const got = draft.get()
    expect(got).toEqual({ title: '标题', content: '正文', imageFile: null })
    got.title = '被改坏了'
    expect(draft.get().title).toBe('标题')
  })

  it('update 只合并传入的字段，其余字段原样保留', () => {
    const draft = useEditDraft<Draft>(freshKey(), defaults())
    draft.save({ title: '标题', content: '正文', imageFile: null })
    draft.update({ content: '正文2' })
    expect(draft.get()).toEqual({ title: '标题', content: '正文2', imageFile: null })
  })

  it('clear 之后回到「无草稿」', () => {
    const draft = useEditDraft<Draft>(freshKey(), defaults())
    draft.save({ title: '标题', content: '', imageFile: null })
    draft.clear()
    expect(draft.hasDraft()).toBe(false)
    expect(draft.get().title).toBe('')
  })

  it('草稿跨组件实例存活——页面被销毁重建后仍在（useRef 版做不到这条）', () => {
    const key = freshKey()
    useEditDraft<Draft>(key, defaults()).update({ title: '用户敲了一半' })

    // 模拟页面重建：同一 key 重新调用（等价于新组件实例的首次渲染）
    const afterRemount = useEditDraft<Draft>(key, defaults())
    expect(afterRemount.hasDraft()).toBe(true)
    expect(afterRemount.get().title).toBe('用户敲了一半')
  })

  it('同一 key 每次渲染返回同一个对象（否则放进 effect 依赖会让 effect 轮轮重跑）', () => {
    const key = freshKey()
    expect(useEditDraft<Draft>(key, defaults())).toBe(useEditDraft<Draft>(key, defaults()))
  })

  it('不同 key 的草稿互不干扰', () => {
    const keyA = freshKey()
    const keyB = freshKey()
    useEditDraft<Draft>(keyA, defaults()).update({ title: 'A' })
    useEditDraft<Draft>(keyB, defaults()).update({ title: 'B' })
    expect(useEditDraft<Draft>(keyA, defaults()).get().title).toBe('A')
    expect(useEditDraft<Draft>(keyB, defaults()).get().title).toBe('B')
  })

  it('无草稿时 update 以「最新一次渲染」的默认值起底，而不是首帧那份', () => {
    const key = freshKey()
    useEditDraft<Draft>(key, { title: '首帧默认', content: '', imageFile: null })
    const secondRender = useEditDraft<Draft>(key, {
      title: '次帧默认',
      content: '',
      imageFile: null,
    })
    secondRender.update({ content: '改了内容' })
    expect(secondRender.get()).toEqual({
      title: '次帧默认',
      content: '改了内容',
      imageFile: null,
    })
  })
})
