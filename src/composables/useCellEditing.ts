/**
 * 单元格编辑状态机:进入/提交/取消/Tab 导航/多行编辑
 * 从 ResultsGrid 抽出的纯逻辑。
 */
import { ref } from 'vue'

interface Options {
  columns: () => string[]
  colOrder: () => number[]
  /** 获取显示值(含未保存变更合并) */
  displayValue: (r: number, c: number) => string | null
  /** 提交变更回调 */
  onCommit: (rowIndex: number, col: string, value: string | null) => void
  /** 提交新行变更回调 */
  onInsertCommit: (idx: number, col: string, value: string) => void
  /** 新行当前值 */
  newCellValue: (ni: number, c: number) => string
}

export function useCellEditing(opts: Options) {
  const { columns, colOrder, displayValue, onCommit, onInsertCommit, newCellValue } = opts

  const editCell = ref<{ r: number; c: number } | null>(null)
  const editNew = ref<{ ni: number; c: number } | null>(null)
  const draft = ref('')

  /** 打开已有行编辑 */
  function startEdit(r: number, c: number) {
    const col = columns()[c]
    if (!col) return
    const v = displayValue(r, c)
    draft.value = v === null ? '' : v
    editNew.value = null
    editCell.value = { r, c }
  }

  /** 打开新行编辑 */
  function startEditNew(ni: number, c: number) {
    draft.value = newCellValue(ni, c)
    editCell.value = null
    editNew.value = { ni, c }
  }

  /** 提交(已有行或新行) */
  function commitEdit() {
    if (editNew.value) {
      const { ni, c } = editNew.value
      editNew.value = null
      const col = columns()[c]
      if (col) onInsertCommit(ni, col, draft.value)
      return
    }
    const ec = editCell.value
    if (!ec) return
    editCell.value = null
    const col = columns()[ec.c]
    const cur = displayValue(ec.r, ec.c)
    const v = draft.value === '' ? null : draft.value
    if (v !== cur && col) onCommit(ec.r, col, v)
  }

  function cancelEdit() {
    editCell.value = null
    editNew.value = null
  }

  /** Tab/Shift+Tab:提交并打开相邻可见列编辑 */
  function moveEdit(dir: number) {
    const ec = editCell.value ?? editNew.value
    if (!ec) return
    const isOld = !!editCell.value
    const r = isOld ? editCell.value!.r : editNew.value!.ni
    const cur = isOld ? editCell.value!.c : editNew.value!.c
    commitEdit()
    const order = colOrder()
    const pos = order.indexOf(cur)
    const nextIdx = order[pos + dir]
    if (nextIdx === undefined) return
    if (isOld) startEdit(r, nextIdx)
    else startEditNew(r, nextIdx)
  }

  /** 判断某格是否正在编辑 */
  function isEditing(r: number, c: number): boolean {
    return editCell.value?.r === r && editCell.value?.c === c
  }

  function isEditingNew(ni: number, c: number): boolean {
    return editNew.value?.ni === ni && editNew.value?.c === c
  }

  return {
    editCell,
    editNew,
    draft,
    startEdit,
    startEditNew,
    commitEdit,
    cancelEdit,
    moveEdit,
    isEditing,
    isEditingNew,
  }
}
