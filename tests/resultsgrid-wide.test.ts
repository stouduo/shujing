import { describe, expect, it } from 'vitest'
import { createApp, h } from 'vue'
import { NMessageProvider } from 'naive-ui'
import ResultsGrid from '../src/components/ResultsGrid.vue'

const N_COLS = 160
const N_ROWS = 100

function mountGrid(props: Record<string, unknown>) {
  const el = document.createElement('div')
  document.body.appendChild(el)
  const app = createApp({
    render: () => h(NMessageProvider, () => h(ResultsGrid, props)),
  })
  app.config.errorHandler = (err) => {
    throw err
  }
  app.mount(el)
  return el
}

describe('ResultsGrid 宽表冒烟', () => {
  it('160 列渲染出表头和数据单元格', async () => {
    const columns = Array.from({ length: N_COLS }, (_, i) => `col_${i}`)
    const rows = Array.from({ length: N_ROWS }, (_, r) =>
      Array.from({ length: N_COLS }, (_, c) => `v${r}_${c}`),
    )
    const el = mountGrid({
      columns,
      rows,
      editable: true,
      sortable: true,
      total: N_ROWS,
    })
    await new Promise((r) => setTimeout(r, 50))
    const cells = el.querySelectorAll('.head-cell')
    expect(cells.length).toBeGreaterThan(0)
    expect(el.querySelectorAll('.row').length).toBeGreaterThan(0)
  })

  it('10 列常规表渲染', async () => {
    const columns = Array.from({ length: 10 }, (_, i) => `c${i}`)
    const rows = Array.from({ length: 30 }, (_, r) =>
      Array.from({ length: 10 }, (_, c) => `x${r}${c}`),
    )
    const el = mountGrid({ columns, rows, editable: true, total: 30 })
    await new Promise((r) => setTimeout(r, 50))
    expect(el.querySelectorAll('.head-cell').length).toBeGreaterThan(0)
  })
})
