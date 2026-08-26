import { describe, expect, it } from 'vitest'
import { exportFileName } from '../src/filename'

describe('exportFileName 导出文件名', () => {
  it('追加秒级时间戳和扩展名', () => {
    const n = exportFileName('users', 'csv')
    expect(n).toMatch(/^users_\d{8}_\d{6}\.csv$/)
  })

  it('清洗文件系统非法字符', () => {
    const n = exportFileName('a/b:c*d?e"f<g>h|i', 'xlsx')
    expect(n).toMatch(/^a_b_c_d_e_f_g_h_i_\d{8}_\d{6}\.xlsx$/)
  })

  it('空/未传基础名回退为 result', () => {
    expect(exportFileName('', 'csv')).toMatch(/^result_\d{8}_\d{6}\.csv$/)
    expect(exportFileName(null, 'sql')).toMatch(/^result_\d{8}_\d{6}\.sql$/)
    expect(exportFileName(undefined, 'xlsx')).toMatch(/^result_\d{8}_\d{6}\.xlsx$/)
  })
})
