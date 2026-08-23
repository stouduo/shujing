import { describe, expect, it } from 'vitest'
import { csvQuoteIdent, inferColumnType, parseCsv, sqlLiteral } from '../src/csv'

describe('parseCsv', () => {
  it('基础逗号分隔', () => {
    expect(parseCsv('a,b,c')).toEqual([['a', 'b', 'c']])
  })

  it('处理字段内引号与转义双引号', () => {
    expect(parseCsv('"say ""hi""",b')).toEqual([['say "hi"', 'b']])
  })

  it('字段内换行不拆行', () => {
    expect(parseCsv('"line1\nline2",b')).toEqual([['line1\nline2', 'b']])
  })

  it('字段内逗号不拆列', () => {
    expect(parseCsv('"1,000",2')).toEqual([['1,000', '2']])
  })

  it('CRLF 行尾', () => {
    expect(parseCsv('a,b\r\nc,d')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ])
  })

  it('空行被忽略', () => {
    expect(parseCsv('a,b\n\nc,d\n')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ])
  })

  it('结尾无换行的最后一行保留', () => {
    expect(parseCsv('x\ny')).toEqual([['x'], ['y']])
  })

  it('自定义分隔符(tsv)', () => {
    expect(parseCsv('a\tb\tc', '\t')).toEqual([['a', 'b', 'c']])
  })

  it('未闭合引号按普通文本收尾', () => {
    expect(parseCsv('"abc')).toEqual([['abc']])
  })
})

describe('inferColumnType', () => {
  const cases: [string[], 'sqlite' | 'mysql', string][] = [
    [['1', '23'], 'mysql', 'BIGINT'],
    [['1.5', '-2.25'], 'sqlite', 'DOUBLE'],
    [['a', 'bc'], 'mysql', 'VARCHAR(50)'],
    [['', '', ''], 'sqlite', 'TEXT'],
    [['2024-01-01'], 'mysql', 'VARCHAR(50)'],
  ]
  it.each(cases)('%j → %s', (vals, db, expected) => {
    expect(inferColumnType(vals, db)).toBe(expected)
  })
})

describe('sqlLiteral / csvQuoteIdent', () => {
  it('单引号转义', () => {
    expect(sqlLiteral("o'clock")).toBe("'o''clock'")
  })
  it('mysql 反引号标识符', () => {
    expect(csvQuoteIdent('t`x', 'mysql')).toBe('`t``x`')
  })
  it('ansi 双引号标识符', () => {
    expect(csvQuoteIdent('t"x', 'postgres')).toBe('"t""x"')
  })
})
