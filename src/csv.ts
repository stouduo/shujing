import type { DbType } from './types'

/** RFC4180 风格 CSV 解析:处理引号、双引号转义、字段内换行 */
export function parseCsv(text: string, delim = ','): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cur += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        cur += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === delim) {
      row.push(cur)
      cur = ''
    } else if (ch === '\n') {
      row.push(cur)
      rows.push(row)
      row = []
      cur = ''
    } else if (ch !== '\r') {
      cur += ch
    }
  }
  if (cur !== '' || row.length) {
    row.push(cur)
    rows.push(row)
  }
  return rows.filter((r) => r.length > 1 || (r[0] ?? '') !== '')
}

/** 按列内容推断建表类型 */
export function inferColumnType(values: string[], dbType: DbType): string {
  const nonEmpty = values.filter((v) => v !== '')
  if (!nonEmpty.length) return dbType === 'mysql' ? 'VARCHAR(255)' : 'TEXT'
  if (nonEmpty.every((v) => /^-?\d+$/.test(v))) {
    return 'BIGINT'
  }
  if (nonEmpty.every((v) => /^-?\d+\.\d+$/.test(v))) {
    return 'DOUBLE'
  }
  const maxLen = Math.max(...nonEmpty.map((v) => v.length))
  if (maxLen <= 20) return dbType === 'mysql' ? `VARCHAR(${Math.max(50, maxLen * 2)})` : 'TEXT'
  return 'TEXT'
}

export function sqlLiteral(v: string): string {
  return `'${v.replace(/'/g, "''")}'`
}

export function csvQuoteIdent(name: string, dbType: DbType): string {
  const q = dbType === 'mysql' ? '`' : '"'
  return q + name.split(q).join(q + q) + q
}
