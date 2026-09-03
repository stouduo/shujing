/**
 * 多数据库浏览树:库列表加载 / 展开 / 表缓存 / 库显示筛选 / 表名搜索高亮
 * 从 SideBar.vue 拆出的纯逻辑(无模板依赖),UI 交互留在组件。
 */
import { nextTick, ref, watch } from 'vue'
import * as api from '../api'
import { useAppStore } from '../stores/app'
import { escapeHtml } from '../stores/helpers'
import type { ConnInfo, TableMeta } from '../types'

/** 大库截断:无搜索时最多渲染的表数(防止一次渲染上千节点卡顿) */
const TREE_CAP = 500
const DB_FILTER_KEY = 'dblens_dbfilter'

export function useDbTree() {
  const store = useAppStore()

  // ── 树状态:库列表 / 展开的库 / 库→表缓存 / 加载中 ──
  const databases = ref<Record<string, string[]>>({})
  const expandedDb = ref<Record<string, string>>({})
  const dbTables = ref<Record<string, TableMeta[]>>({})
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

  function syncTablesToStore(connId: string, tables: TableMeta[]) {
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
  function currentDbTables(connId: string): TableMeta[] {
    const db = expandedDb.value[connId]
    if (!db) return []
    const key = `${connId}/${db}`
    return dbTables.value[key] ?? []
  }

  function dbAllOf(connId: string, kind: string): TableMeta[] {
    return currentDbTables(connId).filter((t) => t.kind === kind)
  }

  function dbTablesOf(connId: string, kind: string): TableMeta[] {
    const kw = store.tableFilter.trim().toLowerCase()
    const list = dbAllOf(connId, kind)
    if (kw) return list.filter((t) => t.name.toLowerCase().includes(kw))
    return list.length > TREE_CAP ? list.slice(0, TREE_CAP) : list
  }

  /** 搜索时自动展开有命中的库(仅限已缓存表列表的库,不触发网络) */
  function expandDbWithHits(kw: string) {
    const q = kw.trim().toLowerCase()
    if (!q) return
    for (const [key, tables] of Object.entries(dbTables.value)) {
      if (!tables.some((t) => t.name.toLowerCase().includes(q))) continue
      const connId = key.slice(0, key.indexOf('/'))
      const db = key.slice(key.indexOf('/') + 1)
      if (databases.value[connId]?.includes(db)) expandedDb.value[connId] = db
    }
  }

  /** 重新拉取某库的表列表(表组右键"刷新") */
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

  /** 滚动到第一个命中表 */
  async function scrollToFirstHit() {
    await nextTick()
    document.querySelector('.scroll .tbl mark')?.scrollIntoView({ block: 'nearest' })
  }

  // ── 库显示筛选(按连接记忆,localStorage 持久化) ──
  const dbFilter = ref<Record<string, string[]>>({})
  try {
    dbFilter.value = JSON.parse(localStorage.getItem(DB_FILTER_KEY) || '{}')
  } catch {
    /* 损坏则当空 */
  }

  function persistDbFilter() {
    localStorage.setItem(DB_FILTER_KEY, JSON.stringify(dbFilter.value))
  }

  function visibleDbs(connId: string): string[] {
    const all = databases.value[connId] ?? []
    const show = dbFilter.value[connId]
    return show ? all.filter((db) => show.includes(db)) : all
  }

  function dbVisible(connId: string, db: string): boolean {
    const show = dbFilter.value[connId]
    return show ? show.includes(db) : true
  }

  function toggleDbVisible(connId: string, db: string, on: boolean) {
    const cur = dbFilter.value[connId] ?? [...(databases.value[connId] ?? [])]
    const next = on ? [...new Set([...cur, db])] : cur.filter((d) => d !== db)
    // 全部勾选 = 不限(与未设置等价,少存一份)
    if (next.length === (databases.value[connId] ?? []).length) {
      delete dbFilter.value[connId]
    } else {
      dbFilter.value[connId] = next
    }
    persistDbFilter()
  }

  function setAllDbVisible(connId: string, on: boolean) {
    if (!on) {
      dbFilter.value[connId] = []
    } else {
      delete dbFilter.value[connId]
    }
    persistDbFilter()
  }

  /** 表名搜索命中高亮(HTML) */
  function hiName(name: string): string {
    const q = store.tableFilter.trim()
    if (!q) return escapeHtml(name)
    const lower = name.toLowerCase()
    const lq = q.toLowerCase()
    let out = ''
    let i = 0
    for (;;) {
      const idx = lower.indexOf(lq, i)
      if (idx < 0) {
        out += escapeHtml(name.slice(i))
        break
      }
      out += escapeHtml(name.slice(i, idx)) + '<mark class="kw">' + escapeHtml(name.slice(idx, idx + q.length)) + '</mark>'
      i = idx + q.length
    }
    return out
  }

  return {
    databases,
    expandedDb,
    dbTables,
    dbLoading,
    dbFilter,
    isMultiDb,
    loadDatabases,
    expandDb,
    currentDbTables,
    dbAllOf,
    dbTablesOf,
    expandDbWithHits,
    refreshTablesOnly,
    scrollToFirstHit,
    visibleDbs,
    dbVisible,
    toggleDbVisible,
    setAllDbVisible,
    hiName,
  }
}
