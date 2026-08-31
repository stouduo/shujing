<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { NButton, NSpin } from 'naive-ui'
import { useAppStore } from '../stores/app'
import type { ErTab } from '../types'
import Icon from './Icon.vue'

const props = defineProps<{ tab: ErTab }>()
const store = useAppStore()

const NODE_W = 230
const HEAD_H = 32
const ROW_H = 21
const GAP_X = 90
const GAP_Y = 46
const MAX_ROWS = 12

const tables = computed(() => store.live[props.tab.connId ?? '']?.tables ?? [])

interface NodeCol {
  name: string
  pk: boolean
  type: string
}
// 列信息从 mock/结构的记忆里拿不到,只有表名 + 外键;PK 标记靠外键被引用列推断
const pkByTable = computed(() => {
  const m: Record<string, Set<string>> = {}
  for (const fk of props.tab.fks) {
    ;(m[fk.refTable] ??= new Set()).add(fk.refColumn)
  }
  return m
})

const fkColsOf = computed(() => {
  const m: Record<string, Set<string>> = {}
  for (const fk of props.tab.fks) {
    ;(m[fk.table] ??= new Set()).add(fk.column)
  }
  return m
})

// 自动分层布局:被引用的表在左,引用方在右
const autoPositions = computed(() => {
  const names = tables.value.filter((t) => t.kind === 'table').map((t) => t.name)
  const deps: Record<string, string[]> = {}
  for (const fk of props.tab.fks) {
    ;(deps[fk.table] ??= []).push(fk.refTable)
  }
  const level: Record<string, number> = {}
  function lv(name: string, stack: Set<string>): number {
    if (level[name] !== undefined) return level[name]
    if (stack.has(name)) return 0 // 环
    stack.add(name)
    const ds = deps[name] ?? []
    const l = names.includes(name) && ds.some((d) => names.includes(d))
      ? Math.max(...ds.filter((d) => names.includes(d)).map((d) => lv(d, stack))) + 1
      : 0
    stack.delete(name)
    level[name] = l
    return l
  }
  for (const n of names) lv(n, new Set())
  const byLevel: Record<number, string[]> = {}
  for (const n of names) {
    const l = level[n] ?? 0
    ;(byLevel[l] ??= []).push(n)
  }
  const pos: Record<string, { x: number; y: number }> = {}
  const levelHeights: Record<number, number> = {}
  for (const l of Object.keys(byLevel).map(Number)) {
    levelHeights[l] = 0
  }
  for (const l of Object.keys(byLevel).map(Number).sort((a, b) => a - b)) {
    for (const n of byLevel[l]) {
      pos[n] = { x: l * (NODE_W + GAP_X), y: levelHeights[l] }
      levelHeights[l] += nodeHeight() + GAP_Y
    }
  }
  return pos
})

function nodeHeight(): number {
  return HEAD_H + ROW_H * MAX_ROWS + 10
}

const positions = computed<Record<string, { x: number; y: number }>>(() => ({
  ...autoPositions.value,
  ...props.tab.positions,
}))

// 视口变换
const zoom = ref(0.9)
const pan = ref({ x: 60, y: 40 })
const canvasEl = ref<HTMLElement | null>(null)

function fit() {
  const pos = positions.value
  const names = Object.keys(pos)
  if (!names.length) return
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const n of names) {
    minX = Math.min(minX, pos[n].x)
    minY = Math.min(minY, pos[n].y)
    maxX = Math.max(maxX, pos[n].x + NODE_W)
    maxY = Math.max(maxY, pos[n].y + nodeHeight())
  }
  const el = canvasEl.value
  if (!el || !isFinite(minX)) return
  const pad = 40
  const z = Math.min(
    (el.clientWidth - pad * 2) / (maxX - minX),
    (el.clientHeight - pad * 2) / (maxY - minY),
    1.4,
  )
  zoom.value = Math.max(0.25, z)
  pan.value = {
    x: pad - minX * zoom.value + (el.clientWidth - pad * 2 - (maxX - minX) * zoom.value) / 2,
    y: pad - minY * zoom.value + (el.clientHeight - pad * 2 - (maxY - minY) * zoom.value) / 2,
  }
}

function onWheel(e: WheelEvent) {
  e.preventDefault()
  const factor = Math.exp(-e.deltaY * 0.0015)
  zoom.value = Math.min(2.5, Math.max(0.25, zoom.value * factor))
}

// 画布平移 / 节点拖拽(pointer 事件统一处理)
const drag = ref<{
  mode: 'pan' | 'node'
  startX: number
  startY: number
  origPan: { x: number; y: number }
  node?: string
  nodeOrig?: { x: number; y: number }
} | null>(null)

function onPointerDown(e: PointerEvent, node?: string) {
  ;(e.target as Element).setPointerCapture?.(e.pointerId)
  if (node) {
    drag.value = {
      mode: 'node',
      startX: e.clientX,
      startY: e.clientY,
      origPan: { ...pan.value },
      node,
      nodeOrig: { ...positions.value[node] },
    }
  } else {
    drag.value = { mode: 'pan', startX: e.clientX, startY: e.clientY, origPan: { ...pan.value } }
  }
}

function onPointerMove(e: PointerEvent) {
  const d = drag.value
  if (!d) return
  const dx = (e.clientX - d.startX) / zoom.value
  const dy = (e.clientY - d.startY) / zoom.value
  if (d.mode === 'pan') {
    pan.value = { x: d.origPan.x + (e.clientX - d.startX), y: d.origPan.y + (e.clientY - d.startY) }
  } else if (d.node && d.nodeOrig) {
    store.moveErNode(
      props.tab.id,
      d.node,
      // 允许负坐标(画布无限延伸),仅防离谱值
      Math.max(-20000, Math.min(20000, Math.round(d.nodeOrig.x + dx))),
      Math.max(-20000, Math.min(20000, Math.round(d.nodeOrig.y + dy))),
    )
  }
}

function onPointerUp() {
  drag.value = null
}

onMounted(() => {
  // 数据就绪后自动适配一次
  setTimeout(fit, 300)
})
onUnmounted(() => undefined)

// 连线路径:源表右缘 → 目标表左缘(三次贝塞尔)
interface Edge {
  d: string
  key: string
}
const edges = computed<Edge[]>(() => {
  const pos = positions.value
  const out: Edge[] = []
  for (const fk of props.tab.fks) {
    const from = pos[fk.table]
    const to = pos[fk.refTable]
    if (!from || !to) continue
    const cols = fkColsOf.value[fk.table]
    let rowIndex = 0
    if (cols) {
      const arr = [...cols]
      rowIndex = Math.min(arr.indexOf(fk.column), MAX_ROWS - 1)
    }
    const y1 = from.y + HEAD_H + ROW_H * rowIndex + ROW_H / 2
    const x1 = from.x + NODE_W
    const toCols = pkByTable.value[fk.refTable]
    let toRow = 0
    if (toCols) {
      const arr = [...toCols]
      toRow = Math.min(arr.indexOf(fk.refColumn), MAX_ROWS - 1)
      if (toRow < 0) toRow = 0
    }
    const y2 = to.y + HEAD_H + ROW_H * toRow + ROW_H / 2
    const x2 = to.x
    const mid = (x1 + x2) / 2
    out.push({
      key: `${fk.table}.${fk.column}->${fk.refTable}.${fk.refColumn}`,
      d: `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`,
    })
  }
  return out
})

function nodeCols(name: string): NodeCol[] {
  const pks = pkByTable.value[name]
  const fks = fkColsOf.value[name]
  const cols: NodeCol[] = []
  // 没有真实列信息时,用主键+外键列合成展示
  const known = new Set<string>([...(pks ?? []), ...(fks ?? [])])
  for (const c of known) {
    cols.push({ name: c, pk: pks?.has(c) ?? false, type: pks?.has(c) ? 'PK' : 'FK' })
  }
  if (!cols.length) cols.push({ name: '(展开表可查看全部字段)', pk: false, type: '' })
  return cols.slice(0, MAX_ROWS)
}
</script>

<template>
  <div class="pane-root">
    <div class="toolbar" data-tauri-drag-region>
      <span class="title"><Icon name="database" :size="13" /> ER 图</span>
      <span class="meta">{{ tables.filter(t => t.kind === 'table').length }} 表 · {{ tab.fks.length }} 关系</span>
      <div class="spacer" data-tauri-drag-region />
      <span class="hint">拖拽节点 · 滚轮缩放 · 空白平移</span>
      <n-button size="small" quaternary @click="fit"><Icon name="refresh" :size="12" /> 适配</n-button>
      <n-button size="small" quaternary @click="store.resetErLayout(tab.id)">重置布局</n-button>
    </div>
    <div
      ref="canvasEl"
      class="canvas"
      @wheel.prevent="onWheel"
      @pointerdown="(e: PointerEvent) => !((e.target as Element).closest('.node')) && onPointerDown(e)"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
    >
      <n-spin v-if="tab.loading" class="loading" size="medium" />
      <div v-else-if="tab.error" class="err mono">{{ tab.error }}</div>
      <svg v-else class="svg" :width="'100%'" :height="'100%'">
        <defs>
          <marker id="er-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 1 L 9 5 L 0 9 z" fill="rgba(122,162,247,0.75)" />
          </marker>
        </defs>
        <g :transform="`translate(${pan.x} ${pan.y}) scale(${zoom})`">
          <path
            v-for="e in edges"
            :key="e.key"
            :d="e.d"
            fill="none"
            stroke="rgba(122,162,247,0.55)"
            stroke-width="1.6"
            marker-end="url(#er-arrow)"
          />
          <g
            v-for="(p, name) in positions"
            :key="name"
            class="node"
            :transform="`translate(${p.x} ${p.y})`"
            @pointerdown.stop="(e: PointerEvent) => onPointerDown(e, String(name))"
          >
            <rect class="node-box" :width="NODE_W" :height="nodeHeight()" rx="10" />
            <rect class="node-head" :width="NODE_W" :height="HEAD_H" rx="10" />
            <rect class="head-fill" y="16" :width="NODE_W" :height="HEAD_H - 16" />
            <text class="head-text" x="12" y="21">{{ name }}</text>
            <g v-for="(c, i) in nodeCols(String(name))" :key="c.name">
              <text
                class="col-text"
                :class="{ pk: c.pk, fk: !c.pk }"
                x="14"
                :y="HEAD_H + 14 + i * ROW_H"
              >{{ c.pk ? '🗝' : '·' }} {{ c.name }}</text>
              <text class="col-type" :x="NODE_W - 12" :y="HEAD_H + 14 + i * ROW_H">{{ c.type }}</text>
            </g>
          </g>
        </g>
      </svg>
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
  gap: 10px;
  height: 44px;
  padding: 0 12px;
  background: var(--bg-elevated);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
}
.title :deep(svg) {
  color: var(--accent);
}
.meta {
  font-size: 12px;
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
}
.spacer {
  flex: 1;
  height: 100%;
}
.hint {
  font-size: 11px;
  color: var(--text-tertiary);
}
.canvas {
  flex: 1;
  min-height: 0;
  position: relative;
  overflow: hidden;
  background:
    radial-gradient(rgba(255, 255, 255, 0.045) 1px, transparent 1px) 0 0 / 22px 22px,
    var(--bg);
  cursor: grab;
  touch-action: none;
}
.canvas:active {
  cursor: grabbing;
}
.svg {
  display: block;
}
.loading {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}
.err {
  margin: 14px;
  padding: 10px 14px;
  border-radius: 10px;
  background: rgba(255, 69, 58, 0.1);
  border: 1px solid rgba(255, 69, 58, 0.25);
  color: #ff8a80;
  font-size: 12px;
}
.node {
  cursor: pointer;
}
.node-box {
  fill: var(--node-bg);
  stroke: rgba(255, 255, 255, 0.14);
  stroke-width: 1;
}
.node:hover .node-box {
  stroke: rgba(133, 135, 246, 0.6);
}
.node-head {
  fill: var(--node-head);
  stroke: rgba(255, 255, 255, 0.14);
  stroke-width: 1;
}
.head-fill {
  fill: var(--node-head);
}
.head-text {
  fill: var(--text);
  font-size: 12.5px;
  font-weight: 700;
  font-family: var(--mono);
}
.col-text {
  font-size: 11.5px;
  fill: var(--text-secondary);
  font-family: var(--mono);
}
.col-text.pk {
  fill: var(--accent);
  font-weight: 700;
}
.col-text.fk {
  fill: #9ece6a;
}
.col-type {
  font-size: 9.5px;
  fill: #6e6e78;
  text-anchor: end;
  font-family: var(--mono);
}
</style>
