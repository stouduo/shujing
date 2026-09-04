import { describe, expect, it } from 'vitest'
import { pkFingerprint, locateByFingerprint } from '../src/stores/helpers'


describe('记录详情行跟随(主键指纹)', () => {
  const rows = [
    ['1', 'alice', '北京'],
    ['2', 'bob', '上海'],
    ['3', 'carol', null],
  ]
  const pkIdxs = [0] // id 列为主键

  it('指纹稳定:同一行任意列序提取一致', () => {
    expect(pkFingerprint(rows[1], pkIdxs)).toBe('2')
  })

  it('排序(行序打乱)后按指纹找回同一行', () => {
    const shuffled = [rows[2], rows[0], rows[1]]
    const fp = pkFingerprint(rows[1], pkIdxs)!
    expect(locateByFingerprint(shuffled, pkIdxs, fp)).toBe(2)
  })

  it('翻页后行不在集合中 → -1(面板应关闭)', () => {
    const fp = pkFingerprint(rows[0], pkIdxs)!
    expect(locateByFingerprint([rows[1], rows[2]], pkIdxs, fp)).toBe(-1)
  })

  it('NULL 主键值参与指纹且能定位', () => {
    const rowsN = [['9', 'x', 'y'], [null, 'z', 'w']]
    const fp = pkFingerprint(rowsN[1], pkIdxs)!
    expect(locateByFingerprint(rowsN, pkIdxs, fp)).toBe(1)
  })

  it('复合主键按列序拼接,列顺序不同不误匹配', () => {
    const fp = pkFingerprint(['a', 'b'], [0, 1])!
    expect(fp).toBe('a\u0000b')
    expect(pkFingerprint(['b', 'a'], [0, 1])).not.toBe(fp)
  })

  it('无有效主键列 → null(调用方退回旧行为)', () => {
    expect(pkFingerprint(rows[0], [])).toBeNull()
  })
})
