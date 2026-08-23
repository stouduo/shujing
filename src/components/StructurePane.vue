<script setup lang="ts">
import { computed, ref } from 'vue'
import { NSpin, NTabPane, NTabs } from 'naive-ui'
import { useAppStore } from '../stores/app'
import type { ExecResult, StructureTab } from '../types'
import ResultsGrid from './ResultsGrid.vue'

const props = defineProps<{ tab: StructureTab }>()
const store = useAppStore()

const section = ref<'columns' | 'indexes' | 'ddl'>('columns')

const columnsView = computed<ExecResult | null>(() => {
  const d = props.tab.data
  if (!d) return null
  return {
    columns: ['字段', '类型', '可空', '键', '默认值', '额外', '注释'],
    rows: d.columns.map((c) => [
      c.name,
      c.dataType,
      c.nullable ? 'YES' : 'NO',
      c.key,
      c.default,
      c.extra,
      c.comment,
    ]),
    affected: 0,
    truncated: false,
    elapsedMs: 0,
  }
})

const indexesView = computed<ExecResult | null>(() => {
  const d = props.tab.data
  if (!d) return null
  return {
    columns: ['索引名', '列', '唯一'],
    rows: d.indexes.map((i) => [i.name, i.columns, i.unique ? '✓' : '']),
    affected: 0,
    truncated: false,
    elapsedMs: 0,
  }
})

const hasDdl = computed(() => !!(props.tab.data && props.tab.data.ddl))

function refresh() {
  store.loadStructure(props.tab.id)
}
</script>

<template>
  <div class="pane-root">
    <div class="toolbar" data-tauri-drag-region>
      <span class="table-name mono" :title="tab.table">☰ {{ tab.table }}</span>
      <n-spin v-if="tab.loading" :size="14" />
      <n-button v-else size="small" quaternary @click="refresh">↻ 刷新</n-button>
      <div class="spacer" data-tauri-drag-region />
      <span v-if="tab.data" class="meta">
        {{ tab.data.columns.length }} 字段 · {{ tab.data.indexes.length }} 索引
      </span>
    </div>
    <div class="body">
      <div v-if="tab.error" class="err mono">{{ tab.error }}</div>
      <n-spin v-else-if="tab.loading && !tab.data" class="loading" size="medium" />
      <div v-else-if="tab.data" class="content">
        <n-tabs
          :value="section"
          type="segment"
          size="small"
          class="section-tabs"
          @update:value="(v: string | number) => (section = v as typeof section)"
        >
          <n-tab-pane name="columns" tab="字段" display-directive="show">
            <ResultsGrid
              v-if="columnsView"
              class="grid"
              :columns="columnsView.columns"
              :rows="columnsView.rows"
              :truncated="false"
            />
          </n-tab-pane>
          <n-tab-pane name="indexes" tab="索引" display-directive="show">
            <ResultsGrid
              v-if="indexesView"
              class="grid"
              :columns="indexesView.columns"
              :rows="indexesView.rows"
              :truncated="false"
            />
          </n-tab-pane>
          <n-tab-pane v-if="hasDdl" name="ddl" tab="DDL" display-directive="show">
            <div class="ddl-wrap">
              <pre class="ddl mono">{{ tab.data?.ddl }}</pre>
            </div>
          </n-tab-pane>
        </n-tabs>
      </div>
      <div v-else class="empty">无结构信息</div>
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
  height: 44px;
  padding: 0 12px;
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
}
.spacer {
  flex: 1;
  height: 100%;
}
.meta {
  color: var(--text-tertiary);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 10px 12px 12px;
}
.content {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
/* 让 n-tabs 内部布局撑满 */
.content :deep(.n-tabs) {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.content :deep(.n-tabs-pane-wrapper) {
  flex: 1;
  min-height: 0;
}
.content :deep(.n-tab-pane) {
  height: 100%;
  padding: 10px 0 0;
}
.grid {
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
.loading {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}
.err {
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
.ddl-wrap {
  height: 100%;
  border: 1px solid var(--border-strong);
  border-radius: 10px;
  background: var(--bg-grid);
  overflow: auto;
}
.ddl {
  margin: 0;
  padding: 14px 16px;
  font-size: 12px;
  line-height: 1.7;
  color: var(--cell-color);
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
