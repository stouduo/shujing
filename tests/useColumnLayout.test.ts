import { describe, expect, it } from 'vitest'
import { ref } from 'vue'
import { useColumnLayout } from '../src/composables/useColumnLayout'

function setup(cols: string[], rows: (string | null)[][]) {
  return useColumnLayout({
    columns: ref(cols),
    rows: ref(rows),
    fixedBase: ref(0),
  })
}

describe('useColumnLayout', () => {
  it('自动宽度按内容估算并夹在上下限', () => {
    const l = setup(['id', 'name', 'veryLongColumnName...'], [['1', 'ab', null]])
    expect(l.widths.value[0]).toBeGreaterThanOrEqual(90)
    expect(l.widths.value[1]).toBeLessThanOrEqual(360)
    // 长列名宽于短内容
    expect(l.widths.value[2]).toBeGreaterThan(l.widths.value[1])
  })

  it('用户列宽优先于估算', () => {
    const l = setup(['a', 'b'], [])
    l.setWidth(0, 200)
    expect(l.widths.value[0]).toBe(200)
    l.setWidth(0, 99999)
    expect(l.widths.value[0]).toBe(760) // 上限
  })

  it('固定列排在最前且保持固定顺序', () => {
    const l = setup(['id', 'name', 'age', 'city'], [])
    l.togglePin('city')
    l.togglePin('id')
    expect(l.colOrder.value).toEqual([0, 3, 1, 2])
  })

  it('隐藏列不参与渲染顺序', () => {
    const l = setup(['a', 'b', 'c'], [])
    l.toggleHidden('b')
    expect(l.colOrder.value).toEqual([0, 2])
    l.toggleHidden('b')
    expect(l.colOrder.value).toEqual([0, 1, 2])
  })

  it('固定 + 隐藏组合', () => {
    const l = setup(['a', 'b', 'c', 'd'], [])
    l.togglePin('c')
    l.toggleHidden('a')
    expect(l.colOrder.value).toEqual([2, 1, 3])
  })

  it('固定列偏移从 fixedBase 起累加', () => {
    const l = useColumnLayout({
      columns: ref(['id', 'name', 'age']),
      rows: ref([]),
      fixedBase: ref(110),
    })
    l.togglePin('id')
    l.togglePin('name')
    expect(l.pinnedLeft.value['id']).toBe(110)
    expect(l.pinnedLeft.value['name']).toBe(110 + l.widths.value[0])
    // 非固定列无偏移
    expect(l.pinnedLeft.value['age']).toBeUndefined()
  })

  it('showAll 清空隐藏与行号开关', () => {
    const l = setup(['a'], [])
    l.toggleHidden('a')
    l.hideRowNum.value = true
    l.showAll()
    expect(l.hidden.value).toEqual([])
    expect(l.hideRowNum.value).toBe(false)
  })

  it('totalW 含 fixedBase', () => {
    const l = useColumnLayout({
      columns: ref(['a', 'b']),
      rows: ref([]),
      fixedBase: ref(80),
    })
    const sum = l.widths.value[0] + l.widths.value[1]
    expect(l.totalW.value).toBe(sum + 80)
  })
})
