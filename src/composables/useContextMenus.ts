/**
 * 表格右键菜单组合式:单元格菜单 + 列头菜单(定位/选项/处理)
 * 从 ResultsGrid 抽出的状态与选项生成逻辑。
 */
import { computed, ref } from 'vue'
import type { DropdownOption } from 'naive-ui'

interface CellMenuActions {
  copyCell: (r: number, c: number) => void
  copyRowJson: (r: number) => void
  copyRowCsv: (r: number) => void
  copyInsert: (r: number) => void
  copyRowToNew: (r: number) => void
  openMlEdit: (r: number, c: number) => void
  setNull: (r: number, col: string) => void
}

interface HeadMenuActions {
  copyColName: (col: string) => void
  togglePin: (col: string) => void
  filterCol: (col: string, op?: string) => void
  showStats: (col: string) => void
  batchSet: (col: string) => void
}

interface Options {
  editable: () => boolean
  sortable: () => boolean
  sortKey: () => string | null | undefined
  sortDir: () => 'asc' | 'desc'
  hasTableName: () => boolean
  /** 是否支持勾选行(表数据页 true;查询结果无复选框为 false) */
  hasCheckboxes: () => boolean
  cellActions: CellMenuActions
  headActions: HeadMenuActions
}

export function useContextMenus(opts: Options) {
  const ctx = ref({ show: false, x: 0, y: 0, r: 0, c: 0 })
  const headCtx = ref({ show: false, x: 0, y: 0, col: '' })

  function openCtx(e: MouseEvent, r: number, c: number) {
    e.preventDefault()
    ctx.value = { show: true, x: e.clientX, y: e.clientY, r, c }
  }

  function openHeadCtx(e: MouseEvent, col: string) {
    e.preventDefault()
    headCtx.value = { show: true, x: e.clientX, y: e.clientY, col }
  }

  const ctxOptions = computed<DropdownOption[]>(() => {
    const o: DropdownOption[] = [
      { label: '复制单元格', key: 'cell' },
      { label: '筛选此值', key: 'filterval' },
      { label: '复制整行 (JSON)', key: 'row' },
      { label: '复制行 (CSV)', key: 'rowcsv' },
    ]
    if (opts.hasTableName()) {
      o.push({ label: '复制 INSERT 语句', key: 'insert' })
    }
    if (opts.editable()) {
      o.push({ type: 'divider', key: 'd' })
      o.push({ label: '复制为新行', key: 'copyrow' })
      o.push({ label: '多行编辑… (⌥↵)', key: 'ml' })
      o.push({ label: '设为 NULL', key: 'null' })
    }
    return o
  })

  const headCtxOptions = computed<DropdownOption[]>(() => {
    const col = headCtx.value.col
    const o: DropdownOption[] = [{ label: '复制列名', key: 'copy' }]
    if (opts.sortable()) {
      o.push({
        label: '排序',
        key: 'sort-menu',
        children: [
          {
            label: opts.sortKey() === col && opts.sortDir() === 'asc' ? '✓ 升序' : '升序',
            key: 'sort-asc',
          },
          {
            label: opts.sortKey() === col && opts.sortDir() === 'desc' ? '✓ 降序' : '降序',
            key: 'sort-desc',
          },
          { label: '取消排序', key: 'sort-none' },
        ],
      })
    }
    o.push({ label: '固定此列到左侧', key: 'pin' })
    o.push(
      { label: '按此列筛选…', key: 'filter' },
      { label: '筛选 NULL 值', key: 'isnull' },
      { label: '筛选非空值', key: 'notnull' },
    )
    o.push(
      { label: '列统计(当前页)', key: 'stats' },
    )
    if (opts.editable() && opts.hasCheckboxes()) {
      o.push({ label: '勾选行统一设置此列…', key: 'batch' })
    }
    return o
  })

  async function onCtxSelect(
    key: string | number,
    columns: string[],
    displayValue: (r: number, c: number) => string | null,
  ) {
    const { r, c } = ctx.value
    ctx.value.show = false
    const col = columns[c]
    switch (key) {
      case 'cell':
        opts.cellActions.copyCell(r, c)
        break
      case 'filterval': {
        const v = displayValue(r, c)
        if (col && v !== null) opts.headActions.filterCol(col, `=${v}`)
        break
      }
      case 'row':
        opts.cellActions.copyRowJson(r)
        break
      case 'rowcsv':
        opts.cellActions.copyRowCsv(r)
        break
      case 'insert':
        opts.cellActions.copyInsert(r)
        break
      case 'copyrow':
        opts.cellActions.copyRowToNew(r)
        break
      case 'ml':
        opts.cellActions.openMlEdit(r, c)
        break
      case 'null':
        if (col) opts.cellActions.setNull(r, col)
        break
    }
  }

  async function onHeadCtxSelect(
    key: string | number,
    onSort: (col: string, dir?: 'asc' | 'desc' | null) => void,
  ) {
    const col = headCtx.value.col
    headCtx.value.show = false
    const k = String(key)
    if (k.startsWith('sort-')) {
      if (k === 'sort-none') onSort(col, null)
      else if (k === 'sort-asc') onSort(col, 'asc')
      else onSort(col, 'desc')
      return
    }
    switch (key) {
      case 'copy':
        opts.headActions.copyColName(col)
        break
      case 'pin':
        opts.headActions.togglePin(col)
        break
      case 'filter':
        opts.headActions.filterCol(col, '=')
        break
      case 'isnull':
        opts.headActions.filterCol(col, 'IS NULL')
        break
      case 'notnull':
        opts.headActions.filterCol(col, 'IS NOT NULL')
        break
      case 'stats':
        opts.headActions.showStats(col)
        break
      case 'batch':
        opts.headActions.batchSet(col)
        break
    }
  }

  return {
    ctx,
    headCtx,
    ctxOptions,
    headCtxOptions,
    openCtx,
    openHeadCtx,
    onCtxSelect,
    onHeadCtxSelect,
  }
}
