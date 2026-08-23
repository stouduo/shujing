<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  NButton,
  NInput,
  NModal,
  NRadioButton,
  NRadioGroup,
  NSpin,
  useMessage,
} from 'naive-ui'
import { getTableStructure } from '../api'
import { parseCsv } from '../csv'
import { useAppStore } from '../stores/app'
import type { ColumnDef } from '../types'
import Icon from './Icon.vue'

const props = defineProps<{ show: boolean; connId: string | null; table: string }>()
const emit = defineEmits<{ (e: 'update:show', v: boolean): void }>()

const store = useAppStore()
const message = useMessage()

const mode = ref<'form' | 'csv' | 'json'>('form')
const columns = ref<ColumnDef[]>([])
const loadingCols = ref(false)
const form = ref<Record<string, string>>({})
const csvText = ref('')
const jsonText = ref('')
const saving = ref(false)

const isReadOnly = computed(() => !!store.connById(props.connId ?? '')?.readOnly)

const JSON_PLACEHOLDER = '{\n  "name": "张三",\n  "age": 30\n}'

watch(
  () => props.show,
  async (v) => {
    if (!v || !props.connId) return
    loadingCols.value = true
    columns.value = []
    form.value = {}
    csvText.value = ''
    jsonText.value = ''
    mode.value = 'form'
    try {
      const st = await getTableStructure(props.connId, props.table)
      columns.value = st.columns
      const init: Record<string, string> = {}
      for (const c of st.columns) init[c.name] = ''
      form.value = init
    } catch (e) {
      message.error(String(e))
    } finally {
      loadingCols.value = false
    }
  },
)

/** 解析当前模式 → 待插入行(列名 → 值,空串/缺失列=不写入) */
const parsedRows = computed<{ rows: Record<string, string>[]; error: string }>(() => {
  if (mode.value === 'form') {
    const row: Record<string, string> = {}
    for (const c of columns.value) {
      const v = (form.value[c.name] ?? '').trim()
      if (v !== '') row[c.name] = v
    }
    return { rows: Object.keys(row).length ? [row] : [], error: '' }
  }
  if (mode.value === 'csv') {
    if (!csvText.value.trim()) return { rows: [], error: '' }
    const grid = parseCsv(csvText.value)
    if (!grid.length) return { rows: [], error: '' }
    const names = columns.value.map((c) => c.name)
    // 首行若全部命中列名则视为表头
    const first = grid[0].map((h) => h.trim())
    const headerMode = first.length > 0 && first.every((h) => names.includes(h))
    const order = headerMode ? first : names
    const body = headerMode ? grid.slice(1) : grid
    const rows: Record<string, string>[] = []
    for (const cells of body) {
      const row: Record<string, string> = {}
      order.forEach((col, i) => {
        const v = (cells[i] ?? '').trim()
        if (v !== '') row[col] = v
      })
      if (Object.keys(row).length) rows.push(row)
    }
    return { rows, error: '' }
  }
  // json
  if (!jsonText.value.trim()) return { rows: [], error: '' }
  try {
    const data = JSON.parse(jsonText.value)
    const arr = Array.isArray(data) ? data : [data]
    const names = new Set(columns.value.map((c) => c.name))
    const rows: Record<string, string>[] = []
    for (const item of arr) {
      if (typeof item !== 'object' || item === null) {
        return { rows: [], error: 'JSON 数组元素必须是对象' }
      }
      const row: Record<string, string> = {}
      for (const [k, v] of Object.entries(item as Record<string, unknown>)) {
        if (!names.has(k)) continue
        if (v === null) continue // null 列跳过;如需 NULL 请后续编辑
        row[k] = String(v)
      }
      if (Object.keys(row).length) rows.push(row)
    }
    return { rows, error: '' }
  } catch {
    return { rows: [], error: 'JSON 格式错误' }
  }
})

const preview = computed(() => {
  const rows = parsedRows.value.rows.slice(0, 3)
  return rows.map((r) =>
    Object.entries(r)
      .map(([k, v]) => `${k}=${v.length > 24 ? v.slice(0, 24) + '…' : v}`)
      .join(', '),
  )
})

const pkHint = computed(() => columns.value.filter((c) => c.key === 'PRI').map((c) => c.name))

async function save() {
  if (!props.connId) return
  if (isReadOnly.value) {
    message.error('只读连接不允许插入')
    return
  }
  const rows = parsedRows.value.rows
  if (!rows.length) {
    message.warning('没有可插入的数据')
    return
  }
  saving.value = true
  try {
    await store.insertRows(props.connId, props.table, rows)
    message.success(`已插入 ${rows.length} 行`)
    emit('update:show', false)
  } catch (e) {
    message.error(String(e))
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <n-modal
    :show="props.show"
    preset="card"
    :title="`添加数据 · ${table}`"
    :style="{ width: '640px' }"
    :mask-closable="!saving"
    @update:show="(v: boolean) => emit('update:show', v)"
  >
    <n-spin v-if="loadingCols" size="small" style="width: 100%; padding: 30px 0" />
    <template v-else>
      <n-radio-group v-model:value="mode" size="small" class="mode-row">
        <n-radio-button value="form">表单</n-radio-button>
        <n-radio-button value="csv">CSV</n-radio-button>
        <n-radio-button value="json">JSON</n-radio-button>
      </n-radio-group>

      <!-- 表单模式 -->
      <div v-if="mode === 'form'" class="form-grid">
        <div v-for="c in columns" :key="c.name" class="form-item">
          <span class="f-label mono" :class="{ pk: c.key === 'PRI' }" :title="c.dataType">
            {{ c.name }}<i class="f-type">{{ c.dataType }}</i>
          </span>
          <n-input
            v-model:value="form[c.name]"
            size="small"
            class="mono"
            :placeholder="c.key === 'PRI' ? '留空=自增/默认' : c.nullable ? '可空,留空不写入' : ''"
          />
        </div>
      </div>

      <!-- CSV 模式 -->
      <template v-else-if="mode === 'csv'">
        <div class="hint">每行一条记录,逗号分隔;首行可写列名(命中表列则按名映射),否则按列顺序。空字段=不写入。支持引号包裹。</div>
        <n-input
          v-model:value="csvText"
          type="textarea"
          class="mono"
          :autosize="{ minRows: 7, maxRows: 14 }"
          :placeholder="columns.map(c => c.name).slice(0, 4).join(',') + '\n张三,30,北京'"
        />
      </template>

      <!-- JSON 模式 -->
      <template v-else>
        <div class="hint">单个对象或对象数组,key=列名,未知列忽略。如需 NULL 值插入后编辑。</div>
        <n-input
          v-model:value="jsonText"
          type="textarea"
          class="mono"
          :autosize="{ minRows: 7, maxRows: 14 }"
          :placeholder="JSON_PLACEHOLDER"
        />
      </template>

      <!-- 预览 -->
      <div v-if="parsedRows.rows.length" class="preview">
        <div class="pv-title">将插入 {{ parsedRows.rows.length }} 行(预览前 3 行)</div>
        <div v-for="(p, i) in preview" :key="i" class="pv-line mono">{{ p }}</div>
      </div>
      <div v-else-if="parsedRows.error" class="pv-error mono">{{ parsedRows.error }}</div>
    </template>
    <template #footer>
      <div class="footer">
        <span v-if="pkHint.length" class="pk-hint">主键:{{ pkHint.join(', ') }}</span>
        <div class="gap" />
        <n-button size="small" :disabled="saving" @click="emit('update:show', false)">取消</n-button>
        <n-button
          size="small"
          type="primary"
          :loading="saving"
          :disabled="!parsedRows.rows.length || isReadOnly"
          @click="save"
        >
          <Icon name="save" :size="12" /> 插入 {{ parsedRows.rows.length || '' }} 行
        </n-button>
      </div>
    </template>
  </n-modal>
</template>

<style scoped>
.mode-row {
  margin-bottom: 12px;
}
.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px 14px;
  max-height: 360px;
  overflow-y: auto;
  padding-right: 4px;
}
.form-item {
  display: flex;
  align-items: center;
  gap: 8px;
}
.f-label {
  width: 150px;
  flex-shrink: 0;
  font-size: 12px;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.f-label.pk {
  color: var(--accent);
  font-weight: 700;
}
.f-type {
  font-style: normal;
  font-size: 9.5px;
  color: var(--text-tertiary);
  font-weight: 400;
}
.hint {
  font-size: 11.5px;
  color: var(--text-tertiary);
  margin-bottom: 8px;
  line-height: 1.6;
}
.preview {
  margin-top: 10px;
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  background: var(--bg-grid);
  padding: 8px 12px;
}
.pv-title {
  font-size: 11.5px;
  color: var(--accent);
  margin-bottom: 4px;
}
.pv-line {
  font-size: 11px;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.pv-error {
  margin-top: 10px;
  font-size: 12px;
  color: #ff8a80;
}
.footer {
  display: flex;
  align-items: center;
}
.pk-hint {
  font-size: 11px;
  color: var(--text-tertiary);
}
.gap {
  flex: 1;
}
</style>
