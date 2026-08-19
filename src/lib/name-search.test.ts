import { describe, it, expect } from 'vitest'
import { containsChinese, computePinyinKeys, filterByName } from './name-search'

const ROWS = [
  { id: '1', full_name: '王梓萱' }, // wang zi xuan / wzx
  { id: '2', full_name: '王五' }, // wang wu / ww
  { id: '3', full_name: '张三丰' }, // zhang san feng / zsf
  { id: '4', full_name: '李四' }, // li si / ls
]

describe('name-search', () => {
  describe('containsChinese', () => {
    it('中文返回 true', () => {
      expect(containsChinese('王')).toBe(true)
      expect(containsChinese('wzx王')).toBe(true)
    })

    it('纯字母/数字/符号返回 false', () => {
      expect(containsChinese('wzx')).toBe(false)
      expect(containsChinese('123')).toBe(false)
      expect(containsChinese('')).toBe(false)
    })
  })

  describe('computePinyinKeys', () => {
    it('计算全拼连写与首字母连写（忽略空格、统一小写）', () => {
      const wangKeys = computePinyinKeys('王梓萱')
      expect(wangKeys.fullPinyin).toBe('wangzixuan')
      expect(wangKeys.initials).toBe('wzx')
      const zhangKeys = computePinyinKeys('张 三')
      expect(zhangKeys.fullPinyin).toBe('zhangsan')
      expect(zhangKeys.initials).toBe('zs')
    })

    it('多音字返回全部读音组合（笛卡尔积）', () => {
      // 曾：ceng/zeng → 全拼 [cengzimo, zengzimo]，首字母 [czm, zzm]
      const keys = computePinyinKeys('曾子墨')
      expect(keys.fullPinyinList).toEqual(['cengzimo', 'zengzimo'])
      expect(keys.initialsList).toEqual(['czm', 'zzm'])
      // 姓氏读音集合：曾 → {ceng, zeng}
      expect(keys.surnamePinyin).toEqual(['ceng', 'zeng'])
      expect(keys.surnameInitials).toEqual(['c', 'z'])
    })

    it('超长多音字姓名的拼音组合数有上限（防笛卡尔积爆炸）', () => {
      // 10 字 × 多个读音，未截断时可达数万组合，截断后应 ≤ 256
      const keys = computePinyinKeys('曾单仇解区查曾单仇解')
      expect(keys.fullPinyinList.length).toBeLessThanOrEqual(256)
      expect(keys.initialsList.length).toBeLessThanOrEqual(256)
    })
  })

  describe('filterByName', () => {
    it('空串返回全部', () => {
      expect(filterByName(ROWS, '')).toHaveLength(4)
      expect(filterByName(ROWS, '   ')).toHaveLength(4)
    })

    it('中文按姓名包含匹配', () => {
      expect(filterByName(ROWS, '王').map((r) => r.id)).toEqual(['1', '2'])
      expect(filterByName(ROWS, '梓萱').map((r) => r.id)).toEqual(['1'])
      expect(filterByName(ROWS, '李').map((r) => r.id)).toEqual(['4'])
      expect(filterByName(ROWS, '张').map((r) => r.id)).toEqual(['3'])
    })

    it('中文不匹配时返回空数组', () => {
      expect(filterByName(ROWS, '陈')).toEqual([])
    })

    it('全拼连写包含匹配', () => {
      expect(filterByName(ROWS, 'wang').map((r) => r.id)).toEqual(['1', '2'])
      expect(filterByName(ROWS, 'zixuan').map((r) => r.id)).toEqual(['1'])
      expect(filterByName(ROWS, 'zhangsanfeng').map((r) => r.id)).toEqual(['3'])
    })

    it('首字母连写包含匹配（wzx）', () => {
      expect(filterByName(ROWS, 'wzx').map((r) => r.id)).toEqual(['1'])
      expect(filterByName(ROWS, 'zsf').map((r) => r.id)).toEqual(['3'])
    })

    it('单字母匹配姓氏首字母', () => {
      // "w" 匹配王姓成员
      expect(filterByName(ROWS, 'w').map((r) => r.id)).toEqual(['1', '2'])
      // "z" 只匹配张姓（姓氏首字母为 z），不匹配王梓萱（w）
      expect(filterByName(ROWS, 'z').map((r) => r.id)).toEqual(['3'])
    })

    it('忽略大小写', () => {
      expect(filterByName(ROWS, 'WZX').map((r) => r.id)).toEqual(['1'])
      expect(filterByName(ROWS, 'WANG').map((r) => r.id)).toEqual(['1', '2'])
    })

    it('忽略空格', () => {
      // "w z x" 去空格后为 "wzx"，匹配王梓萱
      expect(filterByName(ROWS, ' w z x ').map((r) => r.id)).toEqual(['1'])
      // "wang zi" 去空格后为 "wangzi"，只匹配王梓萱（wangzixuan）
      expect(filterByName(ROWS, 'wang zi').map((r) => r.id)).toEqual(['1'])
      // "wang wu" 去空格后为 "wangwu"，匹配王五
      expect(filterByName(ROWS, 'wang wu').map((r) => r.id)).toEqual(['2'])
    })

    it('姓名为空的成员不参与字母匹配', () => {
      const rowsWithNull = [...ROWS, { id: '5', full_name: null }]
      expect(filterByName(rowsWithNull, 'w').map((r) => r.id)).toEqual(['1', '2'])
    })

    describe('多音字姓氏', () => {
      const polyRows = [
        { id: '10', full_name: '曾子墨' }, // ceng/zeng zi mo
        { id: '11', full_name: '单志强' }, // dan/shan/chan zhi qiang
        { id: '12', full_name: '仇志远' }, // chou/qiu zhi yuan
        { id: '13', full_name: '王梓萱' }, // 对照：非多音字
      ]

      it('多音字姓氏全拼任一读音都能搜到（曾：zeng / ceng）', () => {
        expect(filterByName(polyRows, 'zeng').map((r) => r.id)).toEqual(['10'])
        expect(filterByName(polyRows, 'ceng').map((r) => r.id)).toEqual(['10'])
      })

      it('多音字姓氏单字母任一读音都能搜到（单：s / d）', () => {
        expect(filterByName(polyRows, 's').map((r) => r.id)).toEqual(['11'])
        expect(filterByName(polyRows, 'd').map((r) => r.id)).toEqual(['11'])
      })

      it('多音字首字母组合任一读音都能搜到（仇志远：qzy / czy）', () => {
        expect(filterByName(polyRows, 'qzy').map((r) => r.id)).toEqual(['12'])
        expect(filterByName(polyRows, 'czy').map((r) => r.id)).toEqual(['12'])
      })

      it('多音字不干扰非多音字匹配', () => {
        // "w" 只匹配王姓
        expect(filterByName(polyRows, 'w').map((r) => r.id)).toEqual(['13'])
        // "z" 匹配曾姓（zeng 读音）+ 王梓萱？不——"z" 是单字母，只匹配姓氏首字母
        expect(filterByName(polyRows, 'z').map((r) => r.id)).toEqual(['10'])
      })

      it('多字 query 命中多音字组合的中间片段（全拼）', () => {
        // "zimo" 是 "zengzimo" / "cengzimo" 的中间片段
        expect(filterByName(polyRows, 'zimo').map((r) => r.id)).toEqual(['10'])
        expect(filterByName(polyRows, 'cengzi').map((r) => r.id)).toEqual(['10'])
        // 非多音字对照：王梓萱（wangzixuan）不包含 "zimo"
        expect(filterByName(polyRows, 'zimo').map((r) => r.id)).not.toContain('13')
      })

      it('多字 query 命中多音字组合的中间片段（首字母）', () => {
        // "zm" 是 "czm" / "zzm" 的中间片段
        expect(filterByName(polyRows, 'zm').map((r) => r.id)).toEqual(['10'])
        // "zy" 是 仇志远（qzy / czy）与 单志强（dzq / szq / czq）? 检查：都不含 "zy" 连续
        // "zy" 应只命中 仇志远（czy 含 "zy"）
        expect(filterByName(polyRows, 'zy').map((r) => r.id)).toEqual(['12'])
      })
    })
  })
})
