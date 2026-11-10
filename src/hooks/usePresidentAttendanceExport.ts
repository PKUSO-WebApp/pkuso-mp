import { useCallback, useEffect, useRef, useState } from 'react'
import Taro from '@tarojs/taro'
import { supabase } from '@/lib/supabase'
import { useT } from '@/i18n'
import { buildWorkbookFileName } from '@/lib/attendance-export'
import {
  buildAttendanceSheets,
  buildAttendanceXlsx,
  type AttendanceXlsxLabels,
} from '@/lib/attendance-xlsx'
import { localDateKey } from '@/lib/attendance-calendar'
import type { PresidentAttendanceExportRow } from '@/types/database'

export type AttendanceExportFile = {
  path: string
  name: string
  /** 这份文件对应的选中集合（排序后 join），分享前必须与当前选择一致 */
  key: string
}

export type AttendanceExportState = {
  status: 'idle' | 'preparing' | 'ready' | 'error'
  file: AttendanceExportFile | null
}

export type ShareSelectedResult = 'shared' | 'preparing' | 'empty' | 'noRecords' | 'error'

const IDLE: AttendanceExportState = { status: 'idle', file: null }

/** `wx.env.USER_DATA_PATH`：Taro 的类型里没有它，按仓内既有做法从全局取 */
function userDataRoot(): string | null {
  try {
    const w = (globalThis as { wx?: { env?: { USER_DATA_PATH?: string } } }).wx
    return w?.env?.USER_DATA_PATH ?? null
  } catch {
    return null
  }
}

type FsLike = {
  writeFile(o: {
    filePath: string
    data: ArrayBuffer
    success?: () => void
    fail?: (e: { errMsg?: string }) => void
  }): void
}

function writeBinaryFile(path: string, data: Uint8Array): Promise<void> {
  return new Promise((resolve, reject) => {
    const fs = Taro.getFileSystemManager?.() as unknown as FsLike | undefined
    if (!fs) {
      reject(new Error('FileSystemManager 不可用'))
      return
    }
    const buffer = data.buffer.slice(
      data.byteOffset,
      data.byteOffset + data.byteLength
    ) as ArrayBuffer
    fs.writeFile({
      filePath: path,
      data: buffer,
      success: () => resolve(),
      fail: (e) => reject(new Error(e?.errMsg ?? 'writeFile failed')),
    })
  })
}

type Params = {
  enabled: boolean
  startDate: string
  endDate: string
  /** 已按日期筛选、按开始时间倒序的排练 */
  rehearsals: RehearsalLike[]
  /** 当前选中的排练 id；空数组 = 没有可转发的文件 */
  selectedIds: readonly number[]
  /** 编辑考勤后 +1，重新拉取导出数据 */
  refreshKey: number
}

type RehearsalLike = {
  id: number
  start_time?: string | null
  repertoire?: string | null
  title?: string | null
}

/**
 * 团长排练考勤的导出准备（只导出**选中**的排练）。
 *
 * ⚠️ 微信的 `shareFileMessage` **必须在用户点击的同步调用栈里发起**（见
 * `lib/pdf-handoff.ts` 的说明与真机报错）。所以不能「点按钮 → await 取数据 → 生成 →
 * 转发」：那样手势上下文早没了。
 *
 * 分两段：
 * 1. `prepare` 只在进入 tab / 改日期 / 编辑后拉一次原始行，缓存在 ref；
 * 2. 选中的排练变化时，**纯本地**生成 xlsx 并写一份稳定路径的文件。勾选一个排练到点击转发
 *    之间通常已完成（毫秒级），点击只做同步的 `shareFileMessage`。
 */
export function usePresidentAttendanceExport({
  enabled,
  startDate,
  endDate,
  rehearsals,
  selectedIds,
  refreshKey,
}: Params) {
  const { t } = useT()
  const [state, setState] = useState<AttendanceExportState>(IDLE)
  const stateRef = useRef(state)
  stateRef.current = state

  const rowsRef = useRef<PresidentAttendanceExportRow[]>([])
  const dataVersionRef = useRef(0)
  const dataReadyRef = useRef(false)
  const [dataVersion, setDataVersion] = useState(0)
  const dataGenRef = useRef(0)
  const writeGenRef = useRef(0)
  const writeChainRef = useRef<Promise<void>>(Promise.resolve())
  const rehearsalsRef = useRef(rehearsals)
  rehearsalsRef.current = rehearsals
  const selectedIdsRef = useRef(selectedIds)
  selectedIdsRef.current = selectedIds
  const selectedKey = selectedIds.join(',')

  const labels = useCallback((): AttendanceXlsxLabels => {
    return {
      name: t('president.attendance.columns.name'),
      email: t('president.attendance.columns.email'),
      status: t('president.attendance.columns.status'),
      inOrchestra: t('president.attendance.columns.inOrchestra'),
      signInTime: t('president.attendance.columns.signInTime'),
      statusLabels: {
        present: t('memberAttendance.status.present'),
        late: t('memberAttendance.status.late'),
        absent: t('memberAttendance.status.absent'),
        excused: t('memberAttendance.status.excused'),
        exempt: t('memberAttendance.status.exempt'),
      },
      inOrchestraValue: t('president.attendance.columns.inOrchestraValue'),
      notInOrchestraValue: t('president.attendance.columns.notInOrchestraValue'),
      unknown: t('president.attendance.columns.unknown'),
    }
  }, [t])

  const queueWrite = useCallback((path: string, content: Uint8Array, gen: number) => {
    const run = writeChainRef.current
      .catch(() => {})
      .then(async () => {
        if (gen !== writeGenRef.current) return
        await writeBinaryFile(path, content)
      })
    writeChainRef.current = run
    return run
  }, [])

  /** 拉取当前日期区间的原始考勤行（不生成文件） */
  const prepare = useCallback(async () => {
    // 作废可能在途的选中文件写入，别让旧文件在新一轮准备中把状态改回 ready
    writeGenRef.current += 1
    if (!enabled) {
      dataGenRef.current += 1
      dataReadyRef.current = false
      rowsRef.current = []
      setState(IDLE)
      return
    }
    const gen = ++dataGenRef.current
    dataReadyRef.current = false
    setState({ status: 'preparing', file: null })

    try {
      // 列表还没加载 / 为空：不必发一次全量导出查询
      if (rehearsalsRef.current.length === 0) {
        rowsRef.current = []
        dataReadyRef.current = true
        dataVersionRef.current += 1
        setDataVersion(dataVersionRef.current)
        setState({ status: 'ready', file: null })
        return
      }
      // 没有手选日期时，用当前列表的第一场 / 最后一场作为范围（而不是把「不限」当成
      // 无界查询）。这样导出的就是「第一场排练到最后一场排练」的出勤。
      const listDates = rehearsalsRef.current
        .map((rehearsal) => localDateKey(rehearsal.start_time ?? null))
        .filter((date): date is string => !!date)
        .sort()
      const { data, error } = await supabase.rpc('president_attendance_export', {
        p_start_date: startDate || listDates[0] || undefined,
        p_end_date: endDate || listDates[listDates.length - 1] || undefined,
      })
      if (gen !== dataGenRef.current) return
      if (error) throw new Error(error.message)

      rowsRef.current = (data ?? []) as PresidentAttendanceExportRow[]
      dataReadyRef.current = true
      dataVersionRef.current += 1
      setDataVersion(dataVersionRef.current)
      // 有选中项时由下面的选择 effect 生成文件并置 ready；没有选中项直接 ready（file=null）
      if (selectedIdsRef.current.length === 0) {
        setState({ status: 'ready', file: null })
      }
    } catch (err) {
      if (gen !== dataGenRef.current) return
      console.error('[PresidentAttendanceExport] 准备考勤表失败', err)
      dataReadyRef.current = false
      setState({ status: 'error', file: null })
    }
  }, [enabled, endDate, startDate])

  // 选中集合变化 / 原始数据刷新 → 本地生成 xlsx 并写文件（不联网）
  useEffect(() => {
    if (!enabled || !dataReadyRef.current) return
    const ids = selectedIdsRef.current
    if (ids.length === 0) {
      writeGenRef.current += 1
      setState({ status: 'ready', file: null })
      return
    }

    const idSet = new Set(ids)
    const rows = rowsRef.current.filter((row) => idSet.has(row.rehearsal_id))
    const key = [...ids].sort((a, b) => a - b).join(',')
    if (rows.length === 0) {
      writeGenRef.current += 1
      setState({ status: 'ready', file: null })
      return
    }

    const gen = ++writeGenRef.current
    setState({ status: 'preparing', file: null })
    const root = userDataRoot()
    if (!root) {
      setState({ status: 'error', file: null })
      return
    }
    const selectedRehearsals = rehearsalsRef.current
      .filter((rehearsal) => idSet.has(rehearsal.id))
      .map((rehearsal) => ({
        id: rehearsal.id,
        start_time: rehearsal.start_time ?? null,
        repertoire: rehearsal.repertoire ?? null,
        title: rehearsal.title ?? null,
      }))
    const sheets = buildAttendanceSheets(
      rows,
      selectedRehearsals,
      t('president.attendance.unnamedRehearsal')
    )
    const content = buildAttendanceXlsx(sheets, labels())
    // 文件名用**选中排练**的第一场 / 最后一场日期，而不是筛选框里的「不限」
    const selectedDates = selectedRehearsals
      .map((rehearsal) => localDateKey(rehearsal.start_time ?? null))
      .filter((date): date is string => !!date)
      .sort()
    const name = buildWorkbookFileName({
      prefix: t('president.attendance.filePrefix'),
      startDate: selectedDates[0] || startDate,
      endDate: selectedDates[selectedDates.length - 1] || endDate,
      allLabel: t('president.attendance.unlimited'),
    })
    // 稳定路径：反复勾选覆盖同一份文件，不在用户目录里堆历史版本
    const path = `${root}/pkuso-attendance-selected.xlsx`
    void queueWrite(path, content, gen)
      .then(() => {
        if (gen !== writeGenRef.current) return
        setState({ status: 'ready', file: { path, name, key } })
      })
      .catch((err) => {
        if (gen !== writeGenRef.current) return
        console.error('[PresidentAttendanceExport] 写考勤 xlsx 失败', err)
        setState({ status: 'error', file: null })
      })
  }, [enabled, dataVersion, selectedKey, labels, queueWrite, startDate, endDate, t])

  // 进入 tab / 改筛选 / 编辑考勤后重新拉原始行
  const filterKey = `${startDate}|${endDate}|${refreshKey}|${rehearsals
    .map((rehearsal) => `${rehearsal.id}:${rehearsal.start_time ?? ''}`)
    .join(',')}`
  useEffect(() => {
    void prepare()
    return () => {
      dataGenRef.current += 1
    }
  }, [prepare, filterKey])

  const shareSelected = useCallback((): ShareSelectedResult => {
    if (!enabled) return 'empty'
    if (selectedIdsRef.current.length === 0) return 'empty'
    const current = stateRef.current
    if (current.status === 'error') return 'error'
    if (current.status !== 'ready') return 'preparing'
    if (!current.file) return 'noRecords'
    const currentKey = [...selectedIdsRef.current].sort((a, b) => a - b).join(',')
    if (current.file.key !== currentKey) return 'preparing'
    if (typeof Taro.shareFileMessage !== 'function') return 'error'
    try {
      Promise.resolve(
        Taro.shareFileMessage({ filePath: current.file.path, fileName: current.file.name })
      ).catch((err: unknown) => {
        const msg = String((err as { errMsg?: string })?.errMsg ?? err)
        if (/cancel/i.test(msg)) return
        void Taro.showToast({ title: t('president.attendance.shareFailed'), icon: 'none' })
      })
      return 'shared'
    } catch {
      return 'error'
    }
  }, [enabled, t])

  return { state, prepare, shareSelected }
}
