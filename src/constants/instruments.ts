/** 乐团声部展示顺序:严格按此顺序分组,命中者各成一组,未命中归入「其他」 */
export const INSTRUMENT_ORDER = [
  '第一小提琴',
  '第二小提琴',
  '中提琴',
  '大提琴',
  '低音提琴',
  '长笛',
  '双簧管',
  '单簧管',
  '大管',
  '圆号',
  '小号',
  '长号',
  '大号',
  '打击乐',
  '键盘',
  '竖琴',
] as const

export type Instrument = (typeof INSTRUMENT_ORDER)[number]

export const OTHER_INSTRUMENT_GROUP = '其他'
