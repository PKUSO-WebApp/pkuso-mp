/**
 * 「分发给我的」的判据：**我的声部** → 那个曲子里属于我的那份谱子。
 *
 * 现阶段的定义（用户 2026-10-11 定，暂时替代按 `sheet_music_distributions` 下发）：
 * **「分发给我的」= 所有含我声部的乐谱**。所以判据是一条**精确相等**：
 * `sheet_music_parts.section === profiles.instrument`。
 *
 * 为什么可以精确相等：两侧用的是**同一套闭集词表**——`profiles.instrument` 的现网取值与
 * `INSTRUMENT_ORDER`（16 个声部）逐个吻合，`sheet_music_parts.section` 由 LLM 归类后
 * 也落在这套词表里（校验见 `lib/sheet-music-sort.ts` 的 `sectionSortKey`）。
 * **不要在这里加别名/子串兜底**：`小提琴` 同时是「第一小提琴」「第二小提琴」的子串，
 * 按子串匹配会让一提的人看到二提的谱子——这类错静默且看起来"有内容"，比空列表坏得多。
 *
 * ⚠️ `总谱`（`FULL_SCORE_SECTION`）**不是声部**（不在 `INSTRUMENT_ORDER` 里）：它是整份谱、
 * 属于所有人，也就不专属任何人 ⇒ 显式排除。不能只靠"精确相等"——profile 的声部列是自由文本，
 * 万一有人手填了「总谱」，靠相等就会把整份谱算成"我的声部"。
 */

import { FULL_SCORE_SECTION } from '@/constants/instruments'

/**
 * 在某个曲子的声部里找出「我的」那一个；没有（未设置声部 / 该曲没有我这个声部）返回 null。
 *
 * 每个曲子里一个声部最多一行 part（现网数据如此，且上传时按 section 归并），
 * 所以这里返回单个而不是数组；真出现重复时取**第一个**（调用方按展示顺序传入，
 * 顺序由 `sortPartsForDisplay` 保证，是确定的）。
 */
export function myPartOf<T extends { section: string | null }>(
  parts: readonly T[],
  mySection: string | null | undefined
): T | null {
  const mine = (mySection ?? '').trim()
  if (!mine || mine === FULL_SCORE_SECTION) return null
  return parts.find((p) => (p.section ?? '').trim() === mine) ?? null
}
