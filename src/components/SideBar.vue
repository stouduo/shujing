<script setup lang="ts">
import { computed, ref, watch } from 'vue'
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
import * as api from '../api'
import NewObjectModal from './NewObjectModal.vue'
import TableStatsModal from './TableStatsModal.vue'

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

// ── 多数据库浏览(树形:连接 → 库列表 → 表) ────────
const databases = ref<Record<string, string[]>>({})
/** 当前展开的库(一个连接同时只展开一个库) */
const expandedDb = ref<Record<string, string>>({})
/** 各库的表缓存(键: connId/dbname) */
const dbTables = ref<Record<string, import('../types').TableMeta[]>>({})
const dbLoading = ref<Record<string, boolean>>({})

function isMultiDb(c: ConnInfo): boolean {
  return c.dbType === 'mysql' || c.dbType === 'postgres'
}

// 监听连接状态:会话恢复后自动加载数据库列表
watch(
  () => Object.keys(store.live),
  (liveIds) => {
    for (const connId of liveIds) {
      const conn = store.connById(connId)
      if (conn && isMultiDb(conn) && !databases.value[connId]) {
        loadDatabases(connId)
      }
    }
  },
  { immediate: true },
)

async function loadDatabases(connId: string) {
  if (databases.value[connId]) return
  try {
    databases.value[connId] = await api.listDatabases(connId)
    // 默认展开第一个(或连接配置/最近使用的库)
    const conn = store.connById(connId)
    const defaultDb =
      (conn?.database || '').trim() || store.lastDbs[connId] || databases.value[connId]?.[0] || ''
    if (defaultDb) {
      if (!databases.value[connId]?.includes(defaultDb)) return
      expandDb(connId, defaultDb)
    }
  } catch {
    databases.value[connId] = []
  }
}

async function expandDb(connId: string, db: string) {
  // 折叠已展开的
  if (expandedDb.value[connId] === db) {
    delete expandedDb.value[connId]
    return
  }
  expandedDb.value[connId] = db

  // 加载该库的表(有缓存则直接用)
  const key = `${connId}/${db}`
  if (dbTables.value[key]) {
    syncTablesToStore(connId, dbTables.value[key])
    switchDatabase(connId, db)
    return
  }

  dbLoading.value[key] = true
  try {
    const tables = await api.listTables(connId, db)
    dbTables.value[key] = tables
    syncTablesToStore(connId, tables)
    switchDatabase(connId, db)
  } catch (e) {
    console.warn('加载表失败:', e)
    dbTables.value[key] = []
  } finally {
    dbLoading.value[key] = false
  }
}

function syncTablesToStore(connId: string, tables: import('../types').TableMeta[]) {
  const live = store.live[connId]
  if (live) live.tables = tables
}

/** 切换数据库上下文(MySQL 发 USE dbname,PG 设 search_path),并记忆为该连接的最近库 */
async function switchDatabase(connId: string, db: string) {
  const conn = store.connById(connId)
  if (!conn) return
  try {
    if (conn.dbType === 'mysql') {
      await api.runSql(connId, 'USE `' + db + '`')
    } else if (conn.dbType === 'postgres') {
      await api.runSql(connId, 'SET search_path TO "' + db.replace(/"/g, '""') + '"')
    }
  } catch {
    /* 切库失败不影响 information_schema 查表 */
  }
  // 记忆最近使用的库:重启重连后自动回到这里(不改连接配置本身)
  store.rememberLastDb(connId, db)
}

/** 当前展开库的表(用于渲染表分组) */
function currentDbTables(connId: string): import('../types').TableMeta[] {
  const db = expandedDb.value[connId]
  if (!db) return []
  const key = `${connId}/${db}`
  return dbTables.value[key] ?? []
}

/** 当前展开库的表(按 kind 过滤) */
function dbTablesOf(connId: string, kind: string): import('../types').TableMeta[] {
  return currentDbTables(connId).filter((t) => t.kind === kind)
}

/** 点击连接行:展开/收起内容(不触发断开) */
// 纯展开/收起(不重新加载任何数据)
const connExpanded = ref<Record<string, boolean>>({})

async function toggle(c: ConnInfo) {
  if (connExpanded.value[c.id]) {
    // 收起:只改显示状态
    delete connExpanded.value[c.id]
    return
  }
  // 展开
  connExpanded.value[c.id] = true
  // 如果未连接,连接
  if (!store.live[c.id]) {
    await store.connect(c.id)
  }
  // 如果是多库且没有库列表,加载库列表(首次)
  if (store.live[c.id] && isMultiDb(c) && !databases.value[c.id]) {
    loadDatabases(c.id)
  }
}

/** 右侧电源按钮:真正的连接/断开 */
async function powerToggle(c: ConnInfo) {
  if (store.live[c.id]) {
    store.disconnect(c.id)
    delete expandedDb.value[c.id]
    delete databases.value[c.id]
  } else {
    await store.connect(c.id)
    if (store.live[c.id] && isMultiDb(c)) {
      loadDatabases(c.id)
    }
  }
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
const menuTarget = ref<{ connId: string; table: TableMeta; database?: string | null } | null>(null)

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
  {
    label: '复制表 ▸',
    key: 'dup-menu',
    children: [
      { label: '结构 + 数据', key: 'dup-full' },
      { label: '仅结构', key: 'dup-schema' },
    ],
  },
  {
    label: '维护 ▸',
    key: 'maint-menu',
    children: [
      { label: 'OPTIMIZE(优化碎片)', key: 'maint-opt' },
      { label: 'ANALYZE(更新统计)', key: 'maint-ana' },
      { label: '表统计信息…', key: 'maint-stats' },
    ],
  },
  { label: '重命名…', key: 'rename' },
  { label: '清空表数据…', key: 'truncate' },
  { label: '删除表…', key: 'drop', props: { style: { color: '#ff6b70' } } },
  { type: 'divider', key: 'd2' },
  { label: '新建查询', key: 'query' },
  { label: '刷新表列表', key: 'refresh' },
]

// ── 新建对象 ────────────────────────────────────────
const showNewObj = ref(false)
const showStats = ref(false)
const statsTable = ref('')
const newObjConn = ref('')
const newObjKind = ref<'trigger' | 'procedure' | 'function' | 'view'>('trigger')

function openNewObj(connId: string, kind?: string) {
  newObjConn.value = connId
  newObjKind.value = (kind as typeof newObjKind.value) || 'trigger'
  showNewObj.value = true
}

// ── 数据库右键菜单(局部刷新表列表) ──────────────────
const dbMenu = ref({ show: false, x: 0, y: 0, connId: '', db: '' })

function openDbMenu(e: MouseEvent, connId: string, db: string) {
  dbMenu.value = { show: true, x: e.clientX, y: e.clientY, connId, db }
}

async function refreshTablesOnly(connId: string, db: string) {
  const key = `${connId}/${db}`
  dbLoading.value[key] = true
  try {
    const tables = await api.listTables(connId, db)
    dbTables.value[key] = tables
    syncTablesToStore(connId, tables)
    await switchDatabase(connId, db)
  } catch (e) {
    console.warn('刷新表列表失败:', e)
  } finally {
    dbLoading.value[key] = false
  }
}

// ── 对象右键删除 ──────────────────────────────────────
const objMenu = ref({ show: false, x: 0, y: 0, connId: '', kind: '', name: '' })

function openObjMenu(e: MouseEvent, connId: string, p: { name: string; kind: string }) {
  objMenu.value = { show: true, x: e.clientX, y: e.clientY, connId, kind: p.kind, name: p.name }
}

// ── 表管理操作弹窗(重命名 / 清空 / 删除) ────────────
const message = useMessage()
const ops = ref<{
  mode: 'rename' | 'truncate' | 'drop' | 'duplicate'
  connId: string
  table: string
  dupWithData?: boolean
} | null>(null)
const opsInput = ref('')
const opsBusy = ref(false)

const opsTitle = computed(() => {
  if (!ops.value) return ''
  if (ops.value.mode === 'rename') return `重命名表:${ops.value.table}`
  if (ops.value.mode === 'truncate') return `清空表数据:${ops.value.table}`
  if (ops.value.mode === 'duplicate')
    return `复制表:${ops.value.table}(${ops.value.dupWithData ? '结构+数据' : '仅结构'})`
  return `删除表:${ops.value.table}`
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
    } else if (mode === 'duplicate') {
      const name = opsInput.value.trim()
      if (!name || name === table) return
      opsBusy.value = true
      await store.duplicateTable(connId, table, name, !!ops.value.dupWithData)
      message.success(`已复制为 ${name}`)
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

function openMenu(e: MouseEvent, connId: string, table: TableMeta, database?: string | null) {
  menuTarget.value = { connId, table, database: database ?? null }
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
      store.openTable(t.connId, t.table, t.database)
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
    case 'dup-full':
    case 'dup-schema':
      opsInput.value = ''
      ops.value = { mode: 'duplicate', connId: t.connId, table: t.table.name, dupWithData: key === 'dup-full' }
      break
    case 'maint-opt':
      store.maintainTable(t.connId, t.table.name, 'optimize').then(
        () => message.success('OPTIMIZE 完成'),
        (e) => message.error(String(e)),
      )
      break
    case 'maint-stats':
      statsTable.value = t.table.name
      showStats.value = true
      break
    case 'maint-ana':
      store.maintainTable(t.connId, t.table.name, 'analyze').then(
        () => message.success('ANALYZE 完成'),
        (e) => message.error(String(e)),
      )
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
    case 'refresh': {
      // 局部刷新:刷该表所在库的表列表,不整连接 reload
      if (t.database) {
        await refreshTablesOnly(t.connId, t.database)
      } else if (store.live[t.connId]) {
        try {
          store.live[t.connId].tables = await api.listTables(t.connId)
        } catch (e) {
          console.warn('刷新表列表失败:', e)
        }
      }
      break
    }
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
    case 'new-trigger':
      openNewObj(c.id, 'trigger')
      break
    case 'new-procedure':
      openNewObj(c.id, 'procedure')
      break
    case 'new-function':
      openNewObj(c.id, 'function')
      break
    case 'new-view':
      openNewObj(c.id, 'view')
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
    case 'refresh-dbs': {
      // 局部刷新:只重新拉库列表
      databases.value[c.id] = await api.listDatabases(c.id)
      const curDb = expandedDb.value[c.id]
      if (curDb) {
        await refreshTablesOnly(c.id, curDb)
      }
      break
    }
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
            <button v-else class="op" title="断开连接" @click.stop="powerToggle(c)">
              <Icon name="power" :size="12" />
            </button>
            <button
              v-if="!store.live[c.id]"
              class="op"
              title="连接"
              @click.stop="powerToggle(c)"
            >
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
        <div v-if="connExpanded[c.id] && store.live[c.id]" class="tables">
          <n-spin v-if="store.live[c.id].loading" size="small" class="spin" />
          <!-- Redis:键空间分组 -->
          <template v-if="isRedisConn(c)">
            <div v-for="d in redisDbsOf(c.id)" :key="d.db" class="tbl redis-db" :title="`db${d.db}:${d.keys} 个键`" @click="store.openRedis(c.id, d.db)">
              <span class="tbl-icon redis-ic"><Icon name="diamond" :size="11" /></span>{{ d.name }}
              <span class="db-count">{{ d.keys }}</span>
            </div>
          </template>
          <template v-else>
            <!-- 多数据库:MySQL/PG 显示库列表(树形展开) -->
            <template v-if="isMultiDb(c)">
              <n-spin v-if="!databases[c.id]" size="small" class="spin" />
              <template v-else>
                <div
                  v-for="db in databases[c.id]"
                  :key="db"
                  class="db-node"
                >
                  <div
                    class="db-row"
                    :class="{ active: expandedDb[c.id] === db }"
                    @click="expandDb(c.id, db)"
                    @contextmenu.prevent="openDbMenu($event, c.id, db)"
                  >
                    <span class="db-chevron">
                      {{ expandedDb[c.id] === db ? '▾' : '▸' }}
                    </span>
                    <Icon name="database" :size="11" class="db-ic" />
                    <span class="db-name">{{ db }}</span>
                    <n-spin v-if="dbLoading[`${c.id}/${db}`]" size="small" style="margin-left:auto" />
                  </div>
                  <!-- 展开的库:显示表/视图/程序对象 -->
                  <template v-if="expandedDb[c.id] === db">
                    <div class="group db-child" @click="toggleGroup(c.id, 'table')">
                      <span class="chevron">
                        <Icon :name="isCollapsed(c.id, 'table') ? 'chevronRight' : 'chevronDown'" :size="11" />
                      </span>
                      表 ({{ dbTablesOf(c.id, 'table').length }})
                    </div>
                    <div v-show="!isCollapsed(c.id, 'table')" class="group-items db-indent">
                      <div
                        v-for="t in dbTablesOf(c.id, 'table')"
                        :key="t.name"
                        class="tbl"
                        :title="t.name"
                        @click="store.openTable(c.id, t, db)"
                        @contextmenu.prevent="openMenu($event, c.id, t, db)"
                      >
                        <span class="tbl-icon"><Icon name="table" :size="12" /></span>{{ t.name }}
                      </div>
                      <div v-if="!dbTablesOf(c.id, 'table').length && !dbLoading[`${c.id}/${db}`]" class="tbl-empty">无表</div>
                    </div>
                    <div v-if="dbTablesOf(c.id, 'view').length" class="group db-child" @click="toggleGroup(c.id, 'view')">
                      <span class="chevron">
                        <Icon :name="isCollapsed(c.id, 'view') ? 'chevronRight' : 'chevronDown'" :size="11" />
                      </span>
                      视图 ({{ dbTablesOf(c.id, 'view').length }})
                    </div>
                    <div v-show="!isCollapsed(c.id, 'view')" class="group-items db-indent">
                      <div
                        v-for="t in dbTablesOf(c.id, 'view')"
                        :key="t.name"
                        class="tbl"
                        :title="t.name"
                        @click="store.openTable(c.id, t, db)"
                        @contextmenu.prevent="openMenu($event, c.id, t, db)"
                      >
                        <span class="tbl-icon view"><Icon name="eye" :size="12" /></span>{{ t.name }}
                      </div>
                    </div>
                    <!-- 程序对象(仅 MySQL/PG) -->
                    <div v-if="procsOf(c.id).length" class="group db-child" @click="toggleGroup(c.id, 'proc')">
                      <span class="chevron">
                        <Icon :name="isCollapsed(c.id, 'proc') ? 'chevronRight' : 'chevronDown'" :size="11" />
                      </span>
                      程序对象 ({{ procsOf(c.id).length }})
                    </div>
                    <div v-show="!isCollapsed(c.id, 'proc')" class="group-items db-indent">
                      <div
                        v-for="pr in procsOf(c.id)"
                        :key="pr.name"
                        class="tbl"
                        :title="`${pr.kind}: ${pr.name}`"
                        @click="openProc(c.id, pr)"
                        @contextmenu.prevent="openObjMenu($event, c.id, pr)"
                      >
                        <span class="tbl-icon proc">
                          <Icon :name="pr.kind === 'trigger' ? 'zap' : 'code'" :size="11" />
                        </span>{{ pr.name }}
                      </div>
                      <div class="tbl add-obj" title="新建对象" @click.stop="openNewObj(c.id)">
                        <span class="tbl-icon proc"><Icon name="plus" :size="10" /></span>新建对象…
                      </div>
                    </div>
                  </template>
                </div>
                <!-- 刷新按钮 -->
                </template>
            </template>
            <!-- 单库(SQLite):直接显示表,多库时不渲染 -->
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
                :title="`${p.kind}: ${p.name}(右键:删除)`"
                @click="openProc(c.id, p)"
                @contextmenu.prevent="openObjMenu($event, c.id, p)"
              >
                <span class="tbl-icon proc">
                  <Icon :name="p.kind === 'trigger' ? 'zap' : 'code'" :size="11" />
                </span>{{ p.name }}
              </div>
              <div class="tbl add-obj" title="新建触发器/过程/函数/视图" @click.stop="openNewObj(c.id)">
                <span class="tbl-icon proc"><Icon name="plus" :size="10" /></span>新建对象…
              </div>
            </div>
            <div
              v-if="!store.filteredTables(c.id).length"
              class="tbl-empty"
            >
              {{ store.tableFilter ? '没有匹配的表' : '没有表' }}
            </div>
            </template>
          </template>
        </div>
      </div>
      <button v-if="!store.saved.length" class="none" @click="emit('new-connection')">
        <span class="none-plus"><Icon name="plus" :size="16" /></span>
        新建第一个连接
      </button>
    </div>
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
        {
          label: '新建对象 ▸',
          key: 'new-obj',
          children: [
            { label: '触发器…', key: 'new-trigger' },
            { label: '存储过程…', key: 'new-procedure' },
            { label: '函数…', key: 'new-function' },
            { label: '视图…', key: 'new-view' },
          ],
        },
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
        { label: '刷新数据库列表', key: 'refresh-dbs' },
        { type: 'divider', key: 'd1' },
        { label: '编辑连接', key: 'edit' },
        { label: '断开连接', key: 'disconnect' },
      ]"
      placement="bottom-start"
      @select="onConnMenuSelect"
      @clickoutside="connMenuShow = false"
    />
  </aside>

  <!-- 新建对象弹窗 -->
  <TableStatsModal
    v-model:show="showStats"
    :conn-id="menuTarget?.connId ?? null"
    :table="statsTable"
  />
  <NewObjectModal
    v-model:show="showNewObj"
    :conn-id="newObjConn || null"
    :default-kind="newObjKind"
  />
  <!-- 数据库右键菜单 -->
  <n-dropdown
    trigger="manual"
    :show="dbMenu.show"
    :x="dbMenu.x"
    :y="dbMenu.y"
    :options="[
      { label: '刷新表列表', key: 'refresh-tables' },
    ]"
    placement="bottom-start"
    @select="(k: string | number) => {
      const m = dbMenu
      dbMenu.show = false
      if (k === 'refresh-tables') refreshTablesOnly(m.connId, m.db)
    }"
    @clickoutside="dbMenu.show = false"
  />
  <!-- 对象右键删除 -->
  <n-popconfirm @positive-click="() => {
    store.dropObject(objMenu.connId, objMenu.kind, objMenu.name)
      .then(() => message.success(`已删除 ${objMenu.name}`))
      .catch((e) => message.error(String(e)))
  }">
    <template #trigger>
      <span style="display:none" />
    </template>
  </n-popconfirm>
  <n-dropdown
    trigger="manual"
    :show="objMenu.show"
    :x="objMenu.x"
    :y="objMenu.y"
    :options="[
      { label: '查看 DDL', key: 'view' },
      { label: `删除${objMenu.kind === 'trigger' ? '触发器' : objMenu.kind === 'procedure' ? '存储过程' : objMenu.kind === 'function' ? '函数' : '视图'}…`, key: 'del', props: { style: { color: '#ff6b70' } } },
    ]"
    placement="bottom-start"
    @select="(k: string | number) => {
      const m = objMenu
      objMenu.show = false
      if (k === 'view') store.openDdl(m.connId, m.kind, m.name)
      else if (k === 'del') {
        store.dropObject(m.connId, m.kind, m.name)
          .then(() => message.success(`已删除 ${m.name}`))
          .catch((e) => message.error(String(e)))
      }
    }"
    @clickoutside="objMenu.show = false"
  />
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
      <template v-else-if="ops.mode === 'duplicate'">
        <div class="ops-label">新表名(将复制{{ ops.dupWithData ? '结构和数据' : '仅结构' }})</div>
        <n-input v-model:value="opsInput" size="small" class="mono" :placeholder="`${ops.table}_copy`" @keyup.enter="runOps" />
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
          {{ ops?.mode === 'rename' ? '重命名' : ops?.mode === 'truncate' ? '清空数据' : ops?.mode === 'duplicate' ? '复制' : '删除表' }}
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
.db-node {
  margin-bottom: 0;
}
.db-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px 4px 22px;
  border-radius: 7px;
  cursor: pointer;
  color: var(--text-secondary);
  font-size: 12.5px;
  font-weight: 600;
  transition: all 0.12s ease;
  border-left: 2px solid transparent;
}
.db-row:hover {
  background: var(--bg-hover);
  color: var(--text);
}
.db-row.active {
  color: var(--accent);
}
.db-chevron {
  width: 12px;
  flex-shrink: 0;
  color: var(--text-tertiary);
  font-size: 10px;
}
.db-ic {
  color: var(--accent);
  opacity: 0.8;
}
.db-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.db-child {
  padding-left: 30px !important;
}
.db-indent {
  padding-left: 34px !important;
}
.db-refresh {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 4px 8px 4px 22px;
  color: var(--text-tertiary);
  font-size: 11px;
  cursor: pointer;
  border-radius: 6px;
  margin-top: 2px;
}
.db-refresh:hover {
  color: var(--accent);
  background: var(--bg-hover);
}
.db-expanded {
  animation: fade-in 0.15s ease;
}
/* .db-ic 在上方已定义 */
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
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.3px;
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
.db-selector {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 6px 6px 14px;
}
.db-select {
  flex: 1;
  height: 24px;
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  background: var(--bg-elevated);
  color: var(--text);
  font-size: 12px;
  padding: 0 6px;
  outline: none;
  cursor: pointer;
}
.db-select:hover,
.db-select:focus {
  border-color: var(--accent);
}
.add-obj {
  margin-left: 24px;
  color: var(--text-tertiary);
  border: 1px dashed var(--border-strong);
  margin-top: 4px;
}
.add-obj:hover {
  color: var(--accent);
  border-color: var(--accent);
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
