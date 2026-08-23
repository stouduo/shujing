/** 共享辅助函数 */
import type { DbType } from '../types'

export function quoteIdent(name: string, dbType: DbType): string {
  const q = dbType === 'mysql' ? '`' : '"'
  return q + name.split(q).join(q + q) + q
}
