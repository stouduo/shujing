<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { NButton, NModal, useMessage } from 'naive-ui'
import Icon from './Icon.vue'

const props = defineProps<{
  columns: string[]
  rows: (string | null)[][]
  rowIndex: number
  /** 跨页全局行号(展示用) */
  globalNo: number
  /** 未保存变更(表数据页传入) */
  changes?: Record<number, Record<string, string | null>>
}>()
const emit = defineEmits<{ (e: 'close'): void }>()

const message = useMessage()

// 面板宽度:默认占容器 30%,可拖 15% ~ 75%
const width = ref(320)
const hDrag = ref<{ startX: number; startW: number } | null>(null)
const host = ref<HTMLElement | null>(null)

function clampWidth(w: number): number {
  const total = host.value?.parentElement?.clientWidth ?? 1200
  return Math.max(total * 0.15, Math.min(total * 0.75, w))
}

onMounted(() => {
  const total = host.value?.parentElement?.clientWidth ?? 1200
  width.value = clampWidth(total * 0.3)
})

function startHDrag(e: PointerEvent) {
  e.preventDefault()
  hDrag.value = { startX: e.clientX, startW: width.value }
  ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
}

function onHDrag(e: PointerEvent) {
  const d = hDrag.value
  if (!d) return
  width.value = clampWidth(d.startW - (e.clientX - d.startX))
}

/** 合并未保存变更后的当前值 */
function valueOf(col: string): string | null {
  const ch = props.changes?.[props.rowIndex]?.[col]
  if (ch !== undefined) return ch
  const i = props.columns.indexOf(col)
  return props.rows[props.rowIndex]?.[i] ?? null
}

function isChanged(col: string): boolean {
  return props.changes?.[props.rowIndex]?.[col] !== undefined
}

function isLong(col: string): boolean {
  const v = valueOf(col)
  return v !== null && (v.length > 64 || v.includes('\n'))
}

// ── 全文本查看器 ──────────────────────────────────────
const viewer = ref<{ col: string; text: string } | null>(null)

function openViewer(col: string) {
  const v = valueOf(col)
  if (v === null) return
  viewer.value = { col, text: v }
}

async function copyAll() {
  if (!viewer.value) return
  try {
    await navigator.clipboard.writeText(viewer.value.text)
    message.success('已复制全文')
  } catch {
    message.error('剪贴板不可用')
  }
}

async function copyRowJson() {
  const obj: Record<string, string | null> = {}
  for (const c of props.columns) obj[c] = valueOf(c)
  try {
    await navigator.clipboard.writeText(JSON.stringify(obj, null, 2))
    message.success('已复制整行 JSON')
  } catch {
    message.error('剪贴板不可用')
  }
}

function formatJson() {
  if (!viewer.value) return
  try {
    const parsed = JSON.parse(viewer.value.text)
    viewer.value.text = JSON.stringify(parsed, null, 2)
  } catch {
    message.error('内容不是有效的 JSON')
  }
}
</script>

<template>
  <div ref="host" class="record-panel" :style="{ width: width + 'px' }">
    <div
      class="rp-resize"
      title="拖拽调整宽度"
      @pointerdown="startHDrag"
      @pointermove="onHDrag"
      @pointerup="hDrag = null"
      @pointercancel="hDrag = null"
    />
    <div class="rp-head">
      <span class="rp-title"><Icon name="list" :size="12" /> 记录 #{{ globalNo.toLocaleString() }}</span>
      <span class="rp-meta">{{ columns.length }} 个字段</span>
      <div class="rp-spacer" />
      <n-button size="tiny" quaternary title="复制整行 JSON" @click="copyRowJson">
        <Icon name="copy" :size="12" /> JSON
      </n-button>
      <n-button size="tiny" quaternary title="收起面板" @click="emit('close')">
        <Icon name="x" :size="12" />
      </n-button>
    </div>
    <div class="rp-body">
      <div
        v-for="c in columns"
        :key="c"
        class="rp-row"
        :class="{ changed: isChanged(c) }"
        @click="openViewer(c)"
      >
        <div class="rp-name mono" :title="c">{{ c }}</div>
        <div class="rp-value mono">
          <span v-if="valueOf(c) === null" class="null">NULL</span>
          <template v-else>{{ valueOf(c) }}</template>
        </div>
        <button v-if="isLong(c)" class="rp-expand" title="查看完整内容" @click.stop="openViewer(c)">
          ⤢
        </button>
        <span v-else-if="isChanged(c)" class="rp-changed-mark" title="未保存的修改">●</span>
      </div>
    </div>

    <n-modal
      :show="viewer !== null"
      preset="card"
      :title="viewer ? `字段:${viewer.col}` : ''"
      class="viewer-modal"
      :style="{ width: '72vw' }"
      @update:show="(v: boolean) => !v && (viewer = null)"
    >
      <div v-if="viewer" class="viewer-toolbar">
        <n-button size="tiny" quaternary @click="copyAll">
          <Icon name="copy" :size="12" /> 复制全文
        </n-button>
        <n-button size="tiny" quaternary title="格式化为 JSON" @click="formatJson">
          <Icon name="zap" :size="12" /> JSON 格式化
        </n-button>
        <span class="viewer-len">{{ viewer.text.length.toLocaleString() }} 字符</span>
      </div>
      <pre v-if="viewer" class="viewer-content mono">{{ viewer.text }}</pre>
    </n-modal>
  </div>
</template>

<style scoped>
.record-panel {
  position: relative;
  flex-shrink: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border-strong);
  border-radius: 10px;
  background: var(--record-bg);
  overflow: hidden;
}
.rp-resize {
  position: absolute;
  top: 0;
  left: -3px;
  bottom: 0;
  width: 7px;
  cursor: ew-resize;
  z-index: 6;
}
.rp-resize:hover {
  background: rgba(10, 132, 255, 0.3);
}
.rp-head {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 32px;
  padding: 0 10px;
  background: var(--record-head);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.rp-title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--accent);
}
.rp-meta {
  font-size: 11px;
  color: var(--text-tertiary);
}
.rp-spacer {
  flex: 1;
}
.rp-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 4px 0;
}
.rp-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 3px 12px 3px 10px;
  border-left: 2px solid transparent;
  cursor: pointer;
  transition: background-color 0.1s ease;
}
.rp-row:hover {
  background: var(--bg-hover);
}
.rp-row.changed {
  border-left-color: var(--edit-mark);
  background: var(--edit-line);
}
.rp-name {
  width: 118px;
  flex-shrink: 0;
  font-size: 12px;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
}
.rp-value {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  color: var(--cell-color);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 22px;
}
.rp-row.changed .rp-value {
  color: var(--edit-hl-fg);
}
.null {
  color: var(--null-color);
  font-style: italic;
}
.rp-expand {
  border: 1px solid var(--border-strong);
  border-radius: 4px;
  background: transparent;
  color: var(--text-tertiary);
  font-size: 11px;
  width: 20px;
  height: 20px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.rp-expand:hover {
  color: var(--accent);
  border-color: var(--accent);
}
.rp-changed-mark {
  color: #ffaa00;
  font-size: 8px;
  width: 20px;
  text-align: center;
  flex-shrink: 0;
}

/* 查看器弹窗 */
.viewer-toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 10px;
}
.viewer-len {
  margin-left: auto;
  font-size: 11px;
  color: var(--text-tertiary);
}
.viewer-content {
  margin: 0;
  max-height: 64vh;
  overflow: auto;
  font-size: 12.5px;
  line-height: 1.7;
  color: var(--cell-color);
  white-space: pre-wrap;
  word-break: break-word;
  user-select: text;
}
</style>
