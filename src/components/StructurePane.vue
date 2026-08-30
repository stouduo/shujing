<script setup lang="ts">
import { computed, ref } from 'vue'
import { NButton, useMessage } from 'naive-ui'
import { useAppStore } from '../stores/app'
import type { ColumnSpec, StructureTab } from '../types'
import Icon from './Icon.vue'

const props = defineProps<{ tab: StructureTab }>()
const store = useAppStore()
const message = useMessage()

const cols = computed(() => props.tab.data?.columns ?? [])
const idxs = computed(() => props.tab.data?.indexes ?? [])
const ddl = computed(() => props.tab.data?.ddl ?? '')

function refresh() {
  if (props.tab.connId) store.loadStructure(props.tab.id)
}

async function copyText(text: string, tip: string) {
  try {
    await navigator.clipboard.writeText(text)
    message.success(tip)
  } catch {
    message.error('剪贴板不可用')
  }
}

function copyDdl() {
  if (!ddl.value.trim()) return
  copyText(ddl.value, 'DDL 已复制')
}

function escapeHtmlDdl(s: string): string {
  return s.replace(/[&<>]/g, (ch: string) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[ch] as string,
  )
}

/** DDL 简易语法着色:关键字/字符串/注释 */
const KEYWORDS =
  /^(CREATE|TABLE|IF|NOT|EXISTS|PRIMARY|KEY|UNIQUE|INDEX|DEFAULT|NULL|AUTO_INCREMENT|COMMENT|CONSTRAINT|FOREIGN|REFERENCES|ENGINE|CHARSET|COLLATE|INT|INTEGER|TINYINT|BIGINT|VARCHAR|CHAR|TEXT|DATE|DATETIME|TIMESTAMP|DECIMAL|DOUBLE|FLOAT|BOOLEAN|BLOB|JSON)$/i

function highlightDdl(src: string): string {
  let out = ''
  const re = /('(?:[^']|'')*')|(--[^\n]*)/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) {
    out += colorWords(src.slice(last, m.index))
    const seg = m[0]
    if (seg.startsWith("'")) out += `<span class="tk-str">${escapeHtmlDdl(seg)}</span>`
    else out += `<span class="tk-com">${escapeHtmlDdl(seg)}</span>`
    last = m.index + seg.length
  }
  out += colorWords(src.slice(last))
  return out
}
function colorWords(seg: string): string {
  return escapeHtmlDdl(seg).replace(/([A-Za-z_][A-Za-z0-9_]*)/g, (w: string) =>
    KEYWORDS.test(w) ? `<span class="tk-kw">${w}</span>` : w,
  )
}

// ── 结构编辑:驱动一个并行设计器标签,复用其 ALTER 生成与执行 ──
const editing = ref(false)
const applying = ref(false)
const designerTabId = ref<string | null>(null)

const readOnly = computed(() => {
  const c = props.tab.connId ? store.connById(props.tab.connId) : undefined
  return !!c?.readOnly
})

/** 承载编辑的设计器标签(同连接同表,复用已打开的) */
const dtab = computed(() =>
  designerTabId.value
    ? store.tabs.find(
        (t) => t.id === designerTabId.value && t.kind === 'designer',
      )
    : null,
)
const editCols = computed<ColumnSpec[]>(() =>
  dtab.value && dtab.value.kind === 'designer' ? dtab.value.columns : [],
)

async function beginEdit() {
  const cid = props.tab.connId
  if (!cid) return
  let d = store.tabs.find(
    (t) =>
      t.kind === 'designer' &&
      t.mode === 'edit' &&
      t.connId === cid &&
      t.tableName === props.tab.table,
  )
  if (!d) {
    await store.openDesigner(cid, props.tab.table)
    d = store.tabs.find(
      (t) =>
        t.kind === 'designer' &&
        t.mode === 'edit' &&
        t.connId === cid &&
        t.tableName === props.tab.table,
    )
  }
  if (!d || d.kind !== 'designer') {
    message.error('无法打开结构编辑器')
    return
  }
  designerTabId.value = d.id
  // 留在结构页编辑(设计器标签仅在后台承载状态)
  store.activeTabId = props.tab.id
  editing.value = true
}

function discardEdit() {
  if (designerTabId.value) store.closeTab(designerTabId.value)
  designerTabId.value = null
  editing.value = false
}

const previewSql = computed(() => {
  if (!designerTabId.value) return '-- 进入编辑后,修改字段将在此生成 ALTER 语句'
  const { create, alters, warnings } = store.designerSql(designerTabId.value)
  const parts: string[] = []
  if (create) parts.push(create)
  parts.push(...alters)
  if (warnings.length) parts.push('-- ' + warnings.join('\n-- '))
  return parts.join('\n\n') || '-- 暂无变更'
})

async function applyEdit() {
  if (!designerTabId.value || applying.value) return
  applying.value = true
  try {
    await store.saveDesigner(designerTabId.value)
    const d = store.tabs.find((t) => t.id === designerTabId.value)
    if (d && d.kind === 'designer' && d.error) {
      message.error(d.error)
    } else {
      message.success('结构变更已应用')
    }
    if (designerTabId.value) store.closeTab(designerTabId.value)
    designerTabId.value = null
    editing.value = false
    refresh()
  } finally {
    applying.value = false
  }
}

function addField() {
  if (!dtab.value || dtab.value.kind !== 'designer') return
  dtab.value.columns.push({
    name: '',
    dataType: 'VARCHAR',
    length: '255',
    nullable: true,
    pk: false,
    autoInc: false,
    default: '',
    comment: '',
    existing: false,
  })
}

function removeField(i: number) {
  const c = editCols.value[i]
  if (!c || c.existing) {
    message.warning('编辑模式暂不支持删除已有字段(避免误删数据)')
    return
  }
  dtab.value?.kind === 'designer' && dtab.value.columns.splice(i, 1)
}
</script>

<template>
  <div class="pane-root">
    <div class="toolbar" data-tauri-drag-region>
      <span class="tbl-name mono" :title="tab.table">
        <Icon name="table" :size="13" class="tbl-ic" /> {{ tab.table }}
      </span>
      <div class="seg-group">
        <template v-if="!editing">
          <n-button size="small" quaternary :loading="tab.loading" title="刷新 (F5)" @click="refresh">
            <Icon name="refresh" :size="13" />
          </n-button>
          <n-button size="small" quaternary title="复制建表 DDL" :disabled="!ddl.trim()" @click="copyDdl">
            <Icon name="copy" :size="13" /> 复制 DDL
          </n-button>
          <n-button
            size="small"
            quaternary
            type="primary"
            :disabled="readOnly"
            :title="readOnly ? '只读连接不可编辑' : '进入结构编辑(改列/加列)'"
            @click="beginEdit"
          >
            <Icon name="pencil" :size="13" /> 编辑结构
          </n-button>
        </template>
        <template v-else>
          <span class="edit-badge">编辑中</span>
          <n-button size="small" quaternary @click="discardEdit">放弃</n-button>
          <n-button size="small" type="primary" :loading="applying" @click="applyEdit">
            <Icon name="save" :size="13" /> 应用更改
          </n-button>
        </template>
      </div>
      <div class="spacer" data-tauri-drag-region />
    </div>

    <div v-if="tab.error" class="err mono">{{ tab.error }}</div>
    <div v-else-if="tab.loading && !tab.data" class="empty">加载中…</div>
    <div v-else-if="!tab.data" class="empty">暂无数据</div>

    <!-- 编辑模式 -->
    <div v-else-if="editing" class="scroll">
      <div class="cols-head">
        <div class="c-name">字段名</div>
        <div class="c-type">类型</div>
        <div class="c-len">长度</div>
        <div class="c-bool" title="非空">NOT NULL</div>
        <div class="c-default">默认值</div>
        <div class="c-comment">注释</div>
        <div class="c-op" />
      </div>
      <div v-for="(c, i) in editCols" :key="i" class="col-row">
        <div class="c-name"><input v-model="c.name" class="e-input mono" placeholder="name" /></div>
        <div class="c-type"><input v-model="c.dataType" class="e-input mono" placeholder="VARCHAR" /></div>
        <div class="c-len"><input v-model="c.length" class="e-input mono" placeholder="-" /></div>
        <div class="c-bool">
          <input type="checkbox" class="cb" :checked="!c.nullable" @change="c.nullable = !($event.target as HTMLInputElement).checked" />
        </div>
        <div class="c-default"><input v-model="c.default" class="e-input mono" /></div>
        <div class="c-comment"><input v-model="c.comment" class="e-input" /></div>
        <div class="c-op">
          <button class="f-del" :disabled="c.existing" :title="c.existing ? '已有字段不支持删除' : '删除字段'" @click="removeField(i)">−</button>
        </div>
      </div>
      <button class="add-field" @click="addField">
        <Icon name="plus" :size="12" /> 添加字段
      </button>
      <div class="preview">
        <div class="preview-title">SQL 预览(应用更改时执行)</div>
        <pre class="preview-sql mono">{{ previewSql }}</pre>
      </div>
    </div>

    <!-- 查看模式 -->
    <div v-else class="scroll">
      <!-- 字段 -->
      <div class="sec-block">
        <div class="sec-head">字段 ({{ cols.length }})</div>
        <table class="st-table">
          <thead>
            <tr><th>列名</th><th>类型</th><th>可空</th><th>键</th><th>默认值</th><th>额外</th><th>注释</th></tr>
          </thead>
          <tbody>
            <tr v-for="c in cols" :key="c.name">
              <td class="mono strong">{{ c.name }}</td>
              <td class="mono">{{ c.dataType }}</td>
              <td>{{ c.nullable ? 'YES' : 'NO' }}</td>
              <td class="mono">{{ c.key || '' }}</td>
              <td class="mono">{{ c.default ?? 'NULL' }}</td>
              <td class="mono">{{ c.extra || '' }}</td>
              <td>{{ c.comment || '' }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 索引 -->
      <div v-if="idxs.length" class="sec-block">
        <div class="sec-head">索引 ({{ idxs.length }})</div>
        <table class="st-table">
          <thead>
            <tr><th>名称</th><th>列</th><th>唯一</th></tr>
          </thead>
          <tbody>
            <tr v-for="ix in idxs" :key="ix.name">
              <td class="mono strong">{{ ix.name }}</td>
              <td class="mono">{{ ix.columns }}</td>
              <td>{{ ix.unique ? 'UNIQUE' : '' }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- DDL -->
      <div class="sec-block">
        <div class="sec-head">DDL (建表语句)</div>
        <pre v-if="ddl.trim()" class="ddl-pre mono" v-html="highlightDdl(ddl)"></pre>
        <div v-else class="ddl-empty">当前连接类型不提供 DDL</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.pane-root {
  flex: 1;
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg);
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 42px;
  padding: 0 12px;
  background: var(--bg-elevated);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.tbl-name {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  max-width: 300px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tbl-ic {
  color: var(--accent);
}
.seg-group {
  display: flex;
  align-items: center;
  gap: 2px;
}
.spacer {
  flex: 1;
}
.edit-badge {
  font-size: 12px;
  font-weight: 600;
  color: var(--warn);
  padding: 3px 10px;
  border: 1px solid rgba(255, 159, 10, 0.35);
  background: rgba(255, 159, 10, 0.1);
  border-radius: 6px;
}
.scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 12px 14px;
}
.sec-block {
  margin-bottom: 18px;
}
.sec-head {
  font-size: 12px;
  font-weight: 700;
  color: var(--text-secondary);
  padding-bottom: 6px;
  margin-bottom: 6px;
  border-bottom: 1px solid var(--border);
}
.st-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
.st-table th {
  text-align: left;
  font-weight: 600;
  color: var(--text-tertiary);
  padding: 5px 10px 5px 0;
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
}
.st-table td {
  padding: 5px 10px 5px 0;
  border-bottom: 1px solid var(--border);
  color: var(--text-secondary);
  vertical-align: top;
}
.st-table tr:hover td {
  color: var(--text);
}
.strong {
  color: var(--text);
  font-weight: 600;
}
.ddl-pre {
  margin: 0;
  padding: 12px 14px;
  background: var(--bg-grid, rgba(255, 255, 255, 0.03));
  border: 1px solid var(--border);
  border-radius: 8px;
  font-size: 12px;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-all;
  color: var(--text);
  user-select: text;
}
.ddl-pre :deep(.tk-kw) {
  color: #7cb8ff;
  font-weight: 600;
}
.ddl-pre :deep(.tk-str) {
  color: #ffd479;
}
.ddl-pre :deep(.tk-com) {
  color: var(--text-tertiary);
  font-style: italic;
}
.ddl-empty {
  font-size: 12px;
  color: var(--text-tertiary);
  padding: 8px 2px;
}
.err {
  margin: 12px;
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
  font-size: 12.5px;
}

/* ── 编辑模式 ── */
.cols-head,
.col-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.cols-head {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-tertiary);
  padding: 0 4px 6px;
  border-bottom: 1px solid var(--border);
}
.col-row {
  padding: 3px 0 3px 4px;
  border-radius: 6px;
}
.col-row:hover {
  background: var(--bg-hover);
}
.c-name {
  width: 170px;
  flex-shrink: 0;
}
.c-type {
  width: 140px;
  flex-shrink: 0;
}
.c-len {
  width: 72px;
  flex-shrink: 0;
}
.c-bool {
  width: 70px;
  text-align: center;
  flex-shrink: 0;
  font-size: 11px;
  color: var(--text-tertiary);
}
.c-default {
  width: 130px;
  flex-shrink: 0;
}
.c-comment {
  flex: 1;
  min-width: 80px;
}
.c-op {
  width: 30px;
  flex-shrink: 0;
  text-align: center;
}
.e-input {
  width: 100%;
  height: 24px;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: var(--input-bg);
  color: var(--text);
  font-size: 12px;
  padding: 0 6px;
  outline: none;
}
.e-input:focus {
  border-color: var(--accent);
}
.cb {
  accent-color: var(--accent);
  cursor: pointer;
}
.f-del {
  width: 20px;
  height: 20px;
  border: 1px solid var(--border-strong);
  border-radius: 4px;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
}
.f-del:hover:not(:disabled) {
  color: var(--danger);
  border-color: var(--danger);
}
.f-del:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}
.add-field {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 26px;
  padding: 0 12px;
  margin-top: 8px;
  border: 1px dashed var(--border-strong);
  border-radius: 6px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
}
.add-field:hover {
  color: var(--accent);
  border-color: var(--accent);
}
.preview {
  margin-top: 14px;
  border: 1px solid var(--border-strong);
  border-radius: 10px;
  background: var(--bg-grid);
  overflow: hidden;
}
.preview-title {
  padding: 6px 12px;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-tertiary);
  background: var(--bg-head);
  border-bottom: 1px solid var(--border);
}
.preview-sql {
  margin: 0;
  padding: 10px 14px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--cell-color);
  white-space: pre-wrap;
  user-select: text;
  max-height: 220px;
  overflow: auto;
}
</style>
