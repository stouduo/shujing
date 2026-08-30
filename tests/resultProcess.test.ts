import { describe, expect, it } from 'vitest'
import { processRows } from '../src/workers/resultWorker'

const rows: (string | null)[][] = [
  ['3', '张涛', '苏州'],
  ['1', '刘军', '北京'],
  ['2', null, '上海'],
  ['10', '刘敏', '成都'],
]

describe('processRows 结果二次加工', () => {
  it('无筛选无排序返回全量原序', () => {
    expect(processRows(rows, '', -1, 'asc')).toEqual([0, 1, 2, 3])
  })
  it('关键词筛选(大小写不敏感,任一列命中)', () => {
    expect(processRows(rows, '刘', -1, 'asc')).toEqual([1, 3])
    expect(processRows(rows, '上海', -1, 'asc')).toEqual([2])
  })
  it('数值排序(右对齐语义,字符串数字按数值比较)', () => {
    expect(processRows(rows, '', 0, 'asc')).toEqual([1, 2, 0, 3])
    expect(processRows(rows, '', 0, 'desc')).toEqual([3, 0, 2, 1])
  })
  it('文本排序(按当前环境中文排序规则)', () => {
    expect(processRows(rows, '', 1, 'asc')).toEqual([2, 1, 3, 0])
  })
  it('筛选 + 排序组合', () => {
    expect(processRows(rows, '刘', 0, 'asc')).toEqual([1, 3])
  })
  it('空值参与排序不崩溃(空串排最前)', () => {
    const r2: (string | null)[][] = [['b'], [null], ['a']]
    expect(processRows(r2, '', 0, 'asc')).toEqual([1, 2, 0])
  })
})
