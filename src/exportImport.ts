/** 表/库级导入导出:统一入口,浏览器预览走下载,真窗口走系统保存对话框 */
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog'
import * as api from './api'
import { useAppStore } from './stores/app'
import type { DbType } from './types'

function download(name: string, content: string | Blob) {
  const blob = typeof content === 'string' ? new Blob([content], { type: 'text/plain;charset=utf-8' }) : content
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

async function saveOrDownload(name: string, content: string | Blob): Promise<boolean> {
  if (!api.isTauri) {
    download(name, content)
    return true
  }
  const path = await saveDialog({ defaultPath: name })
  if (typeof path !== 'string' || !path) return false
  if (typeof content === 'string') {
    await api.writeTextFile(path, content)
  } else {
    await api.writeBinaryFile(path, new Uint8Array(await content.arrayBuffer()))
  }
  return true
}

function esc(v: string): string {
  const s = v.replace(/"/g, '""')
  return /[",\n\r]/.test(s) ? `"${s}"` : s
}

export type TableFmt = 'csv' | 'xlsx' | 'sql-both' | 'sql-ddl'

export async function exportTable(connId: string, table: string, fmt: TableFmt): Promise<void> {
  const store = useAppStore()
  if (fmt === 'sql-both' || fmt === 'sql-ddl') {
    const r = await api.exportTableSql(connId, table, fmt === 'sql-both')
    const ok = await saveOrDownload(`${table}${fmt === 'sql-ddl' ? '-schema' : ''}.sql`, r.sql)
    if (ok) window.$msg?.success(`已导出 SQL(${r.rows} 行数据)`)
    return
  }
  // CSV / Excel:前端取全量(上限 5 万行)
  const conn = store.connById(connId)
  const dbType: DbType = conn?.dbType ?? 'mysql'
  const q = dbType === 'mysql' ? '`' : '"'
  const qt = q + table.split(q).join(q + q) + q
  const rs = await api.runSql(connId, `SELECT * FROM ${qt} LIMIT 50000`, 50000)
  const r = rs[0]
  if (!r) throw new Error('导出失败')
  if (fmt === 'csv') {
    const text =
      '\uFEFF' +
      r.columns.map(esc).join(',') +
      '\n' +
      r.rows.map((row) => row.map((v) => esc(v ?? '')).join(',')).join('\n')
    const ok = await saveOrDownload(`${table}.csv`, text)
    if (ok) window.$msg?.success(`已导出 CSV(${r.rows.length} 行)`)
  } else {
    const { default: ExcelJS } = await import('exceljs')
    const wb = new ExcelJS.Workbook()
    const sheet = wb.addWorksheet(table.slice(0, 31))
    sheet.addRow(r.columns)
    for (const row of r.rows) {
      sheet.addRow(row.map((v) => (v === null ? null : /^\d+(\.\d+)?$/.test(v) ? Number(v) : v)))
    }
    const buf = await wb.xlsx.writeBuffer()
    const ok = await saveOrDownload(
      `${table}.xlsx`,
      new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    )
    if (ok) window.$msg?.success(`已导出 Excel(${r.rows.length} 行)`)
  }
}

export async function exportDatabase(connId: string, dbName: string, withData: boolean): Promise<void> {
  const store = useAppStore()
  const r = await api.exportDatabaseSql(connId, withData)
  const suffix = withData ? '' : '-schema'
  const ok = await saveOrDownload(`${dbName}${suffix}.sql`, r.sql)
  if (ok) window.$msg?.success(`已导出数据库 SQL(${r.rows} 行数据)`)
  void store
}

export async function importSqlFile(connId: string): Promise<void> {
  const store = useAppStore()
  if (!api.isTauri) {
    window.$msg?.info('导入 SQL 文件需要真实窗口(npm run tauri dev)')
    return
  }
  const path = await openDialog({
    title: '导入 SQL 文件',
    filters: [{ name: 'SQL', extensions: ['sql', 'txt'] }],
  })
  if (typeof path !== 'string' || !path) return
  const sql = await api.readTextFile(path)
  const rs = await api.runSql(connId, sql, 1)
  const affected = rs.reduce((n, r) => n + r.affected, 0)
  window.$msg?.success(`导入完成:${rs.length} 条语句,影响 ${affected} 行`)
  store.refreshTables(connId)
}
