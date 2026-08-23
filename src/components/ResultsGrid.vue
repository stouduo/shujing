<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { NButton, NDropdown, NInput, NModal, useMessage, type DropdownOption } from 'naive-ui'
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
}>()

const message = useMessage()

const ROW_H = computed(() => (props.rowHeight === 'compact' ? 24 : 28))
const W_NUM = 46
const W_DEL = 34
const W_CHK = 30

const hiddenColsLocal = ref<string[]>(props.hiddenCols ?? [])
const hideRowNumLocal = ref(!!props.hideRowNum)
const visibleCols = computed(() =>
  props.columns.map((_, i) => i).filter((i) => !hiddenColsLocal.value.includes(props.columns[i])),
)
const showNum = computed(() => props.editable && !hideRowNumLocal.value)
const fixedBase = computed(() =>
  (showNum.value ? W_NUM : 0) + (props.editable ? W_CHK + W_DEL : 0),
)

const scroller = ref<HTMLElement | null>(null)
const scrollTop = ref(0)
const viewH = ref(400)

function measure() {
  const el = scroller.value
  if (!el) return
  scrollTop.value = el.scrollTop
  viewH.value = el.clientHeight
}

function onScroll() {
  commitEdit()
  measure()
}

onMounted(() => {
  measure()
  window.addEventListener('resize', measure)
})
onUnmounted(() => {
  window.removeEventListener('resize', measure)
})


// 固定列(列名,按固定顺序),渲染在行号/删除列之后、普通列之前
const pinned = ref<string[]>([])

// 列布局状态:列宽 / 固定列 / 隐藏列 / 行号开关,按表持久化
const userWidths = ref<Record<number, number>>({})

interface ColLayout {
  widths: Record<number, number>
  pinned: string[]
  hidden: string[]
  hideRowNum?: boolean
}

function layoutKey(): string {
  return props.colWidthKey ? `dblens_colw:${props.colWidthKey}` : ''
}

onMounted(() => {
  const k = layoutKey()
  if (!k) return
  try {
    const saved = localStorage.getItem(k)
    if (!saved) return
    const d = JSON.parse(saved) as ColLayout
    userWidths.value = d.widths ?? {}
    pinned.value = d.pinned ?? []
    hiddenColsLocal.value = d.hidden ?? []
    hideRowNumLocal.value = !!d.hideRowNum
  } catch {
    /* 忽略 */
  }
})

function saveLayout() {
  const k = layoutKey()
  if (!k) return
  const d: ColLayout = {
    widths: userWidths.value,
    pinned: pinned.value,
    hidden: hiddenColsLocal.value,
    hideRowNum: hideRowNumLocal.value,
  }
  try {
    localStorage.setItem(k, JSON.stringify(d))
  } catch {
    /* 忽略 */
  }
}

watch([userWidths, pinned, hiddenColsLocal, () => hideRowNumLocal.value], saveLayout, { deep: true })

/** 渲染顺序:固定列在前(保持固定顺序),其余列原序 */
const colOrderAll = computed<number[]>(() => {
  const pinSet = new Set(pinned.value)
  const pinIdx: number[] = []
  const rest: number[] = []
  props.columns.forEach((c, i) => (pinSet.has(c) ? pinIdx.push(i) : rest.push(i)))
  return [...pinIdx, ...rest]
})

/** 渲染顺序 = 固定列在前,再滤掉隐藏列 */
const colOrder = computed<number[]>(() => colOrderAll.value.filter((i) => visibleCols.value.includes(i)))

/** 固定列的 sticky left 偏移(行号+删除列之后依次累加) */
const pinnedLeft = computed<Record<string, number>>(() => {
  const m: Record<string, number> = {}
  let x = fixedBase.value
  for (const name of pinned.value) {
    const i = props.columns.indexOf(name)
    if (i >= 0) {
      m[name] = x
      x += widths.value[i]
    }
  }
  return m
})

function togglePin(col: string) {
  pinned.value = pinned.value.includes(col)
    ? pinned.value.filter((c) => c !== col)
    : [...pinned.value, col]
}

// 依据表头与前 60 行内容估算列宽
const widths = computed(() =>
  props.columns.map((c, i) => {
    if (userWidths.value[i]) return userWidths.value[i]
    let max = c.length
    const n = Math.min(props.rows.length, 60)
    for (let r = 0; r < n; r++) {
      const v = props.rows[r]?.[i]
      if (v && v.length > max) max = v.length
    }
    return Math.min(360, Math.max(90, Math.ceil(max * 7.3) + 30))
  }),
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
  userWidths.value = {
    ...userWidths.value,
    [r.col]: Math.max(60, Math.min(760, r.startW + e.clientX - r.startX)),
  }
}

function endResize() {
  resizing.value = null
}

const totalW = computed(() => widths.value.reduce((a, b) => a + b, 0) + fixedBase.value)

const start = computed(() => Math.max(0, Math.floor(scrollTop.value / ROW_H.value) - 4))
const end = computed(() =>
  Math.min(props.rows.length, start.value + Math.ceil(viewH.value / ROW_H.value) + 8),
)
const visible = computed(() => props.rows.slice(start.value, end.value))

const NUM_RE = /^-?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/
function isNum(v: string | null): boolean {
  return v !== null && NUM_RE.test(v)
}

function sortIcon(col: string): string {
  if (!props.sortable || props.sortKey !== col) return ''
  return props.sortDir === 'asc' ? '▲' : '▼'
}

// ── 单元格编辑 ────────────────────────────────────────
const editCell = ref<{ r: number; c: number } | null>(null)
const editNew = ref<{ ni: number; c: number } | null>(null)
const draft = ref('')

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

async function startEdit(r: number, c: number) {
  if (!props.editable || rowDeleted(r)) return
  const col = props.columns[c]
  if (!col) return
  const v = displayValue(r, c)
  draft.value = v === null ? '' : v
  editNew.value = null
  editCell.value = { r, c }
  // 外键列:加载候选值供 datalist 提示
  fkOpts.value = null
  if (props.fkLoader) {
    const opts = await props.fkLoader(col)
    if (editCell.value?.r === r && editCell.value?.c === c && opts.length) {
      fkOpts.value = { col, opts }
    }
  }
}

function startEditNew(ni: number, c: number) {
  if (!props.editable) return
  draft.value = newCellValue(ni, c)
  editCell.value = null
  editNew.value = { ni, c }
}

function focusEditEl(el: Element | unknown) {
  if (el instanceof HTMLInputElement) el.focus()
}

function commitEdit() {
  if (editNew.value) {
    const { ni, c } = editNew.value
    editNew.value = null
    const col = props.columns[c]
    if (col) emit('insert-change', ni, col, draft.value)
    return
  }
  const ec = editCell.value
  if (!ec) return
  editCell.value = null
  const col = props.columns[ec.c]
  const cur = displayValue(ec.r, ec.c)
  const v = draft.value === '' ? null : draft.value
  if (v !== cur && col) emit('cell-change', ec.r, col, v)
}

function cancelEdit() {
  editCell.value = null
  editNew.value = null
}

/** Tab/Shift+Tab:提交当前并打开同行相邻可见列编辑 */
function moveEdit(dir: number) {
  const ec = editCell.value ?? editNew.value
  if (!ec) return
  const isOld = !!editCell.value
  const r = isOld ? editCell.value!.r : editNew.value!.ni
  const cur = isOld ? editCell.value!.c : editNew.value!.c
  commitEdit()
  const order = colOrder.value
  const pos = order.indexOf(cur)
  const nextIdx = order[pos + dir]
  if (nextIdx === undefined) return
  if (isOld) startEdit(r, nextIdx)
  else startEditNew(r, nextIdx)
}

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
const headCtx = ref({ show: false, x: 0, y: 0, col: '' })

function openHeadCtx(e: MouseEvent, col: string) {
  e.preventDefault()
  headCtx.value = { show: true, x: e.clientX, y: e.clientY, col }
}

const headCtxOptions = computed<DropdownOption[]>(() => {
  const col = headCtx.value.col
  const opts: DropdownOption[] = [{ label: '复制列名', key: 'copy' }]
  if (props.sortable) {
    opts.push({
      label: '排序',
      key: 'sort-menu',
      children: [
        { label: props.sortKey === col && props.sortDir === 'asc' ? '✓ 升序' : '升序', key: 'sort-asc' },
        { label: props.sortKey === col && props.sortDir === 'desc' ? '✓ 降序' : '降序', key: 'sort-desc' },
        { label: '取消排序', key: 'sort-none' },
      ],
    })
  }
  opts.push({
    label: headCtx.value.col && pinned.value.includes(headCtx.value.col) ? '取消固定此列' : '固定此列到左侧',
    key: 'pin',
  })
  opts.push(
    { label: '按此列筛选…', key: 'filter' },
    { label: '筛选 NULL 值', key: 'isnull' },
    { label: '筛选非空值', key: 'notnull' },
  )
  opts.push({
    label: '转换',
    key: 'tf-menu',
    children: [
      { label: !colTransforms.value[col ?? ''] ? '✓ 无' : '无', key: 'tf-none' },
      ...TRANSFORMS.map((t) => ({
        label: colTransforms.value[col ?? ''] === t.key ? `✓ ${t.label}` : t.label,
        key: `tf-${t.key}`,
      })),
    ],
  })
  opts.push({ type: 'divider', key: 'd' }, { label: '列统计(当前页)', key: 'stats' })
  return opts
})

async function onHeadCtxSelect(key: string | number) {
  const col = headCtx.value.col
  headCtx.value.show = false
  const k = String(key)
  if (k.startsWith('sort-')) {
    if (k === 'sort-none') emit('sort', col ?? '', null)
    else if (k === 'sort-asc') emit('sort', col ?? '', 'asc')
    else emit('sort', col ?? '', 'desc')
    return
  }
  if (k.startsWith('tf-')) {
    if (k === 'tf-none' || !col) delete colTransforms.value[col ?? '']
    else colTransforms.value[col] = k.slice(3)
    return
  }
  switch (key) {
    case 'copy':
      try {
        await navigator.clipboard.writeText(col)
      } catch {
        /* 剪贴板不可用 */
      }
      break
    case 'pin':
      togglePin(col)
      break
    case 'filter':
      emit('filter-col', col, '=')
      break
    case 'isnull':
      emit('filter-col', col, 'IS NULL')
      break
    case 'notnull':
      emit('filter-col', col, 'IS NOT NULL')
      break
    case 'stats': {
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
      break
    }
  }
}

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
const ctx = ref({ show: false, x: 0, y: 0, r: 0, c: 0 })

function openCtx(e: MouseEvent, r: number, c: number) {
  e.preventDefault()
  ctx.value = { show: true, x: e.clientX, y: e.clientY, r, c }
}

const ctxOptions = computed<DropdownOption[]>(() => {
  const opts: DropdownOption[] = [
    { label: '复制单元格', key: 'cell' },
    { label: '筛选此值', key: 'filterval' },
    { label: '复制整行 (JSON)', key: 'row' },
    { label: '复制行 (CSV)', key: 'rowcsv' },
  ]
  if (props.tableName) {
    opts.push({ label: '复制 INSERT 语句', key: 'insert' })
  }
  if (props.editable) {
    opts.push({ type: 'divider', key: 'd' })
    opts.push({ label: '复制为新行', key: 'copyrow' })
    opts.push({ label: '多行编辑… (⌥↵)', key: 'ml' })
    opts.push({ label: '设为 NULL', key: 'null' })
  }
  return opts
})

async function onCtxSelect(key: string | number) {
  ctx.value.show = false
  const { r, c } = ctx.value
  const col = props.columns[c]
  switch (key) {
    case 'cell': {
      const v = displayValue(r, c)
      try {
        await navigator.clipboard.writeText(v ?? '')
      } catch {
        /* 剪贴板不可用时静默 */
      }
      break
    }
    case 'rowcsv': {
      const cols = props.columns
      const row = props.rows[r] ?? []
      const esc2 = (x: string) => /[",\n]/.test(x) ? '"' + x.replace(/"/g, '""') + '"' : x
      const text = cols.map(esc2).join(',') + '\n' + cols.map((_, i) => esc2(pendingValue(r, i) ?? row[i] ?? '')).join(',')
      try {
        await navigator.clipboard.writeText(text)
      } catch { /* 同上 */ }
      break
    }
    case 'insert': {
      const tn = props.tableName!
      const q = props.mysqlDialect ? '`' : '"'
      const qi = (x: string) => q + x.split(q).join(q + q) + q
      const cols = props.columns
      const row = props.rows[r] ?? []
      const lit = (v: string | null) => (v === null ? 'NULL' : `'${v.replace(/'/g, "''")}'`)
      const sql = `INSERT INTO ${qi(tn)} (${cols.map(qi).join(', ')}) VALUES (${cols
        .map((_, i) => lit(pendingValue(r, i) ?? row[i] ?? null))
        .join(', ')});`
      try {
        await navigator.clipboard.writeText(sql)
      } catch { /* 同上 */ }
      break
    }
    case 'row': {
      const cols = props.columns
      const row = props.rows[r] ?? []
      const obj: Record<string, string | null> = {}
      cols.forEach((name, i) => (obj[name] = pendingValue(r, i) ?? row[i] ?? null))
      try {
        await navigator.clipboard.writeText(JSON.stringify(obj, null, 2))
      } catch {
        /* 同上 */
      }
      break
    }
    case 'null':
      if (col) emit('cell-change', r, col, null)
      break
    case 'filterval': {
      const col = props.columns[c]
      const v = displayValue(r, c)
      if (col && v !== null) emit('filter-value', col, v)
      break
    }
    case 'copyrow':
      emit('copy-row', r)
      break
    case 'ml':
      openMlEdit(r, c)
      break
  }
}

// 暴露列布局控制(供父组件列选择器调用)
function toggleColExternal(c: string) {
  hiddenColsLocal.value = hiddenColsLocal.value.includes(c)
    ? hiddenColsLocal.value.filter((x) => x !== c)
    : [...hiddenColsLocal.value, c]
}

function showAllColsExternal() {
  hiddenColsLocal.value = []
  hideRowNumLocal.value = false
}

defineExpose({
  toggleCol: toggleColExternal,
  showAllCols: showAllColsExternal,
  toggleRowNum: () => (hideRowNumLocal.value = !hideRowNumLocal.value),
  hiddenColsLocal,
  hideRowNumLocal,
})

</script>

<template>
  <div class="grid-wrap" :style="{ '--row-h': ROW_H + 'px' }">
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
            :title="columns[i]"
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
</style>
