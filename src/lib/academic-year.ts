export type AcademicYear = {
  startYear: number
  endYear: number
  label: string
}

/**
 * 获取当前学年（以当前年份 9 月 1 日 00:00:00 UTC+8 为分界）
 * - 当前日期 < 当年 9 月 1 日 → 上一学年（如 25-26）
 * - 当前日期 >= 当年 9 月 1 日 → 当前学年（如 26-27）
 * 返回格式：{ startYear, endYear, label: 'YY-YY' }
 */
export function getCurrentAcademicYear(): AcademicYear {
  const now = new Date()
  const shanghaiTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }))
  const currentYear = shanghaiTime.getFullYear()
  const cutoff = new Date(currentYear, 7, 1, 0, 0, 0, 0) // 8月1日 (month is 0-indexed)

  if (shanghaiTime >= cutoff) {
    return {
      startYear: currentYear,
      endYear: currentYear + 1,
      label: `${String(currentYear).slice(-2)}-${String(currentYear + 1).slice(-2)}`,
    }
  } else {
    return {
      startYear: currentYear - 1,
      endYear: currentYear,
      label: `${String(currentYear - 1).slice(-2)}-${String(currentYear).slice(-2)}`,
    }
  }
}

/**
 * 直接返回学年标签，如 '25-26'、'26-27'
 */
export function getAcademicYearLabel(): string {
  return getCurrentAcademicYear().label
}
