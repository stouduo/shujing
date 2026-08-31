import { defineStore } from 'pinia'
import { markRaw } from 'vue'
import * as api from '../api'
import { reviveTab, serializeTab } from '../panes/registry'
import { tableActions } from './tableActions'
import { quoteIdent, histSql } from './helpers'
import type { ColumnSpec, ConnInfo, DbType, TableMeta, TableTab, Tab } from '../types'

interface LiveState {
  tables: TableMeta[]
  loading: boolean
  version: string
}

function dbTypeOf(conn: ConnInfo | undefined, fallback: DbType = 'mysql'): DbType {
  return conn?.dbType ?? fallback
}

// ── 会话持久化 ────────────────────────────────────────
const SESSION_KEY = 'dblens_session_v1'


export const useAppStore = defineStore('app', {
  state: () => ({
    saved: [] as ConnInfo[],
    live: {} as Record<string, LiveState>,
    connecting: {} as Record<string, Promise<void> | undefined>,
    tabs: [] as Tab[],
    activeTabId: '',
    tabSeq: 0,
    /** 查询标签专用编号(从 1 开始,全部关闭后重置) */
    querySeq: 0,
    /** 侧栏表分组折叠状态,键为 `${connId}:表` / `${connId}:视图` */
    collapsed: {} as Record<string, boolean>,
    /** 侧栏表名搜索 */
    tableFilter: '',
    /** 查询历史(最近 30 条,带执行时的库上下文) */
    history: [] as import('./helpers').HistoryEntry[],
    /** 已知的表列(键 connId/table),用于 SQL 编辑器列名补全 */
    tableCols: {} as Record<string, string[]>,
    /** SQL 片段 */
    snippets: [] as { id: string; name: string; sql: string }[],
    /** 每个连接最近使用的库(键 connId),重启重连后自动恢复上下文 */
    lastDbs: {} as Record<string, string>,
  }),
  getters: {
    connById: (state) => (id: string): ConnInfo | undefined =>
      state.saved.find((c) => c.id === id),
    activeTab: (state): Tab | undefined =>
      state.tabs.find((t) => t.id === state.activeTabId),
    /** 按连接过滤后的表(应用搜索框) */
    filteredTables: (state) => (connId: string): TableMeta[] => {
      const st = state.live[connId]
      if (!st) return []
      const kw = state.tableFilter.trim().toLowerCase()
      if (!kw) return st.tables
      return st.tables.filter((t) => t.name.toLowerCase().includes(kw))
    },
  },
  actions: {
    ...tableActions,
    async init() {
      try {
        this.history = JSON.parse(localStorage.getItem('dblens_history') ?? '[]')
      } catch {
        this.history = []
      }
      try {
        this.snippets = JSON.parse(localStorage.getItem('dblens_snippets') ?? '[]')
      } catch {
        this.snippets = []
      }
      await this.loadSaved()
      if (!(await this.restoreSession())) this.openQueryTab()
      // 会话自动落盘:状态变化后防抖 800ms
      let timer: ReturnType<typeof setTimeout> | undefined
      this.$subscribe(() => {
        clearTimeout(timer)
        timer = setTimeout(() => this.saveSession(), 800)
      })
    },

    saveSession() {
      const tabs = this.tabs.map(serializeTab).filter((t): t is Record<string, unknown> => !!t)
      if (!tabs.length) {
        try {
          localStorage.removeItem(SESSION_KEY)
        } catch {
          /* 忽略 */
        }
        return
      }
      const data = {
        v: 1,
        activeTabId: this.activeTabId,
        liveConnIds: Object.keys(this.live),
        lastDbs: this.lastDbs,
        // lastDbsV=2 才可信:旧版会话里的 lastDbs 是"默认选第一个库"策略写入的,不可信
        lastDbsV: 2,
        tabs,
      }
      try {
        localStorage.setItem(SESSION_KEY, JSON.stringify(data))
      } catch {
        /* 存储满时忽略 */
      }
    },

    async restoreSession(): Promise<boolean> {
      let raw: string | null = null
      try {
        raw = localStorage.getItem(SESSION_KEY)
      } catch {
        return false
      }
      if (!raw) return false
      try {
        /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
        const d = JSON.parse(raw) as any
        if (d?.v !== 1 || !Array.isArray(d.tabs) || !d.tabs.length) return false
        // 恢复各连接最近使用的库(仅接受新版格式,旧数据可能被默认选库策略污染)
        if (d.lastDbsV === 2 && d.lastDbs && typeof d.lastDbs === 'object') {
          for (const [k, v] of Object.entries(d.lastDbs)) {
            if (typeof v === 'string') this.lastDbs[k] = v
          }
        }
        for (const st of d.tabs) {
          const tab = reviveTab(st)
          if (tab) this.tabs.push(tab)
        }
        if (!this.tabs.length) return false
        this.activeTabId = this.tabs.some((t) => t.id === d.activeTabId)
          ? d.activeTabId
          : this.tabs[0].id
        this.tabSeq = Math.max(0, ...this.tabs.map((t) => Number(t.id.slice(1)) || 0))

        // 恢复上次在线的连接:等全部连接(含库上下文恢复)就绪后再刷新标签,
        // 否则表数据查询会跑在 USE 之前,报 No database selected
        const connIds = Array.isArray(d.liveConnIds) ? d.liveConnIds : []
        await Promise.all(connIds.map((cid: string) => this.connect(cid).catch(() => {})))
        // 各标签重新拉数据
        for (const t of this.tabs) {
          if (t.kind === 'table' && t.connId) {
            this.loadTableData(t.id)
            this.loadPkCols(t.id)
            this.loadTableCount(t.id)
          } else if (t.kind === 'structure') {
            this.loadStructure(t.id)
          } else if (t.kind === 'er' && t.connId) {
            this.reloadEr(t.id)
          } else if (t.kind === 'ddl' && t.connId) {
            this.reloadDdl(t.id)
          } else if (t.kind === 'designer' && t.mode === 'edit' && t.connId) {
            this.reloadDesignerColumns(t.id)
          }
        }
        return true
      } catch {
        return false
      }
    },

    async reloadEr(id: string) {
      const tab = this.tabs.find((t) => t.id === id)
      if (!tab || tab.kind !== 'er' || !tab.connId) return
      tab.loading = true
      try {
        tab.fks = await api.listForeignKeys(tab.connId)
        tab.loading = false
      } catch (e) {
        tab.error = String(e)
        tab.loading = false
      }
    },

    async reloadDdl(id: string) {
      const tab = this.tabs.find((t) => t.id === id)
      if (!tab || tab.kind !== 'ddl' || !tab.connId) return
      tab.loading = true
      try {
        tab.ddl = await api.getObjectDdl(tab.connId, tab.objKind, tab.title)
        tab.loading = false
      } catch (e) {
        tab.error = String(e)
        tab.loading = false
      }
    },

    async reloadDesignerColumns(id: string) {
      const tab = this.tabs.find((t) => t.id === id)
      if (!tab || tab.kind !== 'designer' || !tab.connId) return
      try {
        const st = await api.getTableStructure(tab.connId, tab.tableName)
        tab.columns = st.columns.map((c) => {
          const m = c.dataType.match(/^(\w+)\s*(?:\((\d+)(?:,\d+)?\))?/)
          return {
            name: c.name,
            dataType: (m?.[1] ?? c.dataType).toUpperCase(),
            length: m?.[2] ?? '',
            nullable: c.nullable,
            pk: c.key === 'PRI',
            autoInc: /auto_increment|identity/i.test(c.extra),
            default: c.default ?? '',
            comment: c.comment,
            existing: true,
          } satisfies ColumnSpec
        })
      } catch {
        /* 恢复失败保持空,用户可关闭标签 */
      }
    },

    async loadSaved() {
      try {
        this.saved = await api.listSavedConnections()
      } catch (e) {
        // 非 tauri 环境(纯浏览器调试)没有 IPC
        console.warn('加载连接列表失败:', e)
      }
    },

    async upsertConn(info: ConnInfo) {
      this.saved = await api.saveConnection(info)
      // 配置可能变化,旧连接已由后端断开
      delete this.live[info.id]
    },

    async removeConn(id: string) {
      this.saved = await api.deleteConnection(id)
      delete this.live[id]
      for (const t of this.tabs) {
        if (t.connId === id) t.connId = null
      }
    },

    async connect(id: string) {
      if (this.live[id]) return
      // 单飞:并发调用等待同一个连接过程
      if (this.connecting[id]) {
        await this.connecting[id]
        return
      }
      const info = this.connById(id)
      if (!info) return
      const task = (async () => {
        try {
          const r = await api.connect(info)
          this.live[id] = { tables: [], loading: true, version: r.version }
          // 未配置默认库的多库连接:回到上次使用的库,避免 "No database selected"
          await this.restoreLastDatabase(id)
          await this.loadTables(id)
        } catch (e) {
          console.warn('连接失败:', e)
          delete this.live[id]
        }
      })()
      this.connecting[id] = task
      try {
        await task
      } finally {
        delete this.connecting[id]
      }
    },

    /** 记录连接最近使用的库(切换库时调用,会话持久化) */
    rememberLastDb(id: string, db: string) {
      if (!id || !db) return
      this.lastDbs[id] = db
    },

    /**
     * 未配置默认库的 MySQL/PG 连接:重连后的库上下文策略
     * 1) 有使用记录(lastDbs)→ 恢复到上次的库
     * 2) 无记录但服务器只有一个可用库 → 选它
     * 3) 其余情况 → 不选任何库,由用户显式选择
     */
    async restoreLastDatabase(id: string) {
      const info = this.connById(id)
      if (!info || (info.dbType !== 'mysql' && info.dbType !== 'postgres')) return
      const cfgDb = (info.database ?? '').trim()
      if (cfgDb) return
      let target = this.lastDbs[id] ?? ''
      try {
        if (!target) {
          const dbs = await api.listDatabases(id).catch(() => [] as string[])
          if (dbs.length === 1) target = dbs[0]
        }
        if (!target) return
        await api.runSql(
          id,
          info.dbType === 'mysql'
            ? 'USE `' + target.replace(/`/g, '``') + '`'
            : 'SET search_path TO "' + target.replace(/"/g, '""') + '"',
        )
        this.lastDbs[id] = target
      } catch {
        // 记录的库可能已被删除;保持未选中状态,让用户显式选择
        delete this.lastDbs[id]
      }
    },

    async disconnect(id: string) {
      try {
        await api.disconnect(id)
      } catch (e) {
        console.warn(e)
      }
      delete this.live[id]
      // 清理该连接的列补全缓存,防止长期使用累积
      const prefix = `${id}/`
      for (const k of Object.keys(this.tableCols)) {
        if (k.startsWith(prefix)) delete this.tableCols[k]
      }
    },

    async loadTables(id: string) {
      const st = this.live[id]
      if (!st || !st.loading) return
      try {
        st.tables = await api.listTables(id)
      } catch (e) {
        console.warn('加载表列表失败:', e)
      } finally {
        st.loading = false
      }
    },

    /** 强制重新拉取表列表 */
    async refreshTables(id: string) {
      const st = this.live[id]
      if (!st) return
      st.loading = true
      await this.loadTables(id)
    },

    // ── 标签页管理 ──────────────────────────────────────

    pushTab(tab: Tab) {
      this.tabs.push(tab)
      this.activeTabId = tab.id
    },

    nextId(): string {
      this.tabSeq++
      return `t${this.tabSeq}`
    },

    openQueryTab(connId: string | null = null) {
      const inherit =
        connId ?? this.tabs.find((t) => t.id === this.activeTabId)?.connId ?? null
      // 独立编号:从 1 开始,全部关闭后重置
      this.querySeq++
      this.pushTab({
        id: this.nextId(),
        kind: 'query',
        title: `查询 ${this.querySeq}`,
        connId: inherit,
        sql: '',
        results: [],
        activeSet: 0,
        error: null,
        running: false,
      })
    },

    async openTable(connId: string, table: TableMeta, database?: string | null) {
      const conn = this.connById(connId)
      if (!conn) return
      // 去重:同连接 + 同库 + 同名的表已打开,直接定位到已有标签
      const dbKey = database ?? null
      const existing = this.tabs.find(
        (t) =>
          t.kind === 'table' &&
          t.connId === connId &&
          t.table === table.name &&
          (t.database ?? null) === dbKey,
      )
      if (existing) {
        this.activeTabId = existing.id
        return
      }
      const id = this.nextId()
      this.pushTab({
        id,
        kind: 'table',
        title: table.name,
        connId,
        table: table.name,
        database: database ?? null,
        page: 1,
        pageSize: 100,
        total: null,
        orderKey: null,
        orderDir: 'asc',
        filters: [],
        filterMode: 'fields',
        freeWhere: '',
        checkedRows: {},
        result: null,
        loading: false,
        error: null,
        pkCols: [],
        fks: [],
        changes: {},
        deletedRows: {},
        newRows: [],
        loadSeq: 0,
      })
      await this.loadTableData(id, false)
      this.loadPkCols(id)
      await this.loadTableCount(id)
    },

    /** 缓存表列,供 SQL 编辑器补全 */
    rememberCols(connId: string, table: string, columns: string[]) {
      this.tableCols[`${connId}/${table}`] = columns
    },


    async openStructure(connId: string, table: string) {
      // 去重:同连接同表的结构页已打开则定位
      const existing = this.tabs.find(
        (t) => t.kind === 'structure' && t.connId === connId && t.table === table,
      )
      if (existing) {
        this.activeTabId = existing.id
        return
      }
      const id = this.nextId()
      this.pushTab({
        id,
        kind: 'structure',
        title: `${table} 结构`,
        connId,
        table,
        data: null,
        loading: false,
        error: null,
      })
      await this.loadStructure(id)
    },

    async loadStructure(id: string) {
      const tab = this.tabs.find((t) => t.id === id)
      if (!tab || tab.kind !== 'structure' || !tab.connId) return
      if (!this.live[tab.connId]) await this.connect(tab.connId)
      if (!this.live[tab.connId]) {
        tab.error = '连接不可用'
        return
      }
      tab.loading = true
      tab.error = null
      try {
        tab.data = await api.getTableStructure(tab.connId, tab.table)
        this.rememberCols(tab.connId, tab.table, tab.data.columns.map((c) => c.name))
      } catch (e) {
        tab.data = null
        tab.error = String(e)
      } finally {
        tab.loading = false
      }
    },

    // ── ER 图 ──────────────────────────────────────────

    async openEr(connId: string) {
      if (!this.live[connId]) await this.connect(connId)
      const id = this.nextId()
      this.pushTab({
        id,
        kind: 'er',
        title: `ER 图 ${this.tabSeq}`,
        connId,
        fks: [],
        loading: true,
        error: null,
        positions: {},
      })
      try {
        const fks = await api.listForeignKeys(connId)
        const tab = this.tabs.find((t) => t.id === id)
        if (tab && tab.kind === 'er') {
          tab.fks = fks
          tab.loading = false
        }
      } catch (e) {
        const tab = this.tabs.find((t) => t.id === id)
        if (tab && tab.kind === 'er') {
          tab.error = String(e)
          tab.loading = false
        }
      }
    },

    moveErNode(id: string, table: string, x: number, y: number) {
      const tab = this.tabs.find((t) => t.id === id)
      if (!tab || tab.kind !== 'er') return
      tab.positions[table] = { x, y }
    },

    resetErLayout(id: string) {
      const tab = this.tabs.find((t) => t.id === id)
      if (!tab || tab.kind !== 'er') return
      tab.positions = {}
    },

    // ── SQL 片段 ────────────────────────────────────────

    saveSnippet(sqlRaw: string) {
      const sql = sqlRaw.trim()
      if (!sql) return
      if (this.snippets.some((s) => s.sql === sql)) return
      const name = sql.replace(/\s+/g, ' ').slice(0, 40)
      this.snippets = [{ id: crypto.randomUUID(), name, sql }, ...this.snippets].slice(0, 50)
      try {
        localStorage.setItem('dblens_snippets', JSON.stringify(this.snippets))
      } catch {
        /* 忽略 */
      }
    },

    clearSnippets() {
      this.snippets = []
      try {
        localStorage.removeItem('dblens_snippets')
      } catch {
        /* 忽略 */
      }
    },

    // ── 表管理操作(重命名/清空/删除) ──────────────────

    /** 关闭引用某表的数据/结构/设计器标签 */
    closeTabsOfTable(connId: string, table: string) {
      const dead = this.tabs.filter(
        (t) =>
          t.connId === connId &&
          ((t.kind === 'table' && t.table === table) ||
            (t.kind === 'structure' && t.table === table) ||
            (t.kind === 'designer' && t.tableName === table)),
      )
      for (const t of dead) {
        const idx = this.tabs.indexOf(t)
        if (idx >= 0) this.tabs.splice(idx, 1)
      }
      if (!this.tabs.length) this.openQueryTab()
      else if (dead.some((t) => t.id === this.activeTabId)) {
        this.activeTabId = this.tabs[this.tabs.length - 1].id
      }
    },

    async dropTable(connId: string, table: string) {
      const conn = this.connById(connId)
      if (!conn || conn.readOnly) throw new Error('只读连接不允许删除表')
      const dbType = dbTypeOf(conn)
      await api.runSql(connId, `DROP TABLE ${quoteIdent(table, dbType)}`, 1)
      this.closeTabsOfTable(connId, table)
      this.refreshTables(connId)
    },

    async truncateTable(connId: string, table: string) {
      const conn = this.connById(connId)
      if (!conn || conn.readOnly) throw new Error('只读连接不允许清空表')
      const dbType = dbTypeOf(conn)
      const sql =
        dbType === 'sqlite'
          ? `DELETE FROM ${quoteIdent(table, dbType)}`
          : `TRUNCATE TABLE ${quoteIdent(table, dbType)}`
      await api.runSql(connId, sql, 1)
      for (const t of this.tabs) {
        if (t.kind === 'table' && t.connId === connId && t.table === table) {
          this.loadTableData(t.id)
          this.loadTableCount(t.id)
        }
      }
    },

    async renameTable(connId: string, oldName: string, newName: string) {
      const conn = this.connById(connId)
      if (!conn || conn.readOnly) throw new Error('只读连接不允许重命名表')
      const dbType = dbTypeOf(conn)
      await api.runSql(
        connId,
        `ALTER TABLE ${quoteIdent(oldName, dbType)} RENAME TO ${quoteIdent(newName, dbType)}`,
        1,
      )
      // 更新引用该表的标签标题
      for (const t of this.tabs) {
        if (t.connId !== connId) continue
        if (t.kind === 'table' && t.table === oldName) {
          t.table = newName
          t.title = newName
          this.loadTableData(t.id)
          this.loadTableCount(t.id)
        } else if (t.kind === 'structure' && t.table === oldName) {
          t.table = newName
          t.title = `${newName} 结构`
          this.loadStructure(t.id)
        } else if (t.kind === 'designer' && t.tableName === oldName) {
          t.tableName = newName
          t.title = `设计 ${newName}`
        }
      }
      this.refreshTables(connId)
    },

    /** 弹窗添加:批量插入并刷新相关表标签 */
    async insertRows(connId: string, table: string, rows: Record<string, string>[]) {
      const conn = this.connById(connId)
      if (!conn) throw new Error('连接不存在')
      if (conn.readOnly) throw new Error('只读连接不允许插入')
      const inserts = rows.map((r) => Object.entries(r).map(([c, v]) => [c, v] as [string, string]))
      await api.applyChanges(connId, table, [], [], inserts)
      for (const t of this.tabs) {
        if (t.kind === 'table' && t.connId === connId && t.table === table) {
          this.loadTableData(t.id)
          this.loadTableCount(t.id)
        }
      }
    },

    /** 复制表(结构+数据) */
    async duplicateTable(connId: string, table: string, newName: string, withData: boolean) {
      const conn = this.connById(connId)
      if (!conn || conn.readOnly) throw new Error('只读连接不允许复制表')
      const dbType = dbTypeOf(conn)
      const qt = quoteIdent(table, dbType)
      const qn = quoteIdent(newName, dbType)
      if (dbType === 'mysql') {
        await api.runSql(connId, `CREATE TABLE ${qn} AS SELECT * FROM ${qt}${withData ? '' : ' WHERE 1=0'}`, 1)
      } else {
        await api.runSql(connId, `CREATE TABLE ${qn} AS SELECT * FROM ${qt}${withData ? '' : ' WHERE 1=0'}`, 1)
      }
      this.refreshTables(connId)
    },

    /** 表维护:OPTIMIZE / ANALYZE */
    async maintainTable(connId: string, table: string, action: 'optimize' | 'analyze') {
      const conn = this.connById(connId)
      if (!conn) return
      const dbType = dbTypeOf(conn)
      const qt = quoteIdent(table, dbType)
      if (dbType === 'sqlite') {
        // SQLite 用 VACUUM / ANALYZE
        await api.runSql(connId, action === 'optimize' ? 'VACUUM' : `ANALYZE ${qt}`, 1)
      } else {
        await api.runSql(connId, `${action === 'optimize' ? 'OPTIMIZE TABLE' : 'ANALYZE TABLE'} ${qt}`, 1)
      }
    },

    /** 删除触发器/存储过程/函数/视图 */
    async dropObject(connId: string, objKind: string, name: string) {
      const conn = this.connById(connId)
      if (!conn || conn.readOnly) throw new Error('只读连接不允许删除')
      const dbType = dbTypeOf(conn)
      const qn = quoteIdent(name, dbType)
      let sql: string
      switch (objKind) {
        case 'trigger':
          sql = dbType === 'mysql' ? `DROP TRIGGER IF EXISTS ${qn}` : `DROP TRIGGER IF EXISTS ${qn}`
          break
        case 'procedure':
          sql = `DROP PROCEDURE IF EXISTS ${qn}`
          break
        case 'function':
          sql = `DROP FUNCTION IF EXISTS ${qn}`
          break
        case 'view':
          sql = `DROP VIEW IF EXISTS ${qn}`
          break
        default:
          throw new Error(`不支持的类型: ${objKind}`)
      }
      await api.runSql(connId, sql, 1)
      this.refreshTables(connId)
    },

    /** 把表名插入到当前查询(无查询标签则新建) */
    insertIntoQuery(connId: string, name: string) {
      let tab = this.tabs.find((t) => t.id === this.activeTabId && t.kind === 'query')
      if (!tab) {
        this.openQueryTab(connId)
        tab = this.tabs[this.tabs.length - 1]
      }
      if (tab?.kind === 'query') {
        tab.sql = tab.sql.trimEnd() ? `${tab.sql.trimEnd()}\n${name}` : name
        this.activeTabId = tab.id
      }
    },

    /** 打开 Redis 键空间浏览标签 */
    async openRedis(connId: string, db: number) {
      if (!this.live[connId]) await this.connect(connId)
      const id = this.nextId()
      this.pushTab({
        id,
        kind: 'redis',
        title: `db${db}`,
        connId,
        db,
        cursor: 0,
        keys: [],
        pattern: '*',
        scanning: false,
        selectedKey: null,
        detail: null,
        detailLoading: false,
        error: null,
      })
      // 触发首次扫描
      const tab = this.tabs.find((t) => t.id === id)
      if (tab?.kind === 'redis') {
        tab.scanning = true
        try {
          const [next, keys] = await api.redisScan(connId, db, '*', 0, 200)
          tab.cursor = next
          tab.keys = keys
        } catch (e) {
          tab.error = String(e)
        } finally {
          tab.scanning = false
        }
      }
    },

    /** 打开触发器/函数/过程的 DDL 查看标签 */
    async openDdl(connId: string, objKind: string, name: string) {
      if (!this.live[connId]) await this.connect(connId)
      const id = this.nextId()
      this.pushTab({
        id,
        kind: 'ddl',
        title: name,
        connId,
        objKind,
        ddl: '',
        loading: true,
        error: null,
      })
      try {
        const ddl = await api.getObjectDdl(connId, objKind, name)
        const tab = this.tabs.find((t) => t.id === id)
        if (tab && tab.kind === 'ddl') {
          tab.ddl = ddl
          tab.loading = false
        }
      } catch (e) {
        const tab = this.tabs.find((t) => t.id === id)
        if (tab && tab.kind === 'ddl') {
          tab.error = String(e)
          tab.loading = false
        }
      }
    },

    // ── 表设计器(建表/改表) ──────────────────────────

    async openDesigner(connId: string, table?: string) {
      if (!this.live[connId]) await this.connect(connId)
      const id = this.nextId()
      if (table) {
        this.pushTab({
          id,
          kind: 'designer',
          mode: 'edit',
          title: `设计 ${table}`,
          connId,
          tableName: table,
          columns: [],
          saving: false,
          error: null,
          info: null,
        })
        // 拉现有结构转列定义
        try {
          const st = await api.getTableStructure(connId, table)
          const tab = this.tabs.find((t) => t.id === id)
          if (tab && tab.kind === 'designer') {
            tab.columns = st.columns.map((c) => {
              const m = c.dataType.match(/^(\w+)\s*(?:\((\d+)(?:,\d+)?\))?/)
              return {
                name: c.name,
                dataType: (m?.[1] ?? c.dataType).toUpperCase(),
                length: m?.[2] ?? '',
                nullable: c.nullable,
                pk: c.key === 'PRI',
                autoInc: /auto_increment|identity/i.test(c.extra) || /AUTOINCREMENT/.test(c.dataType),
                default: c.default ?? '',
                comment: c.comment,
                existing: true,
              } satisfies ColumnSpec
            })
          }
        } catch (e) {
          const tab = this.tabs.find((t) => t.id === id)
          if (tab && tab.kind === 'designer') tab.error = String(e)
        }
      } else {
        this.pushTab({
          id,
          kind: 'designer',
          mode: 'create',
          title: `新表 ${this.tabSeq}`,
          connId,
          tableName: '',
          columns: [
            { name: 'id', dataType: 'INTEGER', length: '', nullable: false, pk: true, autoInc: true, default: '', comment: '' },
          ],
          saving: false,
          error: null,
          info: null,
        })
      }
    },

    /** 生成设计器将要执行的 SQL(预览与保存共用) */
    designerSql(id: string): { create?: string; alters: string[]; warnings: string[] } {
      const tab = this.tabs.find((t) => t.id === id)
      if (!tab || tab.kind !== 'designer' || !tab.connId) return { alters: [], warnings: [] }
      const conn = this.connById(tab.connId)
      const dbType = dbTypeOf(conn)
      const q = (s: string) => quoteIdent(s, dbType)
      const qt = q(tab.tableName.trim())
      const warnings: string[] = []

      const typeOf = (c: ColumnSpec): string => {
        let t = c.dataType.toUpperCase()
        if (c.autoInc && dbType === 'postgres') {
          t = 'SERIAL'
          return t
        }
        if (c.length) t += `(${c.length})`
        return t
      }
      const colDef = (c: ColumnSpec): string => {
        let s = `${q(c.name)} ${typeOf(c)}`
        if (c.autoInc && dbType === 'mysql') s += ' AUTO_INCREMENT'
        if (!c.nullable && !(c.pk && c.autoInc && dbType === 'sqlite')) s += ' NOT NULL'
        if (c.default) s += ` DEFAULT ${/^-?\d+(\.\d+)?$/.test(c.default) ? c.default : `'${c.default.replace(/'/g, "''")}'`}`
        if (c.comment && dbType === 'mysql') s += ` COMMENT '${c.comment.replace(/'/g, "''")}'`
        return s
      }

      if (tab.mode === 'create') {
        const cols = tab.columns.map(colDef)
        const pks = tab.columns.filter((c) => c.pk)
        if (pks.length > 1) cols.push(`PRIMARY KEY (${pks.map((c) => q(c.name)).join(', ')})`)
        return { create: `CREATE TABLE ${qt} (\n  ${cols.join(',\n  ')}\n);`, alters: [], warnings }
      }

      // 编辑模式:diff 生成 ALTER
      const alters: string[] = []
      const existing = tab.columns.filter((c) => c.existing)
      const added = tab.columns.filter((c) => !c.existing)
      const removedNames = new Set(tab.columns.filter((c) => c.existing).map((c) => c.name))
      // 删除的列:无法从当前列推断原始全集 —— 编辑模式不提供删除已有列的 diff(见 UI 禁用)
      for (const c of added) {
        alters.push(`ALTER TABLE ${qt} ADD COLUMN ${colDef({ ...c, pk: false, autoInc: false })};`)
      }
      for (const c of existing) {
        const full = colDef(c)
        if (dbType === 'mysql') {
          alters.push(`ALTER TABLE ${qt} MODIFY COLUMN ${full};`)
        } else if (dbType === 'postgres') {
          alters.push(`ALTER TABLE ${qt} ALTER COLUMN ${q(c.name)} TYPE ${typeOf(c)};`)
          alters.push(`ALTER TABLE ${qt} ALTER COLUMN ${q(c.name)} ${c.nullable ? 'DROP NOT NULL' : 'SET NOT NULL'};`)
        } else {
          // SQLite 不支持修改已有列
          warnings.push(`SQLite 无法修改已有列「${c.name}」,已跳过`)
        }
      }
      if (removedNames.size === 0 && added.length === 0 && existing.length === 0) {
        warnings.push('没有可保存的变更')
      }
      return { alters, warnings }
    },

    async saveDesigner(id: string) {
      const tab = this.tabs.find((t) => t.id === id)
      if (!tab || tab.kind !== 'designer' || !tab.connId) return
      if (!tab.tableName.trim()) {
        tab.error = '请填写表名'
        return
      }
      if (!tab.columns.length) {
        tab.error = '至少需要一个字段'
        return
      }
      if (tab.columns.some((c) => !c.name.trim())) {
        tab.error = '存在未命名字段'
        return
      }
      const { create, alters, warnings } = this.designerSql(id)
      tab.saving = true
      tab.error = null
      tab.info = null
      try {
        if (create) {
          await api.runSql(tab.connId, create, 1)
          tab.info = `表 ${tab.tableName} 创建成功`
        } else if (alters.length) {
          for (const stmt of alters) {
            await api.runSql(tab.connId, stmt, 1)
          }
          tab.info = `已执行 ${alters.length} 条 ALTER 语句`
        }
        if (warnings.length) {
          tab.info = (tab.info ? tab.info + ' · ' : '') + warnings.join(';')
        }
        if (tab.connId) this.refreshTables(tab.connId)
        // 编辑模式刷新列快照,避免重复执行 ALTER
        if (tab.mode === 'edit') {
          try {
            const st = await api.getTableStructure(tab.connId, tab.tableName)
            tab.columns = st.columns.map((c) => {
              const m = c.dataType.match(/^(\w+)\s*(?:\((\d+)(?:,\d+)?\))?/)
              return {
                name: c.name,
                dataType: (m?.[1] ?? c.dataType).toUpperCase(),
                length: m?.[2] ?? '',
                nullable: c.nullable,
                pk: c.key === 'PRI',
                autoInc: /auto_increment|identity/i.test(c.extra),
                default: c.default ?? '',
                comment: c.comment,
                existing: true,
              } satisfies ColumnSpec
            })
          } catch {
            /* 刷新失败不影响结果提示 */
          }
        }
      } catch (e) {
        tab.error = String(e)
      } finally {
        tab.saving = false
      }
    },

    closeTab(id: string) {
      const idx = this.tabs.findIndex((t) => t.id === id)
      if (idx < 0) return
      this.tabs.splice(idx, 1)
      if (this.activeTabId === id) {
        const next = this.tabs[Math.max(0, idx - 1)]
        this.activeTabId = next ? next.id : ''
      }
      // 没有查询标签了 → 重置编号
      if (!this.tabs.some((t) => t.kind === 'query')) {
        this.querySeq = 0
      }
      if (!this.tabs.length) this.openQueryTab()
    },

    // ── 查询执行 ────────────────────────────────────────

    async runQuery(id: string, sqlOverride?: string) {
      const tab = this.tabs.find((t) => t.id === id)
      if (!tab || tab.kind !== 'query' || tab.running) return
      if (!tab.connId) {
        // 只有一个在线连接时自动选用,省一步手动选择
        const liveIds = Object.keys(this.live)
        if (liveIds.length === 1) tab.connId = liveIds[0]
      }
      if (!tab.connId) {
        tab.error = '请先在工具栏选择目标连接'
        return
      }
      if (!this.live[tab.connId]) await this.connect(tab.connId)
      if (!this.live[tab.connId]) {
        tab.error = '连接失败,请检查连接配置后重试'
        return
      }
      const execSql = (sqlOverride ?? tab.sql).trim()
      if (!execSql) {
        tab.error = 'SQL 为空'
        return
      }
      tab.running = true
      tab.error = null
      try {
        // Redis 连接:命令行模式
        const conn = this.connById(tab.connId)
        if (conn?.dbType === 'redis') {
          const lines = await api.redisRun(tab.connId, execSql)
          tab.results = [
            {
              columns: [`${execSql.split(/\s+/)[0]?.toUpperCase()} →`],
              rows: lines.map((l) => [l]),
              affected: lines.length,
              truncated: false,
              elapsedMs: 0,
            },
          ]
        } else {
          // 大结果集绕开深度代理(整体替换、从不深改),降低内存与访问开销
        tab.results = markRaw(await api.runSql(tab.connId, execSql))
        }
        tab.activeSet = 0
        // 默认标题的查询页,运行后按 FROM 的表名自动命名
        if (/^查询 \d+$/.test(tab.title)) {
          const m = execSql.match(/FROM\s+[`"[]?(\w+)/i)
          if (m?.[1]) tab.title = m[1]
        }
        this.history = [
          { sql: execSql, db: this.lastDbs[tab.connId] ?? null },
          ...this.history.filter((s) => histSql(s) !== execSql),
        ].slice(0, 30)
        try {
          localStorage.setItem('dblens_history', JSON.stringify(this.history))
        } catch {
          /* 忽略存储异常 */
        }
      } catch (e) {
        tab.results = []
        tab.error = String(e)
      } finally {
        tab.running = false
      }
    },

    // ── 表数据分页浏览 ──────────────────────────────────








    // ── 勾选与复制行 ────────────────────────────────────

    toggleCheck(id: string, r: number, val: boolean) {
      const tab = this.tabs.find((t) => t.id === id)
      if (!tab || tab.kind !== 'table') return
      if (val) tab.checkedRows[r] = true
      else delete tab.checkedRows[r]
    },

    checkPage(id: string, all: boolean) {
      const tab = this.tabs.find((t) => t.id === id)
      if (!tab || tab.kind !== 'table' || !tab.result) return
      if (all) {
        for (let r = 0; r < tab.result.rows.length; r++) tab.checkedRows[r] = true
      } else {
        tab.checkedRows = {}
      }
    },

    checkedCount(id: string): number {
      const tab = this.tabs.find((t) => t.id === id)
      if (!tab || tab.kind !== 'table') return 0
      return Object.keys(tab.checkedRows).length
    },

    /** 复制行为待插入新行(全列非空值,出现在表格顶部,可编辑后保存) */
    copyRowToNew(id: string, rowIndex: number) {
      const tab = this.tabs.find((t) => t.id === id)
      if (!tab || tab.kind !== 'table' || !tab.result) return
      const cols = tab.result.columns
      const row = tab.result.rows[rowIndex]
      if (!row) return
      const nr: Record<string, string> = {}
      cols.forEach((c, i) => {
        if (row[i] !== null && row[i] !== undefined) nr[c] = row[i] as string
      })
      tab.newRows.push(nr)
    },

    copyCheckedToNew(id: string) {
      const tab = this.tabs.find((t) => t.id === id)
      if (!tab || tab.kind !== 'table') return
      for (const r of Object.keys(tab.checkedRows).map(Number).sort((a, b) => a - b)) {
        this.copyRowToNew(id, r)
      }
    },

    /** 批量勾选行标记删除 */
    deleteChecked(id: string) {
      const tab = this.tabs.find((t) => t.id === id)
      if (!tab || tab.kind !== 'table') return
      for (const r of Object.keys(tab.checkedRows).map(Number)) {
        const pk = this.pkOf(tab, r)
        if (pk) tab.deletedRows[r] = pk
      }
    },


    // ── 数据编辑(Navicat 式回写) ─────────────────────

    /** 在当前页末尾添加一个待插入的空行 */
    addNewRow(id: string) {
      const tab = this.tabs.find((t) => t.id === id)
      if (!tab || tab.kind !== 'table' || !tab.pkCols.length) return
      tab.newRows.push({})
    },

    setInsertChange(id: string, idx: number, col: string, value: string) {
      const tab = this.tabs.find((t) => t.id === id)
      if (!tab || tab.kind !== 'table') return
      if (!tab.newRows[idx]) return
      if (value === '') {
        delete tab.newRows[idx][col]
      } else {
        tab.newRows[idx][col] = value
      }
    },

    removeInsertRow(id: string, idx: number) {
      const tab = this.tabs.find((t) => t.id === id)
      if (!tab || tab.kind !== 'table') return
      tab.newRows.splice(idx, 1)
    },

    /** 主键值(原始行数据) */
    pkOf(tab: TableTab, rowIndex: number): [string, string][] | null {
      if (!tab.result || !tab.pkCols.length) return null
      const cols = tab.result.columns
      const row = tab.result.rows[rowIndex]
      if (!row) return null
      const pk: [string, string][] = []
      for (const c of tab.pkCols) {
        const i = cols.indexOf(c)
        if (i < 0) return null
        if (row[i] === null) return null
        pk.push([c, String(row[i])])
      }
      return pk
    },

    setCellChange(id: string, rowIndex: number, col: string, value: string | null) {
      const tab = this.tabs.find((t) => t.id === id)
      if (!tab || tab.kind !== 'table') return
      const orig = tab.result?.rows[rowIndex]?.[tab.result.columns.indexOf(col)]
      // 与原值相同则视为撤销
      if (value === orig) {
        if (tab.changes[rowIndex]) {
          delete tab.changes[rowIndex][col]
          if (!Object.keys(tab.changes[rowIndex]).length) delete tab.changes[rowIndex]
        }
        return
      }
      if (!tab.changes[rowIndex]) tab.changes[rowIndex] = {}
      tab.changes[rowIndex][col] = value
    },

    deleteRow(id: string, rowIndex: number) {
      const tab = this.tabs.find((t) => t.id === id)
      if (!tab || tab.kind !== 'table') return
      const pk = this.pkOf(tab, rowIndex)
      if (!pk) return
      if (tab.deletedRows[rowIndex]) {
        delete tab.deletedRows[rowIndex]
      } else {
        // 该行若有未保存编辑,一并标记
        tab.deletedRows[rowIndex] = pk
      }
    },

    changeCount(id: string): { edits: number; deletes: number; inserts: number } {
      const tab = this.tabs.find((t) => t.id === id)
      if (!tab || tab.kind !== 'table') return { edits: 0, deletes: 0, inserts: 0 }
      return {
        edits: Object.values(tab.changes).reduce((n, row) => n + Object.keys(row).length, 0),
        deletes: Object.keys(tab.deletedRows).length,
        inserts: tab.newRows.filter((r) => Object.keys(r).length > 0).length,
      }
    },

    discardChanges(id: string) {
      const tab = this.tabs.find((t) => t.id === id)
      if (!tab || tab.kind !== 'table') return
      tab.changes = {}
      tab.deletedRows = {}
      tab.newRows = []
    },

    async saveChanges(id: string) {
      const tab = this.tabs.find((t) => t.id === id)
      if (!tab || tab.kind !== 'table' || !tab.connId) return
      const updates: import('../types').CellUpdate[] = []
      for (const [rowIdxStr, sets] of Object.entries(tab.changes)) {
        const rowIdx = Number(rowIdxStr)
        const pk = this.pkOf(tab, rowIdx)
        if (!pk) {
          tab.error = `第 ${rowIdx + 1} 行缺少主键,无法保存该行更改`
          continue
        }
        updates.push({
          pk,
          sets: Object.entries(sets).map(([c, v]) => [c, v] as [string, string | null]),
        })
      }
      const deletes = Object.values(tab.deletedRows)
      const inserts: [string, string][][] = tab.newRows
        .map((nr) =>
          Object.entries(nr)
            .filter(([, v]) => v !== '')
            .map(([c, v]) => [c, v] as [string, string]),
        )
        .filter((cols) => cols.length > 0)
      if (!updates.length && !deletes.length && !inserts.length) return
      tab.loading = true
      tab.error = null
      try {
        await api.applyChanges(tab.connId, tab.table, updates, deletes, inserts)
        tab.changes = {}
        tab.deletedRows = {}
        tab.newRows = []
        await this.loadTableData(id)
        await this.loadTableCount(id)
      } catch (e) {
        tab.error = String(e)
      } finally {
        tab.loading = false
      }
    },
  },
})
