/**
 * 虚拟滚动组合式:只计算可见窗口的行偏移
 * 从 ResultsGrid 抽出的纯逻辑,便于单测。
 *
 * scroll 事件用 rAF 合帧:高频滚动(触控板/滚轮一帧多次)只测量一次,
 * 避免同一帧内重复触发响应式更新与渲染。
 */
import { computed, onMounted, onUnmounted, ref, type Ref } from 'vue'

interface Options {
  rowCount: Ref<number>
  /** 行高:固定数值或响应式(紧凑/舒适切换) */
  rowHeight: number | Ref<number>
  overscanBefore?: number
  overscanAfter?: number
}

export function useVirtualScroll(opts: Options) {
  const { rowCount, overscanBefore = 4, overscanAfter = 8 } = opts
  const rowH = computed(() =>
    typeof opts.rowHeight === 'number' ? opts.rowHeight : opts.rowHeight.value,
  )

  const scroller = ref<HTMLElement | null>(null)
  const scrollTop = ref(0)
  const viewH = ref(400)

  function measure() {
    const el = scroller.value
    if (!el) return
    scrollTop.value = el.scrollTop
    viewH.value = el.clientHeight
  }

  let rafId = 0

  function onScroll() {
    if (rafId) return
    rafId = requestAnimationFrame(() => {
      rafId = 0
      measure()
    })
  }

  onMounted(() => {
    measure()
    window.addEventListener('resize', onScroll)
  })
  onUnmounted(() => {
    window.removeEventListener('resize', onScroll)
    if (rafId) cancelAnimationFrame(rafId)
  })

  const start = computed(() =>
    Math.max(0, Math.floor(scrollTop.value / rowH.value) - overscanBefore),
  )

  const end = computed(() =>
    Math.min(rowCount.value, start.value + Math.ceil(viewH.value / rowH.value) + overscanAfter),
  )

  return { scroller, scrollTop, viewH, start, end, onScroll, measure }
}
