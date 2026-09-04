import { describe, expect, it } from 'vitest'
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from '../src/App.vue'
import { useAppStore } from '../src/stores/app'

/**
 * 用户报告:侧栏搜索(列表上面的查询)删除关键词后列表不恢复、刷新无效。
 * 此测试复现完整链:展开连接 → 搜索过滤 → 清空 → 断言列表恢复全量。
 */
async function waitFor(fn: () => boolean, timeout = 4000): Promise<boolean> {
  const t0 = Date.now()
  while (Date.now() - t0 < timeout) {
    if (fn()) return true
    await new Promise((r) => setTimeout(r, 50))
  }
  return false
}

describe('侧栏搜索:单库', () => {
  it('清空搜索词后表列表恢复全量', { retry: 2, timeout: 15000 }, async () => {
    const el = document.createElement('div')
    el.id = 'app'
    document.body.appendChild(el)
    const app = createApp(App)
    app.config.errorHandler = (err) => {
      throw err
    }
    const pinia = createPinia()
    app.use(pinia)
    app.mount(el)
    const store = useAppStore(pinia)
    await new Promise((r) => setTimeout(r, 120))

    // 等连接列表渲染(loadSaved 带 mock 延迟,并行跑时更慢)
    expect(await waitFor(() => !!el.querySelector('.conn .row')), '连接列表渲染').toBe(true)

    // 展开示例 SQLite 连接(单库路径)
    await store.connect('mock-sqlite')

    const names = () =>
      [...el.querySelectorAll('.conn .tbl .tbl-name')].map((t) => t.textContent?.trim())

    // 模拟用户点击连接行展开(事件冒泡到 .row 的 @click=toggle)
    ;(el.querySelector('.conn .row') as HTMLElement).dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    )
    expect(await waitFor(() => names().length > 0), '展开后表列表渲染').toBe(true)

    const all = names()
    expect(all.length).toBeGreaterThan(0)

    // 搜索过滤
    store.tableFilter = 'or'
    await new Promise((r) => setTimeout(r, 120))
    const filtered = names()
    expect(filtered.join(',')).toContain('orders')

    // 清空搜索 → 恢复全量
    store.tableFilter = ''
    await new Promise((r) => setTimeout(r, 120))
    const restored = names()
    expect(restored.length).toBe(all.length)
    app.unmount()
  })


})
