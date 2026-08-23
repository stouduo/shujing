<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { NButton, NInput, NModal, NSelect, useMessage } from 'naive-ui'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { getTableStructure, isTauri, readBinaryFile, readTextFile, runSql } from '../api'
import { parseCsv, inferColumnType, sqlLiteral, csvQuoteIdent } from '../csv'
import { useAppStore } from '../stores/app'
import type { DbType } from '../types'
import Icon from './Icon.vue'
import ResultsGrid from './ResultsGrid.vue'

const props = defineProps<{ show: boolean; connId: string | null }>()
const emit = defineEmits<{ (e: 'update:show', v: boolean): void }>()

const store = useAppStore()
const message = useMessage()

const fileName = ref('')
const rows = ref<string[][]>([])
const hasHeader = ref(true)
const tableName = ref('')
const importing = ref(false)
const resultInfo = ref('')
const fileInput = ref<HTMLInputElement | null>(null)

// ── 追加模式 ──────────────────────────────────────────
const mode = ref<'create' | 'append'>('create')
const appendTable = ref<string | null>(null)
const targetCols = ref<string[]>([])

const tableOptions = computed(() =>
  (store.live[props.connId ?? '']?.tables ?? [])
    .filter((t) => t.kind === 'table')
    .map((t) => ({ label: t.name, value: t.name })),
)

watch(appendTable, async (t) => {
  targetCols.value = []
  if (!t || !props.connId) return
  try {
    const st = await getTableStructure(props.connId, t)
    targetCols.value = st.columns.map((c) => c.name)
  } catch {
    /* 拉不到列时按无匹配处理 */
  }
})

/** 追加模式下,CSV 列与目标表列的同名交集(按表列顺序) */
const matchedCols = computed<string[]>(() => {
  if (mode.value !== 'append' || !targetCols.value.length) return []
  const heads = new Set(header.value)
  return targetCols.value.filter((c) => heads.has(c))
})

const dbType = computed<DbType>(
  () => store.connById(props.connId ?? '')?.dbType ?? 'mysql',
)

const header = computed(() =>
  hasHeader.value && rows.value.length
    ? rows.value[0].map((h, i) => (h.trim() ? h.trim() : `col_${i + 1}`))
    : (rows.value[0] ?? []).map((_, i) => `col_${i + 1}`),
)

const dataRows = computed(() => (hasHeader.value ? rows.value.slice(1) : rows.value))

const previewResult = computed(() => ({
  columns: header.value,
  rows: dataRows.value.slice(0, 50).map((r) => r.map((v) => (v === '' ? null : v))),
  affected: 0,
  truncated: dataRows.value.length > 50,
  elapsedMs: 0,
}))

const colTypes = computed(() => {
  const n = header.value.length
  const types: string[] = []
  for (let i = 0; i < n; i++) {
    types.push(inferColumnType(dataRows.value.slice(0, 500).map((r) => r[i] ?? ''), dbType.value))
  }
  return types
})

function onFileChange(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0]
  if (!f) return
  if (/\.xlsx$/i.test(f.name)) {
    const reader = new FileReader()
    reader.onload = async () => {
      const rows = await parseXlsx(new Uint8Array(reader.result as ArrayBuffer))
      acceptRows(rows, f.name)
    }
    reader.readAsArrayBuffer(f)
  } else {
    const reader = new FileReader()
    reader.onload = () => {
      acceptCsv(String(reader.result ?? ''), f.name)
    }
    reader.readAsText(f)
  }
}

/** xlsx 首个工作表 → string[][] */
async function parseXlsx(data: Uint8Array): Promise<string[][]> {
  const { default: ExcelJS } = await import('exceljs')
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(data)
  const ws = wb.worksheets[0]
  if (!ws) return []
  const out: string[][] = []
  ws.eachRow((row) => {
    // values 为稀疏数组(1 起),每个 cell 转文本
    const vals = (row.values as unknown[]).slice(1)
    out.push(vals.map((v) => cellText(v)))
  })
  return out
}

function cellText(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'object') {
    const obj = v as Record<string, unknown>
    if ('richText' in obj) {
      return (obj.richText as { text: string }[]).map((r) => r.text).join('')
    }
    if ('result' in obj) return cellText(obj.result)
    if (obj instanceof Date) return obj.toISOString().slice(0, 19).replace('T', ' ')
    if ('text' in obj) return String(obj.text)
    return String(v)
  }
  return String(v)
}

function acceptRows(parsed: string[][], name: string) {
  rows.value = parsed
  fileName.value = name
  resultInfo.value = ''
  tableName.value = (name.replace(/\.[^.]+$/, '') || 'imported').replace(/[^\w]/g, '_')
  if (!parsed.length) message.warning('文件内容为空或无法解析')
}

async function pickFile() {
  if (isTauri) {
    try {
      const path = await openDialog({
        title: '选择 CSV 文件',
        filters: [{ name: '表格', extensions: ['csv', 'tsv', 'txt', 'xlsx'] }],
      })
      if (typeof path === 'string' && path) {
        const fname = path.split('/').pop() ?? 'data'
        if (/\.xlsx$/i.test(path)) {
          const bin = await readBinaryFile(path)
          const rows = await parseXlsx(new Uint8Array(bin))
          acceptRows(rows, fname)
        } else {
          const text = await readTextFile(path)
          acceptCsv(text, fname)
        }
      }
    } catch (e) {
      message.error(String(e))
    }
  } else {
    fileInput.value?.click()
  }
}

function acceptCsv(text: string, name: string) {
  rows.value = parseCsv(text)
  fileName.value = name
  resultInfo.value = ''
  tableName.value = (name.replace(/\.[^.]+$/, '') || 'imported').replace(/[^\w]/g, '_')
  if (!rows.value.length) message.warning('文件内容为空或无法解析')
}

async function doImport() {
  if (!props.connId) {
    message.error('缺少目标连接')
    return
  }
  if (!rows.value.length || !tableName.value.trim()) {
    message.warning('请先选择文件并填写表名')
    return
  }
  importing.value = true
  resultInfo.value = ''
  try {
    const connId = props.connId
    let insertCols: string[]
    let csvIdx: number[]
    if (mode.value === 'append') {
      if (!appendTable.value || !matchedCols.value.length) {
        message.warning('追加模式需要选择目标表且至少一列同名匹配')
        return
      }
      insertCols = matchedCols.value.map((c) => csvQuoteIdent(c, dbType.value))
      csvIdx = matchedCols.value.map((c) => header.value.indexOf(c))
    } else {
      // 建表
      const colDefs = header.value.map((h, i) => {
        let name = h
        if (/^\d/.test(name)) name = 'c_' + name
        return `${csvQuoteIdent(name, dbType.value)} ${colTypes.value[i]}`
      })
      const create = `CREATE TABLE ${csvQuoteIdent(tableName.value.trim(), dbType.value)} (\n  ${colDefs.join(',\n  ')}\n);`
      await runSql(connId, create, 1)
      insertCols = header.value.map((h) => (/^\d/.test(h) ? 'c_' + h : h)).map((h) => csvQuoteIdent(h, dbType.value))
      csvIdx = header.value.map((_, i) => i)
    }

    // 批量插入(500 行/批)
    const target = mode.value === 'append' ? appendTable.value! : tableName.value.trim()
    const cols = insertCols.join(', ')
    const BATCH = 500
    let done = 0
    for (let i = 0; i < dataRows.value.length; i += BATCH) {
      const chunk = dataRows.value.slice(i, i + BATCH)
      const values = chunk
        .map((r) => `(${csvIdx.map((ci) => sqlLiteral(r[ci] ?? '')).join(', ')})`)
        .join(',\n  ')
      await runSql(connId, `INSERT INTO ${csvQuoteIdent(target, dbType.value)} (${cols}) VALUES\n  ${values};`, 1)
      done += chunk.length
    }
    resultInfo.value =
      mode.value === 'append'
        ? `追加完成:表 ${target},写入 ${done} 行 × ${csvIdx.length} 列(同名匹配)`
        : `导入完成:表 ${target},${done} 行 × ${header.value.length} 列`
    message.success(`已导入 ${done} 行`)
    store.refreshTables(connId)
  } catch (e) {
    message.error(String(e))
    resultInfo.value = String(e)
  } finally {
    importing.value = false
  }
}
</script>

<template>
  <n-modal
    :show="props.show"
    preset="card"
    title="导入数据 (CSV / Excel)"
    :style="{ width: '760px' }"
    :mask-closable="!importing"
    @update:show="(v: boolean) => emit('update:show', v)"
  >
    <div class="imp-row">
      <n-button size="small" @click="pickFile" :loading="importing">
        <Icon name="download" :size="13" /> 选择文件
      </n-button>
      <span v-if="fileName" class="file-name mono">{{ fileName }}</span>
      <span v-else class="file-hint">支持 .csv / .tsv / .xlsx</span>
      <div class="gap" />
      <label class="hdr-check">
        <input v-model="hasHeader" type="checkbox" class="cb" /> 首行为表头
      </label>
    </div>
    <div class="imp-row">
      <span class="lbl">模式</span>
      <label class="mode-opt"><input v-model="mode" type="radio" value="create" class="cb" /> 新建表</label>
      <label class="mode-opt"><input v-model="mode" type="radio" value="append" class="cb" /> 追加到已有表</label>
    </div>
    <div class="imp-row">
      <template v-if="mode === 'create'">
        <span class="lbl">目标表名</span>
        <n-input v-model:value="tableName" size="small" class="tbl-name mono" placeholder="imported_data" />
        <span class="db-hint">{{ dbType }}</span>
      </template>
      <template v-else>
        <span class="lbl">目标表</span>
        <n-select
          v-model:value="appendTable"
          size="small"
          :options="tableOptions"
          placeholder="选择已有表"
          class="tbl-name"
        />
        <span v-if="appendTable" class="db-hint">
          <template v-if="matchedCols.length">匹配 {{ matchedCols.length }}/{{ header.length }} 列:{{ matchedCols.slice(0, 6).join(', ') }}{{ matchedCols.length > 6 ? '…' : '' }}</template>
          <template v-else-if="targetCols.length">没有同名列可匹配</template>
          <template v-else>读取表结构中…</template>
        </span>
      </template>
    </div>
    <div v-if="rows.length" class="preview">
      <div class="pv-head">
        预览(前 50 行,共 {{ dataRows.length.toLocaleString() }} 行)
        <span class="pv-types mono">{{ colTypes.join(' · ') }}</span>
      </div>
      <ResultsGrid
        class="pv-grid"
        :columns="previewResult.columns"
        :rows="previewResult.rows"
        :truncated="previewResult.truncated"
      />
    </div>
    <div v-if="resultInfo" class="result-line mono" :class="{ ok: resultInfo.startsWith('导入完成') }">
      {{ resultInfo }}
    </div>
    <template #footer>
      <div class="footer">
        <n-button size="small" :disabled="importing" @click="emit('update:show', false)">关闭</n-button>
        <n-button
          size="small"
          type="primary"
          :loading="importing"
          :disabled="!rows.length"
          @click="doImport"
        >
          <Icon name="save" :size="12" /> 开始导入
        </n-button>
      </div>
    </template>
    <input ref="fileInput" type="file" accept=".csv,.tsv,.txt,.xlsx" style="display: none" @change="onFileChange" />
  </n-modal>
</template>

<style scoped>
.imp-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}
.file-name {
  color: var(--text-secondary);
  font-size: 12px;
}
.file-hint {
  color: var(--text-tertiary);
  font-size: 12px;
}
.gap {
  flex: 1;
}
.hdr-check {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  color: var(--text-secondary);
  cursor: pointer;
  user-select: none;
}
.cb {
  accent-color: var(--accent);
}
.lbl {
  font-size: 12.5px;
  color: var(--text-secondary);
}
.mode-opt {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  color: var(--text-secondary);
  cursor: pointer;
  user-select: none;
}
.tbl-name {
  width: 240px;
}
.db-hint {
  font-size: 11px;
  color: var(--text-tertiary);
}
.preview {
  border: 1px solid var(--border-strong);
  border-radius: 10px;
  overflow: hidden;
  background: var(--bg-grid);
}
.pv-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 12px;
  font-size: 11.5px;
  color: var(--text-tertiary);
  background: #26262b;
  border-bottom: 1px solid var(--border);
}
.pv-types {
  margin-left: auto;
  font-size: 10.5px;
  opacity: 0.8;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 400px;
}
.pv-grid {
  height: 220px;
}
.result-line {
  margin-top: 10px;
  padding: 8px 12px;
  border-radius: 8px;
  font-size: 12px;
  background: rgba(255, 69, 58, 0.1);
  border: 1px solid rgba(255, 69, 58, 0.25);
  color: #ff8a80;
  word-break: break-all;
}
.result-line.ok {
  background: rgba(48, 209, 88, 0.1);
  border-color: rgba(48, 209, 88, 0.25);
  color: #7ce8a4;
}
.footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
