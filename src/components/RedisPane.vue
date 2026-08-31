<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { NButton, NDropdown, NInput, NModal, NPopconfirm, NSpin, useMessage } from 'naive-ui'
import * as api from '../api'
import { useAppStore } from '../stores/app'
import type { RedisTab } from '../types'
import Icon from './Icon.vue'
import RedisNewKeyModal from './RedisNewKeyModal.vue'
import RedisAnalyzeModal from './RedisAnalyzeModal.vue'

const props = defineProps<{ tab: RedisTab }>()
const store = useAppStore()
const message = useMessage()

const isReadOnly = computed(() => !!store.connById(props.tab.connId ?? '')?.readOnly)
const showNewKey = ref(false)
const showAnalyze = ref(false)

// 批量 TTL(SCAN 后 pipeline,同类型徽标一起)
const keyTtls = ref<Record<string, number>>({})

// 新建 key 后的刷新事件
onMounted(() => {
  const h = (ev: Event) => {
    const d = (ev as CustomEvent).detail
    if (d.tabId === props.tab.id) {
      scan(true)
      selectKey(d.key as string).catch(() => undefined)
    }
  }
  window.addEventListener('redis-refresh', h)
  onUnmounted(() => window.removeEventListener('redis-refresh', h))
})

function ttlShort(t: number | undefined): string {
  if (t === undefined) return ''
  if (t === -1) return '∞'
  if (t < 0) return ''
  if (t < 60) return `${t}s`
  if (t < 3600) return `${Math.floor(t / 60)}m`
  if (t < 86400) return `${Math.floor(t / 3600)}h`
  return `${Math.floor(t / 86400)}d`
}

async function loadTtls(keys: string[]) {
  if (!keys.length || !props.tab.connId) return
  try {
    const ttls = await api.redisTtlBatch(props.tab.connId, props.tab.db, keys.slice(0, 200))
    const m: Record<string, number> = {}
    keys.slice(0, 200).forEach((k, i) => (m[k] = ttls[i] ?? -2))
    keyTtls.value = m
  } catch {
    /* 忽略 */
  }
}

// ── TTL 管理 / 重命名 ────────────────────────────────
const ttlDraft = ref('')

async function applyTtl(seconds: number) {
  const t = props.tab
  if (!t.selectedKey || !t.connId) return
  try {
    await api.redisSetTtl(t.connId, t.db, t.selectedKey, seconds)
    message.success(seconds < 0 ? '已设为永久' : `TTL 已设为 ${seconds} 秒`)
    await selectKey(t.selectedKey)
  } catch (e) {
    message.error(String(e))
  }
}

const renaming = ref(false)
const renameDraft = ref('')

async function applyRename() {
  const t = props.tab
  if (!t.selectedKey || !t.connId) return
  const nk = renameDraft.value.trim()
  if (!nk || nk === t.selectedKey) {
    renaming.value = false
    return
  }
  try {
    await api.redisRename(t.connId, t.db, t.selectedKey, nk)
    message.success(`已重命名为 ${nk}`)
    t.keys = t.keys.map((k) => (k === t.selectedKey ? nk : k))
    t.selectedKey = nk
    renaming.value = false
    await selectKey(nk)
  } catch (e) {
    message.error(String(e))
  }
}

// ── 成员操作 ────────────────────────────────────────
const addingMember = ref(false)
const memberDraft = ref('')
const memberExtra = ref('')

async function memberOp(op: string, member: string, extra = '') {
  const t = props.tab
  if (!t.selectedKey || !t.connId || !t.detail) return
  try {
    await api.redisMemberOp(t.connId, t.db, t.selectedKey, t.detail.keyType, op, member, extra)
    await selectKey(t.selectedKey)
  } catch (e) {
    message.error(String(e))
  }
}

async function addMember() {
  const t = props.tab
  if (!t.detail) return
  const m = memberDraft.value.trim()
  if (!m) return
  await memberOp('add', m, t.detail.keyType === 'hash' ? memberExtra.value : memberExtra.value)
  addingMember.value = false
  memberDraft.value = ''
  memberExtra.value = ''
}

// hash field 编辑
const editingField = ref('')
const fieldDraft = ref('')

async function saveField(field: string) {
  const t = props.tab
  if (!t.detail || !t.selectedKey || !t.connId) return
  await memberOp('set', field, fieldDraft.value)
  editingField.value = ''
}

// list 元素编辑(按显示序号)
const editingIndex = ref(-1)
const listDraft = ref('')

async function saveList(index: number) {
  const t = props.tab
  if (!t.detail || !t.selectedKey || !t.connId) return
  await memberOp('lset', listDraft.value, String(index))
  editingIndex.value = -1
}

// 键类型批量加载(SCAN 后 pipeline TYPE)
const keyTypes = ref<Record<string, string>>({})
const sortMode = ref<'default' | 'asc' | 'desc'>('default')
/** 客户端即时过滤词(输入即筛已加载的 key,不等 SCAN) */
const localFilter = ref('')

const sortedKeys = computed(() => {
  let ks = [...props.tab.keys]
  const lf = localFilter.value.trim().toLowerCase()
  if (lf) {
    // 支持 * 通配(转成前缀/包含匹配的简化处理)
    if (lf.includes('*')) {
      const re = new RegExp('^' + lf.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$', 'i')
      ks = ks.filter((k) => re.test(k))
    } else {
      ks = ks.filter((k) => k.toLowerCase().includes(lf))
    }
  }
  if (sortMode.value === 'asc') ks.sort()
  else if (sortMode.value === 'desc') ks.sort().reverse()
  return ks
})

/** 右键:按该 key 的前缀(冒号分段)重新 SCAN */
function scanByPrefix(key: string) {
  const prefix = key.includes(':') ? key.slice(0, key.lastIndexOf(':') + 1) + '*' : key + '*'
  props.tab.pattern = prefix
  localFilter.value = ''
  scan(true)
}

async function loadTypes(keys: string[]) {
  if (!keys.length || !props.tab.connId) return
  try {
    const types = await api.redisKeyTypes(props.tab.connId, props.tab.db, keys.slice(0, 200))
    const m: Record<string, string> = {}
    keys.slice(0, 200).forEach((k, i) => (m[k] = types[i] ?? ''))
    keyTypes.value = m
  } catch {
    /* 失败忽略徽标 */
  }
}

const keyCtx = ref({ show: false, x: 0, y: 0, key: '' })

function onKeyCtx(e: MouseEvent, key: string) {
  keyCtx.value = { show: true, x: e.clientX, y: e.clientY, key }
}

async function copyKey(key: string) {
  try {
    await navigator.clipboard.writeText(key)
    message.success('已复制 key')
  } catch {
    message.error('剪贴板不可用')
  }
}

async function scan(reset: boolean) {
  const t = props.tab
  if (t.scanning) return
  t.scanning = true
  t.error = null
  try {
    const cursor = reset ? 0 : t.cursor
    const [next, keys] = await api.redisScan(t.connId!, t.db, t.pattern || '*', cursor, 200)
    t.cursor = next
    t.keys = reset ? keys : Array.from(new Set([...t.keys, ...keys]))
    loadTypes(t.keys)
    loadTtls(t.keys)
  } catch (e) {
    t.error = String(e)
  } finally {
    t.scanning = false
  }
}

async function selectKey(key: string) {
  const t = props.tab
  t.selectedKey = key
  t.detail = null
  t.detailLoading = true
  try {
    t.detail = await api.redisKeyDetail(t.connId!, t.db, key)
  } catch (e) {
    t.error = String(e)
  } finally {
    t.detailLoading = false
  }
}

async function delKey() {
  const t = props.tab
  if (!t.selectedKey) return
  try {
    await api.redisDel(t.connId!, t.db, t.selectedKey)
    message.success(`已删除 ${t.selectedKey}`)
    t.keys = t.keys.filter((k) => k !== t.selectedKey)
    t.selectedKey = null
    t.detail = null
  } catch (e) {
    message.error(String(e))
  }
}

// string 编辑
const editing = ref(false)
const editValue = ref('')

function startEdit() {
  editValue.value = props.tab.detail?.text ?? ''
  editing.value = true
}

async function saveEdit() {
  const t = props.tab
  if (!t.selectedKey) return
  try {
    await api.redisSet(t.connId!, t.db, t.selectedKey, editValue.value)
    message.success('已保存')
    editing.value = false
    await selectKey(t.selectedKey)
  } catch (e) {
    message.error(String(e))
  }
}

const ttlExpireHint = computed(() => props.tab.detail?.ttl ?? -1)

const ttlText = computed(() => {
  const ttl = props.tab.detail?.ttl ?? -1
  if (ttl === -1) return '永久'
  if (ttl === -2) return '已过期'
  if (ttl < 60) return `${ttl} 秒`
  if (ttl < 3600) return `${Math.floor(ttl / 60)} 分 ${ttl % 60} 秒`
  return `${Math.floor(ttl / 3600)} 时 ${Math.floor((ttl % 3600) / 60)} 分`
})

const typeLabel: Record<string, string> = {
  string: 'STRING',
  list: 'LIST',
  set: 'SET',
  zset: 'ZSET',
  hash: 'HASH',
  stream: 'STREAM',
}

function keyTypeIcon(key: string): string {
  return keyTypes.value[key] ?? ''
}
</script>

<template>
  <div class="pane-root">
    <div class="toolbar" data-tauri-drag-region>
      <span class="title mono"><Icon name="diamond" :size="13" class="ic" /> db{{ tab.db }}</span>
      <n-input
        v-model:value="tab.pattern"
        size="small"
        class="pattern mono"
        placeholder="输入即筛已加载,回车 SCAN 重扫(支持 *)"
        @input="localFilter = tab.pattern"
        @keyup.enter="scan(true)"
        @clear="() => { localFilter = ''; scan(true) }"
        clearable
      >
        <template #prefix>
          <Icon name="search" :size="11" />
        </template>
      </n-input>
      <n-button size="small" quaternary :loading="tab.scanning" title="重新扫描" @click="scan(true)">
        <Icon name="refresh" :size="13" />
      </n-button>
      <n-button
        v-if="tab.cursor !== 0 && tab.keys.length"
        size="small"
        quaternary
        title="继续扫描(SCAN 游标)"
        @click="scan(false)"
      >
        继续扫描
      </n-button>
      <n-button
        size="small"
        quaternary
        :title="sortMode === 'default' ? '按名称排序' : sortMode === 'asc' ? '当前:升序' : '当前:降序'"
        @click="sortMode = sortMode === 'default' ? 'asc' : sortMode === 'asc' ? 'desc' : 'default'"
      >
        {{ sortMode === 'default' ? '排序' : sortMode === 'asc' ? 'A→Z' : 'Z→A' }}
      </n-button>
      <n-button
        v-if="!isReadOnly"
        size="small"
        quaternary
        title="新建 key"
        @click="showNewKey = true"
      >
        <Icon name="plus" :size="13" /> 新建
      </n-button>
      <n-button size="small" quaternary title="大 key / 热 key 扫描分析" @click="showAnalyze = true">
        <Icon name="search" :size="13" /> 分析
      </n-button>
      <div class="spacer" data-tauri-drag-region />
      <span class="meta">
        {{ sortedKeys.length === tab.keys.length ? tab.keys.length : sortedKeys.length + '/' + tab.keys.length }} 个 key
      </span>
    </div>
    <div class="body">
      <div v-if="tab.error" class="err mono">{{ tab.error }}</div>
      <div class="keys-panel">
        <div
          v-for="k in sortedKeys"
          :key="k"
          class="key-item mono"
          :class="{ sel: k === tab.selectedKey }"
          :title="k + '(右键:复制 / 按前缀扫)'"
          @click="selectKey(k)"
          @contextmenu.prevent="onKeyCtx($event, k)"
        >
          <span class="key-text">{{ k }}</span>
          <span v-if="ttlShort(keyTtls[k])" class="key-ttl" :class="{ exp: (keyTtls[k] ?? 0) > 0 && (keyTtls[k] ?? 0) < 300 }">
            {{ ttlShort(keyTtls[k]) }}
          </span>
          <span v-if="keyTypeIcon(k)" class="key-type">{{ typeLabel[keyTypeIcon(k)] ?? keyTypeIcon(k) }}</span>
        </div>
        <n-spin v-if="tab.scanning && !tab.keys.length" class="loading" size="medium" />
        <div v-if="!tab.keys.length && !tab.scanning" class="empty">无匹配 key</div>
      </div>
      <div class="detail-panel">
        <n-spin v-if="tab.detailLoading" class="loading" size="medium" />
        <template v-else-if="tab.detail && tab.selectedKey">
          <div class="d-head">
            <span class="d-key mono" :title="tab.selectedKey">{{ tab.selectedKey }}</span>
            <span class="d-type">{{ typeLabel[tab.detail.keyType] ?? tab.detail.keyType }}</span>
            <span class="d-ttl" title="TTL">{{ ttlText }}</span>
            <span class="d-len">len {{ tab.detail.len.toLocaleString() }}</span>
            <input
              v-if="renaming"
              v-model="renameDraft"
              class="rename-input mono"
              @keyup.enter="applyRename"
              @blur="applyRename"
            />
            <div class="spacer" />
            <template v-if="!isReadOnly">
              <n-button size="tiny" quaternary title="重命名 key" @click="() => { renameDraft = tab.selectedKey ?? ''; renaming = true }">
                <Icon name="pencil" :size="12" />
              </n-button>
              <input
                v-if="ttlDraft !== ''"
                v-model="ttlDraft"
                class="ttl-input mono"
                placeholder="秒"
                @keyup.enter="applyTtl(Number(ttlDraft) || 0)"
                @blur="ttlDraft = ''"
              />
              <n-button size="tiny" quaternary title="设置 TTL(秒)" @click="ttlDraft = String(Math.max(ttlExpireHint, 60))">
                ⏱
              </n-button>
              <n-button v-if="(tab.detail.ttl ?? -1) !== -1" size="tiny" quaternary title="设为永久" @click="applyTtl(-1)">
                ∞
              </n-button>
            </template>
            <n-button
              v-if="tab.detail.keyType === 'string' && !isReadOnly"
              size="tiny"
              quaternary
              @click="startEdit"
            >
              <Icon name="pencil" :size="12" /> 编辑
            </n-button>
            <n-button size="tiny" quaternary title="刷新" @click="selectKey(tab.selectedKey!)">
              <Icon name="refresh" :size="12" />
            </n-button>
            <n-popconfirm v-if="!isReadOnly" @positive-click="delKey">
              <template #trigger>
                <n-button size="tiny" quaternary type="error">
                  <Icon name="trash" :size="12" /> 删除
                </n-button>
              </template>
              确认删除该 key?
            </n-popconfirm>
          </div>
          <div class="d-body">
            <pre v-if="tab.detail.text !== null" class="d-text mono">{{ tab.detail.text }}</pre>
            <template v-else-if="tab.detail.pairs.length">
              <div
                v-for="(p, i) in tab.detail.pairs"
                :key="i"
                class="d-row"
                :class="{ kvtwo: p[0] }"
              >
                <template v-if="tab.detail.keyType === 'hash' && editingField === p[0]">
                  <span class="d-field mono">{{ p[0] }}</span>
                  <input v-model="fieldDraft" class="member-input mono" @keyup.enter="saveField(p[0])" @blur="saveField(p[0])" />
                </template>
                <template v-else-if="tab.detail.keyType === 'list' && editingIndex === i">
                  <span class="d-field mono">#{{ i }}</span>
                  <input v-model="listDraft" class="member-input mono" @keyup.enter="saveList(i)" @blur="saveList(i)" />
                </template>
                <template v-else>
                  <span v-if="p[0]" class="d-field mono" :title="p[0]">{{ p[0] }}</span>
                  <span class="d-val mono" :title="p[1]">{{ p[1] }}</span>
                  <template v-if="!isReadOnly">
                    <button
                      v-if="tab.detail.keyType === 'hash'"
                      class="mb-btn"
                      title="编辑字段值"
                      @click="() => { editingField = p[0]; fieldDraft = p[1] }"
                    >
                      ✎
                    </button>
                    <button
                      v-if="tab.detail.keyType === 'list'"
                      class="mb-btn"
                      title="编辑元素"
                      @click="() => { editingIndex = i; listDraft = p[1] }"
                    >
                      ✎
                    </button>
                    <button class="mb-btn danger" title="删除" @click="memberOp('del', tab.detail!.keyType === 'hash' ? p[0] : p[1])">
                      −
                    </button>
                  </template>
                </template>
              </div>
              <!-- 添加成员 -->
              <div v-if="addingMember && !isReadOnly" class="d-row add-row">
                <input
                  v-model="memberDraft"
                  class="member-input mono"
                  :placeholder="tab.detail.keyType === 'hash' ? '字段名' : tab.detail.keyType === 'zset' ? '成员' : '值'"
                  @keyup.enter="addMember"
                />
                <input
                  v-if="tab.detail.keyType === 'hash' || tab.detail.keyType === 'zset'"
                  v-model="memberExtra"
                  class="member-input mono"
                  :placeholder="tab.detail.keyType === 'hash' ? '值' : '分数'"
                  @keyup.enter="addMember"
                />
                <n-button size="tiny" type="primary" @click="addMember">添加</n-button>
                <n-button size="tiny" quaternary @click="addingMember = false">取消</n-button>
              </div>
              <div v-else-if="!isReadOnly" class="add-trigger" @click="addingMember = true">
                ＋ 添加{{ tab.detail.keyType === 'hash' ? '字段' : '成员' }}
              </div>
            </template>
            <div v-else class="empty">(空)</div>
          </div>
        </template>
        <div v-else class="empty">点击左侧 key 查看内容</div>
      </div>
    </div>

    <n-dropdown
      trigger="manual"
      :show="keyCtx.show"
      :x="keyCtx.x"
      :y="keyCtx.y"
      :options="[
        { label: '复制 key 名', key: 'copy' },
        { label: '按此 key 前缀扫描', key: 'prefix' },
        { label: '以此 key 精确匹配', key: 'exact' },
      ]"
      placement="bottom-start"
      @select="(k: string | number) => {
        const key = keyCtx.key
        keyCtx.show = false
        if (k === 'copy') copyKey(key)
        else if (k === 'prefix') scanByPrefix(key)
        else if (k === 'exact') { tab.pattern = key; localFilter = ''; scan(true) }
      }"
      @clickoutside="keyCtx.show = false"
    />
    <RedisNewKeyModal v-model:show="showNewKey" :tab="tab" />
    <RedisAnalyzeModal v-model:show="showAnalyze" :tab="tab" />
    <n-modal
      :show="editing"
      preset="card"
      :title="`编辑:${tab.selectedKey}`"
      :style="{ width: '600px' }"
      @update:show="(v: boolean) => !v && (editing = false)"
    >
      <n-input
        v-model:value="editValue"
        type="textarea"
        class="mono"
        :autosize="{ minRows: 10, maxRows: 24 }"
      />
      <template #footer>
        <div class="ml-footer">
          <n-button size="small" @click="editing = false">取消</n-button>
          <n-button size="small" type="primary" @click="saveEdit">
            <Icon name="save" :size="12" /> 保存(TTL 保留)
          </n-button>
        </div>
      </template>
    </n-modal>
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
  gap: 6px;
  font-size: 13px;
  font-weight: 700;
}
.ic {
  color: var(--danger);
}
.pattern {
  width: 240px;
}
.spacer {
  flex: 1;
  height: 100%;
}
.meta {
  font-size: 12px;
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
}
.body {
  flex: 1;
  min-height: 0;
  display: flex;
  gap: 10px;
  padding: 10px 12px;
}
.err {
  flex: 1;
  padding: 10px 14px;
  border-radius: 10px;
  background: rgba(255, 69, 58, 0.1);
  border: 1px solid rgba(255, 69, 58, 0.25);
  color: #ff8a80;
  font-size: 12px;
}
.keys-panel {
  width: 320px;
  flex-shrink: 0;
  border: 1px solid var(--border-strong);
  border-radius: 10px;
  background: var(--bg-grid);
  overflow-y: auto;
  padding: 5px;
  position: relative;
}
.key-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-radius: 7px;
  cursor: pointer;
  color: var(--text-secondary);
}
.key-item:hover {
  background: var(--bg-hover);
  color: var(--text);
}
.key-item.sel {
  background: rgba(255, 107, 112, 0.13);
  color: var(--text);
}
.key-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
}
.key-type {
  font-size: 9px;
  color: var(--danger);
  border: 1px solid rgba(255, 107, 112, 0.4);
  border-radius: 4px;
  padding: 0 4px;
  flex-shrink: 0;
}
.loading {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px 0;
}
.empty {
  padding: 30px;
  text-align: center;
  color: var(--text-tertiary);
  font-size: 12.5px;
}
.detail-panel {
  flex: 1;
  min-width: 0;
  border: 1px solid var(--border-strong);
  border-radius: 10px;
  background: var(--bg-grid);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.d-head {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 8px 12px;
  background: var(--bg-head);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.d-key {
  font-size: 12.5px;
  font-weight: 700;
  color: var(--danger);
  max-width: 300px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.d-type {
  font-size: 9.5px;
  color: var(--accent);
  border: 1px solid rgba(133, 135, 246, 0.4);
  border-radius: 4px;
  padding: 0 5px;
}
.d-ttl {
  font-size: 11px;
  color: var(--warn);
}
.d-len {
  font-size: 11px;
  color: var(--text-tertiary);
}
.d-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 6px;
}
.d-text {
  margin: 0;
  padding: 10px 12px;
  font-size: 12.5px;
  line-height: 1.7;
  color: var(--cell-color);
  white-space: pre-wrap;
  word-break: break-word;
  user-select: text;
}
.rename-input {
  width: 180px;
  height: 22px;
  border: 1px solid var(--accent);
  border-radius: 5px;
  background: var(--input-bg);
  color: var(--text);
  font-size: 12px;
  padding: 0 6px;
  outline: none;
}
.ttl-input {
  width: 52px;
  height: 22px;
  border: 1px solid var(--accent);
  border-radius: 5px;
  background: var(--input-bg);
  color: var(--text);
  font-size: 11px;
  padding: 0 6px;
  outline: none;
}
.key-ttl {
  font-size: 9px;
  color: var(--text-tertiary);
  border: 1px solid var(--border-strong);
  border-radius: 4px;
  padding: 0 3px;
  flex-shrink: 0;
}
.key-ttl.exp {
  color: var(--danger);
  border-color: rgba(255, 107, 112, 0.5);
}
.mb-btn {
  width: 20px;
  height: 20px;
  flex-shrink: 0;
  border: 1px solid var(--border-strong);
  border-radius: 4px;
  background: transparent;
  color: var(--text-tertiary);
  font-size: 11px;
  cursor: pointer;
}
.mb-btn:hover {
  color: var(--accent);
  border-color: var(--accent);
}
.mb-btn.danger:hover {
  color: var(--danger);
  border-color: var(--danger);
}
.member-input {
  flex: 1;
  min-width: 60px;
  height: 22px;
  border: 1px solid var(--accent);
  border-radius: 5px;
  background: var(--input-bg);
  color: var(--text);
  font-size: 12px;
  padding: 0 6px;
  outline: none;
}
.add-trigger {
  margin: 6px 10px;
  padding: 4px 10px;
  border: 1px dashed var(--border-strong);
  border-radius: 6px;
  color: var(--text-tertiary);
  font-size: 11.5px;
  cursor: pointer;
}
.add-trigger:hover {
  color: var(--accent);
  border-color: var(--accent);
}
.add-row {
  gap: 6px;
  padding: 4px 10px;
}
.d-row {
  display: flex;
  gap: 10px;
  padding: 4px 10px;
  border-radius: 6px;
  align-items: baseline;
}
.d-row:hover {
  background: var(--bg-hover);
}
.d-field {
  width: 200px;
  flex-shrink: 0;
  font-size: 12px;
  color: var(--accent);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.d-val {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  color: var(--cell-color);
  word-break: break-all;
}
.ml-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
