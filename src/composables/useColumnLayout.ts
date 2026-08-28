/**
 * 列布局组合式:自动宽度估算 / 用户列宽 / 固定列顺序 / 隐藏列 / 布局持久化
 * 从 ResultsGrid 抽出的纯逻辑,便于单测与复用。
 */
import { computed, onMounted, ref, watch, type Ref } from 'vue'

export interface ColLayout {
  widths: Record<number, number>
  pinned: string[]
  hidden: string[]
  hideRowNum: boolean
}

interface UseColumnLayoutOptions {
  columns: Ref<string[]>
  rows: Ref<(string | null)[][]>
  /** 有行号/勾选/删除等前置固定列时的起始偏移 */
  fixedBase: Ref<number>
  /** 持久化键(如 connId/table),提供则记忆布局 */
  persistKey?: Ref<string | undefined>
}

const MIN_W = 90
const MAX_W = 360
const CHAR_W = 7.3
const SAMPLE_ROWS = 60

export function useColumnLayout(opts: UseColumnLayoutOptions) {
  const { columns, rows, fixedBase, persistKey } = opts

  const userWidths = ref<Record<number, number>>({})
  const pinned = ref<string[]>([])
  const hidden = ref<string[]>([])
  const hideRowNum = ref(false)

  // ── 持久化 ────────────────────────────────────────
  const storageKey = () => (persistKey?.value ? `dblens_colw:${persistKey.value}` : '')

  onMounted(() => {
    const k = storageKey()
    if (!k) return
    try {
      const raw = localStorage.getItem(k)
      if (!raw) return
      const d = JSON.parse(raw) as ColLayout
      userWidths.value = d.widths ?? {}
      pinned.value = d.pinned ?? []
      hidden.value = d.hidden ?? []
      hideRowNum.value = !!d.hideRowNum
    } catch {
      /* 忽略坏数据 */
    }
  })

  const save = () => {
    const k = storageKey()
    if (!k) return
    const d: ColLayout = {
      widths: userWidths.value,
      pinned: pinned.value,
      hidden: hidden.value,
      hideRowNum: hideRowNum.value,
    }
    try {
      localStorage.setItem(k, JSON.stringify(d))
    } catch {
      /* 忽略 */
    }
  }

  watch([userWidths, pinned, hidden, () => hideRowNum.value], save, { deep: true })

  // ── 宽度估算(优先用户设置) ────────────────────────
  const widths = computed(() =>
    columns.value.map((c, i) => {
      if (userWidths.value[i]) return userWidths.value[i]
      let max = c.length
      const n = Math.min(rows.value.length, SAMPLE_ROWS)
      for (let r = 0; r < n; r++) {
        const v = rows.value[r]?.[i]
        if (v && v.length > max) max = v.length
      }
      return Math.min(MAX_W, Math.max(MIN_W, Math.ceil(max * CHAR_W) + 30))
    }),
  )

  const visibleIdx = computed(() =>
    columns.value.map((_, i) => i).filter((i) => !hidden.value.includes(columns.value[i])),
  )

  /** 渲染顺序:固定列在前(保持固定顺序),其余原序,滤掉隐藏列 */
  const colOrder = computed<number[]>(() => {
    const pinSet = new Set(pinned.value)
    const pinIdx: number[] = []
    const rest: number[] = []
    columns.value.forEach((c, i) => (pinSet.has(c) ? pinIdx.push(i) : rest.push(i)))
    return [...pinIdx, ...rest].filter((i) => visibleIdx.value.includes(i))
  })

  /** 固定列的 sticky left 偏移(☑/# 列已不固定,从 0 起依次累加) */
  const pinnedLeft = computed<Record<string, number>>(() => {
    const m: Record<string, number> = {}
    let x = 0
    for (const name of pinned.value) {
      const i = columns.value.indexOf(name)
      if (i >= 0) {
        m[name] = x
        x += widths.value[i]
      }
    }
    return m
  })

  const totalW = computed(() => widths.value.reduce((a, b) => a + b, 0) + fixedBase.value)

  // ── 操作 API ──────────────────────────────────────
  function setWidth(i: number, w: number) {
    userWidths.value = { ...userWidths.value, [i]: Math.max(60, Math.min(760, Math.round(w))) }
  }

  function togglePin(col: string) {
    pinned.value = pinned.value.includes(col)
      ? pinned.value.filter((c) => c !== col)
      : [...pinned.value, col]
  }

  function toggleHidden(col: string) {
    hidden.value = hidden.value.includes(col)
      ? hidden.value.filter((c) => c !== col)
      : [...hidden.value, col]
  }

  function showAll() {
    hidden.value = []
    hideRowNum.value = false
  }

  const isPinned = (col: string) => pinned.value.includes(col)
  const isHidden = (col: string) => hidden.value.includes(col)

  return {
    // state
    userWidths,
    pinned,
    hidden,
    hideRowNum,
    // computed
    widths,
    colOrder,
    pinnedLeft,
    totalW,
    visibleIdx,
    // api
    setWidth,
    togglePin,
    toggleHidden,
    showAll,
    isPinned,
    isHidden,
  }
}
