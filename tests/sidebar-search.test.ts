import { describe, expect, it } from 'vitest'
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from '../src/App.vue'
import { useAppStore } from '../src/stores/app'

/**
 * 用户报告:侧栏搜索(列表上面的查询)删除关键词后列表不恢复、刷新无效。
 * 此测试复现完整链:展开连接 → 搜索过滤 → 清空 → 断言列表恢复全量。
 */
describe('侧栏搜索清空后列表恢复', () => {
  it('清空搜索词后表列表恢复全量', async () => {
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

    // 展开示例 SQLite 连接(单库路径)
    ;(el.querySelector('.conn') as any)?.__vueParentComponent?.setupState
    // 通过组件实例展开不可靠,直接调 store 连接 + 手动设置展开状态
    await store.connect('mock-sqlite')

    // 模拟用户点击连接行展开(事件冒泡到 .row 的 @click=toggle)
    ;(el.querySelector('.conn .row') as HTMLElement).dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    )
    await new Promise((r) => setTimeout(r, 300))

    const names = () =>
      [...el.querySelectorAll('.conn .tbl .tbl-name')].map((t) => t.textContent?.trim())
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

  it('多库:展开库内搜索清空后恢复,刷新后仍正常', async () => {
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
    await store.init()
    await new Promise((r) => setTimeout(r, 200))
    await store.connect('mock-mysql')

    // 点击 MySQL 连接行展开(触发 loadDatabases)
    const mysqlRow = [...el.querySelectorAll('.conn .row')].find((r) =>
      r.textContent?.includes('示例 · MySQL'),
    ) as HTMLElement
    mysqlRow.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 400))
    // 点击第一个库行展开(expandDb)
    const dbRow = el.querySelector('.db-row') as HTMLElement
    expect(dbRow, '库列表已渲染').toBeTruthy()
    dbRow.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 400))

    const names = () =>
      [...el.querySelectorAll('.conn .tbl .tbl-name')].map((t) => t.textContent?.trim())
    const all = names()
    expect(all.length).toBeGreaterThan(0)

    store.tableFilter = 'user'
    await new Promise((r) => setTimeout(r, 200))
    const filtered = names()
    store.tableFilter = ''
    await new Promise((r) => setTimeout(r, 200))
    const restored = names()
    expect(restored.length).toBe(all.length)

    // 刷新表列表:再次点击库行(折叠)再点击(展开重拉)
    ;(el.querySelector('.db-row') as HTMLElement).dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    )
    await new Promise((r) => setTimeout(r, 200))
    ;(el.querySelector('.db-row') as HTMLElement).dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    )
    await new Promise((r) => setTimeout(r, 400))
    const afterRefresh = names()
    expect(afterRefresh.length).toBe(all.length)
    app.unmount()
  })
})
