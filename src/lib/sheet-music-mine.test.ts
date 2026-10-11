import { describe, expect, it } from 'vitest'
import { myPartOf } from './sheet-music-mine'

const part = (section: string | null, id = section ?? '') => ({ id, section })

describe('myPartOf（「分发给我的」判据）', () => {
  it('命中我的声部那一个', () => {
    const parts = [part('总谱'), part('圆号'), part('打击乐')]
    expect(myPartOf(parts, '圆号')?.id).toBe('圆号')
  })

  it('该曲没有我这个声部 ⇒ null（列表里就不该出现这首）', () => {
    expect(myPartOf([part('长笛'), part('大提琴')], '圆号')).toBeNull()
  })

  it('没设置声部（null / 空串 / 纯空白）⇒ null —— 空列表好过把所有人的谱子都算成"我的"', () => {
    const parts = [part('圆号'), part('长笛')]
    expect(myPartOf(parts, null)).toBeNull()
    expect(myPartOf(parts, '')).toBeNull()
    expect(myPartOf(parts, '   ')).toBeNull()
  })

  it('「总谱」不是声部：谁都不该把它当成自己的', () => {
    expect(myPartOf([part('总谱')], '总谱')).toBeNull()
    expect(myPartOf([part('总谱'), part('圆号')], '圆号')?.id).toBe('圆号')
  })

  it('两侧都去空白后精确比较（库里可能有手填的空格）', () => {
    expect(myPartOf([part(' 圆号 ')], '圆号')?.id).toBe(' 圆号 ')
    expect(myPartOf([part('圆号')], ' 圆号 ')?.id).toBe('圆号')
  })

  it('不做子串/别名匹配：「小提琴」不该命中第一/第二小提琴（否则一提会看到二提的谱子）', () => {
    expect(myPartOf([part('第一小提琴'), part('第二小提琴')], '小提琴')).toBeNull()
  })

  it('同一个声部真出现多行时取第一个（顺序由展示排序决定，确定不跳）', () => {
    const parts = [part('圆号', 'a'), part('圆号', 'b')]
    expect(myPartOf(parts, '圆号')?.id).toBe('a')
  })

  it('声部为 null 的行不参与匹配', () => {
    expect(myPartOf([part(null), part('圆号')], '圆号')?.id).toBe('圆号')
  })
})
