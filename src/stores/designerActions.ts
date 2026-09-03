/**
 * 表设计器 actions:建表 / 改表(生成并执行 DDL)
 * 从 app.ts 拆出,通过展开合并进主 store。
 */
import * as api from '../api'
import { columnsFromStructure, dbTypeOf, quoteIdent } from './helpers'
import type { ColumnSpec } from '../types'

 
type Store = any

export const designerActions = {
  async openDesigner(this: Store, connId: string, table?: string) {
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
        const tab = this.tabs.find((t: { id: string; kind: string }) => t.id === id)
        if (tab && tab.kind === 'designer') tab.columns = columnsFromStructure(st)
      } catch (e) {
        const tab = this.tabs.find((t: { id: string }) => t.id === id)
        if (tab) (tab as { error: string | null }).error = String(e)
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
  designerSql(this: Store, id: string): { create?: string; alters: string[]; warnings: string[] } {
    const tab = this.tabs.find((t: { id: string; kind: string }) => t.id === id)
    if (!tab || tab.kind !== 'designer' || !tab.connId) return { alters: [], warnings: [] }
    const conn = this.connById(tab.connId)
    const dbType = dbTypeOf(conn)
    const q = (s: string) => quoteIdent(s, dbType)
    const qt = q((tab.tableName as string).trim())
    const warnings: string[] = []
    const cols = tab.columns as ColumnSpec[]

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
      const defs = cols.map(colDef)
      const pks = cols.filter((c) => c.pk)
      if (pks.length > 1) defs.push(`PRIMARY KEY (${pks.map((c) => q(c.name)).join(', ')})`)
      return { create: `CREATE TABLE ${qt} (\n  ${defs.join(',\n  ')}\n);`, alters: [], warnings }
    }

    // 编辑模式:diff 生成 ALTER
    const alters: string[] = []
    const existing = cols.filter((c) => c.existing)
    const added = cols.filter((c) => !c.existing)
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
    if (added.length === 0 && existing.length === 0) {
      warnings.push('没有可保存的变更')
    }
    return { alters, warnings }
  },

  async saveDesigner(this: Store, id: string) {
    const tab = this.tabs.find((t: { id: string; kind: string }) => t.id === id) as
      | { kind: 'designer'; connId: string; tableName: string; columns: ColumnSpec[]; saving: boolean; error: string | null; info: string | null; mode: string }
      | undefined
    if (!tab || !tab.connId) return
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
          tab.columns = columnsFromStructure(st)
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
}
