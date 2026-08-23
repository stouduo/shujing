import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { useAppStore } from './stores/app'
import './styles.css'

// Tauri 窗口里才需要给红绿灯让位(overlay 标题栏),浏览器预览不留空
if ('__TAURI_INTERNALS__' in window) {
  document.documentElement.classList.add('in-tauri')
}

const pinia = createPinia()
const app = createApp(App).use(pinia)

// 全局错误兜底:组件异常时记录并保留界面,避免整页白屏
app.config.errorHandler = (err, _instance, info) => {
  console.error('[数镜]', info, err)
}

// 关闭/刷新前兜底保存会话
window.addEventListener('beforeunload', () => {
  useAppStore(pinia).saveSession()
})

// 未捕获的 Promise 异常不静默
window.addEventListener('unhandledrejection', (e) => {
  console.error('[数镜] unhandled rejection:', e.reason)
})

app.mount('#app')

// 开发期:HMR 热替换组件会丢失进行中的异步回调(表现为永久 loading),
// 一律整页刷新,状态由会话持久化恢复
if (import.meta.hot) {
  import.meta.hot.on('vite:afterUpdate', () => window.location.reload())
}
