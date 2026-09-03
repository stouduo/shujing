/** 共享辅助函数 */
import type { ColumnSpec, ConnInfo, DbType, TableStructure } from '../types'

/** HTML 转义(v-html 高亮等场景防注入) */
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] as string,
  )
}

export function dbTypeOf(conn: ConnInfo | undefined, fallback: DbType = 'mysql'): DbType {
  return conn?.dbType ?? fallback
}

/** 表结构 → 设计器列定义(打开设计器与保存后刷新共用) */
export function columnsFromStructure(st: TableStructure): ColumnSpec[] {
  return st.columns.map((c) => {
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
    }
  })
}

export function quoteIdent(name: string, dbType: DbType): string {
  const q = dbType === 'mysql' ? '`' : '"'
  return q + name.split(q).join(q + q) + q
}

/** 表引用:已知所属库时返回 限定名 `db`.`table`,否则退回裸表名(按会话上下文解析) */
export function tableRef(
  tab: { table: string; database?: string | null },
  dbType: DbType,
): string {
  if (!tab.database) return quoteIdent(tab.table, dbType)
  return quoteIdent(tab.database, dbType) + '.' + quoteIdent(tab.table, dbType)
}

/** 历史条目:新版带库信息,旧版为纯 SQL 字符串(读取需兼容) */
export type HistoryEntry = string | { sql: string; db?: string | null }

export function histSql(h: HistoryEntry): string {
  return typeof h === 'string' ? h : h.sql
}

export function histDb(h: HistoryEntry): string | null {
  return typeof h === 'string' ? null : h.db ?? null
}


