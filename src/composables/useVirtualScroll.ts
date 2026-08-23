/**
 * 虚拟滚动组合式:只计算可见窗口的行偏移
 * 从 ResultsGrid 抽出的纯逻辑,便于单测。
 */
import { computed, onMounted, onUnmounted, ref, type Ref } from 'vue'

interface Options {
  rowCount: Ref<number>
  rowHeight: number
  overscanBefore?: number
  overscanAfter?: number
}

export function useVirtualScroll(opts: Options) {
  const { rowCount, rowHeight, overscanBefore = 4, overscanAfter = 8 } = opts

  const scroller = ref<HTMLElement | null>(null)
  const scrollTop = ref(0)
  const viewH = ref(400)

  function measure() {
    const el = scroller.value
    if (!el) return
    scrollTop.value = el.scrollTop
    viewH.value = el.clientHeight
  }

  function onScroll() {
    measure()
  }

  onMounted(() => {
    measure()
    window.addEventListener('resize', measure)
  })
  onUnmounted(() => {
    window.removeEventListener('resize', measure)
  })

  const start = computed(() =>
    Math.max(0, Math.floor(scrollTop.value / rowHeight) - overscanBefore),
  )

  const end = computed(() =>
    Math.min(rowCount.value, start.value + Math.ceil(viewH.value / rowHeight) + overscanAfter),
  )

  /** 可见窗口的行(slice 引用,保持原数组行号) */
  const visible = computed(() => {
    const fake = { slice: (a: number, b: number) => [a, b] as unknown as number }
    void fake
    return { start: start.value, end: end.value }
  })

  const topPad = computed(() => start.value * rowHeight)
  const bottomPad = computed(() => Math.max(0, (rowCount.value - end.value) * rowHeight))

  return { scroller, scrollTop, viewH, start, end, visible, topPad, bottomPad, onScroll, measure }
}
