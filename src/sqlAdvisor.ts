/**
 * SQL 优化建议规则引擎(纯函数,可单测)
 * 两层:静态检查(不执行)+ 执行计划解析(需要 EXPLAIN 结果)
 */
import type { DbType, ExecResult } from './types'

export interface Finding {
  level: 'danger' | 'warn' | 'info'
  title: string
  detail: string
}

// ── 静态检查 ────────────────────────────────────────
export function staticCheck(sqlRaw: string): Finding[] {
  const sql = sqlRaw.trim()
  const out: Finding[] = []
  const head = sql.slice(0, 20).toLowerCase()

  if (/^select\s+\*\s+from/i.test(sql)) {
    out.push({
      level: 'info',
      title: 'SELECT *',
      detail: '查询所有列会传输多余数据、无法利用覆盖索引;建议按需列出列名',
    })
  }
  if (/^select\s+[\s\S]*?\bfrom\b[\s\S]*?\bjoin\b/i.test(sql) && !/\bon\b/i.test(sql)) {
    out.push({
      level: 'danger',
      title: 'JOIN 缺少 ON 条件',
      detail: '将产生笛卡尔积,行数可能爆炸;请补充 JOIN … ON … 条件',
    })
  }
  if (/^update\b/i.test(sql) && !/\bwhere\b/i.test(sql)) {
    out.push({
      level: 'danger',
      title: 'UPDATE 无 WHERE',
      detail: '将更新整张表的所有行,请确认是否为有意操作',
    })
  }
  if (/^delete\b/i.test(sql) && !/\bwhere\b/i.test(sql)) {
    out.push({
      level: 'danger',
      title: 'DELETE 无 WHERE',
      detail: '将删除整张表数据,建议先 SELECT 确认范围或加 LIMIT 分批',
    })
  }
  if (/like\s+'%/i.test(sql)) {
    out.push({
      level: 'warn',
      title: 'LIKE 前导通配符',
      detail: "'%xxx' 形式无法使用 B-tree 索引,将全表扫描;若必须前缀模糊,考虑全文索引或倒排表",
    })
  }
  if (/\bwhere\b[\s\S]*?\b(or|and)\b[\s\S]*?\1/i.test(sql)) {
    // OR 条件提示
  }
  {
    const wm = sql.match(/\bwhere\b([\s\S]*)$/i)?.[1] ?? ''
    if (/\b(upper|lower|substring|substr|date|cast|convert|trim)\s*\(/i.test(wm)) {
      out.push({
        level: 'warn',
        title: 'WHERE 中对列使用函数',
        detail: '列上的函数运算会让索引失效(除非有对应表达式索引);建议把计算移到常量侧或改写条件',
      })
    }
  }
  if (/\border\s+by\b/i.test(sql) && !/\blimit\b/i.test(sql) && head.startsWith('select')) {
    out.push({
      level: 'info',
      title: '大结果集排序',
      detail: 'ORDER BY 无 LIMIT 时若结果集大,排序开销高;建议分页或让排序列命中索引',
    })
  }
  if (/\bunion\b(?! all)/i.test(sql)) {
    out.push({
      level: 'info',
      title: 'UNION 去重',
      detail: 'UNION 会做去重排序,若无需去重用 UNION ALL 更快',
    })
  }
  if (/\bnot\s+in\b/i.test(sql)) {
    out.push({
      level: 'info',
      title: 'NOT IN',
      detail: 'NOT IN 遇 NULL 语义坑且通常无法走索引;考虑改写为 NOT EXISTS 或 LEFT JOIN … IS NULL',
    })
  }
  return out
}

// ── 执行计划解析 ────────────────────────────────────
export function planCheck(dbType: DbType, r: ExecResult): Finding[] {
  const out: Finding[] = []
  if (!r.columns.length) {
    out.push({ level: 'info', title: '无执行计划', detail: '该语句不返回执行计划' })
    return out
  }
  if (dbType === 'mysql') return checkMysql(r)
  if (dbType === 'sqlite') return checkSqlite(r)
  if (dbType === 'postgres') return checkPg(r)
  return out
}

function colIdx(r: ExecResult, ...names: string[]): number {
  const lower = r.columns.map((c) => c.toLowerCase())
  for (const n of names) {
    const i = lower.indexOf(n)
    if (i >= 0) return i
  }
  return -1
}

function checkMysql(r: ExecResult): Finding[] {
  const out: Finding[] = []
  const iT = colIdx(r, 'type')
  const iK = colIdx(r, 'key')
  const iR = colIdx(r, 'rows')
  const iE = colIdx(r, 'extra')
  const iId = colIdx(r, 'id')

  for (const row of r.rows) {
    const scope = iId >= 0 ? `(表 ${row[iId - 1] ?? '?'})` : ''
    const type = iT >= 0 ? row[iT] ?? '' : ''
    const key = iK >= 0 ? row[iK] ?? '' : ''
    const rows = iR >= 0 ? row[iR] ?? '' : ''
    const extra = iE >= 0 ? row[iE] ?? '' : ''

    if (type === 'ALL') {
      out.push({
        level: 'danger',
        title: `全表扫描 ${scope}`,
        detail: `type=ALL,预估扫描 ${rows || '?'} 行;WHERE/JOIN 列建议建立索引`,
      })
    } else if (type === 'index') {
      out.push({
        level: 'warn',
        title: `全索引扫描 ${scope}`,
        detail: 'type=index(扫描整个索引),通常比走索引定位慢;检查条件列是否为索引最左前缀',
      })
    }
    if (!key && type !== 'const' && type !== 'system') {
      out.push({
        level: 'warn',
        title: `未使用索引 ${scope}`,
        detail: 'key=NULL,该访问路径没有命中索引',
      })
    }
    if (/using filesort/i.test(extra)) {
      out.push({
        level: 'warn',
        title: `额外排序 ${scope}`,
        detail: 'Using filesort:排序未走索引;ORDER BY/GROUP BY 列考虑加索引',
      })
    }
    if (/using temporary/i.test(extra)) {
      out.push({
        level: 'warn',
        title: `临时表 ${scope}`,
        detail: 'Using temporary:常见于 DISTINCT/GROUP BY/UNION;分组列建索引可避免',
      })
    }
  }
  if (!out.length) {
    out.push({ level: 'info', title: '计划良好', detail: '未发现全表扫描/临时表/额外排序等信号' })
  }
  return out
}

function checkSqlite(r: ExecResult): Finding[] {
  const out: Finding[] = []
  const iD = colIdx(r, 'detail')
  for (const row of r.rows) {
    const detail = (iD >= 0 ? row[iD] ?? '' : row.join(' ')) ?? ''
    const m = detail.match(/\bSCAN\s+(\S+)/i)
    if (m) {
      out.push({
        level: 'danger',
        title: `全表扫描 ${m[1]}`,
        detail: `SCAN ${m[1]}:过滤条件列无索引可用;建议建索引或检查条件写法`,
      })
    }
    const s = detail.match(/\bSEARCH\s+(\S+).*USING\s+INDEX\s+(\S+)/i)
    if (s) {
      out.push({
        level: 'info',
        title: `${s[1]} 命中索引 ${s[2]}`,
        detail: 'SEARCH … USING INDEX,访问路径良好',
      })
    }
  }
  if (!out.length) {
    out.push({ level: 'info', title: '未发现明显问题', detail: '执行计划中没有全表扫描信号' })
  }
  return out
}

function checkPg(r: ExecResult): Finding[] {
  const out: Finding[] = []
  const text = r.rows.map((row) => row.join(' ')).join('\n')
  for (const m of text.matchAll(/Seq Scan on\s+(\S+)/g)) {
    out.push({
      level: 'danger',
      title: `顺序扫描 ${m[1]}`,
      detail: 'Seq Scan:该表走了全表扫描;过滤/连接列建议建索引(大表尤其)',
    })
  }
  for (const m of text.matchAll(/Index Scan using\s+(\S+)/g)) {
    out.push({
      level: 'info',
      title: `命中索引 ${m[1]}`,
      detail: 'Index Scan,访问路径良好',
    })
  }
  if (/rows=\d+\.\.\d+/.test(text)) {
    // ANALYZE 模式:估算 vs 实际
    for (const m of text.matchAll(/rows=(\d+)\.\.\s*(\d+)/g)) {
      const est = Number(m[1])
      const actual = Number(m[2])
      if (actual > est * 10 && actual > 100) {
        out.push({
          level: 'warn',
          title: '统计信息偏差大',
          detail: `估算 ${est} 行 vs 实际 ${actual} 行,偏差超 10 倍;执行 ANALYZE 更新统计信息可改善计划选择`,
        })
        break
      }
    }
  }
  if (!out.length) {
    out.push({ level: 'info', title: '未发现明显问题', detail: '计划中无顺序扫描信号' })
  }
  return out
}

/** EXPLAIN 语句构造(按方言) */
export function explainSql(dbType: DbType, sql: string): string {
  const s = sql.trim().replace(/;\s*$/, '')
  switch (dbType) {
    case 'sqlite':
      return `EXPLAIN QUERY PLAN ${s}`
    case 'postgres':
      return `EXPLAIN (ANALYZE, BUFFERS) ${s}`
    default:
      return `EXPLAIN ${s}`
  }
}
