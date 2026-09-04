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

describe('侧栏搜索:多库', () => {
  it('多库:展开库内搜索清空后恢复,刷新后仍正常', { retry: 2, timeout: 15000 }, async () => {
    const el = document.createElement('div')
    el.id = 'app2'
    document.body.appendChild(el)
    const app = createApp(App)
    app.config.errorHandler = (err) => {
      throw err
    }
    const pinia = createPinia()
    app.use(pinia)
    app.mount(el)
    const store = useAppStore(pinia)
    expect(
      await waitFor(() => !!el.querySelector('.conn .row')),
      '连接列表渲染',
    ).toBe(true)
    await store.connect('mock-mysql')

    // 点击 MySQL 连接行展开(触发 loadDatabases)
    const mysqlRow = [...el.querySelectorAll('.conn .row')].find((r) =>
      r.textContent?.includes('示例 · MySQL'),
    ) as HTMLElement
    mysqlRow.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(await waitFor(() => !!el.querySelector('.db-row')), '库列表已渲染').toBe(true)
    const names = () =>
      [...el.querySelectorAll('.conn .tbl .tbl-name')].map((t) => t.textContent?.trim())
    // loadDatabases 完成后会自动展开默认库并拉取表列表,直接等待
    expect(await waitFor(() => names().length > 0), '默认库自动展开并渲染表列表').toBe(true)

    const all = names()
    expect(all.length).toBeGreaterThan(0)

    store.tableFilter = 'user'
    await new Promise((r) => setTimeout(r, 200))
    const filtered = names()
    store.tableFilter = ''
    expect(await waitFor(() => names().length === all.length), '清空后恢复全量').toBe(true)
    const restored = names()
    expect(restored.length).toBe(all.length)

    // 刷新表列表:折叠再展开当前库(重新拉取)
    const expandedRow = [...el.querySelectorAll('.db-row')].find((r) =>
      r.className.includes('active'),
    ) as HTMLElement
    expect(expandedRow, '存在展开中的库').toBeTruthy()
    expandedRow.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 150))
    expandedRow.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(await waitFor(() => names().length === all.length), '重新拉取后仍完整').toBe(true)
    const afterRefresh = names()
    expect(afterRefresh.length).toBe(all.length)
    app.unmount()
  })

})
