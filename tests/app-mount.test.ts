import { describe, expect, it } from 'vitest'
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from '../src/App.vue'

describe('App 挂载冒烟', () => {
  it('mount 后渲染出应用骨架', async () => {
    const el = document.createElement('div')
    el.id = 'app'
    document.body.appendChild(el)
    const app = createApp(App)
    app.config.errorHandler = (err) => { throw err }
    app.use(createPinia())
    app.mount(el)
    await new Promise((r) => setTimeout(r, 50))
    expect(el.innerHTML).toContain('app-shell')
    expect(el.textContent).toContain('数镜')
  })
})
