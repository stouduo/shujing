<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, provide, ref, watch } from 'vue'
import {
  NConfigProvider,
  NDialogProvider,
  NDropdown,
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

// ── 侧栏宽度:默认约为窗口宽度的 20%,分隔条可拖动,记忆到 localStorage ──
const sidebarW = ref(
  clampSidebarW(Number(localStorage.getItem('dblens_sidebar_w')) || Math.round(window.innerWidth * 0.2)),
)
let splitDrag: { x: number; w: number } | null = null

function clampSidebarW(w: number): number {
  return Math.min(520, Math.max(150, w))
}
function startSplit(e: PointerEvent) {
  splitDrag = { x: e.clientX, w: sidebarW.value }
  ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
  e.preventDefault()
}
function onSplitMove(e: PointerEvent) {
  if (!splitDrag) return
  sidebarW.value = clampSidebarW(splitDrag.w + e.clientX - splitDrag.x)
}
function endSplit() {
  if (!splitDrag) return
  splitDrag = null
  try {
    localStorage.setItem('dblens_sidebar_w', String(sidebarW.value))
  } catch {
    /* 忽略 */
  }
}

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
const showKeys = ref(false)
provide('toggleTheme', toggleTheme)
provide('showKeys', showKeys)

// 标签页右键菜单
const tabCtx = ref({ show: false, x: 0, y: 0, id: '' })

function openTabCtx(e: MouseEvent, id: string) {
  e.preventDefault()
  tabCtx.value = { show: true, x: e.clientX, y: e.clientY, id }
}

// 标签右键:document 捕获阶段绑定,避免被子层拦截
const tabsEl = ref<HTMLElement | null>(null)
function onTabsContextmenu(e: MouseEvent) {
  const el = (e.target as HTMLElement)?.closest?.('.tab[data-tab-id]')
  if (!el) return
  openTabCtx(e, (el as HTMLElement).dataset.tabId as string)
}

// ── 标签溢出:滚轮横滚 + 全部标签列表 ─────────────────
function onTabsWheel(e: WheelEvent) {
  const el = tabsEl.value
  if (!el) return
  if (Math.abs(e.deltaY) >= Math.abs(e.deltaX)) {
    el.scrollLeft += e.deltaY
    e.preventDefault()
  }
}

// 激活标签自动滚入视野
watch(
  () => store.activeTabId,
  async (id) => {
    if (!id) return
    await nextTick()
    tabsEl.value
      ?.querySelector(`.tab[data-tab-id="${id}"]`)
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  },
)

const tabListShow = ref(false)
const tabListPos = ref({ x: 0, y: 0 })
const tabListOptions = computed(() =>
  store.tabs.map((t) => ({
    label: (t.id === store.activeTabId ? '● ' : '') + t.title,
    key: t.id,
  })),
)
function openTabList(e: MouseEvent) {
  tabListPos.value = { x: e.clientX, y: e.clientY }
  tabListShow.value = !tabListShow.value
}

function closeOthers(id: string) {
  for (const t of [...store.tabs]) {
    // 固定的标签保持不动
    if (t.id !== id && !pinnedTabs.value.has(t.id)) {
      const i = store.tabs.indexOf(t)
      if (i >= 0) store.tabs.splice(i, 1)
    }
  }
  store.activeTabId = id
}

function closeRight(id: string) {
  const idx = store.tabs.findIndex((t) => t.id === id)
  for (const t of store.tabs.slice(idx + 1)) {
    if (pinnedTabs.value.has(t.id)) continue
    const i = store.tabs.indexOf(t)
    if (i >= 0) store.tabs.splice(i, 1)
  }
  if (!store.tabs.some((t) => t.id === store.activeTabId)) store.activeTabId = id
}

function closeLeft(id: string) {
  const idx = store.tabs.findIndex((t) => t.id === id)
  if (idx <= 0) return
  for (const t of store.tabs.slice(0, idx)) {
    if (pinnedTabs.value.has(t.id)) continue
    const i = store.tabs.indexOf(t)
    if (i >= 0) store.tabs.splice(i, 1)
  }
  if (!store.tabs.some((t) => t.id === store.activeTabId)) store.activeTabId = id
}

// ── 标签拖拽排序 ──────────────────────────────────────
const dragTabId = ref('')
function onTabDragStart(e: DragEvent, id: string) {
  dragTabId.value = id
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', id)
  }
}
function onTabDrop(e: DragEvent, targetId: string) {
  e.preventDefault()
  const src = dragTabId.value
  if (!src || src === targetId) return
  const from = store.tabs.findIndex((t) => t.id === src)
  const to = store.tabs.findIndex((t) => t.id === targetId)
  if (from < 0 || to < 0 || from === to) return
  const [moved] = store.tabs.splice(from, 1)
  store.tabs.splice(to, 0, moved)
  dragTabId.value = ''
}

function openImport(connId: string) {
  importConnId.value = connId
  showImport.value = true
}

// ── 输入框关闭首字母自动大写/自动纠正/拼写检查(WebKit 默认行为对 DB 工具是干扰) ──
function tameOne(el: Element) {
  el.setAttribute('autocapitalize', 'none')
  el.setAttribute('autocorrect', 'off')
  el.setAttribute('spellcheck', 'false')
}
function tameInputs(scope: ParentNode) {
  if (!(scope instanceof Element)) return
  scope.querySelectorAll('input, textarea, [contenteditable="true"]').forEach(tameOne)
}
let tameScheduled = false
const tameObserver = new MutationObserver((muts) => {
  if (tameScheduled) return
  tameScheduled = true
  requestAnimationFrame(() => {
    tameScheduled = false
    for (const m of muts) {
      m.addedNodes.forEach((n) => {
        if (n instanceof HTMLElement) {
          if (n.matches('input, textarea')) tameOne(n)
          else tameInputs(n)
        }
      })
    }
  })
})

onMounted(() => {
  store.init()
  window.addEventListener('keydown', onKeydown)
  tameInputs(document.body)
  tameObserver.observe(document.body, { childList: true, subtree: true })
  document.addEventListener('contextmenu', onTabsContextmenu, true)
})

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

interface ShortcutGroup {
  label: string
  items: [string, string][]
}

const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    label: '全局',
    items: [
      ['⌘P', '快速查询'],
      ['⌘⇧F', '全局数据搜索'],
      ['⌘T / ⌘W', '新建 / 关闭标签'],
      ['⌘1-9', '切换到第 N 个标签'],
      ['F5', '刷新 / 重跑'],
    ],
  },
  {
    label: '编辑器',
    items: [
      ['⌘↵', '运行(选中优先)'],
      ['⌘/', '注释切换'],
      ['⌘F', '搜索替换'],
    ],
  },
  {
    label: '表格',
    items: [
      ['双击', '编辑单元格'],
      ['⌥↵', '多行编辑'],
      ['⇥ / ⇧⇥', '左 / 右移动'],
      ['↑↓←→', '导航'],
      ['⌘C', '复制当前单元格'],
      ['⌘F', '结果内搜索(↵ 定位)'],
      ['右键', '更多操作'],
    ],
  },
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
          primaryColor: '#8587F6',
          primaryColorHover: '#9B9DF8',
          primaryColorPressed: '#6E70E8',
          primaryColorSuppl: '#8587F6',
          borderRadius: '8px',
          borderRadiusSmall: '6px',
          cardColor: '#141518',
          modalColor: '#17181B',
          popoverColor: '#1B1C20',
          inputColor: 'rgba(255, 255, 255, 0.05)',
          borderColor: 'rgba(255, 255, 255, 0.12)',
          textColor1: '#F4F4F5',
          textColor2: '#C9C9CF',
          textColor3: '#77787F',
        },
        Card: { borderRadius: '12px' },
        Dialog: { borderRadius: '12px' },
      }
    : {
        common: {
          primaryColor: '#5B5BD6',
          primaryColorHover: '#6E6FE0',
          primaryColorPressed: '#4A4AC4',
          primaryColorSuppl: '#5B5BD6',
          borderRadius: '8px',
          borderRadiusSmall: '6px',
          cardColor: '#FFFFFF',
          modalColor: '#FFFFFF',
          popoverColor: '#FFFFFF',
          inputColor: 'rgba(0, 0, 0, 0.04)',
          borderColor: 'rgba(0, 0, 0, 0.12)',
          textColor1: '#18181B',
          textColor2: '#3F3F46',
          textColor3: '#8A8A93',
        },
        Card: { borderRadius: '12px' },
        Dialog: { borderRadius: '12px' },
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
          <!-- 多根组件不吃属性透传,宽度套在宿主容器上 -->
          <div class="sidebar-host" :style="{ width: sidebarW + 'px' }">
            <SideBar
              @new-connection="openCreate"
              @edit-connection="openEdit"
              @import-csv="openImport"
              @quick-open="showQuickOpen = true"
              @global-search="showGlobalSearch = true"
            />
          </div>
          <div
            class="splitter"
            title="拖动调整侧栏宽度"
            @pointerdown="startSplit"
            @pointermove="onSplitMove"
            @pointerup="endSplit"
            @pointercancel="endSplit"
          />
          <div class="app-main">
            <div class="tabbar" data-tauri-drag-region>
              <div
                class="tabs"
                role="tablist"
                ref="tabsEl"
                @contextmenu.capture="onTabsContextmenu"
                @wheel="onTabsWheel"
              >
                <div
                  v-for="t in store.tabs"
                  :key="t.id"
                  class="tab"
                  :data-tab-id="t.id"
                  :class="{ active: t.id === store.activeTabId }"
                  role="tab"
                  :aria-selected="t.id === store.activeTabId"
                  :title="t.title"
                  draggable="true"
                  @click="store.activeTabId = t.id"
                  @mousedown.middle.prevent="store.closeTab(t.id)"
                  @dragstart="onTabDragStart($event, t.id)"
                  @dragover.prevent
                  @drop="onTabDrop($event, t.id)"
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
              <button class="tab-list-btn" title="全部标签" @click.stop="openTabList($event)">
                <Icon name="chevronDown" :size="12" />
              </button>
              <button class="tab-add" title="新建查询 (⌘T)" @click="store.openQueryTab()">
                <Icon name="plus" :size="14" />
              </button>
              <div class="tabbar-spacer" data-tauri-drag-region />
            </div>
            <div v-if="activeTab" class="tab-content" :key="activeTab.id">
              <!-- KeepAlive:切换标签不销毁重建,滚动位置/编辑态保留(最多缓存 12 个) -->
              <KeepAlive :max="12">
                <EditorTab :key="activeTab.id" :tab="activeTab" />
              </KeepAlive>
            </div>
            <div v-else class="welcome" data-tauri-drag-region>
              <div class="logo"><Icon name="database" :size="30" /></div>
              <div class="welcome-title">开始使用 数镜</div>
              <div class="welcome-sub">
                按 <span class="kbd">⌘T</span> 新建查询,或点击左侧连接浏览数据
              </div>
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
            { label: pinnedTabs.has(tabCtx.id) ? '关闭(已固定,先取消固定)' : '关闭', key: 'close', disabled: pinnedTabs.has(tabCtx.id) },
            { label: '关闭左侧', key: 'left' },
            { label: '关闭右侧', key: 'right' },
            { label: '关闭其他', key: 'others' },
          ]"
          placement="bottom-start"
          @select="(k: string | number) => {
            const id = tabCtx.id
            tabCtx.show = false
            if (k === 'close') store.closeTab(id)
            else if (k === 'left') closeLeft(id)
            else if (k === 'right') closeRight(id)
            else if (k === 'others') closeOthers(id)
          }"
          @clickoutside="tabCtx.show = false"
        />
        <n-dropdown
          trigger="manual"
          :show="tabListShow"
          :x="tabListPos.x"
          :y="tabListPos.y"
          :options="tabListOptions"
          placement="bottom-start"
          @select="(k: string | number) => {
            tabListShow = false
            store.activeTabId = String(k)
          }"
          @clickoutside="tabListShow = false"
        />
        <Teleport to="body">
          <div v-if="showKeys" class="keys-overlay" @click.self="showKeys = false">
            <div class="keys-popup">
              <div class="keys-popup-head">
                <span class="keys-popup-title">快捷键</span>
                <span class="keys-esc"><span class="kbd">Esc</span> 关闭</span>
                <button class="keys-popup-close" @click="showKeys = false">×</button>
              </div>
              <div class="keys-grid">
                <div v-for="g in SHORTCUT_GROUPS" :key="g.label" class="keys-group">
                  <div class="keys-group-title">{{ g.label }}</div>
                  <div v-for="item in g.items" :key="item[1]" class="keys-item">
                    <span class="keys-desc">{{ item[1] }}</span>
                    <span class="keys-keys">
                      <span v-for="k in item[0].split(' / ')" :key="k" class="kbd">{{ k }}</span>
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </Teleport>
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
.keys-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(5px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
}
.keys-popup {
  width: 640px;
  background: var(--bg-elevated, #222226);
  border: 1px solid var(--border-strong, rgba(255, 255, 255, 0.13));
  border-radius: 16px;
  box-shadow: 0 24px 70px rgba(0, 0, 0, 0.55);
  padding: 18px 22px 20px;
}
.keys-popup-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 14px;
}
.keys-popup-title {
  font-size: 15px;
  font-weight: 700;
  margin-right: auto;
}
.keys-esc {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--text-tertiary);
}
.keys-popup-close {
  border: none;
  background: transparent;
  color: var(--text-tertiary);
  font-size: 18px;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 6px;
}
.keys-popup-close:hover {
  color: var(--text);
  background: var(--bg-hover);
}
.keys-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-auto-flow: column;
  grid-template-rows: repeat(2, auto);
  column-gap: 32px;
  row-gap: 20px;
}
.keys-group {
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.keys-group-title {
  font-size: 10.5px;
  font-weight: 700;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 1.2px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 3px;
}
.keys-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 4px 6px;
  border-radius: 6px;
}
.keys-item:hover {
  background: var(--bg-hover);
}
.keys-desc {
  font-size: 12px;
  color: var(--text-secondary);
}
.keys-keys {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}
.keys-popup .kbd,
.keys-esc .kbd {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 22px;
  height: 21px;
  padding: 0 7px;
  border: 1px solid var(--border-strong);
  border-bottom-width: 2px;
  border-radius: 6px;
  background: var(--bg-hover, rgba(255, 255, 255, 0.05));
  color: var(--text);
  font-family: var(--mono);
  font-size: 11px;
  line-height: 1;
  white-space: nowrap;
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
