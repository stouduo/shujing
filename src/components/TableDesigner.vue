<script setup lang="ts">
import { computed } from 'vue'
import { NButton, NInput, NSelect } from 'naive-ui'
import { useAppStore } from '../stores/app'
import type { DesignerTab } from '../types'
import Icon from './Icon.vue'

const props = defineProps<{ tab: DesignerTab }>()
const store = useAppStore()

const dbType = computed(() => store.connById(props.tab.connId ?? '')?.dbType ?? 'mysql')

const isEdit = computed(() => props.tab.mode === 'edit')

const typeOptions = ['INTEGER', 'BIGINT', 'TEXT', 'VARCHAR', 'REAL', 'DOUBLE', 'DECIMAL', 'BOOLEAN', 'DATE', 'DATETIME', 'TIMESTAMP', 'BLOB', 'JSON'].map(
  (t) => ({ label: t, value: t }),
)

function addColumn() {
  props.tab.columns.push({
    name: '',
    dataType: 'VARCHAR',
    length: dbType.value === 'mysql' ? '255' : '',
    nullable: true,
    pk: false,
    autoInc: false,
    default: '',
    comment: '',
  })
}

function removeColumn(i: number) {
  const c = props.tab.columns[i]
  if (c?.existing && isEdit.value) return
  props.tab.columns.splice(i, 1)
}

const preview = computed(() => {
  const { create, alters, warnings } = store.designerSql(props.tab.id)
  const parts: string[] = []
  if (create) parts.push(create)
  parts.push(...alters)
  if (warnings.length) parts.push('-- ' + warnings.join('\n-- '))
  return parts.join('\n\n') || '-- 暂无变更'
})

const showPreview = computed(() => props.tab.mode === 'create' || true)
</script>

<template>
  <div class="pane-root">
    <div class="toolbar" data-tauri-drag-region>
      <span class="mode-badge">{{ isEdit ? '编辑表' : '新建表' }}</span>
      <n-input
        v-model:value="tab.tableName"
        size="small"
        placeholder="表名"
        class="name-input mono"
        :disabled="isEdit"
      />
      <span class="type-hint">{{ dbType }}</span>
      <div class="spacer" data-tauri-drag-region />
      <n-button size="small" type="primary" :loading="tab.saving" @click="store.saveDesigner(tab.id)">
        <Icon name="save" :size="12" /> {{ isEdit ? '保存修改' : '创建表' }}
      </n-button>
    </div>
    <div v-if="tab.error" class="msg err mono">{{ tab.error }}</div>
    <div v-else-if="tab.info" class="msg ok mono">✓ {{ tab.info }}</div>
    <div class="body">
      <div class="cols-head">
        <div class="c-name">字段名</div>
        <div class="c-type">类型</div>
        <div class="c-len">长度</div>
        <div class="c-bool" title="非空">NOT NULL</div>
        <div class="c-bool" title="主键">PK</div>
        <div class="c-bool" title="自增">自增</div>
        <div class="c-default">默认值</div>
        <div class="c-comment">注释</div>
        <div class="c-op" />
      </div>
      <div class="cols-scroll">
        <div v-for="(c, i) in tab.columns" :key="i" class="col-row" :class="{ pk: c.pk, dead: c.existing && isEdit }">
          <div class="c-name"><n-input v-model:value="c.name" size="tiny" placeholder="name" class="mono" :disabled="c.existing && isEdit" /></div>
          <div class="c-type">
            <n-select v-model:value="c.dataType" size="tiny" :options="typeOptions" filterable tag :disabled="c.existing && isEdit && dbType === 'sqlite'" />
          </div>
          <div class="c-len"><n-input v-model:value="c.length" size="tiny" placeholder="-" class="mono" :disabled="c.existing && isEdit && dbType === 'sqlite'" /></div>
          <div class="c-bool"><input type="checkbox" class="cb" :checked="!c.nullable" @change="c.nullable = !($event.target as HTMLInputElement).checked" :disabled="c.existing && isEdit && dbType === 'sqlite'" /></div>
          <div class="c-bool"><input type="checkbox" class="cb pkcb" :checked="c.pk" @change="c.pk = ($event.target as HTMLInputElement).checked" :disabled="c.existing && isEdit" /></div>
          <div class="c-bool"><input type="checkbox" class="cb" :checked="c.autoInc" @change="c.autoInc = ($event.target as HTMLInputElement).checked" :disabled="c.existing && isEdit" /></div>
          <div class="c-default"><n-input v-model:value="c.default" size="tiny" placeholder="" class="mono" :disabled="c.existing && isEdit && dbType === 'sqlite'" /></div>
          <div class="c-comment"><n-input v-model:value="c.comment" size="tiny" placeholder="" /></div>
          <div class="c-op">
            <button
              class="del-btn"
              :disabled="c.existing && isEdit"
              :title="c.existing && isEdit ? '编辑模式不删除已有字段(避免误删数据)' : '删除字段'"
              @click="removeColumn(i)"
            >
              −
            </button>
          </div>
        </div>
        <n-button size="small" dashed class="add-col" @click="addColumn">
          <Icon name="plus" :size="12" /> 添加字段
        </n-button>
      </div>
      <div v-if="showPreview" class="preview">
        <div class="preview-title">SQL 预览</div>
        <pre class="preview-sql mono">{{ preview }}</pre>
      </div>
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
  height: 46px;
  padding: 0 12px;
  background: var(--bg-elevated);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.mode-badge {
  font-size: 12px;
  font-weight: 600;
  color: var(--accent);
  padding: 3px 10px;
  border: 1px solid rgba(133, 135, 246, 0.35);
  background: rgba(133, 135, 246, 0.1);
  border-radius: 6px;
}
.name-input {
  width: 220px;
}
.type-hint {
  font-size: 11px;
  color: var(--text-tertiary);
}
.spacer {
  flex: 1;
  height: 100%;
}
.msg {
  margin: 10px 12px 0;
  padding: 8px 14px;
  border-radius: 8px;
  font-size: 12px;
}
.msg.err {
  background: rgba(255, 69, 58, 0.1);
  border: 1px solid rgba(255, 69, 58, 0.25);
  color: #ff8a80;
}
.msg.ok {
  background: rgba(48, 209, 88, 0.1);
  border: 1px solid rgba(48, 209, 88, 0.25);
  color: #7ce8a4;
}
.body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 10px 12px;
  gap: 10px;
}
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
  padding: 0 4px 4px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.cols-scroll {
  flex: 1;
  min-height: 120px;
  overflow-y: auto;
  padding: 6px 4px 6px 0;
}
.col-row {
  padding: 3px 0 3px 4px;
  border-radius: 6px;
}
.col-row:hover {
  background: var(--bg-hover);
}
.col-row.pk .c-name :deep(.n-input__input-el) {
  color: var(--accent);
  font-weight: 600;
}
.c-name { width: 170px; flex-shrink: 0; }
.c-type { width: 140px; flex-shrink: 0; }
.c-len { width: 72px; flex-shrink: 0; }
.c-bool { width: 52px; text-align: center; flex-shrink: 0; }
.c-default { width: 120px; flex-shrink: 0; }
.c-comment { flex: 1; min-width: 80px; }
.c-op { width: 30px; flex-shrink: 0; }
.cb {
  accent-color: var(--accent);
  cursor: pointer;
}
.del-btn {
  width: 20px;
  height: 20px;
  border: 1px solid var(--border-strong);
  border-radius: 4px;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
}
.del-btn:hover:not(:disabled) {
  color: var(--danger);
  border-color: var(--danger);
}
.del-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}
.add-col {
  margin-top: 6px;
  width: 140px;
}
.preview {
  flex-shrink: 0;
  max-height: 200px;
  display: flex;
  flex-direction: column;
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
  flex: 1;
  overflow: auto;
  padding: 10px 14px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--cell-color);
  white-space: pre-wrap;
  user-select: text;
}
</style>
