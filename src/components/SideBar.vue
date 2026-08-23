<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  NButton,
  NDropdown,
  NInput,
  NModal,
  NPopconfirm,
  NSpin,
  useMessage,
  type DropdownOption,
} from 'naive-ui'
import { useAppStore } from '../stores/app'
import type { ConnInfo, TableMeta } from '../types'
import Icon from './Icon.vue'
import { exportDatabase, exportTable, importSqlFile } from '../exportImport'

const store = useAppStore()
const emit = defineEmits<{
  (e: 'new-connection'): void
  (e: 'edit-connection', info: ConnInfo): void
  (e: 'import-csv', connId: string): void
  (e: 'quick-open'): void
  (e: 'global-search'): void
}>()

function dotClass(id: string): string {
  if (store.live[id]) return 'on'
  if (store.connecting[id]) return 'busy'
  return ''
}

const DB_ICON: Record<string, import('../types').IconName> = {
  sqlite: 'box',
  mysql: 'database',
  postgres: 'layers',
  redis: 'diamond',
}
const DB_COLOR: Record<string, string> = {
  sqlite: '#4fc3f7',
  mysql: '#f2915a',
  postgres: '#7aa2f7',
  redis: '#ff6b70',
}

function toggle(c: ConnInfo) {
  if (store.live[c.id]) store.disconnect(c.id)
  else store.connect(c.id)
}

function groupKey(connId: string, kind: string): string {
  return `${connId}:${kind}`
}

function isCollapsed(connId: string, kind: string): boolean {
  return !!store.collapsed[groupKey(connId, kind)]
}

function toggleGroup(connId: string, kind: string) {
  const k = groupKey(connId, kind)
  store.collapsed[k] = !store.collapsed[k]
}

function tablesOf(connId: string, kind: string): TableMeta[] {
  return store.filteredTables(connId).filter((t) => t.kind === kind)
}

/** Redis 键空间条目(kind = "redis-db:<idx>:<keys>") */
function redisDbsOf(connId: string): { db: number; keys: number; name: string }[] {
  const kw = store.tableFilter.trim().toLowerCase()
  const all = store.live[connId]?.tables ?? []
  return all
    .filter((t) => t.kind.startsWith('redis-db'))
    .map((t) => {
      const [, idx, keys] = t.kind.split(':')
      return { db: Number(idx), keys: Number(keys), name: t.name }
    })
    .filter((d) => !kw || `db${d.db}`.includes(kw))
}

function isRedisConn(c: ConnInfo): boolean {
  return c.dbType === 'redis'
}

/** 触发器/函数/过程合并为"程序对象"分组 */
function procsOf(connId: string): TableMeta[] {
  return store
    .filteredTables(connId)
    .filter((t) => t.kind === 'trigger' || t.kind === 'function' || t.kind === 'procedure')
}

function openProc(connId: string, p: TableMeta) {
  store.openDdl(connId, p.kind, p.name)
}

// ── 表右键菜单 ────────────────────────────────────────
const menuShow = ref(false)
const menuX = ref(0)
const menuY = ref(0)
const menuTarget = ref<{ connId: string; table: TableMeta } | null>(null)

const menuOptions: DropdownOption[] = [
  { label: '打开数据', key: 'data' },
  { label: '查看结构', key: 'structure' },
  { label: '设计表', key: 'design' },
  { label: '复制表名', key: 'copy' },
  { label: '插入表名到查询', key: 'insert' },
  { type: 'divider', key: 'd1' },
  {
    label: '导出 ▸',
    key: 'exp-menu',
    children: [
      { label: 'CSV 文件', key: 'exp-csv' },
      { label: 'Excel (xlsx)', key: 'exp-xlsx' },
      { label: 'SQL(结构+数据)', key: 'exp-both' },
      { label: 'SQL(仅结构)', key: 'exp-ddl' },
    ],
  },
  { label: '重命名…', key: 'rename' },
  { label: '清空表数据…', key: 'truncate' },
  { label: '删除表…', key: 'drop', props: { style: { color: '#ff6b70' } } },
  { type: 'divider', key: 'd2' },
  { label: '新建查询', key: 'query' },
  { label: '刷新表列表', key: 'refresh' },
]

// ── 表管理操作弹窗(重命名 / 清空 / 删除) ────────────
const message = useMessage()
const ops = ref<{
  mode: 'rename' | 'truncate' | 'drop'
  connId: string
  table: string
} | null>(null)
const opsInput = ref('')
const opsBusy = ref(false)

const opsTitle = computed(() => {
  if (!ops.value) return ''
  return ops.value.mode === 'rename'
    ? `重命名表:${ops.value.table}`
    : ops.value.mode === 'truncate'
      ? `清空表数据:${ops.value.table}`
      : `删除表:${ops.value.table}`
})

async function runExport(connId: string, table: string, fmt: 'csv' | 'xlsx' | 'sql-both' | 'sql-ddl') {
  try {
    await exportTable(connId, table, fmt)
  } catch (e) {
    message.error(String(e))
  }
}

async function runOps() {
  if (!ops.value) return
  const { mode, connId, table } = ops.value
  try {
    if (mode === 'rename') {
      const name = opsInput.value.trim()
      if (!name || name === table) return
      opsBusy.value = true
      await store.renameTable(connId, table, name)
      message.success(`已重命名为 ${name}`)
    } else if (mode === 'truncate') {
      opsBusy.value = true
      await store.truncateTable(connId, table)
      message.success(`已清空 ${table}`)
    } else {
      if (opsInput.value.trim() !== table) {
        message.warning('输入的表名不一致')
        return
      }
      opsBusy.value = true
      await store.dropTable(connId, table)
      message.success(`已删除 ${table}`)
    }
    ops.value = null
  } catch (e) {
    message.error(String(e))
  } finally {
    opsBusy.value = false
  }
}

function openMenu(e: MouseEvent, connId: string, table: TableMeta) {
  menuTarget.value = { connId, table }
  menuShow.value = true
  menuX.value = e.clientX
  menuY.value = e.clientY
}

async function onMenuSelect(key: string | number) {
  menuShow.value = false
  const t = menuTarget.value
  if (!t) return
  switch (key) {
    case 'data':
      store.openTable(t.connId, t.table)
      break
    case 'structure':
      store.openStructure(t.connId, t.table.name)
      break
    case 'design':
      store.openDesigner(t.connId, t.table.name)
      break
    case 'copy':
      try {
        await navigator.clipboard.writeText(t.table.name)
      } catch {
        /* 非 tauri 环境可能无剪贴板权限 */
      }
      break
    case 'insert':
      store.insertIntoQuery(t.connId, t.table.name)
      break
    case 'exp-csv':
      runExport(t.connId, t.table.name, 'csv')
      break
    case 'exp-xlsx':
      runExport(t.connId, t.table.name, 'xlsx')
      break
    case 'exp-both':
      runExport(t.connId, t.table.name, 'sql-both')
      break
    case 'exp-ddl':
      runExport(t.connId, t.table.name, 'sql-ddl')
      break
    case 'rename':
      opsInput.value = ''
      ops.value = { mode: 'rename', connId: t.connId, table: t.table.name }
      break
    case 'truncate':
      opsInput.value = ''
      ops.value = { mode: 'truncate', connId: t.connId, table: t.table.name }
      break
    case 'drop':
      opsInput.value = ''
      ops.value = { mode: 'drop', connId: t.connId, table: t.table.name }
      break
    case 'query':
      store.openQueryTab(t.connId)
      break
    case 'refresh':
      store.refreshTables(t.connId)
      break
  }
}

// ── 连接右键菜单 ──────────────────────────────────────
const connMenuShow = ref(false)
const connMenuX = ref(0)
const connMenuY = ref(0)
const connMenuTarget = ref<ConnInfo | null>(null)

function openConnMenu(e: MouseEvent, c: ConnInfo) {
  connMenuTarget.value = c
  connMenuShow.value = true
  connMenuX.value = e.clientX
  connMenuY.value = e.clientY
}

async function onConnMenuSelect(key: string | number) {
  connMenuShow.value = false
  const c = connMenuTarget.value
  if (!c) return
  switch (key) {
    case 'new-table':
      store.openDesigner(c.id)
      break
    case 'import-csv':
      emit('import-csv', c.id)
      break
    case 'er':
      store.openEr(c.id)
      break
    case 'import-sql':
      importSqlFile(c.id).catch((e) => message.error(String(e)))
      break
    case 'exp-db-both':
      exportDatabase(c.id, c.name, true).catch((e) => message.error(String(e)))
      break
    case 'exp-db-ddl':
      exportDatabase(c.id, c.name, false).catch((e) => message.error(String(e)))
      break
    case 'search-data':
      emit('global-search')
      break
    case 'query':
      store.openQueryTab(c.id)
      break
    case 'edit':
      emit('edit-connection', c)
      break
    case 'disconnect':
      store.disconnect(c.id)
      break
  }
}
</script>

<template>
  <aside class="sidebar">
    <div class="brand" data-tauri-drag-region>
      <span class="logo"><Icon name="database" :size="14" /></span>
      <span class="brand-name">数镜</span>
    </div>
    <div class="sec">
      <span class="sec-title">数据库</span>
      <span class="sec-btns">
        <n-button quaternary size="tiny" title="快速打开表 (⌘P)" @click="emit('quick-open')">
          <Icon name="search" :size="14" />
        </n-button>
        <n-button quaternary size="tiny" title="新建连接" @click="emit('new-connection')">
          <Icon name="plus" :size="14" />
        </n-button>
      </span>
    </div>
    <div v-if="Object.keys(store.live).length" class="search">
      <n-input
        v-model:value="store.tableFilter"
        size="tiny"
        placeholder="搜索表名"
        clearable
        round
      />
    </div>
    <div class="scroll">
      <div v-for="c in store.saved" :key="c.id" class="conn">
        <div
          class="row"
          :class="{ colored: !!c.color }"
          :style="c.color ? { '--c-color': c.color } : undefined"
          :title="c.name"
          @click="toggle(c)"
          @contextmenu.prevent="openConnMenu($event, c)"
        >
          <span class="dot" :class="dotClass(c.id)" />
          <Icon
            :name="DB_ICON[c.dbType] ?? 'database'"
            :size="13"
            :style="{ color: DB_COLOR[c.dbType] ?? 'var(--accent)' }"
            class="db-ic"
          />
          <span class="name">{{ c.name }}</span>
          <span class="ops" @click.stop>
            <button
              v-if="!store.live[c.id]"
              class="op"
              title="编辑连接"
              @click="emit('edit-connection', c)"
            >
              <Icon name="pencil" :size="12" />
            </button>
            <button v-else class="op" title="断开" @click="store.disconnect(c.id)">
              <Icon name="power" :size="12" />
            </button>
            <n-popconfirm @positive-click="store.removeConn(c.id)">
              <template #trigger>
                <button class="op danger" title="删除连接">
                  <Icon name="trash" :size="12" />
                </button>
              </template>
              确认删除连接「{{ c.name }}」?
            </n-popconfirm>
          </span>
        </div>
        <div v-if="store.live[c.id]" class="tables">
          <n-spin v-if="store.live[c.id].loading" size="small" class="spin" />
          <!-- Redis:键空间分组 -->
          <template v-if="isRedisConn(c)">
            <div v-for="d in redisDbsOf(c.id)" :key="d.db" class="tbl redis-db" :title="`db${d.db}:${d.keys} 个键`" @click="store.openRedis(c.id, d.db)">
              <span class="tbl-icon redis-ic"><Icon name="diamond" :size="11" /></span>{{ d.name }}
              <span class="db-count">{{ d.keys }}</span>
            </div>
          </template>
          <template v-else>
            <div
              class="group"
              @click="toggleGroup(c.id, 'table')"
            >
              <span class="chevron">
                <Icon :name="isCollapsed(c.id, 'table') ? 'chevronRight' : 'chevronDown'" :size="11" />
              </span>
              表 ({{ tablesOf(c.id, 'table').length }})
            </div>
            <div v-show="!isCollapsed(c.id, 'table')" class="group-items">
              <div
                v-for="t in tablesOf(c.id, 'table')"
                :key="t.name"
                class="tbl"
                :title="t.name"
                @click="store.openTable(c.id, t)"
                @contextmenu.prevent="openMenu($event, c.id, t)"
              >
                <span class="tbl-icon"><Icon name="table" :size="12" /></span>{{ t.name }}
              </div>
            </div>
            <div
              v-if="tablesOf(c.id, 'view').length"
              class="group"
              @click="toggleGroup(c.id, 'view')"
            >
              <span class="chevron">
                <Icon :name="isCollapsed(c.id, 'view') ? 'chevronRight' : 'chevronDown'" :size="11" />
              </span>
              视图 ({{ tablesOf(c.id, 'view').length }})
            </div>
            <div v-show="!isCollapsed(c.id, 'view')" class="group-items">
              <div
                v-for="t in tablesOf(c.id, 'view')"
                :key="t.name"
                class="tbl"
                :title="t.name"
                @click="store.openTable(c.id, t)"
                @contextmenu.prevent="openMenu($event, c.id, t)"
              >
                <span class="tbl-icon view"><Icon name="eye" :size="12" /></span>{{ t.name }}
              </div>
            </div>
            <div
              v-if="procsOf(c.id).length"
              class="group"
              @click="toggleGroup(c.id, 'proc')"
            >
              <span class="chevron">
                <Icon :name="isCollapsed(c.id, 'proc') ? 'chevronRight' : 'chevronDown'" :size="11" />
              </span>
              程序对象 ({{ procsOf(c.id).length }})
            </div>
            <div v-show="!isCollapsed(c.id, 'proc')" class="group-items">
              <div
                v-for="p in procsOf(c.id)"
                :key="p.name"
                class="tbl"
                :title="`${p.kind}: ${p.name}`"
                @click="openProc(c.id, p)"
              >
                <span class="tbl-icon proc">
                  <Icon :name="p.kind === 'trigger' ? 'zap' : 'code'" :size="11" />
                </span>{{ p.name }}
              </div>
            </div>
            <div
              v-if="!store.filteredTables(c.id).length"
              class="tbl-empty"
            >
              {{ store.tableFilter ? '没有匹配的表' : '没有表' }}
            </div>
          </template>
        </div>
      </div>
      <button v-if="!store.saved.length" class="none" @click="emit('new-connection')">
        <span class="none-plus"><Icon name="plus" :size="16" /></span>
        新建第一个连接
      </button>
    </div>
    <div class="foot"><span class="kbd">⌘↵</span> 运行查询</div>
    <n-dropdown
      trigger="manual"
      :show="menuShow"
      :x="menuX"
      :y="menuY"
      :options="menuOptions"
      placement="bottom-start"
      @select="onMenuSelect"
      @clickoutside="menuShow = false"
    />
    <n-dropdown
      trigger="manual"
      :show="connMenuShow"
      :x="connMenuX"
      :y="connMenuY"
      :options="[
        { label: '新建表…', key: 'new-table' },
        { label: '导入 CSV / Excel…', key: 'import-csv' },
        { label: '导入 SQL 文件…', key: 'import-sql' },
        {
          label: '导出数据库 SQL ▸',
          key: 'exp-db',
          children: [
            { label: '结构 + 数据', key: 'exp-db-both' },
            { label: '仅结构', key: 'exp-db-ddl' },
          ],
        },
        { label: '查看 ER 图', key: 'er' },
        { label: '搜索数据…', key: 'search-data' },
        { label: '新建查询', key: 'query' },
        { type: 'divider', key: 'd1' },
        { label: '编辑连接', key: 'edit' },
        { label: '断开', key: 'disconnect' },
      ]"
      placement="bottom-start"
      @select="onConnMenuSelect"
      @clickoutside="connMenuShow = false"
    />
  </aside>

  <!-- 表管理操作弹窗 -->
  <n-modal
    :show="ops !== null"
    preset="card"
    :title="opsTitle"
    :style="{ width: '420px' }"
    :mask-closable="!opsBusy"
    @update:show="(v: boolean) => !v && (ops = null)"
  >
    <div v-if="ops" class="ops-body">
      <template v-if="ops.mode === 'rename'">
        <div class="ops-label">新表名</div>
        <n-input v-model:value="opsInput" size="small" class="mono" :placeholder="ops.table" @keyup.enter="runOps" />
      </template>
      <template v-else-if="ops.mode === 'truncate'">
        <div class="ops-label">将删除 <b class="mono">{{ ops.table }}</b> 的全部数据(结构保留),不可撤销。确认清空?</div>
      </template>
      <template v-else>
        <div class="ops-label">
          将执行 <b class="mono">DROP TABLE</b>,表结构、数据、索引全部删除且不可撤销。<br />
          请输入表名 <b class="mono warn-text">{{ ops.table }}</b> 以确认:
        </div>
        <n-input v-model:value="opsInput" size="small" class="mono" placeholder="输入表名确认" @keyup.enter="runOps" />
      </template>
    </div>
    <template #footer>
      <div class="ops-footer">
        <n-button size="small" :disabled="opsBusy" @click="ops = null">取消</n-button>
        <n-button
          size="small"
          :type="ops?.mode === 'drop' ? 'error' : 'primary'"
          :loading="opsBusy"
          :disabled="ops?.mode === 'drop' && opsInput.trim() !== ops.table"
          @click="runOps"
        >
          {{ ops?.mode === 'rename' ? '重命名' : ops?.mode === 'truncate' ? '清空数据' : '删除表' }}
        </n-button>
      </div>
    </template>
  </n-modal>
</template>

<style scoped>
.sidebar {
  width: 250px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  /* 模拟 macOS vibrancy:极微妙的纵向明度渐变 */
  background: var(--sidebar-gradient);
  border-right: 1px solid var(--border);
}
.brand {
  display: flex;
  align-items: center;
  gap: 9px;
  /* Tauri 窗口内由全局样式加 margin-top 给红绿灯让位 */
  margin-top: 14px;
  padding: 0 18px 8px;
}
.brand .logo {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 6.5px;
  background: linear-gradient(135deg, #0a84ff, #5e5ce6);
  color: #fff;
  font-size: 14px;
  box-shadow: 0 3px 8px rgba(94, 92, 230, 0.35);
}
.brand-name {
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.2px;
}
.sec {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px 4px 20px;
}
.sec-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-tertiary);
}
.sec-btns {
  display: inline-flex;
  gap: 2px;
}
.search {
  padding: 4px 12px 6px;
}
.scroll {
  flex: 1;
  overflow-y: auto;
  padding: 2px 10px 10px;
}
.conn {
  margin-bottom: 2px;
}
.db-ic {
  flex-shrink: 0;
}
.row {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 30px;
  padding: 0 8px;
  border-radius: 7px;
  cursor: pointer;
  color: var(--text-secondary);
  user-select: none;
  transition: background-color 0.12s ease, color 0.12s ease;
}
.row:hover {
  background: var(--bg-hover);
  color: var(--text);
}
.row.colored {
  box-shadow: inset 3px 0 0 var(--c-color, var(--accent));
}
.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #48484a;
  flex-shrink: 0;
}
.dot.on {
  background: var(--green);
  box-shadow: 0 0 6px rgba(48, 209, 88, 0.55);
}
.dot.busy {
  background: var(--warn);
  animation: pulse 0.9s ease-in-out infinite;
}
@keyframes pulse {
  50% {
    opacity: 0.35;
  }
}
.name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
}
.tag {
  font-size: 10px;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 5px;
  flex-shrink: 0;
  letter-spacing: 0.3px;
}
/* 数据库品牌色 */
.tag-sqlite {
  color: #4fc3f7;
  background: rgba(79, 195, 247, 0.12);
}
.tag-mysql {
  color: #f2915a;
  background: rgba(242, 145, 90, 0.13);
}
.tag-postgres {
  color: #7aa2f7;
  background: rgba(122, 162, 247, 0.13);
}
.ops {
  display: none;
  gap: 2px;
  flex-shrink: 0;
}
.row:hover .ops {
  display: inline-flex;
}
.row:hover .tag {
  display: none;
}
.op {
  width: 20px;
  height: 20px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  font-size: 11px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
}
.op:hover {
  color: var(--text);
  background: var(--bg-active);
}
.op.danger:hover {
  color: var(--danger);
}
.tables {
  padding: 1px 0 4px;
}
.spin {
  display: block;
  padding: 8px 0 8px 20px;
}
.group {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 26px;
  padding: 0 6px 0 8px;
  border-radius: 6px;
  color: var(--text-tertiary);
  font-size: 11.5px;
  font-weight: 600;
  cursor: pointer;
  user-select: none;
  transition: color 0.12s ease, background-color 0.12s ease;
}
.group:hover {
  color: var(--text-secondary);
  background: var(--bg-hover);
}
.chevron {
  width: 12px;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  color: var(--text-tertiary);
}
.group-items {
  padding-left: 10px;
}
.tbl {
  display: flex;
  align-items: center;
  gap: 7px;
  height: 26px;
  padding: 0 8px;
  border-radius: 6px;
  color: var(--text-secondary);
  cursor: pointer;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: 12.5px;
  user-select: none;
  transition: background-color 0.12s ease, color 0.12s ease;
}
.tbl:hover {
  color: var(--text);
  background: var(--bg-hover);
}
.tbl-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 15px;
  flex-shrink: 0;
  opacity: 0.7;
}
.tbl-icon.view {
  color: var(--accent);
  opacity: 0.9;
}
.redis-db {
  color: var(--text-secondary);
}
.redis-ic {
  color: var(--danger);
}
.db-count {
  margin-left: auto;
  font-size: 10px;
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
}
.tbl-icon.proc {
  color: #ff9e64;
  opacity: 0.9;
}
.tbl-empty {
  padding: 4px 8px 4px 18px;
  color: var(--text-tertiary);
  font-size: 12px;
}
.none {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  margin: 18px 14px;
  padding: 22px 12px;
  color: var(--text-secondary);
  border: 1px dashed var(--border-strong);
  border-radius: 10px;
  line-height: 1.5;
  font-size: 12.5px;
  background: none;
  cursor: pointer;
  transition: border-color 0.12s ease, color 0.12s ease;
}
.none:hover {
  border-color: var(--accent);
  color: var(--text);
}
.none-plus {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  background: var(--bg-active);
  color: var(--accent);
  font-size: 16px;
}
.none:hover .none-plus {
  background: var(--accent);
  color: #fff;
}
.foot {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 10px 18px;
  border-top: 1px solid var(--border);
  color: var(--text-tertiary);
  font-size: 11px;
}
.ops-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.ops-label {
  font-size: 12.5px;
  color: var(--text-secondary);
  line-height: 1.7;
}
.warn-text {
  color: #ff6b70;
}
.ops-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
