<script setup lang="ts">
import { computed, onMounted, onUnmounted, provide, ref, watch } from 'vue'
import {
  NConfigProvider,
  NDialogProvider,
  NMessageProvider,
  darkTheme,
  type GlobalThemeOverrides,
} from 'naive-ui'
import SideBar from './components/SideBar.vue'
import ConnectionModal from './components/ConnectionModal.vue'
import ImportCsvModal from './components/ImportCsvModal.vue'
import QuickOpen from './components/QuickOpen.vue'
import MessageBridge from './components/MessageBridge.vue'
import GlobalSearchModal from './components/GlobalSearchModal.vue'
import EditorTab from './components/EditorTab.vue'
import Icon from './components/Icon.vue'
import { useAppStore } from './stores/app'
import { paneOf } from './panes/registry'
import type { ConnInfo, IconName, Tab } from './types'

const store = useAppStore()
const showConnModal = ref(false)
const editingConn = ref<ConnInfo | null>(null)
const showImport = ref(false)
const importConnId = ref<string | null>(null)
const showQuickOpen = ref(false)
const pinnedTabs = ref<Set<string>>(new Set())

function togglePin(id: string) {
  if (pinnedTabs.value.has(id)) pinnedTabs.value.delete(id)
  else pinnedTabs.value.add(id)
  // 触发响应式
  pinnedTabs.value = new Set(pinnedTabs.value)
}
const showGlobalSearch = ref(false)

// ── 主题 ──────────────────────────────────────────────
// 主题:手动选择 > 系统跟随
const getInitialTheme = (): 'dark' | 'light' => {
  const saved = localStorage.getItem('dblens_theme')
  if (saved === 'light' || saved === 'dark') return saved
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}
const theme = ref<'dark' | 'light'>(getInitialTheme())

// 监听系统主题变化(仅未手动选择时)
const themeAuto = ref(!localStorage.getItem('dblens_theme'))
if (themeAuto.value) {
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', (e) => {
    if (themeAuto.value) {
      theme.value = e.matches ? 'light' : 'dark'
      applyTheme()
    }
  })
}

function applyTheme() {
  document.documentElement.classList.toggle('light', theme.value === 'light')
}

function toggleTheme() {
  themeAuto.value = false
  theme.value = theme.value === 'dark' ? 'light' : 'dark'
  localStorage.setItem('dblens_theme', theme.value)
  applyTheme()
}

applyTheme()
provide('theme', theme)

// 标签页右键菜单
const tabCtx = ref({ show: false, x: 0, y: 0, id: '' })

function openTabCtx(e: MouseEvent, id: string) {
  e.preventDefault()
  tabCtx.value = { show: true, x: e.clientX, y: e.clientY, id }
}

function closeOthers(id: string) {
  for (const t of [...store.tabs]) {
    if (t.id !== id) {
      const i = store.tabs.indexOf(t)
      if (i >= 0) store.tabs.splice(i, 1)
    }
  }
  store.activeTabId = id
}

function closeRight(id: string) {
  const idx = store.tabs.findIndex((t) => t.id === id)
  const removed = store.tabs.slice(idx + 1)
  store.tabs.splice(idx + 1)
  if (removed.some((t) => t.id === store.activeTabId)) store.activeTabId = id
}

function openImport(connId: string) {
  importConnId.value = connId
  showImport.value = true
}

onMounted(() => {
  store.init()
  window.addEventListener('keydown', onKeydown)
})

const showKeys = ref(false)

// 标签重命名(双击)
const renamingId = ref('')
const renameDraft = ref('')

function startRename(id: string, title: string) {
  renamingId.value = id
  renameDraft.value = title
}

function commitRename() {
  const t = store.tabs.find((x) => x.id === renamingId.value)
  if (t && renameDraft.value.trim()) t.title = renameDraft.value.trim()
  renamingId.value = ''
}

const SHORTCUTS: [string, string, string][] = [
  ['全局', '⌘P', '快速查询(找表 / 筛数据 / 跑 SQL)'],
  ['全局', '⌘⇧F', '全局数据搜索'],
  ['全局', '⌘T / ⌘W', '新建 / 关闭标签(中键关闭)'],
  ['全局', 'F5', '刷新当前表 / 重跑查询'],
  ['SQL 编辑器', '⌘↵', '运行(有选区只执行选中)'],
  ['SQL 编辑器', '⌘/', '注释切换'],
  ['表格编辑', '双击', '编辑单元格'],
  ['表格编辑', '⌥↵', '多行文本编辑'],
  ['表格编辑', 'Tab / ⇧Tab', '提交并编辑右 / 左一列'],
  ['表格编辑', 'Enter / Esc', '提交 / 取消'],
  ['表格', '点表头', '排序(升→降→取消)'],
  ['表格', '拖列头右缘', '调整列宽(按表记忆)'],
  ['表格', '右键', '单元格/列头/行 多种操作'],
  ['ER 图', '拖节点 / 滚轮 / 拖空白', '移动 / 缩放 / 平移'],
]
onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
})

const activeTab = computed<Tab | undefined>(() =>
  store.tabs.find((t) => t.id === store.activeTabId),
)

// 窗口标题跟随当前标签
watch(
  activeTab,
  (t) => {
    document.title = t ? `${t.title} · 数镜` : '数镜'
  },
  { immediate: true },
)

const activeConn = computed(() => store.connById(activeTab.value?.connId ?? ''))

const statusLeft = computed(() => {
  if (!activeConn.value) return '未选择连接'
  const live = activeConn.value.id ? store.live[activeConn.value.id] : undefined
  const parts = [activeConn.value.name, activeConn.value.dbType]
  if (live) {
    parts.push(live.version.split(',')[0])
    return { text: parts.join(' · '), online: true }
  }
  return { text: parts.join(' · ') + ' · 未连接', online: false }
})

// 标签图标由 Pane Registry 提供(新增面板类型自动生效)
const tabIconOf = (kind: string): IconName => paneOf(kind)?.icon ?? 'code'

// ── 全局快捷键 ────────────────────────────────────────
function onKeydown(e: KeyboardEvent) {
  const mod = e.metaKey || e.ctrlKey
  if (mod && e.key.toLowerCase() === 't') {
    e.preventDefault()
    store.openQueryTab()
  } else if (mod && e.key.toLowerCase() === 'p') {
    e.preventDefault()
    showQuickOpen.value = !showQuickOpen.value
  } else if (mod && e.shiftKey && e.key.toLowerCase() === 'f') {
    e.preventDefault()
    showGlobalSearch.value = !showGlobalSearch.value
  } else if (mod && e.key.toLowerCase() === 'w') {
    e.preventDefault()
    if (store.activeTabId && !pinnedTabs.value.has(store.activeTabId)) {
      store.closeTab(store.activeTabId)
    }
  } else if (mod && /^[1-9]$/.test(e.key)) {
    e.preventDefault()
    const t = store.tabs[Number(e.key) - 1]
    if (t) store.activeTabId = t.id
  } else if (mod && e.key.toLowerCase() === 'f') {
    // ⌘F:结果内搜索(委托给当前面板的 grid)
    // 通过自定义事件让各面板响应
    window.dispatchEvent(new CustomEvent('result-search'))
    e.preventDefault()
  } else if (e.key === '?' && !mod) {
    // 仅在非输入框时触发
    const tag = (e.target as HTMLElement)?.tagName
    if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') {
      e.preventDefault()
      showKeys.value = !showKeys.value
    }
  } else if (e.key === 'F5') {
    e.preventDefault()
    const t = activeTab.value
    if (!t) return
    if (t.kind === 'table') {
      store.loadTableData(t.id)
      store.loadTableCount(t.id)
    } else if (t.kind === 'query') {
      if (t.connId) store.runQuery(t.id)
    }
  }
}

const themeOverrides = computed<GlobalThemeOverrides>(() =>
  theme.value === 'dark'
    ? {
        common: {
          primaryColor: '#0A84FF',
          primaryColorHover: '#409CFF',
          primaryColorPressed: '#086CD9',
          primaryColorSuppl: '#0A84FF',
          borderRadius: '8px',
          borderRadiusSmall: '6px',
          cardColor: '#232327',
          modalColor: '#242429',
          popoverColor: '#2A2A2E',
          inputColor: 'rgba(255, 255, 255, 0.055)',
          borderColor: 'rgba(255, 255, 255, 0.11)',
          textColor1: '#F5F5F7',
          textColor2: '#D5D5DA',
          textColor3: '#8E8E93',
        },
        Card: { borderRadius: '14px' },
        Dialog: { borderRadius: '14px' },
      }
    : {
        common: {
          primaryColor: '#0071E3',
          primaryColorHover: '#3D8FE8',
          primaryColorPressed: '#005DBB',
          primaryColorSuppl: '#0071E3',
          borderRadius: '8px',
          borderRadiusSmall: '6px',
          cardColor: '#FFFFFF',
          modalColor: '#FFFFFF',
          popoverColor: '#FFFFFF',
          inputColor: 'rgba(0, 0, 0, 0.045)',
          borderColor: 'rgba(0, 0, 0, 0.13)',
          textColor1: '#1D1D1F',
          textColor2: '#3A3A40',
          textColor3: '#86868B',
        },
        Card: { borderRadius: '14px' },
        Dialog: { borderRadius: '14px' },
      },
)

function openCreate() {
  editingConn.value = null
  showConnModal.value = true
}

function openEdit(info: ConnInfo) {
  editingConn.value = info
  showConnModal.value = true
}
</script>

<template>
  <n-config-provider :theme="theme === 'dark' ? darkTheme : null" :theme-overrides="themeOverrides" style="height: 100%">
    <n-message-provider>
      <MessageBridge />
      <n-dialog-provider>
        <div class="app-shell">
          <SideBar
            @new-connection="openCreate"
            @edit-connection="openEdit"
            @import-csv="openImport"
            @quick-open="showQuickOpen = true"
            @global-search="showGlobalSearch = true"
          />
          <div class="app-main">
            <div class="tabbar" data-tauri-drag-region>
              <div class="tabs" role="tablist">
                <div
                  v-for="t in store.tabs"
                  :key="t.id"
                  class="tab"
                  :class="{ active: t.id === store.activeTabId }"
                  role="tab"
                  :aria-selected="t.id === store.activeTabId"
                  :title="t.title"
                  @click="store.activeTabId = t.id"
                  @mousedown.middle.prevent="store.closeTab(t.id)"
                  @contextmenu.prevent="openTabCtx($event, t.id)"
                >
                  <Icon :name="tabIconOf(t.kind)" :size="12" class="tab-icon" />
                  <input
                    v-if="renamingId === t.id"
                    v-model="renameDraft"
                    class="tab-rename"
                    @keyup.enter="commitRename"
                    @blur="commitRename"
                    @click.stop
                    @mousedown.stop
                  />
                  <span v-else class="tab-title" @dblclick.stop="startRename(t.id, t.title)">{{ t.title }}</span>
                  <button
                    class="tab-pin"
                    :class="{ pinned: pinnedTabs.has(t.id) }"
                    :title="pinnedTabs.has(t.id) ? '取消固定' : '固定标签(⌘W 不关闭)'"
                    @click.stop="togglePin(t.id)"
                  >
                    <Icon :name="pinnedTabs.has(t.id) ? 'eye' : 'search'" :size="10" />
                  </button>
                  <button class="tab-close" title="关闭 (⌘W)" @click.stop="!pinnedTabs.has(t.id) && store.closeTab(t.id)">
                    <Icon name="x" :size="11" />
                  </button>
                </div>
              </div>
              <button class="tab-add" title="新建查询 (⌘T)" @click="store.openQueryTab()">
                <Icon name="plus" :size="14" />
              </button>
              <div class="tabbar-spacer" data-tauri-drag-region />
            </div>
            <div v-if="activeTab" class="tab-content">
              <EditorTab :key="activeTab.id" :tab="activeTab" />
            </div>
            <div v-else class="welcome" data-tauri-drag-region>
              <div class="logo"><Icon name="database" :size="30" /></div>
              <div class="welcome-title">开始使用 数镜</div>
              <div class="welcome-sub">
                按 <span class="kbd">⌘T</span> 新建查询,或点击左侧连接浏览数据
              </div>
            </div>
            <div class="statusbar" data-tauri-drag-region>
              <button class="theme-toggle" :title="theme === 'dark' ? '切换到亮色' : '切换到暗色'" @click="toggleTheme">
                <Icon name="sun" :size="12" />
              </button>
              <div class="status-left">
                <span v-if="typeof statusLeft === 'object'" class="status-dot" :class="{ on: statusLeft.online }" />
                <span>{{ typeof statusLeft === 'object' ? statusLeft.text : statusLeft }}</span>
              </div>
              <button class="keys-hint-btn" title="快捷键(?)" @click="showKeys = true">
                <span class="kbd">?</span>
              </button>
            </div>
          </div>
        </div>
        <ConnectionModal v-model:show="showConnModal" :editing="editingConn" />
        <ImportCsvModal v-model:show="showImport" :conn-id="importConnId" />
        <n-dropdown
          trigger="manual"
          :show="tabCtx.show"
          :x="tabCtx.x"
          :y="tabCtx.y"
          :options="[
            { label: '关闭', key: 'close' },
            { label: '关闭其他', key: 'others' },
            { label: '关闭右侧', key: 'right' },
          ]"
          placement="bottom-start"
          @select="(k: string | number) => {
            const id = tabCtx.id
            tabCtx.show = false
            if (k === 'close') store.closeTab(id)
            else if (k === 'others') closeOthers(id)
            else if (k === 'right') closeRight(id)
          }"
          @clickoutside="tabCtx.show = false"
        />
        <n-modal :show="showKeys" preset="card" title="快捷键" :style="{ width: '560px' }" @update:show="(v: boolean) => (showKeys = v)">
          <div class="keys-table">
            <div v-for="g in SHORTCUTS" :key="g[1]" class="keys-row">
              <span class="keys-group">{{ g[0] }}</span>
              <span class="keys-kbd kbd">{{ g[1] }}</span>
              <span class="keys-desc">{{ g[2] }}</span>
            </div>
          </div>
        </n-modal>
        <QuickOpen v-model:show="showQuickOpen" />
        <GlobalSearchModal v-model:show="showGlobalSearch" />
      </n-dialog-provider>
    </n-message-provider>
  </n-config-provider>
</template>

<style scoped>
.statusbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 26px;
  padding: 0 14px;
  background: var(--bg-sidebar);
  border-top: 1px solid var(--border);
  color: var(--text-tertiary);
  font-size: 11px;
  flex-shrink: 0;
  user-select: none;
}
.status-left {
  display: flex;
  align-items: center;
  gap: 7px;
}
.status-right {
  display: flex;
  align-items: center;
  gap: 5px;
}
.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #48484a;
}
.keys-hint-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  cursor: pointer;
  padding: 2px 4px;
  border-radius: 4px;
}
.keys-hint-btn:hover {
  background: var(--bg-hover);
}
.status-dot.on {
  background: var(--green);
}
.theme-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 18px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
}
.theme-toggle:hover {
  color: var(--warn);
  background: var(--bg-hover);
}
.keys-table {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.keys-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 8px;
  border-radius: 7px;
}
.keys-row:hover {
  background: var(--bg-hover);
}
.keys-group {
  width: 76px;
  flex-shrink: 0;
  font-size: 11px;
  color: var(--text-tertiary);
}
.keys-kbd {
  width: 110px;
  flex-shrink: 0;
  text-align: center;
}
.keys-desc {
  font-size: 12.5px;
  color: var(--text-secondary);
}
.tab-icon {
  opacity: 0.7;
}
.tab-rename {
  width: 110px;
  height: 20px;
  border: 1px solid var(--accent);
  border-radius: 4px;
  background: var(--input-bg);
  color: var(--text);
  font-size: 12.5px;
  padding: 0 5px;
  outline: none;
}
.tab-pin {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  color: var(--text-tertiary);
  cursor: pointer;
  padding: 0 2px;
}
.tab:hover .tab-pin, .tab-pin.pinned {
  opacity: 1;
}
.tab-pin.pinned {
  color: var(--accent);
}
.tab-pin:hover {
  color: var(--accent);
}
.tab-pin.pinned + .tab-close {
  display: none;
}
.tab-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.welcome-title {
  font-size: 17px;
  font-weight: 700;
  color: var(--text-secondary);
  letter-spacing: 0.2px;
}
.welcome-sub {
  font-size: 12.5px;
  color: var(--text-tertiary);
  display: flex;
  align-items: center;
  gap: 4px;
}
</style>
