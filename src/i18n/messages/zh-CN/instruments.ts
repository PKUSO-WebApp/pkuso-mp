// 乐器 / 声部展示名（按稳定 code 索引）。后端存储的是中文展示串，
// 渲染时经 src/lib/instrument-i18n.ts 的 translateInstrument 映射到本词典做本地化。
export const instruments = {
  firstViolin: '第一小提琴',
  secondViolin: '第二小提琴',
  viola: '中提琴',
  cello: '大提琴',
  doubleBass: '低音提琴',
  flute: '长笛',
  oboe: '双簧管',
  clarinet: '单簧管',
  bassoon: '大管',
  horn: '圆号',
  trumpet: '小号',
  trombone: '长号',
  tuba: '大号',
  percussion: '打击乐',
  keyboard: '键盘',
  harp: '竖琴',
  other: '其他',
}
