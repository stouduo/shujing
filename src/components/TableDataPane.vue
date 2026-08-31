<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { NButton, NInput, NPopover, NSelect, NSpin, useMessage } from 'naive-ui'
import { save as saveDialog } from '@tauri-apps/plugin-dialog'
import * as api from '../api'
import { exportTableSql, isTauri, writeTextFile } from '../api'
import { exportFileName } from '../filename'
import { useAppStore } from '../stores/app'
import type { TableTab } from '../types'
import ResultsGrid from './ResultsGrid.vue'
import ResultActions from './ResultActions.vue'
import RecordPanel from './RecordPanel.vue'
import AddRowsModal from './AddRowsModal.vue'
import Icon from './Icon.vue'

// 隐藏实例:承载勾选行导出(通过 ref 调用其导出方法)

const props = defineProps<{ tab: TableTab }>()
const store = useAppStore()
const message = useMessage()

// 行选中(记录详情);数据变化/翻页后失效
const selectedRow = ref<number | null>(null)
watch(
  () => [props.tab.result, props.tab.page] as const,
  () => {
    selectedRow.value = null
  },
)

// ── 筛选 ──────────────────────────────────────────────
const showFilterBar = ref(false)
watch(
  () => props.tab.filters.length,
  (n) => {
    if (n > 0) showFilterBar.value = true
  },
  { immediate: true },
)

const colOptions = computed(() =>
  (props.tab.result?.columns ?? []).map((c) => ({ label: c, value: c })),
)

const opOptions = [
  { label: '=', value: '=' },
  { label: '≠', value: '<>' },
  { label: '>', value: '>' },
  { label: '<', value: '<' },
  { label: '≥', value: '>=' },
  { label: '≤', value: '<=' },
  { label: 'LIKE', value: 'LIKE' },
  { label: 'IS NULL', value: 'IS NULL' },
  { label: 'IS NOT NULL', value: 'IS NOT NULL' },
]

const exporting = ref(false)
const showAddModal = ref(false)

// ── 列显示选择(实际状态由 ResultsGrid 内部管理并持久化) ──
const gridRef = ref<InstanceType<typeof ResultsGrid> | null>(null)

// ⌘F 结果搜索
onMounted(() => {
  window.addEventListener('result-search', () => gridRef.value?.openSearch())
})

// 行高:紧凑/舒适(按表记忆)
const rowhKey = computed(() => `dblens_rowh:${props.tab.connId ?? ''}/${props.tab.table}`)
const rowHeight = ref<'compact' | 'cozy'>(
  localStorage.getItem(rowhKey.value) === 'compact' ? 'compact' : 'cozy',
)

function toggleRowHeight() {
  rowHeight.value = rowHeight.value === 'cozy' ? 'compact' : 'cozy'
  localStorage.setItem(rowhKey.value, rowHeight.value)
}

const checkedN = computed(() => Object.keys(props.tab.checkedRows).length)

// ── 勾选行导出:构造勾选子集,复用 ResultActions 的导出实现 ──
const checkedExportRef = ref<InstanceType<typeof ResultActions> | null>(null)
const checkedResult = computed(() => {
  if (!props.tab.result || !checkedN.value) return null
  const idxs = Object.keys(props.tab.checkedRows)
    .map(Number)
    .sort((a, b) => a - b)
  const rows = idxs.map((i) => props.tab.result!.rows[i]).filter((r) => !!r)
  if (!rows.length) return null
  return { ...props.tab.result, rows }
})
function exportChecked(fmt: 'csv' | 'xlsx') {
  if (!checkedResult.value) {
    message.warning('请先勾选要导出的行')
    return
  }
  checkedExportRef.value?.[fmt === 'csv' ? 'exportCsv' : 'exportXlsx']()
}

function copyCheckedInsert() {
  const t = props.tab
  if (!t.result) return
  const mysql = store.connById(t.connId ?? '')?.dbType === 'mysql'
  const q = mysql ? '`' : '"'
  const qi = (x: string) => q + x.split(q).join(q + q) + q
  const lit = (v: string | null) => (v === null ? 'NULL' : `'${v.replace(/'/g, "''")}'`)
  const stmts = Object.keys(t.checkedRows)
    .map(Number)
    .sort((a, b) => a - b)
    .map((r) => {
      const row = t.result!.rows[r]
      if (!row) return ''
      return `INSERT INTO ${qi(t.table)} (${t.result!.columns.map(qi).join(', ')}) VALUES (${row
        .map(lit)
        .join(', ')});`
    })
    .filter(Boolean)
  navigator.clipboard
    .writeText(stmts.join('\n'))
    .then(() => message.success(`已复制 ${stmts.length} 条 INSERT`))
    .catch(() => message.error('剪贴板不可用'))
}

async function exportSql() {
  if (!props.tab.connId) return
  if (!isTauri) {
    message.info('导出 SQL 文件需要真实窗口(npm run tauri dev)')
    return
  }
  try {
    const path = await saveDialog({
      title: '导出表为 SQL',
      defaultPath: exportFileName(props.tab.table, 'sql'),
      filters: [{ name: 'SQL', extensions: ['sql'] }],
    })
    if (typeof path === 'string' && path) {
      exporting.value = true
      const r = await exportTableSql(props.tab.connId, props.tab.table, true)
      await writeTextFile(path, r.sql)
      message.success(`已导出 ${r.rows.toLocaleString()} 行 → ${path}`)
    }
  } catch (e) {
    message.error(String(e))
  } finally {
    exporting.value = false
  }
}

const totalPages = computed(() => {
  if (props.tab.total == null) return null
  return Math.max(1, Math.ceil(props.tab.total / props.tab.pageSize))
})

const rangeText = computed(() => {
  const t = props.tab
  if (!t.result || t.result.columns.length === 0) return ''
  const from = (t.page - 1) * t.pageSize + 1
  const to = (t.page - 1) * t.pageSize + t.result.rows.length
  return `${from}-${to}`
})

const counts = computed(() => store.changeCount(props.tab.id))
const hasChanges = computed(() => counts.value.edits > 0 || counts.value.deletes > 0)
const isReadOnlyConn = computed(() => !!store.connById(props.tab.connId ?? '')?.readOnly)
const editable = computed(() => props.tab.pkCols.length > 0 && !isReadOnlyConn.value)

const pageSizeOptions = [
  { label: '50 行/页', value: 50 },
  { label: '100 行/页', value: 100 },
  { label: '500 行/页', value: 500 },
  { label: '1000 行/页', value: 1000 },
]

function refresh() {
  store.loadTableData(props.tab.id)
  store.loadTableCount(props.tab.id)
}

function openStructure() {
  if (props.tab.connId) store.openStructure(props.tab.connId, props.tab.table)
}

// ── 筛选值候选(该列 DISTINCT) ──────────────────────
const distinctCache = new Map<string, string[]>()

async function loadDistinct(col: string): Promise<string[]> {
  if (distinctCache.has(col)) return distinctCache.get(col)!
  if (!props.tab.connId || !props.tab.result) return []
  const conn = store.connById(props.tab.connId)
  if (!conn) return []
  try {
    const { quoteIdent: q } = await import('../stores/helpers')
    const rs = await api.runSql(
      props.tab.connId,
      `SELECT DISTINCT ${q(col, conn.dbType)} FROM ${q(props.tab.table, conn.dbType)} WHERE ${q(col, conn.dbType)} IS NOT NULL LIMIT 300`,
      300,
    )
    const vals = (rs[0]?.rows ?? []).map((r) => r[0]).filter((v): v is string => v !== null)
    distinctCache.set(col, vals)
    return vals
  } catch {
    return []
  }
}

const filterOptions = ref<Record<number, string[]>>({})

async function onFilterColChange(i: number) {
  const f = props.tab.filters[i]
  if (!f?.column) return
  if (!filterOptions.value[i]?.length) {
    filterOptions.value[i] = await loadDistinct(f.column)
  }
}

// ── 外键候选值(编辑 FK 列时 datalist 提示) ──────────
const fkCache = new Map<string, string[]>()

async function loadFkOptions(col: string): Promise<string[]> {
  const cached = fkCache.get(col)
  if (cached) return cached
  const fk = props.tab.fks.find((f) => f.column === col)
  if (!fk || !props.tab.connId) return []
  const conn = store.connById(props.tab.connId)
  if (!conn) return []
  try {
    const { quoteIdent: q } = await import('../stores/helpers')
    const rs = await api.runSql(
      props.tab.connId,
      `SELECT DISTINCT ${q(fk.refColumn, conn.dbType)} FROM ${q(fk.refTable, conn.dbType)} LIMIT 500`,
      500,
    )
    const vals = (rs[0]?.rows ?? []).map((r) => r[0]).filter((v): v is string => v !== null)
    fkCache.set(col, vals)
    return vals
  } catch {
    return []
  }
}

/** 列头右键:按列填充筛选条件 */
function onFilterValue(col: string, value: string) {
  showFilterBar.value = true
  props.tab.filters.push({ column: col, op: '=', value })
  store.applyFilters(props.tab.id)
}

function onFilterCol(col: string, op = '=') {
  showFilterBar.value = true
  props.tab.filters.push({ column: col, op, value: '' })
  onFilterColChange(props.tab.filters.length - 1)
  if (op.includes('NULL')) store.applyFilters(props.tab.id)
}
</script>

<template>
  <div class="pane-root">
    <div class="toolbar" data-tauri-drag-region>
      <span class="table-name mono" :title="tab.table">
        <Icon name="table" :size="13" class="table-ic" /> {{ tab.table }}
      </span>
      <div class="seg-group">
        <n-button size="small" quaternary title="刷新 (F5)" @click="refresh">
          <Icon name="refresh" :size="13" />
        </n-button>
        <n-button size="small" quaternary title="查看表结构" @click="openStructure">
          <Icon name="list" :size="13" /> 结构
        </n-button>
        <n-button
          size="small"
          quaternary
          :title="rowHeight === 'cozy' ? '切换紧凑行高(24px)' : '切换舒适行高(28px)'"
          @click="toggleRowHeight"
        >
          {{ rowHeight === 'cozy' ? '舒适' : '紧凑' }}
        </n-button>
        <n-button
          v-if="editable"
          size="small"
          quaternary
          title="快速添加:在表格第一行插入,填值后随保存更改一起 INSERT"
          @click="store.addNewRow(tab.id)"
        >
          <Icon name="plusCircle" :size="13" /> 快速添加
        </n-button>
        <n-button
          size="small"
          quaternary
          :disabled="!tab.connId"
          title="弹窗添加:支持表单 / CSV / JSON,可批量插入"
          @click="showAddModal = true"
        >
          <Icon name="plus" :size="13" /> 添加
        </n-button>
        <n-button
          size="small"
          quaternary
          :title="tab.filters.length ? `编辑筛选(当前 ${tab.filters.length} 个条件)` : '添加筛选条件'"
          :class="{ 'filter-on': tab.filters.length > 0 }"
          @click="showFilterBar = !showFilterBar"
        >
          <Icon name="search" :size="13" /> 筛选
        </n-button>
        <n-popover trigger="click" placement="bottom-end" :show-arrow="false">
          <template #trigger>
            <n-button size="small" quaternary title="选择显示的列">
              <Icon name="list" :size="13" /> 列
            </n-button>
          </template>
          <div class="col-picker">
            <div class="cp-item" @click="gridRef?.toggleRowNum()">
              <span class="cp-mark">{{ gridRef?.hideRowNum ? '○' : '✓' }}</span># 行号
            </div>
            <div
              v-for="c in tab.result?.columns ?? []"
              :key="c"
              class="cp-item mono"
              @click="gridRef?.toggleCol(c)"
            >
              <span class="cp-mark">{{ gridRef?.hiddenCols?.includes(c) ? '○' : '✓' }}</span>{{ c }}
            </div>
            <div class="cp-all" @click="gridRef?.showAll()">全部显示</div>
          </div>
        </n-popover>
        <n-button size="small" quaternary :loading="exporting" title="整表导出为 SQL INSERT 文件" @click="exportSql">
          <Icon name="download" :size="13" />
        </n-button>
      </div>
      <span v-if="!editable" class="readonly" :title="isReadOnlyConn ? '只读连接:所有写入被拦截' : '没有主键的表无法定位行,仅支持只读浏览'">
        {{ isReadOnlyConn ? '只读连接' : '只读(无主键)' }}
      </span>
      <div class="spacer" data-tauri-drag-region />
      <span v-if="tab.total !== null" class="total">共 {{ tab.total.toLocaleString() }} 行</span>
    </div>
    <div v-if="showFilterBar" class="filter-bar">
      <!-- 顶行:模式切换 + 操作 -->
      <div class="fb-top">
        <div class="fb-modes">
          <button
            class="fb-mode"
            :class="{ on: tab.filterMode === 'fields' }"
            @click="tab.filterMode = 'fields'"
          >字段</button>
          <button
            class="fb-mode"
            :class="{ on: tab.filterMode === 'free' }"
            @click="tab.filterMode = 'free'"
          >自由</button>
        </div>
        <template v-if="tab.filterMode === 'fields'">
          <n-button size="tiny" quaternary @click="store.addFilter(tab.id)">＋ 添加条件</n-button>
          <n-button v-if="tab.filters.length" size="tiny" quaternary @click="store.clearFilters(tab.id)">
            清除全部
          </n-button>
          <n-button
            v-if="tab.filters.length"
            size="tiny"
            type="primary"
            secondary
            :loading="tab.loading"
            @click="store.applyFilters(tab.id)"
          >
            应用
          </n-button>
        </template>
        <template v-else>
          <n-button size="tiny" type="primary" secondary :loading="tab.loading" @click="store.applyFilters(tab.id)">应用</n-button>
          <n-button size="tiny" quaternary @click="() => { tab.freeWhere = ''; store.applyFilters(tab.id) }">清除</n-button>
        </template>
        <span class="f-count" v-if="tab.total !== null">匹配 {{ tab.total.toLocaleString() }} 行</span>
        <button class="f-close" title="收起筛选栏" @click="showFilterBar = false">×</button>
      </div>
      <!-- 条件区:每个条件独占一行;自由模式为多行编辑 -->
      <div v-if="tab.filterMode === 'fields' && tab.filters.length" class="fb-rows">
        <div v-for="(f, i) in tab.filters" :key="i" class="filter-row">
          <n-select
            v-model:value="f.column"
            size="tiny"
            :options="colOptions"
            class="f-col"
            placeholder="列"
            @update:value="onFilterColChange(i)"
          />
          <n-select
            v-model:value="f.op"
            size="tiny"
            :options="opOptions"
            class="f-op"
            @update:value="f.op.includes('NULL') && store.applyFilters(tab.id)"
          />
          <n-input
            v-if="!f.op.includes('NULL')"
            v-model:value="f.value"
            size="tiny"
            placeholder="值,回车应用"
            class="f-val mono"
            :list="'fv-opts-' + i"
            @keyup.enter="store.applyFilters(tab.id)"
            @blur="store.applyFilters(tab.id)"
          >
            <template v-if="filterOptions[i]?.length" #suffix>
              <datalist :id="'fv-opts-' + i">
                <option v-for="o in filterOptions[i].slice(0, 100)" :key="o" :value="o" />
              </datalist>
            </template>
          </n-input>
          <span v-else class="f-null-hint">无需值</span>
          <button class="f-del" title="移除该条件" @click="store.removeFilter(tab.id, i)">×</button>
        </div>
      </div>
      <div v-else-if="tab.filterMode === 'free'" class="fb-free">
        <n-input
          v-model:value="tab.freeWhere"
          type="textarea"
          class="f-free mono"
          placeholder="WHERE 之后的 SQL,如:age > 25 AND city = '北京'(⌘↵ 应用)"
          :autosize="{ minRows: 3, maxRows: 6 }"
          @keydown.enter.exact.prevent="store.applyFilters(tab.id)"
        />
      </div>
    </div>
    <div class="grid-area">
      <n-spin v-if="tab.loading && !tab.result" class="loading" size="medium" />
      <div v-else-if="tab.error" class="err mono">{{ tab.error }}</div>
      <template v-else-if="tab.result && tab.result.columns.length">
        <div class="grid panel">
          <ResultsGrid
            :columns="tab.result.columns"
            :rows="tab.result.rows"
            :truncated="false"
            :sortable="true"
            :sort-key="tab.orderKey"
            :sort-dir="tab.orderDir"
            :editable="editable"
            :changes="tab.changes"
            :deleted-rows="tab.deletedRows"
            :new-rows="tab.newRows"
            :selected-row="selectedRow"
            ref="gridRef"
            :fk-loader="loadFkOptions"
            :checked-rows="tab.checkedRows"
            :table-name="tab.table"
            :col-width-key="`${tab.connId}/${tab.table}`"
            :mysql-dialect="store.connById(tab.connId ?? '')?.dbType === 'mysql'"
            :row-height="rowHeight"
            :col-comments="tab.colComments ?? {}"
            @sort="(col: string, dir?: 'asc' | 'desc' | null) => store.sortTable(tab.id, col, dir)"
            @cell-change="(r: number, c: string, v: string | null) => store.setCellChange(tab.id, r, c, v)"
            @delete-row="(r: number) => store.deleteRow(tab.id, r)"
            @insert-change="(i: number, c: string, v: string) => store.setInsertChange(tab.id, i, c, v)"
            @remove-insert="(i: number) => store.removeInsertRow(tab.id, i)"
            @select-row="(r: number) => (selectedRow = selectedRow === r ? null : r)"
            @filter-col="(c: string, op?: string) => onFilterCol(c, op ?? '=')"
            @check-row="(r: number, v: boolean) => store.toggleCheck(tab.id, r, v)"
            @check-page="(all: boolean) => store.checkPage(tab.id, all)"
            @copy-row="(r: number) => store.copyRowToNew(tab.id, r)"
            @filter-value="(c: string, v: string) => onFilterValue(c, v)"
            @batch-committed="() => store.saveChanges(tab.id)"
          />
        </div>
        <RecordPanel
          v-if="selectedRow !== null && tab.result && tab.result.rows[selectedRow]"
          :columns="tab.result.columns"
          :rows="tab.result.rows"
          :row-index="selectedRow"
          :global-no="(tab.page - 1) * tab.pageSize + selectedRow + 1"
          :changes="tab.changes"
          @close="selectedRow = null"
        />
      </template>
      <div v-else class="empty">暂无数据</div>
    </div>
    <div v-if="checkedN > 0" class="checked-bar">
      <span class="ck-info">已勾选 <b>{{ checkedN }}</b> 行</span>
      <n-button size="tiny" quaternary @click="store.copyCheckedToNew(tab.id)">
        <Icon name="copy" :size="12" /> 复制为新行
      </n-button>
      <n-button size="tiny" quaternary title="勾选行生成 INSERT 语句到剪贴板" @click="copyCheckedInsert">
        <Icon name="code" :size="12" /> 复制 INSERT
      </n-button>
      <n-button size="tiny" quaternary @click="store.deleteChecked(tab.id)">
        <Icon name="trash" :size="12" /> 标记删除
      </n-button>
      <n-button size="tiny" quaternary @click="store.checkPage(tab.id, false)">取消全选</n-button>
      <n-button size="tiny" quaternary title="将勾选行导出为 CSV 文件" @click="exportChecked('csv')">导出 CSV</n-button>
      <n-button size="tiny" quaternary title="将勾选行导出为 Excel 文件" @click="exportChecked('xlsx')">导出 Excel</n-button>
      <div class="f-spacer" />
    </div>
    <div v-if="hasChanges" class="changes-bar">
      <span class="changes-info">
        <b>{{ counts.edits }}</b> 处修改 · <b>{{ counts.deletes }}</b> 行待删除<template v-if="counts.inserts"> · <b>{{ counts.inserts }}</b> 行待插入</template>(未保存)
      </span>
      <div class="spacer" />
      <n-button size="tiny" quaternary @click="store.discardChanges(tab.id)">
        <Icon name="undo" :size="12" /> 放弃更改
      </n-button>
      <n-button
        size="tiny"
        type="primary"
        :loading="tab.loading"
        @click="store.saveChanges(tab.id)"
      >
        <Icon name="save" :size="12" /> 保存更改
      </n-button>
    </div>
    <AddRowsModal
      v-model:show="showAddModal"
      :conn-id="tab.connId"
      :table="tab.table"
    />
    <!-- 勾选行导出的隐藏驱动实例 -->
    <div v-show="false" aria-hidden="true">
      <ResultActions v-if="checkedResult" ref="checkedExportRef" :result="checkedResult" :base-name="tab.table" />
    </div>
    <div class="pager">
      <div class="pager-left">
        <n-select
          :value="tab.pageSize"
          size="tiny"
          :options="pageSizeOptions"
          class="page-size"
          @update:value="(v: number) => store.setTablePageSize(tab.id, v)"
        />
        <span v-if="rangeText" class="range">第 {{ rangeText }} 行</span>
      </div>
      <div v-if="tab.result && tab.result.rows.length" class="pager-mid">
        <span class="ra-label">导出:</span>
        <ResultActions :result="tab.result" :base-name="tab.table" />
      </div>
      <div class="pager-right">
        <n-button
          size="tiny"
          quaternary
          :disabled="tab.page <= 1 || tab.loading"
          @click="store.setTablePage(tab.id, tab.page - 1)"
        >
          ‹ 上一页
        </n-button>
        <span class="page-no">
          第 {{ tab.page }} 页<template v-if="totalPages"> / {{ totalPages }}</template>
        </span>
        <n-button
          size="tiny"
          quaternary
          :disabled="
            tab.loading ||
            (totalPages !== null && tab.page >= totalPages) ||
            (tab.result !== null && tab.result.rows.length < tab.pageSize)
          "
          @click="store.setTablePage(tab.id, tab.page + 1)"
        >
          下一页 ›
        </n-button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.pane-root {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 42px;
  padding: 0 10px;
  background: var(--bg-elevated);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.table-name {
  font-size: 13px;
  font-weight: 600;
  max-width: 280px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.table-ic {
  color: var(--accent);
  opacity: 0.85;
}
.readonly {
  font-size: 11px;
  color: var(--warn);
  padding: 2px 8px;
  border: 1px solid rgba(255, 214, 10, 0.3);
  border-radius: 5px;
}
.filter-on {
  color: var(--accent) !important;
}
.fb-modes {
  display: inline-flex;
  border: 1px solid var(--border-strong);
  border-radius: 7px;
  overflow: hidden;
  flex-shrink: 0;
}
.fb-mode {
  padding: 3px 12px;
  border: none;
  background: transparent;
  color: var(--text-tertiary);
  font-size: 11.5px;
  cursor: pointer;
}
.fb-mode.on {
  background: var(--bg-active);
  color: var(--text);
  font-weight: 600;
}
.f-free {
  flex: 1;
  min-width: 260px;
}
.col-picker {
  max-height: 300px;
  overflow-y: auto;
  min-width: 170px;
  padding: 4px;
}
.cp-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  border-radius: 6px;
  font-size: 12px;
  color: var(--text-secondary);
  cursor: pointer;
}
.cp-item:hover {
  background: var(--bg-hover);
  color: var(--text);
}
.cp-mark {
  width: 14px;
  color: var(--accent);
  font-size: 11px;
}
.cp-all {
  margin-top: 4px;
  padding: 5px 8px;
  border-top: 1px solid var(--border);
  font-size: 11.5px;
  color: var(--accent);
  cursor: pointer;
}
.checked-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 36px;
  padding: 0 12px;
  background: rgba(133, 135, 246, 0.08);
  border-top: 1px solid rgba(133, 135, 246, 0.25);
  flex-shrink: 0;
}
.ck-info {
  font-size: 12px;
  color: var(--accent);
}
.ck-info b {
  font-weight: 700;
}
.filter-bar {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px 12px;
  background: var(--bg-elevated);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.fb-top {
  display: flex;
  align-items: center;
  gap: 8px;
}
.fb-rows {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.fb-free {
  display: flex;
}
.filter-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.f-col {
  width: 150px;
}
.f-op {
  width: 108px;
}
.f-val {
  width: 180px;
}
.f-null-hint {
  font-size: 11px;
  color: var(--text-tertiary);
  width: 180px;
}
.f-del {
  width: 20px;
  height: 20px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
}
.f-del:hover {
  color: var(--danger);
  background: var(--bg-active);
}
.filter-ops {
  display: flex;
  align-items: center;
  gap: 4px;
}
.f-count {
  font-size: 11.5px;
  color: var(--accent);
  font-variant-numeric: tabular-nums;
}
.f-spacer {
  flex: 1;
}
.f-close {
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--text-tertiary);
  font-size: 14px;
  cursor: pointer;
}
.f-close:hover {
  color: var(--text);
  background: var(--bg-active);
}
.spacer {
  flex: 1;
  height: 100%;
}
.total {
  color: var(--text-tertiary);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.grid-area {
  flex: 1;
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: row;
  gap: 10px;
  padding: 10px 12px;
  position: relative;
}
.grid.panel {
  position: relative;
  flex: 1;
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border-strong);
  border-radius: 10px;
  overflow: hidden;
  background: var(--bg-grid);
  box-shadow:
    var(--panel-inset),
    var(--panel-shadow);
}
.pager-mid {
  display: flex;
  align-items: center;
  gap: 4px;
}
.ra-label {
  font-size: 11.5px;
  color: var(--text-tertiary);
  white-space: nowrap;
  margin-right: 2px;
}
.loading {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}
.err {
  flex: 1;
  margin: 4px;
  padding: 10px 14px;
  border-radius: 10px;
  background: rgba(255, 69, 58, 0.1);
  border: 1px solid rgba(255, 69, 58, 0.25);
  color: #ff8a80;
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-all;
}
.empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-tertiary);
}
.changes-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 36px;
  padding: 0 12px;
  background: rgba(255, 170, 0, 0.07);
  border-top: 1px solid rgba(255, 170, 0, 0.25);
  flex-shrink: 0;
  animation: slide-up 0.18s ease;
}
@keyframes slide-up {
  from {
    transform: translateY(6px);
    opacity: 0;
  }
}
.changes-info {
  color: #ffd08a;
  font-size: 12px;
}
.changes-info b {
  font-weight: 700;
}
.pager {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 40px;
  padding: 0 12px;
  background: var(--bg-elevated);
  border-top: 1px solid var(--border);
  flex-shrink: 0;
}
.pager-left {
  display: flex;
  align-items: center;
  gap: 12px;
}
.page-size {
  width: 110px;
}
.range {
  color: var(--text-tertiary);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.pager-right {
  display: flex;
  align-items: center;
  gap: 8px;
}
.page-no {
  color: var(--text-secondary);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  padding: 0 4px;
}
</style>
