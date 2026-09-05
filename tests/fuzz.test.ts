import { describe, expect, it } from 'vitest'
import { parseCsv, inferColumnType, sqlLiteral, csvQuoteIdent } from '../src/csv'
import { quoteIdent, tableRef, histSql, pkFingerprint, excelCell, escapeHtml } from '../src/stores/helpers'

const EDGE_STRINGS = ['', ' ', "'", '"', "a'b", 'a"b', '\\', '\\\\', '\n', '\t', '中文', '🎉', "'; DROP TABLE x;--", 'NULL', '0', '-0', '1e5', ' 1']

describe('fuzz: 核心纯函数边界输入', () => {
  it('quoteIdent 全边界不崩且引号转义可逆', () => {
    for (const v of EDGE_STRINGS) {
      for (const t of ['mysql', 'postgres', 'sqlite'] as const) {
        const quoted = quoteIdent(v, t)
        // 去引号后按转义规则还原,应等于原值
        const qch = t === 'mysql' ? '`' : '"'
        expect(quoted.startsWith(qch) && quoted.endsWith(qch)).toBe(true)
        expect(quoted.slice(1, -1).split(qch + qch).join(qch)).toBe(v)
      }
    }
  })

  it('parseCsv 引号/换行/分隔符组合不崩且行列对齐', () => {
    const cases = [
      'a,b,c',
      '"a","b"',
      '"a\nb",c',
      '"a""b",c',
      'a,,c',
      ',,',
      '"',
      'a,"b',
      '\r\n\r\n',
      'a,b,\r\n1,2,3',
      '"a, b" , c',
    ]
    for (const text of cases) {
      const rows = parseCsv(text)
      for (const r of rows) {
        expect(Array.isArray(r)).toBe(true)
        expect(r.length).toBeGreaterThan(0)
      }
    }
    // 基本语义
    expect(parseCsv('"a\nb",c')).toEqual([['a\nb', 'c']])
    expect(parseCsv('"a""b",c')).toEqual([['a"b', 'c']])
  })

  it('sqlLiteral 单引号转义后可逆', () => {
    for (const v of EDGE_STRINGS) {
      const lit = sqlLiteral(v)
      expect(lit.startsWith("'") && lit.endsWith("'")).toBe(true)
      // 拆掉外层引号后内部不再含未转义单引号
      const inner = lit.slice(1, -1)
      expect((inner.match(/''/g)?.length ?? 0)).toBe((v.match(/'/g)?.length ?? 0))
    }
  })

  it('inferColumnType 不崩且输出合法类型', () => {
    for (const t of ['mysql', 'postgres', 'sqlite'] as const) {
      expect(inferColumnType([], t)).toBeTruthy()
      expect(inferColumnType(['', ''], t)).toBeTruthy()
      expect(inferColumnType(['1', '-2'], t)).toBe('BIGINT')
      expect(inferColumnType(['1.5'], t)).toBe('DOUBLE')
      expect(inferColumnType(['x'.repeat(10)], t)).toMatch(/VARCHAR|TEXT/)
      expect(inferColumnType(['x'.repeat(30)], t)).toBe('TEXT')
    }
  })

  it('excelCell 大整数保文本、正常数字转数值', () => {
    expect(excelCell('9007199254740993')).toBe('9007199254740993')
    expect(excelCell('123')).toBe(123)
    expect(excelCell('-9007199254740993')).toBe('-9007199254740993')
    expect(excelCell('1.5')).toBe(1.5)
    expect(excelCell(null)).toBeNull()
    expect(excelCell('abc')).toBe('abc')
    expect(excelCell('')).toBe('')
  })

  it('escapeHtml 覆盖五类字符', () => {
    expect(escapeHtml(`<img src=x onerror="a'b">`)).toBe('&lt;img src=x onerror=&quot;a&#39;b&quot;&gt;')
    expect(escapeHtml('')).toBe('')
  })

  it('histSql 兼容新旧格式', () => {
    expect(histSql('SELECT 1')).toBe('SELECT 1')
    expect(histSql({ sql: 'SELECT 2', db: 'x' })).toBe('SELECT 2')
    expect(histSql({ sql: 'SELECT 2' })).toBe('SELECT 2')
  })

  it('tableRef 组合限定名', () => {
    expect(tableRef({ table: 't' }, 'mysql')).toBe('`t`')
    expect(tableRef({ table: 't', database: 'd' }, 'mysql')).toBe('`d`.`t`')
    expect(tableRef({ table: 't', database: null }, 'postgres')).toBe('"t"')
  })
})
