import { strToU8, zipSync } from 'fflate'
import { localDateKey } from '@/lib/attendance-calendar'
import { pinyinSortKey } from '@/lib/pinyin-sort'
import type { AttendanceStatus, PresidentAttendanceExportRow } from '@/types/database'

/**
 * 团长考勤导出（xlsx，每场排练一个 sheet）。
 *
 * 为什么不用 web 的 SheetJS：它的浏览器构建放不进小程序主包。这里只生成 xlsx 的
 * 最小 ZIP + XML 结构，ZIP 由 fflate（~8KB）完成；产物 Excel / WPS 可直接打开。
 *
 * 本文件保持纯函数，便于单测（测试用 fflate 自己解压检查 XML）。
 */

export type AttendanceXlsxLabels = {
  name: string
  email: string
  status: string
  inOrchestra: string
  signInTime: string
  statusLabels: Record<AttendanceStatus, string>
  inOrchestraValue: string
  notInOrchestraValue: string
  unknown: string
}

export type AttendanceSheetMeta = {
  id: number
  start_time: string | null
  repertoire: string | null
  title: string | null
}

export type AttendanceSheet = {
  name: string
  rows: PresidentAttendanceExportRow[]
}

const MAX_SHEET_NAME = 31
const XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** Excel sheet 名：≤31 字符、不能含 []:*?/\\，且不能为空 */
export function sanitizeSheetName(value: string, fallback = 'rehearsal'): string {
  const cleaned = value
    .replace(/[\\/?*[\]:|<>"]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_SHEET_NAME)
    .trim()
  return cleaned || fallback.slice(0, MAX_SHEET_NAME)
}

/** Excel 的 sheet 名大小写不敏感，重复时追加 _2 / _3 */
export function buildUniqueSheetNames(names: string[]): string[] {
  const used = new Set<string>()
  return names.map((name) => {
    let candidate = name
    let n = 2
    while (used.has(candidate.toLowerCase())) {
      const suffix = `_${n}`
      candidate = `${name.slice(0, MAX_SHEET_NAME - suffix.length)}${suffix}`
      n += 1
    }
    used.add(candidate.toLowerCase())
    return candidate
  })
}

function nameOf(row: PresidentAttendanceExportRow): string {
  return (row.full_name ?? '').trim()
}

function compareName(a: PresidentAttendanceExportRow, b: PresidentAttendanceExportRow): number {
  const an = nameOf(a)
  const bn = nameOf(b)
  const ka = pinyinSortKey(an)
  const kb = pinyinSortKey(bn)
  if (ka !== kb) return ka < kb ? -1 : 1
  if (an !== bn) return an < bn ? -1 : 1
  return 0
}

function statusText(row: PresidentAttendanceExportRow, labels: AttendanceXlsxLabels): string {
  if (!row.status) return labels.unknown
  return labels.statusLabels[row.status] ?? labels.unknown
}

function inOrchestraText(row: PresidentAttendanceExportRow, labels: AttendanceXlsxLabels): string {
  if (row.is_in_orchestra === true) return labels.inOrchestraValue
  if (row.is_in_orchestra === false) return labels.notInOrchestraValue
  return labels.unknown
}

function cell(ref: string, value: string): string {
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`
}

function sheetXml(sheet: AttendanceSheet, labels: AttendanceXlsxLabels): string {
  const header = [labels.name, labels.email, labels.status, labels.inOrchestra, labels.signInTime]
  const rows = [...sheet.rows].sort(compareName)
  const data = [
    header,
    ...rows.map((row) => [
      nameOf(row) || labels.unknown,
      row.email ?? labels.unknown,
      statusText(row, labels),
      inOrchestraText(row, labels),
      row.sign_in_time ?? labels.unknown,
    ]),
  ]
  const rowXml = data
    .map((values, rowIndex) => {
      const cells = values
        .map((value, colIndex) =>
          cell(`${String.fromCharCode(65 + colIndex)}${rowIndex + 1}`, value)
        )
        .join('')
      return `<row r="${rowIndex + 1}">${cells}</row>`
    })
    .join('')
  return `${XML_HEADER}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rowXml}</sheetData></worksheet>`
}

/** 把选中的排练整理成 sheet：每场一个 sheet，名字 = 曲目_日期（重名自动加后缀） */
export function buildAttendanceSheets(
  rows: PresidentAttendanceExportRow[],
  rehearsals: AttendanceSheetMeta[],
  fallbackTitle: string
): AttendanceSheet[] {
  const grouped = new Map<number, PresidentAttendanceExportRow[]>()
  for (const row of rows) {
    const list = grouped.get(row.rehearsal_id) ?? []
    list.push(row)
    grouped.set(row.rehearsal_id, list)
  }
  const baseNames = rehearsals.map((rehearsal) => {
    const title = rehearsal.repertoire || rehearsal.title || fallbackTitle
    const date = localDateKey(rehearsal.start_time)
    return sanitizeSheetName(date ? `${title}_${date}` : title, fallbackTitle)
  })
  const names = buildUniqueSheetNames(baseNames)
  return rehearsals.map((rehearsal, index) => ({
    name: names[index]!,
    rows: grouped.get(rehearsal.id) ?? [],
  }))
}

function stylesXml(): string {
  return `${XML_HEADER}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`
}

/** 生成 xlsx 字节（每场一个 sheet） */
export function buildAttendanceXlsx(
  sheets: AttendanceSheet[],
  labels: AttendanceXlsxLabels
): Uint8Array {
  const files: Record<string, Uint8Array> = {}
  files['[Content_Types].xml'] = strToU8(
    `${XML_HEADER}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets
      .map(
        (_, index) =>
          `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
      )
      .join(
        ''
      )}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`
  )
  files['_rels/.rels'] = strToU8(
    `${XML_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`
  )
  files['docProps/core.xml'] = strToU8(
    `${XML_HEADER}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:creator>PKUSO</dc:creator></cp:coreProperties>`
  )
  files['docProps/app.xml'] = strToU8(
    `${XML_HEADER}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>PKUSO</Application></Properties>`
  )
  files['xl/workbook.xml'] = strToU8(
    `${XML_HEADER}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets
      .map(
        (sheet, index) =>
          `<sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`
      )
      .join('')}</sheets></workbook>`
  )
  files['xl/_rels/workbook.xml.rels'] = strToU8(
    `${XML_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets
      .map(
        (_, index) =>
          `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`
      )
      .join(
        ''
      )}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`
  )
  files['xl/styles.xml'] = strToU8(stylesXml())
  sheets.forEach((sheet, index) => {
    files[`xl/worksheets/sheet${index + 1}.xml`] = strToU8(sheetXml(sheet, labels))
  })
  return zipSync(files)
}
