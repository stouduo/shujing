/** 共享辅助函数 */
import type { DbType } from '../types'

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


