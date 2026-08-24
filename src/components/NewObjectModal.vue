<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { NButton, NInput, NModal, useMessage } from 'naive-ui'
import * as api from '../api'
import { useAppStore } from '../stores/app'
import { getTemplate, TEMPLATES, type ObjKind } from './ObjectTemplates'
import Icon from './Icon.vue'

const props = defineProps<{
  show: boolean
  connId: string | null
  /** 预选类型 */
  defaultKind?: ObjKind
}>()
const emit = defineEmits<{ (e: 'update:show', v: boolean): void }>()

const store = useAppStore()
const message = useMessage()

const objKind = ref<ObjKind>('trigger')
const sql = ref('')
const saving = ref(false)

const dbType = computed(() => store.connById(props.connId ?? '')?.dbType ?? 'mysql')
const isReadOnly = computed(() => !!store.connById(props.connId ?? '')?.readOnly)

const supportedKinds = computed(() =>
  TEMPLATES.filter((t) => dbType.value !== 'sqlite' || t.sqliteSupported),
)

watch(
  () => props.show,
  (v) => {
    if (v) {
      objKind.value = props.defaultKind ?? 'trigger'
      sql.value = getTemplate(objKind.value, dbType.value)
    }
  },
)

watch(objKind, (k) => {
  sql.value = getTemplate(k, dbType.value)
})

async function create() {
  if (!props.connId) return
  if (isReadOnly.value) {
    message.error('只读连接不允许创建对象')
    return
  }
  if (!sql.value.trim()) {
    message.warning('SQL 为空')
    return
  }
  saving.value = true
  try {
    await api.runSql(props.connId, sql.value, 1)
    message.success('创建成功,刷新表列表…')
    store.refreshTables(props.connId)
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
    :title="`新建${TEMPLATES.find(t => t.kind === objKind)?.label ?? '对象'}`"
    :style="{ width: '640px' }"
    :mask-closable="!saving"
    @update:show="(v: boolean) => emit('update:show', v)"
  >
    <div class="obj-row">
      <span class="lbl">类型</span>
      <n-button
        v-for="t in supportedKinds"
        :key="t.kind"
        size="small"
        :type="objKind === t.kind ? 'primary' : 'default'"
        @click="objKind = t.kind"
      >
        {{ t.label }}
      </n-button>
    </div>
    <n-input
      v-model:value="sql"
      type="textarea"
      class="mono"
      :autosize="{ minRows: 12, maxRows: 24 }"
      placeholder="SQL 模板已按方言生成,编辑后点击创建"
    />
    <template #footer>
      <div class="footer">
        <span class="hint">{{ dbType }} 方言</span>
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
.obj-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 10px;
}
.lbl {
  font-size: 12.5px;
  color: var(--text-secondary);
  margin-right: 6px;
}
.footer {
  display: flex;
  align-items: center;
}
.hint {
  font-size: 11px;
  color: var(--text-tertiary);
}
.gap {
  flex: 1;
}
</style>
