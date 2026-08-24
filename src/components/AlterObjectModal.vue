<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { NButton, NCheckbox, NInput, NModal, NSelect, useMessage } from 'naive-ui'
import * as api from '../api'
import { useAppStore } from '../stores/app'
import type { DbType, TableStructure } from '../types'
import Icon from './Icon.vue'

const props = defineProps<{
  show: boolean
  connId: string | null
  table: string
  /** 'index' | 'fk' */
  mode: 'index' | 'fk'
}>()
const emit = defineEmits<{ (e: 'update:show', v: boolean): void }>()

const store = useAppStore()
const message = useMessage()

const structure = ref<TableStructure | null>(null)
const loading = ref(false)
const saving = ref(false)

// 索引表单
const idxName = ref('')
const idxColumns = ref<string[]>([])
const idxUnique = ref(false)

// 外键表单
const fkColumn = ref<string | null>(null)
const fkRefTable = ref<string | null>(null)
const fkRefColumn = ref<string | null>(null)

const dbType = computed<DbType>(() => store.connById(props.connId ?? '')?.dbType ?? 'mysql')
const isReadOnly = computed(() => !!store.connById(props.connId ?? '')?.readOnly)

const columnOptions = computed(() =>
  (structure.value?.columns ?? []).map((c) => ({ label: `${c.name} (${c.dataType})`, value: c.name })),
)

const tableOptions = computed(() => {
  const id = props.connId
  if (!id) return []
  return (store.live[id]?.tables ?? [])
    .filter((t) => t.kind === 'table')
    .map((t) => ({ label: t.name, value: t.name }))
})

const refColumnOptions = computed(() => {
  // 简化:引用表的列需要另查,这里先用所有当前表列
  return columnOptions.value
})

watch(
  () => props.show,
  async (v) => {
    if (!v || !props.connId) return
    loading.value = true
    idxName.value = ''
    idxColumns.value = []
    idxUnique.value = false
    fkColumn.value = null
    fkRefTable.value = null
    fkRefColumn.value = null
    try {
      structure.value = await api.getTableStructure(props.connId, props.table)
    } catch {
      structure.value = null
    } finally {
      loading.value = false
    }
  },
)

function quote(name: string): string {
  const q = dbType.value === 'mysql' ? '`' : '"'
  return q + name.split(q).join(q + q) + q
}

async function create() {
  if (!props.connId) return
  if (isReadOnly.value) {
    message.error('只读连接不允许修改')
    return
  }
  const qt = quote(props.table)
  let sql: string

  if (props.mode === 'index') {
    if (!idxName.value.trim() || !idxColumns.value.length) {
      message.warning('请填写索引名并选择列')
      return
    }
    const cols = idxColumns.value.map(quote).join(', ')
    sql = dbType.value === 'mysql'
      ? `CREATE ${idxUnique.value ? 'UNIQUE ' : ''}INDEX ${quote(idxName.value)} ON ${qt} (${cols})`
      : `CREATE ${idxUnique.value ? 'UNIQUE ' : ''}INDEX ${quote(idxName.value)} ON ${qt} (${cols})`
  } else {
    if (!fkColumn.value || !fkRefTable.value || !fkRefColumn.value) {
      message.warning('请选择列、引用表和引用列')
      return
    }
    const name = `fk_${props.table}_${fkColumn.value}`
    if (dbType.value === 'mysql') {
      sql = `ALTER TABLE ${qt} ADD CONSTRAINT ${quote(name)} FOREIGN KEY (${quote(fkColumn.value)}) REFERENCES ${quote(fkRefTable.value)}(${quote(fkRefColumn.value)})`
    } else {
      sql = `ALTER TABLE ${qt} ADD CONSTRAINT ${quote(name)} FOREIGN KEY (${quote(fkColumn.value)}) REFERENCES ${quote(fkRefTable.value)}(${quote(fkRefColumn.value)})`
    }
  }

  saving.value = true
  try {
    await api.runSql(props.connId, sql, 1)
    message.success(props.mode === 'index' ? '索引已创建' : '外键已创建')
    emit('update:show', false)
    // 通知父组件刷新结构
    window.dispatchEvent(new CustomEvent('structure-refresh', { detail: { table: props.table } }))
  } catch (e) {
    message.error(String(e))
  } finally {
    saving.value = false
  }
}

async function dropIndex(name: string) {
  if (!props.connId) return
  const qt = quote(props.table)
  const sql =
    dbType.value === 'mysql'
      ? `DROP INDEX ${quote(name)} ON ${qt}`
      : `DROP INDEX IF EXISTS ${quote(name)}`
  try {
    await api.runSql(props.connId, sql, 1)
    message.success(`已删除索引 ${name}`)
    if (structure.value) {
      structure.value.indexes = structure.value.indexes.filter((i) => i.name !== name)
    }
  } catch (e) {
    message.error(String(e))
  }
}

const title = computed(() =>
  props.mode === 'index' ? `索引管理 · ${props.table}` : `外键管理 · ${props.table}`,
)
</script>

<template>
  <n-modal
    :show="props.show"
    preset="card"
    :title="title"
    :style="{ width: '580px' }"
    :mask-closable="!saving"
    @update:show="(v: boolean) => emit('update:show', v)"
  >
    <!-- 已有索引/外键列表 -->
    <div v-if="mode === 'index'" class="existing">
      <div class="sec-title">已有索引</div>
      <div v-for="idx in structure?.indexes ?? []" :key="idx.name" class="exist-row">
        <span class="mono name">{{ idx.name }}</span>
        <span class="cols mono">{{ idx.columns }}</span>
        <span v-if="idx.unique" class="badge">UNIQUE</span>
        <n-button size="tiny" quaternary type="error" title="删除" @click="dropIndex(idx.name)">
          <Icon name="trash" :size="11" />
        </n-button>
      </div>
      <div v-if="!structure?.indexes?.length" class="empty">暂无索引</div>
    </div>

    <!-- 新建表单 -->
    <div class="sec-title" style="margin-top: 12px">
      新建{{ mode === 'index' ? '索引' : '外键' }}
    </div>

    <template v-if="mode === 'index'">
      <div class="form-row">
        <span class="lbl">索引名</span>
        <n-input v-model:value="idxName" size="small" class="mono" placeholder="如 idx_user_name" />
      </div>
      <div class="form-row">
        <span class="lbl">列</span>
        <n-select
          v-model:value="idxColumns"
          size="small"
          multiple
          :options="columnOptions"
          placeholder="选择索引列(可多选)"
        />
      </div>
      <div class="form-row">
        <span class="lbl">唯一索引</span>
        <n-checkbox v-model:checked="idxUnique" size="small" />
      </div>
    </template>

    <template v-else>
      <div class="form-row">
        <span class="lbl">本表列</span>
        <n-select
          v-model:value="fkColumn"
          size="small"
          :options="columnOptions"
          placeholder="选择外键列"
        />
      </div>
      <div class="form-row">
        <span class="lbl">引用表</span>
        <n-select
          v-model:value="fkRefTable"
          size="small"
          :options="tableOptions"
          placeholder="选择引用表"
        />
      </div>
      <div class="form-row">
        <span class="lbl">引用列</span>
        <n-select
          v-model:value="fkRefColumn"
          size="small"
          :options="refColumnOptions"
          placeholder="选择引用列"
        />
      </div>
    </template>

    <template #footer>
      <div class="footer">
        <div class="gap" />
        <n-button size="small" :disabled="saving" @click="emit('update:show', false)">取消</n-button>
        <n-button size="small" type="primary" :loading="saving" :disabled="isReadOnly" @click="create">
          <Icon name="plus" :size="12" /> 创建
        </n-button>
      </div>
    </template>
  </n-modal>
</template>

<style scoped>
.existing {
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  padding: 8px;
  max-height: 180px;
  overflow-y: auto;
}
.exist-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 8px;
  border-radius: 6px;
}
.exist-row:hover {
  background: var(--bg-hover);
}
.name {
  font-size: 12px;
  font-weight: 600;
  color: var(--accent);
  min-width: 120px;
}
.cols {
  flex: 1;
  font-size: 11.5px;
  color: var(--text-secondary);
}
.badge {
  font-size: 9px;
  color: var(--warn);
  border: 1px solid rgba(255, 214, 10, 0.3);
  padding: 0 5px;
  border-radius: 4px;
}
.empty {
  padding: 16px;
  text-align: center;
  color: var(--text-tertiary);
  font-size: 12px;
}
.sec-title {
  font-size: 12px;
  font-weight: 700;
  color: var(--text-secondary);
  margin-bottom: 8px;
}
.form-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}
.lbl {
  width: 60px;
  flex-shrink: 0;
  font-size: 12.5px;
  color: var(--text-secondary);
  text-align: right;
}
.footer {
  display: flex;
  align-items: center;
}
.gap {
  flex: 1;
}
</style>
