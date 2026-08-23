import { describe, expect, it } from 'vitest'
import { explainSql, planCheck, staticCheck } from '../src/sqlAdvisor'
import type { ExecResult } from '../src/types'

describe('staticCheck', () => {
  it('SELECT * 给提示', () => {
    const f = staticCheck('SELECT * FROM users')
    expect(f.some((x) => x.title === 'SELECT *')).toBe(true)
  })

  it('JOIN 无 ON 为危险', () => {
    const f = staticCheck('SELECT a.x FROM a JOIN b')
    expect(f.find((x) => x.title.includes('JOIN 缺少'))?.level).toBe('danger')
  })

  it('UPDATE/DELETE 无 WHERE 为危险', () => {
    expect(staticCheck('UPDATE t SET x = 1').find((x) => x.title.includes('UPDATE'))?.level).toBe('danger')
    expect(staticCheck('DELETE FROM t').find((x) => x.title.includes('DELETE'))?.level).toBe('danger')
    expect(staticCheck('DELETE FROM t WHERE id = 1').find((x) => x.title.includes('DELETE'))).toBeUndefined()
  })

  it('LIKE 前导通配', () => {
    expect(staticCheck("SELECT id FROM t WHERE name LIKE '%abc'").some((x) => x.title.includes('LIKE'))).toBe(true)
    expect(staticCheck("SELECT id FROM t WHERE name LIKE 'abc%'").some((x) => x.title.includes('LIKE'))).toBe(false)
  })

  it('WHERE 列上函数', () => {
    expect(staticCheck('SELECT id FROM t WHERE UPPER(name) = ' + "'A'").some((x) => x.title.includes('函数'))).toBe(true)
  })

  it('UNION 提示 / NOT IN 提示', () => {
    expect(staticCheck('SELECT 1 UNION SELECT 2').some((x) => x.title === 'UNION 去重')).toBe(true)
    expect(staticCheck('SELECT 1 WHERE x NOT IN (SELECT y FROM t)').some((x) => x.title === 'NOT IN')).toBe(true)
  })
})

describe('planCheck', () => {
  const mk = (columns: string[], rows: (string | null)[][]): ExecResult => ({
    columns,
    rows,
    affected: rows.length,
    truncated: false,
    elapsedMs: 0,
  })

  it('MySQL 全表扫描 + filesort', () => {
    const r = mk(['id', 'select_type', 'table', 'type', 'key', 'rows', 'Extra'], [
      ['1', 'SIMPLE', 'users', 'ALL', null, '2345', 'Using where; Using filesort'],
    ])
    const f = planCheck('mysql', r)
    expect(f.find((x) => x.title.includes('全表扫描'))?.level).toBe('danger')
    expect(f.some((x) => x.title.includes('未使用索引'))).toBe(true)
    expect(f.some((x) => x.title.includes('额外排序'))).toBe(true)
  })

  it('MySQL 走索引且计划良好', () => {
    const r = mk(['id', 'type', 'key', 'rows', 'Extra'], [
      ['1', 'ref', 'idx_name', '10', 'Using index condition'],
    ])
    const f = planCheck('mysql', r)
    expect(f.find((x) => x.title === '计划良好')).toBeTruthy()
  })

  it('SQLite SCAN 识别', () => {
    const r = mk(['id', 'parent', 'notused', 'detail'], [
      ['4', '0', '0', 'SCAN users'],
    ])
    const f = planCheck('sqlite', r)
    expect(f.find((x) => x.title.includes('全表扫描 users'))?.level).toBe('danger')
  })

  it('SQLite SEARCH USING INDEX', () => {
    const r = mk(['id', 'parent', 'notused', 'detail'], [
      ['6', '0', '0', 'SEARCH users USING INDEX idx_users_name (name=?)'],
    ])
    const f = planCheck('sqlite', r)
    expect(f.find((x) => x.title.includes('命中索引'))).toBeTruthy()
  })

  it('PG Seq Scan 识别', () => {
    const r = mk(['QUERY PLAN'], [
      ['Seq Scan on orders  (cost=0.00..35.50 rows=2550 width=4)'],
    ])
    const f = planCheck('postgres', r)
    expect(f.find((x) => x.title.includes('顺序扫描 orders'))?.level).toBe('danger')
  })

  it('PG 统计偏差检测', () => {
    const r = mk(['QUERY PLAN'], [
      ['Seq Scan on big  (cost=0.00..35.50 rows=100..15000 width=4) (actual rows=15000)'],
    ])
    const f = planCheck('postgres', r)
    expect(f.some((x) => x.title.includes('统计信息偏差'))).toBe(true)
  })
})

describe('explainSql', () => {
  it('三方言语句构造', () => {
    expect(explainSql('sqlite', 'SELECT 1')).toBe('EXPLAIN QUERY PLAN SELECT 1')
    expect(explainSql('postgres', 'SELECT 1;')).toBe('EXPLAIN (ANALYZE, BUFFERS) SELECT 1')
    expect(explainSql('mysql', 'SELECT 1')).toBe('EXPLAIN SELECT 1')
  })
})
