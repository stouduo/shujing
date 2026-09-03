/**
 * 表数据操作 actions:分页 / 排序 / 筛选 / 编辑回写 / 行操作
 * 从 app.ts 拆出,通过展开合并进主 store。
 */
import { markRaw } from 'vue'
import * as api from '../api'
import { quoteIdent, tableRef } from './helpers'
import type { TableTab, Tab } from '../types'

type Store = any

export const tableActions = {
  /** 表操作前把会话上下文切到表所属库(多库连接防跨库误查/误写) */
  async ensureTableContext(this: Store, tab: TableTab) {
    const cid = tab.connId
    if (!cid || !tab.database || !this.lastDbs) return
    if (this.lastDbs[cid] === tab.database) return
    const conn = this.connById(cid)
    if (!conn || (conn.dbType !== 'mysql' && conn.dbType !== 'postgres')) return
    try {
      await api.runSql(
        cid,
        conn.dbType === 'mysql'
          ? 'USE `' + tab.database.replace(/`/g, '``') + '`'
          : 'SET search_path TO "' + tab.database.replace(/"/g, '""') + '"',
      )
      this.rememberLastDb(cid, tab.database)
    } catch {
      /* 库可能已删除;具体语句会自己报错 */
    }
  },

  /** 拉取主键列与外键(决定可编辑性 + FK 候选值) */
  async loadPkCols(this: Store, id: string) {
    const tab = this.tabs.find((t: Tab) => t.id === id)
    if (!tab || tab.kind !== 'table' || !tab.connId) return
    if (!this.live[tab.connId]) await this.connect(tab.connId)
    if (!this.live[tab.connId]) return
    // 结构按裸表名解析依赖当前库,先切到表自己的库
    await this.ensureTableContext(tab)
    try {
      const st = await api.getTableStructure(tab.connId, tab.table)
      tab.pkCols = st.columns.filter((c) => c.key === 'PRI').map((c) => c.name)
      tab.colComments = Object.fromEntries(st.columns.map((c) => [c.name, c.comment ?? '']))
      this.rememberCols(tab.connId, tab.table, st.columns.map((c) => c.name))
    } catch {
      tab.pkCols = []
    }
    try {
      tab.fks = await api.listForeignKeys(tab.connId)
    } catch {
      tab.fks = []
    }
  },

  whereOf(this: Store, tab: TableTab): string {
    const free = tab.freeWhere?.trim()
    if (tab.filterMode === 'free') return free ? ` WHERE ${free}` : ''
    const conn = this.connById(tab.connId ?? '')
    const dbType = conn?.dbType ?? 'mysql'
    const conds = tab.filters
      .filter((f) => f.column && (f.value !== '' || f.op.includes('NULL')))
      .map((f) => {
        const col = quoteIdent(f.column, dbType)
        if (f.op === 'IS NULL' || f.op === 'IS NOT NULL') return `${col} ${f.op}`
        const v = f.value
        const lit = /^-?\d+(\.\d+)?$/.test(v) ? v : `'${v.replace(/'/g, "''")}'`
        return `${col} ${f.op} ${lit}`
      })
    return conds.length ? ` WHERE ${conds.join(' AND ')}` : ''
  },

  tablePageSql(this: Store, tab: TableTab): string {
    const conn = this.connById(tab.connId ?? '')
    const dbType = conn?.dbType ?? 'mysql'
    let sql = `SELECT * FROM ${tableRef(tab, dbType)}${this.whereOf(tab)}`
    if (tab.orderKey) {
      sql += ` ORDER BY ${quoteIdent(tab.orderKey, dbType)} ${tab.orderDir === 'asc' ? 'ASC' : 'DESC'}`
    }
    sql += ` LIMIT ${tab.pageSize} OFFSET ${(tab.page - 1) * tab.pageSize}`
    return sql
  },

  async loadTableData(this: Store, id: string, keepTotal = true) {
    const tab = this.tabs.find((t: Tab) => t.id === id)
    if (!tab || tab.kind !== 'table' || !tab.connId) return
    const seq = (tab.loadSeq = (tab.loadSeq ?? 0) + 1)
    if (!this.live[tab.connId]) await this.connect(tab.connId)
    if (!this.live[tab.connId]) {
      if (seq === tab.loadSeq) {
        tab.error = '连接不可用'
        tab.loading = false
      }
      return
    }
    tab.loading = true
    tab.error = null
    tab.changes = {}
    tab.deletedRows = {}
    tab.newRows = []
    try {
      const results = await api.runSql(tab.connId, this.tablePageSql(tab), tab.pageSize)
      if (seq !== tab.loadSeq) return
      tab.result = markRaw(results[0] ?? null)
      if (!keepTotal) tab.total = null
    } catch (e) {
      if (seq !== tab.loadSeq) return
      tab.result = null
      tab.error = String(e)
    } finally {
      if (seq === tab.loadSeq) tab.loading = false
    }
  },

  async loadTableCount(this: Store, id: string) {
    const tab = this.tabs.find((t: Tab) => t.id === id)
    if (!tab || tab.kind !== 'table' || !tab.connId) return
    if (!this.live[tab.connId]) await this.connect(tab.connId)
    if (!this.live[tab.connId]) return
    try {
      const conn = this.connById(tab.connId)
      const dbType = conn?.dbType ?? 'mysql'
      const rs = await api.runSql(
        tab.connId,
        `SELECT COUNT(*) FROM ${tableRef(tab, dbType)}${this.whereOf(tab)}`,
        1,
      )
      tab.total = Number(rs[0]?.rows[0]?.[0] ?? 0)
    } catch {
      tab.total = null
    }
  },

  async setTablePage(this: Store, id: string, page: number) {
    const tab = this.tabs.find((t: Tab) => t.id === id)
    if (!tab || tab.kind !== 'table') return
    tab.page = Math.max(1, page)
    await this.loadTableData(id)
  },

  async setTablePageSize(this: Store, id: string, size: number) {
    const tab = this.tabs.find((t: Tab) => t.id === id)
    if (!tab || tab.kind !== 'table') return
    tab.pageSize = size
    tab.page = 1
    await this.loadTableData(id)
  },

  async sortTable(this: Store, id: string, col: string, dir?: 'asc' | 'desc' | null) {
    const tab = this.tabs.find((t: Tab) => t.id === id)
    if (!tab || tab.kind !== 'table') return
    if (dir !== undefined) {
      if (dir === null) {
        tab.orderKey = null
        tab.orderDir = 'asc'
      } else {
        tab.orderKey = col
        tab.orderDir = dir
      }
    } else if (tab.orderKey === col) {
      if (tab.orderDir === 'asc') tab.orderDir = 'desc'
      else {
        tab.orderKey = null
        tab.orderDir = 'asc'
      }
    } else {
      tab.orderKey = col
      tab.orderDir = 'asc'
    }
    tab.page = 1
    await this.loadTableData(id)
  },

  // ── 筛选 ─────────────────────────────────────────────
  addFilter(this: Store, id: string) {
    const tab = this.tabs.find((t: Tab) => t.id === id)
    if (!tab || tab.kind !== 'table') return
    const col = tab.result?.columns[0] ?? ''
    tab.filters.push({ column: col, op: '=', value: '' })
  },

  removeFilter(this: Store, id: string, idx: number) {
    const tab = this.tabs.find((t: Tab) => t.id === id)
    if (!tab || tab.kind !== 'table') return
    tab.filters.splice(idx, 1)
    this.applyFilters(id)
  },

  clearFilters(this: Store, id: string) {
    const tab = this.tabs.find((t: Tab) => t.id === id)
    if (!tab || tab.kind !== 'table') return
    tab.filters = []
    this.applyFilters(id)
  },

  async applyFilters(this: Store, id: string) {
    const tab = this.tabs.find((t: Tab) => t.id === id)
    if (!tab || tab.kind !== 'table') return
    tab.page = 1
    await this.loadTableData(id)
    await this.loadTableCount(id)
  },

  // ── 编辑回写 ─────────────────────────────────────────
  pkOf(this: Store, tab: TableTab, rowIndex: number): [string, string][] | null {
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

  setCellChange(this: Store, id: string, rowIndex: number, col: string, value: string | null) {
    const tab = this.tabs.find((t: Tab) => t.id === id)
    if (!tab || tab.kind !== 'table') return
    const orig = tab.result?.rows[rowIndex]?.[tab.result.columns.indexOf(col)]
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

  deleteRow(this: Store, id: string, rowIndex: number) {
    const tab = this.tabs.find((t: Tab) => t.id === id)
    if (!tab || tab.kind !== 'table') return
    const pk = this.pkOf(tab, rowIndex)
    if (!pk) return
    if (tab.deletedRows[rowIndex]) {
      delete tab.deletedRows[rowIndex]
    } else {
      tab.deletedRows[rowIndex] = pk
    }
  },

  changeCount(this: Store, id: string): { edits: number; deletes: number; inserts: number } {
    const tab = this.tabs.find((t: Tab) => t.id === id)
    if (!tab || tab.kind !== 'table') return { edits: 0, deletes: 0, inserts: 0 }
    return {
      edits: Object.values(tab.changes as Record<number, Record<string, unknown>>).reduce((n: number, row: Record<string, unknown>) => n + Object.keys(row).length, 0),
      deletes: Object.keys(tab.deletedRows).length,
      inserts: (tab.newRows as Record<string, string>[]).filter((r: Record<string, string>) => Object.keys(r).length > 0).length,
    }
  },

  discardChanges(this: Store, id: string) {
    const tab = this.tabs.find((t: Tab) => t.id === id)
    if (!tab || tab.kind !== 'table') return
    tab.changes = {}
    tab.deletedRows = {}
    tab.newRows = []
  },

  async saveChanges(this: Store, id: string) {
    const tab = this.tabs.find((t: Tab) => t.id === id)
    if (!tab || tab.kind !== 'table' || !tab.connId) return
    const updates: import('../types').CellUpdate[] = []
    for (const [rowIdxStr, sets] of Object.entries(tab.changes as Record<string, Record<string, string | null>>)) {
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
    const deletes = Object.values(tab.deletedRows) as [string, string][][]
    const inserts: [string, string][][] = (tab.newRows as Record<string, string>[])
      .map((nr) =>
        Object.entries(nr)
          .filter(([, v]) => v !== '')
          .map(([c, v]) => [c, v] as [string, string]),
      )
      .filter((cols: [string, string][]) => cols.length > 0)
    if (!updates.length && !deletes.length && !inserts.length) return
    // applyChanges 按裸表名回写,依赖会话当前库 —— 先确保上下文正确
    await this.ensureTableContext(tab)
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

  // ── 新行 / 勾选 / 复制行 ────────────────────────────
  addNewRow(this: Store, id: string) {
    const tab = this.tabs.find((t: Tab) => t.id === id)
    if (!tab || tab.kind !== 'table' || !tab.pkCols.length) return
    tab.newRows.push({})
  },

  setInsertChange(this: Store, id: string, idx: number, col: string, value: string) {
    const tab = this.tabs.find((t: Tab) => t.id === id)
    if (!tab || tab.kind !== 'table') return
    if (!tab.newRows[idx]) return
    if (value === '') {
      delete tab.newRows[idx][col]
    } else {
      tab.newRows[idx][col] = value
    }
  },

  removeInsertRow(this: Store, id: string, idx: number) {
    const tab = this.tabs.find((t: Tab) => t.id === id)
    if (!tab || tab.kind !== 'table') return
    tab.newRows.splice(idx, 1)
  },

  toggleCheck(this: Store, id: string, r: number, val: boolean) {
    const tab = this.tabs.find((t: Tab) => t.id === id)
    if (!tab || tab.kind !== 'table') return
    if (val) tab.checkedRows[r] = true
    else delete tab.checkedRows[r]
  },

  checkPage(this: Store, id: string, all: boolean) {
    const tab = this.tabs.find((t: Tab) => t.id === id)
    if (!tab || tab.kind !== 'table' || !tab.result) return
    if (all) {
      for (let r = 0; r < tab.result.rows.length; r++) tab.checkedRows[r] = true
    } else {
      tab.checkedRows = {}
    }
  },

  checkedCount(this: Store, id: string): number {
    const tab = this.tabs.find((t: Tab) => t.id === id)
    if (!tab || tab.kind !== 'table') return 0
    return Object.keys(tab.checkedRows).length
  },

  copyRowToNew(this: Store, id: string, rowIndex: number) {
    const tab = this.tabs.find((t: Tab) => t.id === id)
    if (!tab || tab.kind !== 'table' || !tab.result) return
    const cols = tab.result.columns
    const row = tab.result.rows[rowIndex]
    if (!row) return
    const nr: Record<string, string> = {}
    cols.forEach((c: string, i: number) => {
      if (row[i] !== null && row[i] !== undefined) nr[c] = row[i] as string
    })
    tab.newRows.push(nr)
  },

  copyCheckedToNew(this: Store, id: string) {
    const tab = this.tabs.find((t: Tab) => t.id === id)
    if (!tab || tab.kind !== 'table') return
    for (const r of Object.keys(tab.checkedRows).map(Number).sort((a: number, b: number) => a - b)) {
      this.copyRowToNew(id, r)
    }
  },

  deleteChecked(this: Store, id: string) {
    const tab = this.tabs.find((t: Tab) => t.id === id)
    if (!tab || tab.kind !== 'table') return
    for (const r of Object.keys(tab.checkedRows).map(Number)) {
      const pk = this.pkOf(tab, r)
      if (pk) tab.deletedRows[r] = pk
    }
  },
}
