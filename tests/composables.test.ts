import { describe, expect, it, vi } from 'vitest'
import { useCellEditing } from '../src/composables/useCellEditing'
import { useVirtualScroll } from '../src/composables/useVirtualScroll'
import { ref } from 'vue'

describe('useCellEditing', () => {
  function setup() {
    const commits: [number, string, string | null][] = []
    const inserts: [number, string, string][] = []
    const cols = ['id', 'name', 'age', 'city']
    const order = [0, 1, 2, 3]
    return {
      cols, order, commits, inserts,
      ed: useCellEditing({
        columns: () => cols,
        colOrder: () => order,
        displayValue: (r, c) => `v${r}_${c}`,
        onCommit: (r, col, v) => commits.push([r, col, v]),
        onInsertCommit: (i, col, v) => inserts.push([i, col, v]),
        newCellValue: (ni, c) => '',
      }),
    }
  }

  it('startEdit 预填当前值', () => {
    const { ed } = setup()
    ed.startEdit(2, 1)
    expect(ed.editCell.value).toEqual({ r: 2, c: 1 })
    expect(ed.draft.value).toBe('v2_1')
  })

  it('commitEdit 触发 onCommit 并清空', () => {
    const { ed, commits } = setup()
    ed.startEdit(0, 0)
    ed.draft.value = '99'
    ed.commitEdit()
    expect(commits).toEqual([[0, 'id', '99']])
    expect(ed.editCell.value).toBeNull()
  })

  it('值未变化不触发 onCommit', () => {
    const { ed, commits } = setup()
    ed.startEdit(0, 0) // displayValue = v0_0
    ed.draft.value = 'v0_0' // 不变
    ed.commitEdit()
    expect(commits).toEqual([])
  })

  it('空串提交为 null', () => {
    const { ed, commits } = setup()
    ed.startEdit(0, 2)
    ed.draft.value = ''
    ed.commitEdit()
    expect(commits[0][2]).toBeNull()
  })

  it('cancelEdit 清空不触发', () => {
    const { ed, commits } = setup()
    ed.startEdit(0, 0)
    ed.cancelEdit()
    expect(commits).toEqual([])
    expect(ed.editCell.value).toBeNull()
  })

  it('Tab 导航提交并打开右一列', () => {
    const { ed, commits } = setup()
    ed.startEdit(0, 0)
    ed.draft.value = 'x'
    ed.moveEdit(1) // Tab
    expect(commits).toEqual([[0, 'id', 'x']])
    expect(ed.editCell.value).toEqual({ r: 0, c: 1 }) // 移到 name
    expect(ed.draft.value).toBe('v0_1')
  })

  it('Shift+Tab 导航到左一列', () => {
    const { ed } = setup()
    ed.startEdit(1, 2)
    ed.moveEdit(-1)
    expect(ed.editCell.value).toEqual({ r: 1, c: 1 })
  })

  it('首列 Shift+Tab 不越界', () => {
    const { ed } = setup()
    ed.startEdit(0, 0)
    ed.moveEdit(-1)
    expect(ed.editCell.value).toBeNull() // 提交后无下一列
  })

  it('新行编辑走 onInsertCommit', () => {
    const { ed, inserts } = setup()
    ed.startEditNew(0, 1)
    ed.draft.value = '张三'
    ed.commitEdit()
    expect(inserts).toEqual([[0, 'name', '张三']])
  })

  it('isEditing / isEditingNew', () => {
    const { ed } = setup()
    ed.startEdit(3, 2)
    expect(ed.isEditing(3, 2)).toBe(true)
    expect(ed.isEditing(3, 0)).toBe(false)
    ed.startEditNew(1, 0)
    expect(ed.isEditingNew(1, 0)).toBe(true)
  })
})

describe('useVirtualScroll', () => {
  it('onScroll 同帧多次触发只测量一次(rAF 合帧)', async () => {
    const v = useVirtualScroll({ rowCount: ref(1000), rowHeight: 28 })
    const el = document.createElement('div')
    Object.defineProperty(el, 'scrollTop', { value: 280, writable: true })
    Object.defineProperty(el, 'clientHeight', { value: 560, writable: true })
    v.scroller.value = el
    v.onScroll()
    v.onScroll()
    v.onScroll()
    await new Promise((r) => setTimeout(r, 50))
    expect(v.start.value).toBe(6) // 10 - 4 overscan
    expect(v.end.value).toBe(6 + 20 + 8)
  })

  it('start/end 基于 scrollTop 和 viewH', () => {
    const v = useVirtualScroll({ rowCount: ref(1000), rowHeight: 28 })
    v.scrollTop.value = 280 // 滚了 10 行
    v.viewH.value = 560 // 可见 20 行
    expect(v.start.value).toBe(6) // 10 - 4 overscan
    expect(v.end.value).toBe(6 + 20 + 8) // start + 20 + 8 overscan
  })

  it('不足一屏时 end = rowCount', () => {
    const v = useVirtualScroll({ rowCount: ref(5), rowHeight: 28 })
    v.scrollTop.value = 0
    v.viewH.value = 560
    expect(v.end.value).toBe(5)
  })
})
