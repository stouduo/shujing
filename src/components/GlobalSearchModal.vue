<script setup lang="ts">
import { computed, ref } from 'vue'
import { NButton, NInput, NModal, NSelect, NSpin, useMessage } from 'naive-ui'
import { searchAllTables } from '../api'
import { useAppStore } from '../stores/app'
import type { SearchHit } from '../types'
import Icon from './Icon.vue'

const props = defineProps<{ show: boolean }>()
const emit = defineEmits<{ (e: 'update:show', v: boolean): void }>()

const store = useAppStore()
const message = useMessage()

const kw = ref('')
const searching = ref(false)
const searched = ref(false)
const hits = ref<SearchHit[]>([])
const error = ref('')

const connOptions = computed(() =>
  store.saved
    .filter((c) => store.live[c.id])
    .map((c) => ({ label: c.name, value: c.id })),
)

const connId = ref<string | null>(null)

const effectiveConn = computed(() => connId.value ?? connOptions.value[0]?.value ?? null)

async function doSearch() {
  if (!kw.value.trim()) {
    message.warning('请输入关键词')
    return
  }
  if (!effectiveConn.value) {
    message.warning('没有在线连接,请先在左侧连接数据库')
    return
  }
  searching.value = true
  error.value = ''
  try {
    hits.value = await searchAllTables(effectiveConn.value, kw.value.trim())
    searched.value = true
  } catch (e) {
    error.value = String(e)
  } finally {
    searching.value = false
  }
}

/** 点击命中:打开对应表并筛到该关键词 */
async function goto(hit: SearchHit) {
  if (!effectiveConn.value) return
  emit('update:show', false)
  await store.openTable(effectiveConn.value, { name: hit.table, kind: 'table' })
  const tab = store.tabs[store.tabs.length - 1]
  if (tab?.kind === 'table') {
    tab.filters = [{ column: hit.column, op: 'LIKE', value: kw.value.trim() }]
    await store.applyFilters(tab.id)
  }
}

function preview(hit: SearchHit): string {
  return hit.row.map((v) => v ?? 'NULL').join(' | ').slice(0, 110)
}
</script>

<template>
  <n-modal
    :show="props.show"
    preset="card"
    title="全局搜索数据"
    :style="{ width: '680px' }"
    @update:show="(v: boolean) => emit('update:show', v)"
  >
    <div class="gs-row">
      <n-select
        v-model:value="connId"
        size="small"
        :options="connOptions"
        :placeholder="connOptions[0]?.label ?? '无在线连接'"
        class="gs-conn"
      />
      <n-input
        v-model:value="kw"
        size="small"
        placeholder="关键词,回车搜索所有表…"
        class="gs-input"
        @keyup.enter="doSearch"
      >
        <template #prefix>
          <Icon name="search" :size="12" />
        </template>
      </n-input>
      <n-button size="small" type="primary" :loading="searching" @click="doSearch">搜索</n-button>
    </div>
    <div class="gs-note">在所选连接的全部表的所有列中查找(逐表扫描,大库可能较慢)</div>

    <div class="gs-body">
      <n-spin v-if="searching" class="gs-loading" size="medium" />
      <div v-else-if="error" class="gs-err mono">{{ error }}</div>
      <template v-else-if="searched">
        <div class="gs-count">
          {{ hits.length ? `命中 ${hits.length} 处` : '没有命中' }}
        </div>
        <div
          v-for="(h, i) in hits"
          :key="i"
          class="gs-hit"
          @click="goto(h)"
        >
          <span class="gs-table mono">{{ h.table }}</span>
          <span class="gs-col mono">{{ h.column }}</span>
          <span class="gs-preview mono">{{ preview(h) }}</span>
        </div>
      </template>
    </div>
    <template #footer>
      <div class="gs-foot">点击命中行 → 打开对应表并自动筛选</div>
    </template>
  </n-modal>
</template>

<style scoped>
.gs-row {
  display: flex;
  gap: 8px;
}
.gs-conn {
  width: 180px;
  flex-shrink: 0;
}
.gs-input {
  flex: 1;
}
.gs-note {
  margin-top: 6px;
  font-size: 11px;
  color: var(--text-tertiary);
}
.gs-body {
  margin-top: 12px;
  min-height: 120px;
  max-height: 380px;
  overflow-y: auto;
  border: 1px solid var(--border-strong);
  border-radius: 10px;
  background: var(--bg-grid);
  padding: 6px;
}
.gs-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px 0;
}
.gs-count {
  padding: 6px 8px;
  font-size: 11.5px;
  color: var(--text-tertiary);
}
.gs-hit {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 10px;
  border-radius: 7px;
  cursor: pointer;
}
.gs-hit:hover {
  background: rgba(133, 135, 246, 0.12);
}
.gs-table {
  flex-shrink: 0;
  font-size: 12px;
  font-weight: 700;
  color: var(--accent);
}
.gs-col {
  flex-shrink: 0;
  font-size: 11.5px;
  color: #9ece6a;
  max-width: 130px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.gs-preview {
  font-size: 11.5px;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.gs-err {
  margin: 8px;
  padding: 8px 12px;
  border-radius: 8px;
  background: rgba(255, 69, 58, 0.1);
  border: 1px solid rgba(255, 69, 58, 0.25);
  color: #ff8a80;
  font-size: 12px;
}
.gs-foot {
  font-size: 11px;
  color: var(--text-tertiary);
}
</style>
