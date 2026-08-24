<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { NModal, NSpin } from 'naive-ui'
import * as api from '../api'
import { useAppStore } from '../stores/app'

const props = defineProps<{
  show: boolean
  connId: string | null
  table: string
}>()
const emit = defineEmits<{ (e: 'update:show', v: boolean): void }>()

const store = useAppStore()
const loading = ref(false)
const stats = ref<Record<string, string>>({})

const dbType = computed(() => store.connById(props.connId ?? '')?.dbType ?? 'mysql')

watch(
  () => props.show,
  async (v) => {
    if (!v || !props.connId) return
    loading.value = true
    stats.value = {}
    try {
      const queries: [string, string][] = []
      if (dbType.value === 'mysql') {
        queries.push([
          '基本信息',
          `SELECT TABLE_ROWS, ROUND(DATA_LENGTH/1024/1024, 2) AS data_mb, ROUND(INDEX_LENGTH/1024/1024, 2) AS index_mb, TABLE_COLLATION, ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${props.table}'`,
        ])
      } else if (dbType.value === 'postgres') {
        queries.push([
          '基本信息',
          `SELECT reltuples::bigint AS row_estimate, pg_size_pretty(pg_total_relation_size('${props.table}')) AS total_size, pg_size_pretty(pg_relation_size('${props.table}')) AS data_size, pg_size_pretty(pg_indexes_size('${props.table}')) AS index_size FROM pg_class WHERE relname = '${props.table}'`,
        ])
      } else {
        // SQLite
        queries.push(['行数', `SELECT COUNT(*) FROM "${props.table}"`])
        queries.push(['页面数', `PRAGMA page_count`])
        queries.push(['页面大小', `PRAGMA page_size`])
        queries.push(['空闲页面', `PRAGMA freelist_count`])
      }

      for (const [label, sql] of queries) {
        try {
          const rs = await api.runSql(props.connId, sql, 5)
          const r = rs[0]
          if (r && r.rows.length) {
            const cols = r.columns
            const vals = r.rows[0]
            stats.value[label] = cols.map((c, i) => `${c}: ${vals[i] ?? 'NULL'}`).join('  ·  ')
          }
        } catch {
          // 忽略单条失败
        }
      }
    } finally {
      loading.value = false
    }
  },
)

const statEntries = computed(() => Object.entries(stats.value))
</script>

<template>
  <n-modal
    :show="props.show"
    preset="card"
    :title="`表统计 · ${table}`"
    :style="{ width: '520px' }"
    @update:show="(v: boolean) => emit('update:show', v)"
  >
    <n-spin v-if="loading" size="small" style="width: 100%; padding: 30px 0" />
    <template v-else>
      <div v-for="[label, info] in statEntries" :key="label" class="stat-row">
        <span class="stat-label">{{ label }}</span>
        <span class="stat-value mono">{{ info }}</span>
      </div>
      <div v-if="!statEntries.length" class="empty">暂无统计信息</div>
    </template>
  </n-modal>
</template>

<style scoped>
.stat-row {
  display: flex;
  align-items: baseline;
  gap: 14px;
  padding: 8px 12px;
  border-radius: 8px;
}
.stat-row:hover {
  background: var(--bg-hover);
}
.stat-label {
  width: 80px;
  flex-shrink: 0;
  font-size: 12px;
  color: var(--text-tertiary);
  font-weight: 600;
}
.stat-value {
  flex: 1;
  font-size: 12.5px;
  color: var(--text-secondary);
}
.empty {
  padding: 30px;
  text-align: center;
  color: var(--text-tertiary);
}
</style>
