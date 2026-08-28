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
  (e: 'batch-committed', col: string, count: number): void
}>()

const message = useMessage()

const ROW_H = computed(() => (props.rowHeight === 'compact' ? 24 : 28))
const W_NUM = 46
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
  // 批量编辑输入框自行处理按键
  if (selEdit.value) return
  // ⌘C:复制当前导航单元格内容(无导航格时走浏览器默认复制)
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'c' && navCell.value) {
    const v = displayValue(navCell.value.r, navCell.value.c)
    navigator.clipboard.writeText(v ?? '').catch(() => {})
    return
  }
  // 有选区:回车/直接输入进入批量编辑,Esc 取消,方向键取消选区走常规导航
  const s = cellSel.value
  if (s) {
    if (e.key === 'Enter') {
      e.preventDefault()
      openSelEdit()
      return
    }
    if (e.key === 'Escape') {
      cellSel.value = null
      return
    }
    if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      if (props.editable) {
        e.preventDefault()
        openSelEdit(e.key)
      }
      return
    }
    cellSel.value = null
  }
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
/** 防抖后的搜索词:大结果集逐键全表扫描会卡输入 */
const searchApplied = ref('')
let searchTimer: ReturnType<typeof setTimeout> | undefined
watch(searchText, (v) => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => (searchApplied.value = v), 200)
})
const searchMatches = computed(() => {
  const q = searchApplied.value.trim().toLowerCase()
  if (!q) return new Set<number>()
  const set = new Set<number>()
  props.rows.forEach((row, r) => {
    if (row.some((c) => c !== null && c.toLowerCase().includes(q))) set.add(r)
  })
  return set
})
/** 命中行升序 + 当前定位游标 */
const searchList = computed(() => [...searchMatches.value].sort((a, b) => a - b))
const searchCursor = ref(0)

function scrollToRow(r: number) {
  const el = scroller.value
  if (!el) return
  const rowH = ROW_H.value
  const top = r * rowH
  if (top < el.scrollTop || top + rowH > el.scrollTop + el.clientHeight) {
    el.scrollTop = Math.max(0, top - el.clientHeight / 2 + rowH / 2)
  }
}

function stepSearch(dir: 1 | -1) {
  const list = searchList.value
  if (!list.length) return
  searchCursor.value = (searchCursor.value + dir + list.length) % list.length
  scrollToRow(list[searchCursor.value])
}

// 搜索词变化:回到第一个命中并滚动定位
watch([searchApplied], () => {
  searchCursor.value = 0
  const first = searchList.value[0]
  if (first !== undefined) scrollToRow(first)
})

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] as string,
  )
}

/** 该格是否命中搜索词(用于高亮渲染) */
function cellHasHit(r: number, c: number): boolean {
  const q = searchApplied.value.trim().toLowerCase()
  if (!q) return false
  const v = displayCell(r, c)
  return v !== null && v.toLowerCase().includes(q)
}

/** 命中格的 HTML:关键词包 <mark>,其余转义 */
function highlightCell(r: number, c: number): string {
  const v = displayCell(r, c) ?? ''
  const q = searchApplied.value.trim()
  if (!q) return escapeHtml(v)
  const lowerV = v.toLowerCase()
  const lowerQ = q.toLowerCase()
  let out = ''
  let i = 0
  for (;;) {
    const idx = lowerV.indexOf(lowerQ, i)
    if (idx < 0) {
      out += escapeHtml(v.slice(i))
      break
    }
    out += escapeHtml(v.slice(i, idx)) + '<mark class="kw">' + escapeHtml(v.slice(idx, idx + q.length)) + '</mark>'
    i = idx + q.length
  }
  return out
}

// ── 虚拟滚动 ────────────────────────────────────────
const vscroll = useVirtualScroll({ rowCount: computed(() => props.rows.length), rowHeight: ROW_H })
const { scroller, start, end } = vscroll
const visible = computed(() => props.rows.slice(start.value, end.value))
function onScroll() {
  commitEdit()
  vscroll.onScroll()
}

const showNum = computed(() => props.editable && !hideRowNumLocal.value)
const fixedBase = computed(() => (props.editable ? W_CHK : 0) + (showNum.value ? W_NUM : 0))

// ── 列宽拖拽 ──────────────────────────────────────────
const resizing = ref<{ col: number; startX: number; startW: number } | null>(null)
let fitCtx: CanvasRenderingContext2D | null = null

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

/** 双击列边界:按可见行内容自适应列宽(文本测量,不碰 DOM) */
function autoFitColumn(i: number) {
  const col = props.columns[i]
  if (!col) return
  if (!fitCtx) fitCtx = document.createElement('canvas').getContext('2d')
  if (!fitCtx) return
  fitCtx.font = '12px ui-monospace, Menlo, Monaco, monospace'
  let w = fitCtx.measureText(col).width + 34
  for (let r = start.value; r < end.value; r++) {
    const v = displayCell(r, i)
    if (v !== null && v !== '') w = Math.max(w, fitCtx.measureText(v).width + 24)
  }
  setWidth(i, Math.min(600, Math.max(40, Math.ceil(w))))
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

// ── 同列多行选区 + 批量编辑(Excel 式) ────────────────
/** 选区:限定单列的行集合(绝对行号) */
const cellSel = ref<{ col: number; rows: Set<number> } | null>(null)
/** 批量编辑态:输入框锚定在首个选中行 */
const selEdit = ref<{ col: number; rows: number[]; anchor: number } | null>(null)
const selDraft = ref('')
let selAnchor = -1
/** 拖拽选区进行中(pointerdown 后纵向划过其他行) */
const selDragging = ref(false)
let dragSel: { col: number; from: number } | null = null

function inSel(r: number, c: number): boolean {
  const s = cellSel.value
  return !!s && s.col === c && s.rows.has(r)
}

/** 批量编辑中:该格是否正在实时预览输入值 */
function selPreviewing(r: number, c: number): boolean {
  const s = selEdit.value
  return !!s && s.col === c && s.rows.includes(r)
}

function rangeSelectRows(a: number, b: number, col: number) {
  const [x, y] = a <= b ? [a, b] : [b, a]
  const rows = new Set<number>()
  for (let i = x; i <= y; i++) rows.add(i)
  cellSel.value = { col, rows }
  selAnchor = a
}

function onCellPointerDown(e: PointerEvent, r: number, c: number) {
  if (e.button !== 0) return
  // 记录拖拽起点;未划出该格前视作普通点击(行选/修饰键逻辑不变)
  dragSel = { col: c, from: r }
}

function onCellPointerEnter(e: PointerEvent, r: number, c: number) {
  if (!dragSel) return
  if (e.buttons === 0) {
    // 按键已在格间释放
    dragSel = null
    selDragging.value = false
    return
  }
  if (!cellSel.value && !selDragging.value) selDragging.value = true
  if (c !== dragSel.col) {
    rangeSelectRows(dragSel.from, r, dragSel.col)
    return
  }
  rangeSelectRows(dragSel.from, r, c)
}

function endDragSel() {
  dragSel = null
  selDragging.value = false
}

function onCellClick(e: MouseEvent, r: number, c: number) {
  if (e.metaKey || e.ctrlKey) {
    e.stopPropagation()
    e.preventDefault()
    toggleSel(r, c)
  } else if (e.shiftKey) {
    e.stopPropagation()
    e.preventDefault()
    rangeSelectRows(selAnchor >= 0 ? selAnchor : r, r, c)
  } else if (cellSel.value && !inSel(r, c)) {
    // 普通点击选区外:清除选区,行选照常(不拦截冒泡)
    cellSel.value = null
  }
}

function toggleSel(r: number, c: number) {
  const s = cellSel.value
  if (!s || s.col !== c) {
    cellSel.value = { col: c, rows: new Set([r]) }
  } else {
    if (s.rows.has(r)) s.rows.delete(r)
    else s.rows.add(r)
    cellSel.value = s.rows.size ? { col: c, rows: new Set(s.rows) } : null
  }
  selAnchor = r
}

/** 进入批量编辑态(键盘字符/回车/双击选中单元格) */
function openSelEdit(init?: string) {
  const s = cellSel.value
  if (!s || !props.editable || s.rows.size < 2) return
  const rows = [...s.rows].sort((a, b) => a - b).filter((r) => !rowDeleted(r))
  if (!rows.length) return
  selEdit.value = { col: s.col, rows, anchor: rows[0] }
  const cur = displayValue(rows[0], s.col)
  selDraft.value = init ?? (cur === null ? '' : cur)
  fkOpts.value = null
}

function commitSelEdit() {
  const s = selEdit.value
  if (!s) return
  selEdit.value = null
  const col = props.columns[s.col]
  if (!col) return
  const v = selDraft.value === '' ? null : selDraft.value
  for (const r of s.rows) {
    if (v !== (displayValue(r, s.col) ?? null)) emit('cell-change', r, col, v)
  }
  cellSel.value = null
  emit('batch-committed', col, s.rows.length)
}

function cancelSelEdit() {
  selEdit.value = null
}

function onCellDblClick(r: number, c: number) {
  if (inSel(r, c) && (cellSel.value?.rows.size ?? 0) > 1 && props.editable) {
    openSelEdit()
    return
  }
  startEdit(r, c)
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
    deleteRow: (r) => emit('delete-row', r),
  },
  headActions: {
    copyColName: async (col) => {
      try { await navigator.clipboard.writeText(col) } catch { /* 同上 */ }
    },
    togglePin: (col) => togglePin(col),
    filterCol: (col, op) => emit('filter-col', col, op),
    showStats: (col) => showColStats(col),
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
  if (selEdit.value) commitSelEdit()
})

// 数据重查:选区与批量编辑失效,搜索态清空
watch(() => props.rows, () => {
  cellSel.value = null
  selEdit.value = null
  searchText.value = ''
  searchApplied.value = ''
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
        placeholder="搜索结果…(↵ 下一个,⇧↵ 上一个)"
        @keydown.enter.prevent="stepSearch($event.shiftKey ? -1 : 1)"
        @keydown.esc="() => { searchText = ''; showSearch = false }"
      />
      <span class="search-count">{{ searchList.length ? `${searchCursor + 1}/${searchList.length}` : 0 }} 行命中</span>
      <button class="search-close" @click="() => { searchText = ''; showSearch = false }">×</button>
    </div>
    <div
      ref="scroller"
      class="grid"
      :class="{ 'sel-dragging': selDragging }"
      @scroll.passive="onScroll"
      @pointermove="onResizeMove"
      @pointerup="() => { endDragSel(); endResize() }"
      @pointercancel="() => { endDragSel(); endResize() }"
    >
      <div class="inner" :style="{ width: totalW + 'px' }">
        <div class="head">
          <div v-if="editable" class="cell head-cell fixed-chk" :style="{ width: W_CHK + 'px', left: '0px' }">
            <input
              type="checkbox"
              class="cb"
              title="全选当前页"
              :checked="allChecked"
              @change="emit('check-page', ($event.target as HTMLInputElement).checked)"
            />
          </div>
          <div v-if="showNum" class="cell head-cell fixed-num" :style="{ width: W_NUM + 'px', left: (editable ? W_CHK : 0) + 'px' }">#</div>
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
              title="拖拽调整列宽 · 双击自适应"
              @pointerdown="(e: PointerEvent) => startResize(e, i)"
              @dblclick.stop="autoFitColumn(i)"
            />
          </div>
        </div>
        <!-- 待插入的新行 -->
        <div
          v-for="(_, ni) in newRows ?? []"
          :key="'new-' + ni"
          class="row inserted"
        >
          <div v-if="editable" class="cell fixed-chk" :style="{ width: W_CHK + 'px', left: '0px' }" />
          <div
            v-if="showNum"
            class="cell rownum fixed-num new-remove"
            title="移除该新行"
            :style="{ width: W_NUM + 'px', left: W_CHK + 'px' }"
            @click="emit('remove-insert', ni)"
          >
            −
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
            'search-current': searchList[searchCursor] === start + ri && searchApplied.trim() !== '',
          }"
          @click="emit('select-row', start + ri)"
        >
          <div v-if="editable" class="cell fixed-chk" :style="{ width: W_CHK + 'px', left: '0px' }">
            <input
              type="checkbox"
              class="cb"
              :checked="!!checkedRows?.[start + ri]"
              @change="emit('check-row', start + ri, ($event.target as HTMLInputElement).checked)"
            />
          </div>
          <div
            v-if="showNum"
            class="cell rownum fixed-num"
            :style="{ width: W_NUM + 'px', left: (editable ? W_CHK : 0) + 'px' }"
          >
            {{ start + ri + 1 }}
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
              sel: inSel(start + ri, ci),
              'sel-preview': selPreviewing(start + ri, ci),
            }"
            :style="{
              width: widths[ci] + 'px',
              left: pinned.includes(columns[ci]) ? (pinnedLeft[columns[ci]] ?? 0) + 'px' : undefined,
            }"
            :title="cellChanged(start + ri, ci)
              ? `原值:${props.rows[start + ri]?.[ci] ?? 'NULL'}`
              : displayValue(start + ri, ci) ?? 'NULL'"
            @click="onCellClick($event, start + ri, ci)"
            @pointerdown="onCellPointerDown($event, start + ri, ci)"
            @pointerenter="onCellPointerEnter($event, start + ri, ci)"
            @dblclick="onCellDblClick(start + ri, ci)"
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
            <input
              v-else-if="selEdit && selEdit.anchor === start + ri && selEdit.col === ci"
              v-model="selDraft"
              class="cell-input mono sel-input"
              :placeholder="`批量填充 ${selEdit.rows.length} 行,↵ 提交`"
              :ref="focusEditEl"
              @keydown.enter.prevent="commitSelEdit"
              @keydown.esc.stop="cancelSelEdit"
              @blur="commitSelEdit"
            />
            <span
              v-else-if="cellHasHit(start + ri, ci) && !selPreviewing(start + ri, ci)"
              class="cell-hl"
              v-html="highlightCell(start + ri, ci)"
            />
            <span
              v-else-if="displayValue(start + ri, ci) === null && !selPreviewing(start + ri, ci)"
              class="null"
            >NULL</span>
            <template v-else>{{ selPreviewing(start + ri, ci) ? selDraft : displayCell(start + ri, ci) }}</template>
          </div>
        </div>
        <div :style="{ height: Math.max(0, (rows.length - end) * ROW_H) + 'px' }" />
    </div>
    <div v-if="truncated" class="trunc">已达显示上限,仅展示前 {{ rows.length }} 行</div>
    <div v-if="cellSel && !selEdit" class="sel-badge">
      已选 <b>{{ cellSel.rows.size }}</b> 行 · {{ columns[cellSel.col] }} ·
      <template v-if="editable">输入字符或 ↵ 批量修改并保存,Esc 取消</template>
      <template v-else>Esc 取消</template>
    </div>
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
  position: relative;
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
  /* 行内布局变化不外溢,宽表滚动时减少全局重排 */
  contain: layout paint style;
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
}
.row.search-hit {
  background: rgba(255, 213, 74, 0.06) !important;
}
.row.search-current {
  background: rgba(255, 213, 74, 0.16) !important;
  box-shadow: inset 2px 0 0 var(--warn);
}
.cell-hl mark.kw {
  background: rgba(255, 213, 74, 0.45);
  color: inherit;
  border-radius: 2px;
  padding: 0 1px;
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
.new-remove {
  color: var(--danger);
  font-weight: 700;
  cursor: pointer;
}
.new-remove:hover {
  background: var(--danger);
  color: #fff;
}
.fixed-num {
  position: sticky;
  left: 0;
  z-index: 1;
  background: var(--bg-fixed);
}
.head .fixed-num {
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
  left: 0;
  z-index: 1;
  background: var(--bg-fixed);
  display: flex;
  align-items: center;
  justify-content: center;
}
.head .fixed-chk {
  background: var(--bg-head);
  z-index: 3;
}
.cb {
  accent-color: var(--accent);
  cursor: pointer;
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
.cell.sel {
  background: rgba(10, 132, 255, 0.14);
  box-shadow: inset 0 0 0 1px rgba(10, 132, 255, 0.4);
}
.cell.sel-preview {
  background: rgba(255, 159, 10, 0.13);
  box-shadow: inset 0 0 0 1px rgba(255, 159, 10, 0.4);
  color: var(--text);
}
.grid.sel-dragging {
  user-select: none;
  cursor: cell;
}
.cell-input.sel-input {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px rgba(255, 159, 10, 0.25);
}
.sel-badge {
  position: absolute;
  top: 6px;
  right: 12px;
  z-index: 6;
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 3px 10px;
  border-radius: 999px;
  background: rgba(28, 28, 33, 0.9);
  border: 1px solid var(--accent);
  color: var(--text-secondary);
  font-size: 11px;
  pointer-events: none;
}
.sel-badge b {
  color: var(--accent);
}
</style>
