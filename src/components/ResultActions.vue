<script setup lang="ts">
import { excelCell } from '../stores/helpers'
import { NButton, useMessage } from 'naive-ui'
import { save as saveDialog } from '@tauri-apps/plugin-dialog'
import { isTauri, writeBinaryFile, writeTextFile } from '../api'
import { exportFileName } from '../filename'
import type { ExecResult } from '../types'

const props = defineProps<{
  result: ExecResult
  /** 导出文件名基础名 */
  baseName?: string
  /** 生成 INSERT 时的表名(可选) */
  tableName?: string
}>()

const message = useMessage()

function esc(v: string | null): string {
  if (v === null) return ''
  const s = v.replace(/"/g, '""')
  return /[",\n\r]/.test(s) ? `"${s}"` : s
}

function toCsv(): string {
  const head = props.result.columns.map(esc).join(',')
  const body = props.result.rows.map((r) => r.map(esc).join(',')).join('\n')
  // BOM 头:Excel 直接打开不乱码
  return '\uFEFF' + head + '\n' + body
}

function toTsv(): string {
  return (
    props.result.columns.join('\t') +
    '\n' +
    props.result.rows.map((r) => r.map((v) => (v ?? '').replace(/[\t\r\n]/g, ' ')).join('\t')).join('\n')
  )
}

function toJson(): string {
  const cols = props.result.columns
  return JSON.stringify(
    props.result.rows.map((r) => Object.fromEntries(cols.map((c, i) => [c, r[i]]))),
    null,
    2,
  )
}

function toInsertSql(): string {
  const tn = props.tableName ?? 'exported_table'
  const lit = (v: string | null) => (v === null ? 'NULL' : `'${v.replace(/'/g, "''")}'`)
  const cols = props.result.columns.map((c) => `"${c}"`).join(', ')
  return props.result.rows
    .map((r) => `INSERT INTO ${tn} (${cols}) VALUES (${r.map(lit).join(', ')});`)
    .join('\n')
}

function toMarkdown(): string {
  const cols = props.result.columns
  const line = (cells: (string | null)[]) => `| ${cells.map((c) => c ?? '').join(' | ')} |`
  return [
    line(cols),
    `| ${cols.map(() => '---').join(' | ')} |`,
    ...props.result.rows.map(line),
  ].join('\n')
}

async function copy(kind: 'csv' | 'tsv' | 'json' | 'md' | 'sql') {
  const text =
    kind === 'csv'
      ? toCsv()
      : kind === 'tsv'
        ? toTsv()
        : kind === 'json'
          ? toJson()
          : kind === 'sql'
            ? toInsertSql()
            : toMarkdown()
  try {
    await navigator.clipboard.writeText(text)
    message.success(`已复制 ${kind.toUpperCase()}(${props.result.rows.length} 行)`)
  } catch {
    message.error('剪贴板不可用')
  }
}

async function exportXlsx() {
  const { default: ExcelJS } = await import('exceljs')
  const wb = new ExcelJS.Workbook()
  const sheet = wb.addWorksheet('data')
  sheet.addRow(props.result.columns)
  for (const r of props.result.rows) {
    sheet.addRow(r.map(excelCell))
  }
  // 表头加粗 + 列宽按内容自适应(采样前 300 行)
  sheet.getRow(1).font = { bold: true }
  sheet.getRow(1).height = 20
  props.result.columns.forEach((c, i) => {
    const sample = props.result.rows.slice(0, 300).map((r) => (r[i] ?? '').length)
    const maxLen = Math.max(c.length, ...(sample.length ? sample : [6]))
    sheet.getColumn(i + 1).width = Math.min(60, Math.max(10, maxLen + 2))
  })
  const buf = await wb.xlsx.writeBuffer()
  const u8 = new Uint8Array(buf)
  if (!isTauri) {
    // 浏览器预览:直接触发下载
    const name = exportFileName(props.baseName, 'xlsx')
    const url = URL.createObjectURL(new Blob([u8], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
    const a = document.createElement('a')
    a.href = url
    a.download = name
    a.click()
    URL.revokeObjectURL(url)
    message.success(`已下载 ${name}(${props.result.rows.length} 行)`)
    return
  }
  try {
    const path = await saveDialog({
      title: '导出 Excel',
      defaultPath: exportFileName(props.baseName, 'xlsx'),
      filters: [{ name: 'Excel', extensions: ['xlsx'] }],
    })
    if (typeof path === 'string' && path) {
      await writeBinaryFile(path, u8)
      message.success(`已导出: ${path}`)
    }
  } catch (e) {
    message.error(String(e))
  }
}

async function exportCsv() {
  const text = toCsv()
  if (!isTauri) {
    try {
      await navigator.clipboard.writeText(text)
      message.info('预览模式:已将 CSV 复制到剪贴板')
    } catch {
      message.error('导出不可用')
    }
    return
  }
  try {
    const path = await saveDialog({
      title: '导出 CSV',
      defaultPath: exportFileName(props.baseName, 'csv'),
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    })
    if (typeof path === 'string' && path) {
      await writeTextFile(path, text)
      message.success(`已导出: ${path}`)
    }
  } catch (e) {
    message.error(String(e))
  }
}

defineExpose({ exportCsv, exportXlsx })
</script>

<template>
  <div class="actions">
    <n-button size="tiny" quaternary title="复制为 CSV" @click="copy('csv')">CSV</n-button>
    <n-button size="tiny" quaternary title="复制为 TSV(可直接粘贴到 Excel)" @click="copy('tsv')">TSV</n-button>
    <n-button size="tiny" quaternary title="复制为 JSON" @click="copy('json')">JSON</n-button>
    <n-button size="tiny" quaternary title="复制为 Markdown 表格" @click="copy('md')">MD</n-button>
    <n-button size="tiny" quaternary title="复制为 INSERT 语句" @click="copy('sql')">SQL</n-button>
    <n-button size="tiny" quaternary title="导出 Excel (xlsx)" @click="exportXlsx">XLSX</n-button>
    <n-button size="tiny" quaternary title="导出 CSV 文件" @click="exportCsv">导出</n-button>
  </div>
</template>

<style scoped>
.actions {
  display: flex;
  gap: 2px;
}
</style>
