import { useCallback, useEffect, useRef, useState } from 'react'
import Taro from '@tarojs/taro'
import { supabase } from '@/lib/supabase'
import { useT } from '@/i18n'
import {
  buildAllAttendanceCsv,
  buildAllExportFileName,
  buildSingleAttendanceCsv,
  buildSingleExportFileName,
  groupExportRowsByRehearsal,
  type AttendanceCsvLabels,
} from '@/lib/attendance-export'
import { localDateKey } from '@/lib/attendance-calendar'
import type { PresidentAttendanceExportRow, RehearsalRow } from '@/types/database'

export type AttendanceExportFile = { path: string; name: string }

export type PreparedAttendanceExports = {
  status: 'idle' | 'preparing' | 'ready' | 'error'
  /** null = 这场没有考勤记录，按钮显示「暂无记录」 */
  perRehearsal: Record<number, AttendanceExportFile | null>
  all: AttendanceExportFile | null
}

const IDLE: PreparedAttendanceExports = { status: 'idle', perRehearsal: {}, all: null }

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
    data: string
    encoding?: string
    success?: () => void
    fail?: (e: { errMsg?: string }) => void
  }): void
}

function writeTextFile(path: string, data: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const fs = Taro.getFileSystemManager?.() as unknown as FsLike | undefined
    if (!fs) {
      reject(new Error('FileSystemManager 不可用'))
      return
    }
    fs.writeFile({
      filePath: path,
      data,
      encoding: 'utf8',
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
  rehearsals: RehearsalRow[]
  /** 编辑考勤后 +1，重新生成表格 */
  refreshKey: number
}

/**
 * 团长排练考勤的导出准备。
 *
 * ⚠️ 微信的 `shareFileMessage` **必须在用户点击的同步调用栈里发起**（见
 * `lib/pdf-handoff.ts` 的说明与真机报错）。所以不能「点按钮 → await 取数据 → 生成 →
 * 转发」：那样手势上下文早没了。这里改成**提前把每个排练的 CSV 写到本地**，
 * 按钮点击只做一件事：拿已经就绪的 path 调 `shareFileMessage`（零 await）。
 *
 * 准备在以下时机重跑：进入 tab、改日期筛选、编辑考勤后（refreshKey）。
 */
export function usePresidentAttendanceExport({
  enabled,
  startDate,
  endDate,
  rehearsals,
  refreshKey,
}: Params) {
  const { t } = useT()
  const [prepared, setPrepared] = useState<PreparedAttendanceExports>(IDLE)
  const rehearsalsRef = useRef(rehearsals)
  rehearsalsRef.current = rehearsals
  const genRef = useRef(0)
  /** 串行化写文件：稳定路径 + 后一轮一定覆盖前一轮，旧轮次在队列里发现 gen 变了就跳过 */
  const writeChainRef = useRef<Promise<void>>(Promise.resolve())

  const queueWrite = useCallback((path: string, content: string, gen: number) => {
    const run = writeChainRef.current
      .catch(() => {})
      .then(async () => {
        if (gen !== genRef.current) return
        await writeTextFile(path, content)
      })
    writeChainRef.current = run
    return run
  }, [])

  const labels = useCallback((): AttendanceCsvLabels => {
    return {
      name: t('president.attendance.csv.name'),
      email: t('president.attendance.csv.email'),
      status: t('president.attendance.csv.status'),
      inOrchestra: t('president.attendance.csv.inOrchestra'),
      signInTime: t('president.attendance.csv.signInTime'),
      rehearsal: t('president.attendance.csv.rehearsal'),
      statusLabels: {
        present: t('memberAttendance.status.present'),
        late: t('memberAttendance.status.late'),
        absent: t('memberAttendance.status.absent'),
        excused: t('memberAttendance.status.excused'),
        exempt: t('memberAttendance.status.exempt'),
      },
      inOrchestraValue: t('president.attendance.csv.inOrchestraValue'),
      notInOrchestraValue: t('president.attendance.csv.notInOrchestraValue'),
      unknown: t('president.attendance.csv.unknown'),
    }
  }, [t])

  const prepare = useCallback(async () => {
    if (!enabled) {
      genRef.current += 1
      setPrepared(IDLE)
      return
    }
    const gen = ++genRef.current
    setPrepared({ status: 'preparing', perRehearsal: {}, all: null })

    try {
      const list = rehearsalsRef.current
      if (list.length === 0) {
        setPrepared({ status: 'ready', perRehearsal: {}, all: null })
        return
      }

      const { data, error } = await supabase.rpc('president_attendance_export', {
        p_start_date: startDate || undefined,
        p_end_date: endDate || undefined,
      })
      if (gen !== genRef.current) return
      if (error) throw new Error(error.message)

      const rows = (data ?? []) as PresidentAttendanceExportRow[]
      const root = userDataRoot()
      if (!root) throw new Error('USER_DATA_PATH 不可用')

      const byRehearsal = groupExportRowsByRehearsal(rows)
      const csvLabels = labels()
      const perRehearsal: Record<number, AttendanceExportFile | null> = {}

      for (const rehearsal of list) {
        const rowsForRehearsal = byRehearsal.get(rehearsal.id) ?? []
        if (rowsForRehearsal.length === 0) {
          perRehearsal[rehearsal.id] = null
          continue
        }
        // 稳定路径：后台每 30 秒刷新时覆盖同一个文件，不在用户目录里堆历史版本
        const path = `${root}/pkuso-attendance-r${rehearsal.id}.csv`
        await queueWrite(path, buildSingleAttendanceCsv(rowsForRehearsal, csvLabels), gen)
        if (gen !== genRef.current) return
        perRehearsal[rehearsal.id] = {
          path,
          name: buildSingleExportFileName({
            prefix: t('president.attendance.filePrefix'),
            title:
              rehearsal.repertoire || rehearsal.title || t('president.attendance.unnamedRehearsal'),
            date: localDateKey(rehearsal.start_time),
          }),
        }
      }

      const ids = new Set(list.map((rehearsal) => rehearsal.id))
      const allRows = rows.filter((row) => ids.has(row.rehearsal_id))
      let all: AttendanceExportFile | null = null
      if (allRows.length > 0) {
        const path = `${root}/pkuso-attendance-all.csv`
        await queueWrite(path, buildAllAttendanceCsv(allRows, csvLabels), gen)
        if (gen !== genRef.current) return
        all = {
          path,
          name: buildAllExportFileName({
            prefix: t('president.attendance.filePrefix'),
            startDate,
            endDate,
            allLabel: t('president.attendance.unlimited'),
          }),
        }
      }

      if (gen !== genRef.current) return
      setPrepared({ status: 'ready', perRehearsal, all })
    } catch (err) {
      if (gen !== genRef.current) return
      console.error('[PresidentAttendanceExport] 准备考勤表失败', err)
      setPrepared({ status: 'error', perRehearsal: {}, all: null })
    }
  }, [enabled, endDate, labels, queueWrite, startDate, t])

  // 不只比对 id：拉回新数据后曲目 / 时间可能变了，文件名与表格内容都得重做
  const listKey = rehearsals
    .map(
      (rehearsal) =>
        `${rehearsal.id}:${rehearsal.start_time ?? ''}:${rehearsal.repertoire ?? ''}:${rehearsal.title ?? ''}`
    )
    .join('|')

  useEffect(() => {
    void prepare()
    return () => {
      // 依赖变化 / 卸载：作废还在路上的准备，别让旧结果覆盖新一轮
      genRef.current += 1
    }
  }, [prepare, listKey, refreshKey])

  /**
   * 把已备好的文件转发到微信。**同步调用 API**，调用方不得在点击回调里先 await。
   * 这是 `shareFileMessage` 的硬约束（用户点击的同步栈），不是风格问题。
   */
  const shareFile = useCallback(
    (file: AttendanceExportFile | null | undefined) => {
      if (!file) return
      if (typeof Taro.shareFileMessage !== 'function') {
        void Taro.showToast({
          title: t('president.attendance.shareUnsupported'),
          icon: 'none',
        })
        return
      }
      try {
        Promise.resolve(Taro.shareFileMessage({ filePath: file.path, fileName: file.name })).catch(
          (err: unknown) => {
            const msg = String((err as { errMsg?: string })?.errMsg ?? err)
            if (/cancel/i.test(msg)) return
            void Taro.showToast({ title: t('president.attendance.shareFailed'), icon: 'none' })
          }
        )
      } catch {
        void Taro.showToast({ title: t('president.attendance.shareFailed'), icon: 'none' })
      }
    },
    [t]
  )

  return { prepared, prepare, shareFile }
}
