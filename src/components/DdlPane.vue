<script setup lang="ts">
import { ref } from 'vue'
import { NButton, NInput, NSpin, useMessage } from 'naive-ui'
import * as api from '../api'
import { useAppStore } from '../stores/app'
import type { DdlTab } from '../types'
import Icon from './Icon.vue'

const props = defineProps<{ tab: DdlTab }>()
const store = useAppStore()
const message = useMessage()

const editing = ref(false)
const draft = ref('')
const saving = ref(false)

function startEdit() {
  draft.value = props.tab.ddl
  editing.value = true
}

async function saveEdit() {
  if (!props.tab.connId) return
  saving.value = true
  try {
    await api.runSql(props.tab.connId, draft.value, 1)
    message.success('已执行,正在刷新…')
    editing.value = false
    store.reloadDdl(props.tab.id)
  } catch (e) {
    message.error(String(e))
  } finally {
    saving.value = false
  }
}

const kindLabel: Record<string, string> = {
  trigger: '触发器',
  function: '函数',
  procedure: '存储过程',
}

async function copyDdl() {
  try {
    await navigator.clipboard.writeText(props.tab.ddl)
    message.success('已复制 DDL')
  } catch {
    message.error('剪贴板不可用')
  }
}
</script>

<template>
  <div class="pane-root">
    <div class="toolbar" data-tauri-drag-region>
      <span class="title mono">
        <Icon name="code" :size="13" class="ic" /> {{ tab.title }}
      </span>
      <span class="kind">{{ kindLabel[tab.objKind] ?? tab.objKind }}</span>
      <div class="spacer" data-tauri-drag-region />
      <n-button size="small" quaternary title="复制 DDL" @click="copyDdl">
        <Icon name="copy" :size="12" /> 复制
      </n-button>
      <n-button
        v-if="!editing"
        size="small"
        quaternary
        :disabled="!!store.connById(props.tab.connId ?? '')?.readOnly"
        title="编辑并重新执行(需自行处理 CREATE OR REPLACE / DROP)"
        @click="startEdit"
      >
        <Icon name="pencil" :size="12" /> 编辑
      </n-button>
      <template v-else>
        <n-button size="small" quaternary @click="editing = false">取消</n-button>
        <n-button size="small" type="primary" :loading="saving" @click="saveEdit">
          <Icon name="play" :size="12" /> 执行
        </n-button>
      </template>
    </div>
    <div class="body">
      <n-spin v-if="tab.loading" class="loading" size="medium" />
      <div v-else-if="tab.error" class="err mono">{{ tab.error }}</div>
      <div v-else class="ddl-wrap">
        <pre v-if="!editing" class="ddl mono">{{ tab.ddl }}</pre>
        <n-input
          v-else
          v-model:value="draft"
          type="textarea"
          class="mono ddl-editor"
          :autosize="{ minRows: 14, maxRows: 32 }"
        />
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
  height: 44px;
  padding: 0 12px;
  background: var(--bg-elevated);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.title {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 13px;
  font-weight: 600;
  max-width: 340px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ic {
  color: var(--accent);
}
.kind {
  font-size: 11px;
  color: var(--text-tertiary);
  border: 1px solid var(--border-strong);
  border-radius: 5px;
  padding: 1px 7px;
}
.spacer {
  flex: 1;
  height: 100%;
}
.body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 12px;
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
}
.ddl-wrap {
  flex: 1;
  min-height: 0;
  border: 1px solid var(--border-strong);
  border-radius: 10px;
  background: var(--bg-grid);
  overflow: auto;
  box-shadow:
    var(--panel-inset),
    var(--panel-shadow);
}
.ddl-editor :deep(textarea) {
  font-size: 12.5px;
  line-height: 1.75;
  padding: 16px 18px;
}
.ddl {
  margin: 0;
  padding: 16px 18px;
  font-size: 12.5px;
  line-height: 1.75;
  color: var(--cell-color);
  white-space: pre-wrap;
  word-break: break-word;
  user-select: text;
}
</style>
