<script setup lang="ts">
import { computed } from 'vue'
import { NButton, useMessage } from 'naive-ui'
import { useAppStore } from '../stores/app'
import type { StructureTab } from '../types'
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
</script>

<template>
  <div class="pane-root">
    <div class="toolbar" data-tauri-drag-region>
      <span class="tbl-name mono" :title="tab.table">
        <Icon name="table" :size="13" class="tbl-ic" /> {{ tab.table }}
      </span>
      <div class="seg-group">
        <n-button size="small" quaternary :loading="tab.loading" title="刷新 (F5)" @click="refresh">
          <Icon name="refresh" :size="13" />
        </n-button>
        <n-button size="small" quaternary title="复制建表 DDL" :disabled="!ddl.trim()" @click="copyDdl">
          <Icon name="copy" :size="13" /> 复制 DDL
        </n-button>
      </div>
      <div class="spacer" data-tauri-drag-region />
    </div>

    <div v-if="tab.error" class="err mono">{{ tab.error }}</div>
    <div v-else-if="tab.loading && !tab.data" class="empty">加载中…</div>
    <div v-else-if="!tab.data" class="empty">暂无数据</div>
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
        <pre v-if="ddl.trim()" class="ddl-pre mono">{{ ddl }}</pre>
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
</style>
