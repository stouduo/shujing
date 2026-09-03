/**
 * 虚拟滚动组合式:只计算可见窗口的行偏移
 * 从 ResultsGrid 抽出的纯逻辑,便于单测。
 *
 * 必须在 scroll 事件里同步测量:rAF 延迟会让行窗口比合成器滚动慢一帧,
 * 快速滑动时边缘出现滞后拖影。重复测量无开销——ref 同值不触发更新,
 * 同帧多次渲染也由 Vue 调度器天然去重。
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

  function onScroll() {
    measure()
  }

  onMounted(() => {
    measure()
    window.addEventListener('resize', onScroll)
  })
  onUnmounted(() => {
    window.removeEventListener('resize', onScroll)
  })

  const start = computed(() =>
    Math.max(0, Math.floor(scrollTop.value / rowH.value) - overscanBefore),
  )

  const end = computed(() =>
    Math.min(rowCount.value, start.value + Math.ceil(viewH.value / rowH.value) + overscanAfter),
  )

  return { scroller, scrollTop, viewH, start, end, onScroll, measure }
}
