import { describe, expect, it } from 'vitest'
import { classifyActivityNotification } from './activity-notification'

describe('classifyActivityNotification（原项目管理端固定文案模板）', () => {
  it('重奏 → ensemble', () => {
    expect(classifyActivityNotification('你的重奏帖子《测试公告》已被管理员删除')).toBe('ensemble')
  })

  it('团建 → gathering', () => {
    expect(classifyActivityNotification('你的团建帖子《团建B》已被管理员锁定')).toBe('gathering')
  })

  it('允许首尾空白', () => {
    expect(classifyActivityNotification('  你的团建帖子《x》已被管理员锁定 ')).toBe('gathering')
  })

  it('非开头出现类型词不误判（锚定结构）', () => {
    expect(classifyActivityNotification('关于重奏排练的通知《x》已被管理员锁定')).toBeNull()
  })

  it('其他通知 / 空 / null → null（仅在「全部」展示）', () => {
    expect(classifyActivityNotification('元旦汇演通知')).toBeNull()
    expect(classifyActivityNotification('帖子已被锁定')).toBeNull()
    expect(classifyActivityNotification('')).toBeNull()
    expect(classifyActivityNotification(null)).toBeNull()
    expect(classifyActivityNotification(undefined)).toBeNull()
  })
})
