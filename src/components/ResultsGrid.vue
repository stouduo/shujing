<script setup lang="ts">
import { computed, nextTick, ref, toRef, watch } from 'vue'
import { NButton, NDropdown, NInput, NModal, useMessage } from 'naive-ui'
import { useColumnLayout } from '../composables/useColumnLayout'
import { useVirtualScroll } from '../composables/useVirtualScroll'
import { useCellEditing } from '../composables/useCellEditing'
import { useContextMenus } from '../composables/useContextMenus'
import type { OrderDir } from '../types'

const props = defineProps<{
  columns: string[]
  rows: (string | null)[][]
  truncated: boolean
  sortable?: boolean
  sortKey?: string | null
  sortDir?: OrderDir
  /** 可编辑模式:显示行号/删除列,双击编辑单元格 */
  editable?: boolean
  /** 未保存变更:行号 → 列 → 新值 */
  changes?: Record<number, Record<string, string | null>>
  deletedRows?: Record<number, unknown>
  /** 待插入的新行:列 → 值 */
  newRows?: Record<string, string>[]
  /** 当前选中行(绝对行号) */
  selectedRow?: number | null
  /** 外键列候选值加载器 */
  fkLoader?: (col: string) => Promise<string[]>
  /** 隐藏列(初始值,内部状态持久化后自行管理) */
  hiddenCols?: string[]
  /** 隐藏 # 行号列(初始值) */
  hideRowNum?: boolean
  /** 勾选行(绝对行号) */
  checkedRows?: Record<number, true>
  /** 表名(用于生成 INSERT 语句) */
  tableName?: string
  /** 行高模式 */
  rowHeight?: 'compact' | 'cozy'
  /** 列宽持久化键(如 connId/table),提供则记忆列宽 */
  colWidthKey?: string
  /** MySQL 方言(反引号) */
  mysqlDialect?: boolean
  /** 列注释(列头悬停提示) */
  colComments?: Record<string, string>
}>()

const emit = defineEmits<{
  (e: 'sort', col: string, dir?: 'asc' | 'desc' | null): void
  (e: 'cell-change', rowIndex: number, col: string, value: string | null): void
  (e: 'delete-row', rowIndex: number): void
  (e: 'insert-change', idx: number, col: string, value: string): void
  (e: 'remove-insert', idx: number): void
  (e: 'select-row', rowIndex: number): void
  (e: 'filter-col', col: string, op?: string): void
  (e: 'filter-value', col: string, value: string): void
  (e: 'check-row', rowIndex: number, val: boolean): void
  (e: 'check-page', all: boolean): void
  (e: 'copy-row', rowIndex: number): void
  (e: 'batch-set', col: string, value: string | null): void
}>()

const message = useMessage()

const ROW_H = computed(() => (props.rowHeight === 'compact' ? 24 : 28))
const W_NUM = 46
const W_DEL = 34
const W_CHK = 30

const showSearch = ref(false)
const searchInput = ref<HTMLInputElement | null>(null)

function openSearch() {
  showSearch.value = true
  nextTick(() => searchInput.value?.focus())
}

// ── 方向键导航 ──────────────────────────────────────
const navCell = ref<{ r: number; c: number } | null>(null)

function onGridKeydown(e: KeyboardEvent) {
  if (!navCell.value) return
  const { r, c } = navCell.value
  const order = colOrder.value
  const pos = order.indexOf(c)
  let moved = false

  switch (e.key) {
    case 'ArrowUp':
      if (r > 0) { navCell.value = { r: r - 1, c }; moved = true }
      break
    case 'ArrowDown':
      if (r < props.rows.length - 1) { navCell.value = { r: r + 1, c }; moved = true }
      break
    case 'ArrowLeft':
      if (pos > 0) { navCell.value = { r, c: order[pos - 1] }; moved = true }
      break
    case 'ArrowRight':
      if (pos < order.length - 1) { navCell.value = { r, c: order[pos + 1] }; moved = true }
      break
    case 'Enter':
      startEdit(navCell.value.r, navCell.value.c)
      moved = true
      break
  }

  if (moved) {
    e.preventDefault()
    // 滚动到可见
    const el = scroller.value
    if (el) {
      const cellTop = navCell.value.r * ROW_H.value
      const cellBottom = cellTop + ROW_H.value
      if (cellTop < el.scrollTop) el.scrollTop = cellTop
      else if (cellBottom > el.scrollTop + el.clientHeight) {
        el.scrollTop = cellBottom - el.clientHeight
      }
    }
  }
}

// ── 结果内搜索(⌘F) ──────────────────────────────────
const searchText = ref('')
const searchMatches = computed(() => {
  const q = searchText.value.trim().toLowerCase()
  if (!q) return new Set<number>()
  const set = new Set<number>()
  props.rows.forEach((row, r) => {
    if (row.some((c) => c !== null && c.toLowerCase().includes(q))) set.add(r)
  })
  return set
})

// ── 虚拟滚动 ────────────────────────────────────────
const vscroll = useVirtualScroll({ rowCount: computed(() => props.rows.length), rowHeight: 28 })
const { scroller, start, end } = vscroll
const visible = computed(() => props.rows.slice(start.value, end.value))
function onScroll() {
  commitEdit()
  vscroll.onScroll()
}

const showNum = computed(() => props.editable && !hideRowNumLocal.value)
const fixedBase = computed(() =>
  (showNum.value ? W_NUM : 0) + (props.editable ? W_CHK + W_DEL : 0),
)

// ── 列宽拖拽 ──────────────────────────────────────────
const resizing = ref<{ col: number; startX: number; startW: number } | null>(null)

function startResize(e: PointerEvent, i: number) {
  e.stopPropagation()
  e.preventDefault()
  resizing.value = { col: i, startX: e.clientX, startW: widths.value[i] }
  ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
}

function onResizeMove(e: PointerEvent) {
  const r = resizing.value
  if (!r) return
  setWidth(r.col, r.startW + e.clientX - r.startX)
}

function endResize() {
  resizing.value = null
}

// ── 列布局(宽度/固定/隐藏/持久化)抽自 useColumnLayout ──
const layout = useColumnLayout({
  columns: toRef(props, 'columns'),
  rows: toRef(props, 'rows'),
  fixedBase,
  persistKey: toRef(props, 'colWidthKey'),
})
const {
  pinned,
  hidden: hiddenCols,
  hideRowNum: hideRowNumRef,
  widths,
  colOrder,
  pinnedLeft,
  totalW,
  setWidth,
  togglePin,
  showAll: showAllColsBase,
} = layout
const hideRowNumLocal = hideRowNumRef


const NUM_RE = /^-?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/
function isNum(v: string | null): boolean {
  return v !== null && NUM_RE.test(v)
}

function sortIcon(col: string): string {
  if (!props.sortable || props.sortKey !== col) return ''
  return props.sortDir === 'asc' ? '▲' : '▼'
}

/** 列头悬停提示:列名 + 数据库注释 */
function headTitle(col: string): string {
  const c = props.colComments?.[col]?.trim()
  return c ? `${col} — ${c}` : col
}

// ── 勾选行批量设置列值 ────────────────────────────────
const batchCol = ref('')
const batchVal = ref('')
const batchNull = ref(false)
const showBatch = ref(false)

function openBatch(col: string) {
  const n = Object.keys(props.checkedRows ?? {}).length
  if (!n) {
    message.warning('请先勾选要批量修改的行(行首复选框)')
    return
  }
  batchCol.value = col
  batchVal.value = ''
  batchNull.value = false
  showBatch.value = true
}

function confirmBatch() {
  const col = batchCol.value
  showBatch.value = false
  if (!col) return
  emit('batch-set', col, batchNull.value ? null : batchVal.value)
}

// ── 单元格编辑 ────────────────────────────────────────
function pendingValue(r: number, c: number): string | null | undefined {
  const row = props.changes?.[r]
  if (!row) return undefined
  const v = row[props.columns[c]]
  return v === undefined ? undefined : v
}

function displayValue(r: number, c: number): string | null {
  return pendingValue(r, c) ?? props.rows[r]?.[c] ?? null
}

function cellChanged(r: number, c: number): boolean {
  return pendingValue(r, c) !== undefined
}

function rowChanged(r: number): boolean {
  return !!props.changes?.[r]
}

function rowDeleted(r: number): boolean {
  return !!props.deletedRows?.[r]
}

function newCellValue(ni: number, c: number): string {
  return props.newRows?.[ni]?.[props.columns[c]] ?? ''
}

const fkOpts = ref<{ col: string; opts: string[] } | null>(null)

const editing = useCellEditing({
  columns: () => props.columns,
  colOrder: () => colOrder.value,
  displayValue: (r: number, c: number) => displayValue(r, c),
  onCommit: (r: number, col: string, v: string | null) => emit('cell-change', r, col, v),
  onInsertCommit: (ni: number, col: string, v: string) => emit('insert-change', ni, col, v),
  newCellValue: (ni: number, c: number) => newCellValue(ni, c),
})
const { editCell, editNew, draft, startEditNew, commitEdit, cancelEdit, moveEdit } = editing

function showColStats(col: string) {
  const i = props.columns.indexOf(col)
  const nums: number[] = []
  let nulls = 0
  for (const row of props.rows) {
    const v = row[i]
    if (v === null) {
      nulls++
    } else if (NUM_RE.test(v)) {
      nums.push(Number(v))
    }
  }
  if (nums.length) {
    const sum = nums.reduce((a, b) => a + b, 0)
    message.info(
      `${col}:共 ${props.rows.length} 行 · 数值 ${nums.length} · SUM ${fmtNum(sum)} · AVG ${fmtNum(sum / nums.length)} · MIN ${fmtNum(Math.min(...nums))} · MAX ${fmtNum(Math.max(...nums))}` +
        (nulls ? ` · NULL ${nulls}` : ''),
      { duration: 6000 },
    )
  } else {
    const uniq = new Set(props.rows.map((r) => r[i])).size
    message.info(`${col}:共 ${props.rows.length} 行 · 去重 ${uniq} · NULL ${nulls}`, { duration: 6000 })
  }
}

// ── 右键菜单 ────────────────────────────────────────
const menus = useContextMenus({
  editable: () => !!props.editable,
  sortable: () => !!props.sortable,
  sortKey: () => props.sortKey,
  sortDir: () => props.sortDir ?? 'asc',
  hasTableName: () => !!props.tableName,
  hasCheckboxes: () => !!props.checkedRows,
  cellActions: {
    copyCell: async (r, c) => {
      try { await navigator.clipboard.writeText(displayValue(r, c) ?? '') } catch { /* 不可用 */ }
    },
    copyRowJson: async (r) => {
      const cols = props.columns
      const row = props.rows[r] ?? []
      const obj: Record<string, string | null> = {}
      cols.forEach((name, i) => (obj[name] = pendingValue(r, i) ?? row[i] ?? null))
      try { await navigator.clipboard.writeText(JSON.stringify(obj, null, 2)) } catch { /* 同上 */ }
    },
    copyRowCsv: async (r) => {
      const cols = props.columns
      const row = props.rows[r] ?? []
      const esc = (x: string) => /[",\n]/.test(x) ? '"' + x.replace(/"/g, '""') + '"' : x
      const text = cols.map(esc).join(',') + '\n' + cols.map((_, i) => esc(pendingValue(r, i) ?? row[i] ?? '')).join(',')
      try { await navigator.clipboard.writeText(text) } catch { /* 同上 */ }
    },
    copyInsert: async (r) => {
      if (!props.tableName) return
      const q = props.mysqlDialect ? '`' : '"'
      const qi = (x: string) => q + x.split(q).join(q + q) + q
      const cols = props.columns
      const row = props.rows[r] ?? []
      const lit = (v: string | null) => (v === null ? 'NULL' : `'${v.replace(/'/g, "''")}'`)
      const sql = `INSERT INTO ${qi(props.tableName)} (${cols.map(qi).join(', ')}) VALUES (${cols
        .map((_, i) => lit(pendingValue(r, i) ?? row[i] ?? null))
        .join(', ')});`
      try { await navigator.clipboard.writeText(sql) } catch { /* 同上 */ }
    },
    copyRowToNew: (r) => emit('copy-row', r),
    openMlEdit: (r, c) => openMlEdit(r, c),
    setNull: (r, col) => emit('cell-change', r, col, null),
  },
  headActions: {
    copyColName: async (col) => {
      try { await navigator.clipboard.writeText(col) } catch { /* 同上 */ }
    },
    togglePin: (col) => togglePin(col),
    filterCol: (col, op) => emit('filter-col', col, op),
    showStats: (col) => showColStats(col),
    batchSet: (col) => openBatch(col),
  },
})
const { ctx, headCtx, ctxOptions, headCtxOptions, openCtx, openHeadCtx } = menus
const onCtxSelect = (key: string | number) => menus.onCtxSelect(key, props.columns, displayValue)
const onHeadCtxSelect = (key: string | number) => menus.onHeadCtxSelect(key, (col, dir) => emit('sort', col, dir))

// 包装:保留 FK 候选加载
async function startEdit(r: number, c: number) {
  if (!props.editable || rowDeleted(r)) return
  editing.startEdit(r, c)
  fkOpts.value = null
  if (props.fkLoader) {
    const col = props.columns[c]
    const opts = await props.fkLoader(col)
    if (editCell.value?.r === r && editCell.value?.c === c && opts.length) {
      fkOpts.value = { col, opts }
    }
  }
}

function focusEditEl(el: Element | unknown) {
  if (el instanceof HTMLInputElement) el.focus()
}

/** Tab/Shift+Tab:提交当前并打开同行相邻可见列编辑 */
// ── 多行文本编辑 ──────────────────────────────────────
const mlEdit = ref<{ r: number; c: number } | null>(null)
const mlDraft = ref('')

function openMlEdit(r: number, c: number) {
  if (!props.editable || rowDeleted(r)) return
  const v = displayValue(r, c)
  mlDraft.value = v === null ? '' : v
  mlEdit.value = { r, c }
}

function commitMlEdit() {
  const m = mlEdit.value
  if (!m) return
  mlEdit.value = null
  const col = props.columns[m.c]
  const v = mlDraft.value === '' ? null : mlDraft.value
  if (col) emit('cell-change', m.r, col, v)
}

watch([start], () => {
  if (editCell.value) commitEdit()
})

// ── 列头右键菜单 ──────────────────────────────────────



function fmtNum(n: number): string {
  return Number.isInteger(n) ? n.toLocaleString() : n.toFixed(2)
}

// ── 列值转换(仅影响展示,编辑/导出仍用原值) ──────────
const colTransforms = ref<Record<string, string>>({})

interface Transform {
  key: string
  label: string
  fn: (v: string) => string
}

const TRANSFORMS: Transform[] = [
  {
    key: 'ts2dt',
    label: '时间戳(秒) → 日期时间',
    fn: (v) => ( /^-?\d+$/.test(v) ? new Date(Number(v) * 1000).toISOString().slice(0, 19).replace('T', ' ') : v ),
  },
  {
    key: 'ts2d',
    label: '时间戳(秒) → 日期',
    fn: (v) => ( /^-?\d+$/.test(v) ? new Date(Number(v) * 1000).toISOString().slice(0, 10) : v ),
  },
  {
    key: 'ms2dt',
    label: '时间戳(毫秒) → 日期时间',
    fn: (v) => ( /^-?\d+$/.test(v) ? new Date(Number(v)).toISOString().slice(0, 19).replace('T', ' ') : v ),
  },
  { key: 'upper', label: '转大写', fn: (v) => v.toUpperCase() },
  { key: 'lower', label: '转小写', fn: (v) => v.toLowerCase() },
]

function transformOf(col: string): Transform | undefined {
  const k = colTransforms.value[col]
  return k ? TRANSFORMS.find((t) => t.key === k) : undefined
}

function displayCell(r: number, c: number): string | null {
  const v = displayValue(r, c)
  if (v === null) return null
  const tf = transformOf(props.columns[c])
  return tf ? tf.fn(v) : v
}

const allChecked = computed(() => {
  if (!props.checkedRows || !props.rows.length) return false
  return props.rows.every((_, i) => props.checkedRows?.[i])
})



defineExpose({
  openSearch,
  toggleCol: (c: string) => {
    hiddenCols.value = hiddenCols.value.includes(c)
      ? hiddenCols.value.filter((x) => x !== c)
      : [...hiddenCols.value, c]
  },
  showAll: showAllColsBase,
  toggleRowNum: () => (hideRowNumLocal.value = !hideRowNumLocal.value),
  hiddenCols,
  hideRowNumLocal,
})

</script>

<template>
  <div
    class="grid-wrap"
    :style="{ '--row-h': ROW_H + 'px' }"
    tabindex="0"
    @keydown="onGridKeydown"
  >
    <!-- 结果内搜索条 -->
    <div v-if="searchText !== '' || showSearch" class="search-bar">
      <input
        ref="searchInput"
        v-model="searchText"
        class="search-input mono"
        placeholder="搜索结果…"
        @keydown.esc="() => { searchText = ''; showSearch = false }"
      />
      <span class="search-count">{{ searchMatches.size }} 行命中</span>
      <button class="search-close" @click="() => { searchText = ''; showSearch = false }">×</button>
    </div>
    <div
      ref="scroller"
      class="grid"
      @scroll.passive="onScroll"
      @pointermove="onResizeMove"
      @pointerup="endResize"
      @pointercancel="endResize"
    >
      <div class="inner" :style="{ width: totalW + 'px' }">
        <div class="head">
          <div v-if="showNum" class="cell head-cell fixed-num" :style="{ width: W_NUM + 'px' }">#</div>
          <div v-if="editable" class="cell head-cell fixed-chk" :style="{ width: W_CHK + 'px', left: (showNum ? W_NUM : 0) + 'px' }">
            <input
              type="checkbox"
              class="cb"
              title="全选当前页"
              :checked="allChecked"
              @change="emit('check-page', ($event.target as HTMLInputElement).checked)"
            />
          </div>
          <div v-if="editable" class="cell head-cell fixed-del" :style="{ width: W_DEL + 'px', left: (showNum ? W_NUM + W_CHK : W_CHK) + 'px' }" />
          <div
            v-for="i in colOrder"
            :key="i"
            class="cell head-cell"
            :class="{ sortable: sortable, pinned: pinned.includes(columns[i]) }"
            :style="{
              width: widths[i] + 'px',
              left: pinned.includes(columns[i]) ? (pinnedLeft[columns[i]] ?? 0) + 'px' : undefined,
            }"
            :title="headTitle(columns[i])"
            @click="sortable && emit('sort', columns[i])"
            @contextmenu="openHeadCtx($event, columns[i])"
          >
            <span class="head-label">{{ columns[i] }}</span>
            <span v-if="sortIcon(columns[i])" class="sort-icon">{{ sortIcon(columns[i]) }}</span>
            <span
              class="col-resize"
              title="拖拽调整列宽"
              @pointerdown="(e: PointerEvent) => startResize(e, i)"
            />
          </div>
        </div>
        <!-- 待插入的新行 -->
        <div
          v-for="(_, ni) in newRows ?? []"
          :key="'new-' + ni"
          class="row inserted"
        >
          <div v-if="showNum" class="cell rownum fixed-num new-mark" :style="{ width: W_NUM + 'px' }">
            +
          </div>
          <div v-if="editable" class="cell fixed-chk" :style="{ width: W_CHK + 'px', left: (showNum ? W_NUM : 0) + 'px' }" />
          <div v-if="editable" class="cell fixed-del" :style="{ width: W_DEL + 'px', left: (showNum ? W_NUM + W_CHK : W_CHK) + 'px' }">
            <button class="del-btn active" title="移除该新行" @click="emit('remove-insert', ni)">
              −
            </button>
          </div>
          <div
            v-for="ci in colOrder"
            :key="ci"
            class="cell editable inserted-cell"
            :class="{ pinned: pinned.includes(columns[ci]) }"
            :style="{
              width: widths[ci] + 'px',
              left: pinned.includes(columns[ci]) ? (pinnedLeft[columns[ci]] ?? 0) + 'px' : undefined,
            }"
            title="点击输入新值"
            @click="startEditNew(ni, ci)"
          >
            <input
              v-if="editNew && editNew.ni === ni && editNew.c === ci"
              v-model="draft"
              class="cell-input mono"
              :ref="focusEditEl"
              @keydown.enter.prevent="commitEdit"
              @keydown.esc.stop="cancelEdit"
              @keydown.tab.prevent="moveEdit($event.shiftKey ? -1 : 1)"
              @blur="commitEdit"
            />
            <span v-else-if="newCellValue(ni, ci)" class="inserted-val">{{ newCellValue(ni, ci) }}</span>
            <span v-else class="null-light">点击输入</span>
          </div>
        </div>
      </div>

        <div :style="{ height: start * ROW_H + 'px' }" />
        <div
          v-for="(_, ri) in visible"
          :key="start + ri"
          class="row"
          :class="{
            odd: (start + ri) % 2 === 1,
            deleted: rowDeleted(start + ri),
            changed: rowChanged(start + ri) && !rowDeleted(start + ri),
            selected: props.selectedRow === start + ri,
            'search-hit': searchMatches.has(start + ri),
          }"
          @click="emit('select-row', start + ri)"
        >
          <div v-if="showNum" class="cell rownum fixed-num" :style="{ width: W_NUM + 'px' }">
            {{ start + ri + 1 }}
          </div>
          <div v-if="editable" class="cell fixed-chk" :style="{ width: W_CHK + 'px', left: (showNum ? W_NUM : 0) + 'px' }">
            <input
              type="checkbox"
              class="cb"
              :checked="!!checkedRows?.[start + ri]"
              @change="emit('check-row', start + ri, ($event.target as HTMLInputElement).checked)"
            />
          </div>
          <div v-if="editable" class="cell fixed-del" :style="{ width: W_DEL + 'px', left: (showNum ? W_NUM + W_CHK : W_CHK) + 'px' }">
            <button
              class="del-btn"
              :class="{ active: rowDeleted(start + ri) }"
              :title="rowDeleted(start + ri) ? '取消删除' : '删除该行'"
              @click="emit('delete-row', start + ri)"
            >
              −
            </button>
          </div>
          <div
            v-for="ci in colOrder"
            :key="ci"
            class="cell"
            :class="{
              num: isNum(displayValue(start + ri, ci)),
              edited: cellChanged(start + ri, ci),
              editable: editable && !rowDeleted(start + ri),
              pinned: pinned.includes(columns[ci]),
              'nav-focus': navCell?.r === start + ri && navCell?.c === ci,
            }"
            :style="{
              width: widths[ci] + 'px',
              left: pinned.includes(columns[ci]) ? (pinnedLeft[columns[ci]] ?? 0) + 'px' : undefined,
            }"
            :title="cellChanged(start + ri, ci)
              ? `原值:${props.rows[start + ri]?.[ci] ?? 'NULL'}`
              : displayValue(start + ri, ci) ?? 'NULL'"
            @dblclick="startEdit(start + ri, ci)"
            @contextmenu="openCtx($event, start + ri, ci)"
          >
            <input
              v-if="editCell && editCell.r === start + ri && editCell.c === ci"
              v-model="draft"
              class="cell-input mono"
              :list="fkOpts && fkOpts.col === columns[ci] ? 'fk-opts-dl' : undefined"
              :ref="focusEditEl"
              @keydown.enter.prevent="commitEdit"
              @keydown.esc.stop="cancelEdit"
              @keydown.alt.enter.prevent="openMlEdit(start + ri, ci)"
              @keydown.tab.prevent="moveEdit($event.shiftKey ? -1 : 1)"
              @blur="commitEdit"
            />
            <span v-else-if="displayValue(start + ri, ci) === null" class="null">NULL</span>
            <template v-else>{{ displayCell(start + ri, ci) }}</template>
          </div>
        </div>
        <div :style="{ height: Math.max(0, (rows.length - end) * ROW_H) + 'px' }" />
    </div>
    <div v-if="truncated" class="trunc">已达显示上限,仅展示前 {{ rows.length }} 行</div>
    <datalist v-if="fkOpts" id="fk-opts-dl">
      <option v-for="o in fkOpts.opts" :key="o" :value="o" />
    </datalist>
    <n-modal
      :show="mlEdit !== null"
      preset="card"
      :title="mlEdit ? `编辑:${columns[mlEdit.c] ?? ''}` : ''"
      :style="{ width: '560px' }"
      @update:show="(v: boolean) => !v && (mlEdit = null)"
    >
      <n-input
        v-model:value="mlDraft"
        type="textarea"
        class="mono ml-textarea"
        :autosize="{ minRows: 10, maxRows: 22 }"
        placeholder="支持多行文本,留空提交 NULL"
      />
      <div class="ml-meta mono">{{ mlDraft.length.toLocaleString() }} 字符 · ⌘↵ 提交</div>
      <template #footer>
        <div class="ml-footer">
          <n-button size="small" @click="mlEdit = null">取消</n-button>
          <n-button size="small" type="primary" @click="commitMlEdit">提交</n-button>
        </div>
      </template>
    </n-modal>
    <n-modal
      :show="showBatch"
      preset="card"
      :title="`勾选行统一设置:${batchCol}`"
      :style="{ width: '460px' }"
      @update:show="(v: boolean) => (showBatch = v)"
    >
      <div class="batch-hint">
        将把已勾选的 <b>{{ Object.keys(checkedRows ?? {}).length }}</b> 行的
        <span class="mono">{{ batchCol }}</span> 列统一设置为下面的值(保存更改时生效)
      </div>
      <input
        v-model="batchVal"
        class="batch-input mono"
        :disabled="batchNull"
        placeholder="输入统一设置的值"
        @keyup.enter="confirmBatch"
      />
      <label class="batch-null">
        <input v-model="batchNull" type="checkbox" /> 设为 NULL
      </label>
      <template #footer>
        <div class="ml-footer">
          <n-button size="small" @click="showBatch = false">取消</n-button>
          <n-button size="small" type="primary" @click="confirmBatch">应用到勾选行</n-button>
        </div>
      </template>
    </n-modal>
    <n-dropdown
      trigger="manual"
      :show="ctx.show"
      :x="ctx.x"
      :y="ctx.y"
      :options="ctxOptions"
      placement="bottom-start"
      @select="onCtxSelect"
      @clickoutside="ctx.show = false"
    />
    <n-dropdown
      trigger="manual"
      :show="headCtx.show"
      :x="headCtx.x"
      :y="headCtx.y"
      :options="headCtxOptions"
      placement="bottom-start"
      @select="onHeadCtxSelect"
      @clickoutside="headCtx.show = false"
    />
  </div>
</template>

<style scoped>
.search-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 10px;
  background: var(--bg-elevated);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.search-input {
  flex: 1;
  height: 24px;
  border: 1px solid var(--accent);
  border-radius: 6px;
  background: var(--input-bg);
  color: var(--text);
  font-size: 12px;
  padding: 0 8px;
  outline: none;
}
.search-count {
  font-size: 11px;
  color: var(--text-tertiary);
  white-space: nowrap;
}
.search-close {
  border: none;
  background: transparent;
  color: var(--text-tertiary);
  font-size: 14px;
  cursor: pointer;
  padding: 0 4px;
  border-radius: 4px;
}
.search-close:hover {
  color: var(--text);
  background: var(--bg-hover);
}
.grid-wrap {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.grid {
  flex: 1;
  min-height: 0;
  overflow: auto;
}
.inner {
  position: relative;
}
.head {
  position: sticky;
  top: 0;
  z-index: 2;
  display: flex;
  background: var(--bg-head);
  border-bottom: 1px solid var(--border-strong);
}
.row {
  display: flex;
  transition: background-color 0.06s ease;
}
.row:hover {
  background: var(--row-hover);
}
.row.odd {
  background: var(--zebra);
}
.row.odd:hover {
  background: var(--row-hover);
}
.row.changed {
  background: var(--edit-line);
}
.row.selected,
.row.selected:hover,
.row.selected.odd {
  background: rgba(10, 132, 255, 0.13);
  box-shadow: inset 2px 0 0 var(--accent);
}
.row.selected .rownum {
  color: var(--accent);
  font-weight: 700;
}
.cell.nav-focus {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
  z-index: 4;
  background: rgba(10, 132, 255, 0.06);
  transition: background-color 0.1s ease;
}
.row.search-hit {
  background: rgba(255, 213, 74, 0.06) !important;
}
.row.search-hit .cell {
  border-bottom-color: rgba(255, 213, 74, 0.15);
}
.row.deleted {
  background: var(--del-bg);
  text-decoration: line-through;
  opacity: 0.65;
}
.row.inserted {
  background: var(--ins-bg);
}
.cell {
  flex-shrink: 0;
  height: var(--row-h, 28px);
  line-height: calc(var(--row-h, 28px) - 1px);
  padding: 0 10px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  border-right: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
  font-family: var(--mono);
  font-size: 12px;
  color: var(--cell-color);
}
.rownum {
  color: var(--text-tertiary);
  text-align: right;
  font-variant-numeric: tabular-nums;
  user-select: none;
}
.new-mark {
  color: var(--green);
  font-weight: 700;
}
.fixed-num {
  position: sticky;
  left: 0;
  z-index: 1;
  background: var(--bg-fixed);
}
.head .fixed-num,
.head .fixed-del {
  background: var(--bg-head);
  z-index: 3;
}
.cell.pinned {
  position: sticky;
  z-index: 1;
  background: var(--bg-fixed);
}
.head-cell.pinned {
  z-index: 3;
}
.fixed-chk {
  position: sticky;
  left: 46px;
  z-index: 1;
  background: var(--bg-fixed);
  display: flex;
  align-items: center;
  justify-content: center;
}
.fixed-del {
  position: sticky;
  left: 76px;
  z-index: 1;
  background: var(--bg-fixed);
  display: flex;
  align-items: center;
  justify-content: center;
}
.head .fixed-chk,
.head .fixed-del {
  background: var(--bg-head);
  z-index: 3;
}
.cb {
  accent-color: var(--accent);
  cursor: pointer;
}
.del-btn {
  width: 18px;
  height: 18px;
  border: 1px solid var(--border-strong);
  border-radius: 4px;
  background: transparent;
  color: var(--text-tertiary);
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
}
.del-btn:hover {
  color: var(--danger);
  border-color: var(--danger);
}
.del-btn.active {
  background: var(--danger);
  border-color: var(--danger);
  color: #fff;
}
.head-cell {
  position: relative;
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--text-secondary);
  font-weight: 600;
  font-size: 12px;
  font-family: inherit;
  background: var(--bg-head);
  user-select: none;
}
.head-cell.sortable {
  cursor: pointer;
}
.head-cell.sortable:hover {
  color: var(--text);
  background: var(--head-hover);
}
.col-resize {
  position: absolute;
  top: 0;
  right: -4px;
  width: 8px;
  height: 100%;
  cursor: col-resize;
  z-index: 4;
}
.col-resize:hover {
  background: rgba(10, 132, 255, 0.35);
}
.head-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sort-icon {
  font-size: 9px;
  color: var(--accent);
  flex-shrink: 0;
}
.cell.num {
  text-align: right;
  color: var(--num-color);
  font-variant-numeric: tabular-nums;
}
.cell.edited {
  background: var(--edit-hl-bg);
  color: var(--edit-hl-fg);
}
.cell.editable {
  cursor: cell;
}
.inserted-cell {
  cursor: text;
}
.inserted-val {
  color: var(--inserted-fg);
}
.null-light {
  color: var(--null-color);
  font-style: italic;
  font-size: 11px;
}
.cell-input {
  width: 100%;
  height: 24px;
  margin-top: 1px;
  padding: 0 4px;
  border: 1px solid var(--accent);
  border-radius: 3px;
  background: var(--input-bg);
  color: var(--text);
  font-size: 12px;
  outline: none;
  animation: fade-in 0.08s ease;
  box-shadow: 0 0 0 2px rgba(10, 132, 255, 0.15);
  transition: box-shadow 0.15s ease;
}
.null {
  color: var(--null-color);
  font-style: italic;
}
.trunc {
  padding: 5px 12px;
  color: var(--warn);
  font-size: 11.5px;
  border-top: 1px solid var(--border);
  background: var(--bg-grid);
}
.ml-textarea :deep(textarea) {
  font-size: 12.5px;
  line-height: 1.7;
}
.ml-meta {
  margin-top: 8px;
  font-size: 11px;
  color: var(--text-tertiary);
}
.ml-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.batch-hint {
  font-size: 12px;
  color: var(--text-secondary);
  margin-bottom: 10px;
}
.batch-hint b {
  color: var(--accent);
}
.batch-input {
  width: 100%;
  height: 30px;
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  background: var(--input-bg);
  color: var(--text);
  font-size: 13px;
  padding: 0 8px;
  outline: none;
}
.batch-input:focus {
  border-color: var(--accent);
}
.batch-null {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 10px;
  font-size: 12px;
  color: var(--text-secondary);
  cursor: pointer;
}
</style>
