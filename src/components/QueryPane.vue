<script setup lang="ts">
import { computed, defineAsyncComponent, inject, ref, watch } from 'vue'
import { NButton, NDropdown, NInput, NSelect, NSplit, useMessage, type DropdownOption } from 'naive-ui'
import * as api from '../api'
import { useAppStore } from '../stores/app'
import type { ExecResult, OrderDir, QueryTab } from '../types'
import ResultsGrid from './ResultsGrid.vue'
import ResultActions from './ResultActions.vue'
import RecordPanel from './RecordPanel.vue'
import SqlOptimizeModal from './SqlOptimizeModal.vue'
import Icon from './Icon.vue'
import type { DbType } from '../types'

const props = defineProps<{ tab: QueryTab }>()
const store = useAppStore()
const message = useMessage()
const theme = inject<'dark' | 'light'>('theme', 'dark')

// CodeMirror 重量级:异步组件 + 惰性挂载(点击或已有 SQL 时才加载 434K chunk)
const SqlEditor = defineAsyncComponent(() => import('./SqlEditor.vue'))
const editorActive = ref(false)
const showOptimize = ref(false)

// ── 查询参数变量(:name) ──────────────────────────────
const paramValues = ref<Record<string, string>>({})
const showParamModal = ref(false)
const pendingSql = ref('')

/** 提取 SQL 中的 :param 变量(排除 ::类型转换和引号内) */
function extractParams(sql: string): string[] {
  const params = new Set<string>()
  const clean = sql.replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""')
  for (const m of clean.matchAll(/(?<!:):(\w+)/g)) {
    if (m[1] && !['true', 'false', 'null'].includes(m[1].toLowerCase())) {
      params.add(m[1])
    }
  }
  return [...params]
}

/** 替换 :param 为用户输入的值 */
function substituteParams(sql: string, values: Record<string, string>): string {
  return sql.replace(/(?<!:):(\w+)/g, (full: string, name: string) => {
    if (['true', 'false', 'null'].includes(name.toLowerCase())) return full
    const v = values[name]
    if (v === undefined) return full
    if (/^-?\d+(\.\d+)?$/.test(v)) return v
    return `'${v.replace(/'/g, "''")}'`
  })
}

function runWithParams() {
  const sql = props.tab.sql.trim()
  const params = extractParams(sql)
  if (!params.length) {
    store.runQuery(props.tab.id)
    return
  }
  // 检查是否已有值(上次输入)
  const missing = params.filter((p) => !paramValues.value[p])
  if (missing.length === 0) {
    // 全有值,直接替换执行
    pendingSql.value = substituteParams(sql, paramValues.value)
    store.runQuery(props.tab.id, pendingSql.value)
  } else {
    pendingSql.value = sql
    showParamModal.value = true
  }
}

function executeWithParams() {
  const sql = substituteParams(pendingSql.value, paramValues.value)
  showParamModal.value = false
  store.runQuery(props.tab.id, sql)
}

watch(
  () => props.tab.sql,
  (v) => {
    if (v.trim()) editorActive.value = true
  },
  { immediate: true },
)

const connOptions = computed(() => store.saved.map((c) => ({ label: c.name, value: c.id })))

// 多库连接:加载该服务器的数据库列表
const dbOptions = ref<{ label: string; value: string }[]>([])
const selectedDb = ref<string | null>(null)

watch(
  () => props.tab.connId,
  async (connId) => {
    selectedDb.value = null
    dbOptions.value = []
    if (!connId) return
    const conn = store.connById(connId)
    if (!conn || (conn.dbType !== 'mysql' && conn.dbType !== 'postgres')) return
    try {
      const dbs = await api.listDatabases(connId)
      dbOptions.value = dbs.map((d) => ({ label: d, value: d }))
      // 默认选中已保存的库或第一个
      const defaultDb = conn.database || dbs[0] || null
      if (defaultDb) {
        selectedDb.value = defaultDb
        // 切换到该库
        await api.runSql(connId, 'USE `' + defaultDb + '`')
      }
    } catch {
      // 静默失败
    }
  },
  { immediate: true },
)

async function onDbChange(db: string) {
  selectedDb.value = db
  if (!props.tab.connId) return
  try {
    await api.runSql(props.tab.connId, 'USE `' + db + '`')
  } catch {
    // USE 失败不影响 information_schema 查询
  }
}

const dialect = computed<DbType>(() => store.connById(props.tab.connId ?? '')?.dbType ?? 'mysql')

const tables = computed<string[]>(() => {
  const id = props.tab.connId
  return id ? store.live[id]?.tables.map((t) => t.name) ?? [] : []
})

/** 当前连接已缓存列的表 → 列名(供编辑器列补全) */
const colMap = computed<Record<string, string[]>>(() => {
  const id = props.tab.connId
  if (!id) return {}
  const out: Record<string, string[]> = {}
  const prefix = `${id}/`
  for (const [k, v] of Object.entries(store.tableCols)) {
    if (k.startsWith(prefix)) out[k.slice(prefix.length)] = v
  }
  return out
})

const activeResult = computed(() => props.tab.results[props.tab.activeSet] ?? null)

// ── 简单 SELECT 结果可编辑回写 ────────────────────────
/** 检测:SELECT ... FROM 单表,无 JOIN/GROUP/UNION → 返回表名 */
const editableQuery = computed<string | null>(() => {
  if (!props.tab.connId) return null
  const conn = store.connById(props.tab.connId)
  if (!conn || conn.dbType === 'redis' || conn.readOnly) return null
  // 去掉注释后检测,避免前导注释导致漏判
  const sql = props.tab.sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, '')
    .trim()
  if (!/^select\s/i.test(sql)) return null
  if (/\b(join|group\s+by|union|having|into)\b/i.test(sql)) return null
  // 表名可能是 `db`.`tbl` / public.tbl / "TBL" / 别名前缀,取首个 FROM 后的 token,
  // 去引号并取最后一个标识段(按当前连接库解析)
  const m = sql.match(/\bfrom\s+([^\s,();]+)/i)
  if (!m) return null
  const seg = m[1].replace(/[`"[\]]/g, '').split('.').pop()
  return seg || null
})

const eqPkCols = ref<string[]>([])
const pkLoadedKey = ref('')
const eqChanges = ref<Record<number, Record<string, string | null>>>({})
const eqDeleted = ref<Record<number, true>>({})
const eqSaving = ref(false)

/** 可编辑条件:识别出单表 SELECT 且表有主键,且结果集包含全部主键列(否则无法定位行) */
const eqEditable = computed(
  () =>
    editableQuery.value !== null &&
    eqPkCols.value.length > 0 &&
    eqPkCols.value.every((c) => activeResult.value?.columns.includes(c) ?? false),
)

// 主键列懒加载:SQL 或结果集变化时尝试拉取;失败(如连接未建立)则等下次结果到达重试
watch(
  [editableQuery, () => activeResult.value?.columns],
  async ([t]) => {
    if (!t || !props.tab.connId) return
    const cid = props.tab.connId
    const key = `${cid}/${t}`
    if (key === pkLoadedKey.value) return
    pkLoadedKey.value = key
    try {
      const st = await api.getTableStructure(cid, t)
      eqPkCols.value = st.columns.filter((c) => c.key === 'PRI').map((c) => c.name)
      store.rememberCols(cid, t, st.columns.map((c) => c.name))
    } catch {
      pkLoadedKey.value = ''
    }
  },
  { immediate: true },
)

// 换表后旧修改不再适用
watch(editableQuery, () => {
  eqChanges.value = {}
  eqDeleted.value = {}
})

watch(
  () => props.tab.results,
  () => {
    eqChanges.value = {}
    eqDeleted.value = {}
  },
)

const eqChangeCount = computed(
  () =>
    Object.values(eqChanges.value).reduce((n, row) => n + Object.keys(row).length, 0) +
    Object.keys(eqDeleted.value).length,
)

function eqPkOf(row: (string | null)[] | undefined): [string, string][] | null {
  const r = activeResult.value
  if (!r || !row) return null
  const pk: [string, string][] = []
  for (const c of eqPkCols.value) {
    const i = r.columns.indexOf(c)
    if (i < 0 || row[i] === null) return null
    pk.push([c, String(row[i])])
  }
  return pk
}

async function eqSave() {
  const t = editableQuery.value
  if (!t || !props.tab.connId) return
  const r = activeResult.value
  if (!r) return
  const updates: import('../types').CellUpdate[] = []
  for (const [idxStr, sets] of Object.entries(eqChanges.value)) {
    const row = r.rows[Number(idxStr)]
    const pk = eqPkOf(row)
    if (!pk) {
      props.tab.error = `第 ${Number(idxStr) + 1} 行缺少主键,无法保存`
      continue
    }
    updates.push({
      pk,
      sets: Object.entries(sets).map(([c, v]) => [c, v] as [string, string | null]),
    })
  }
  const deletes = Object.keys(eqDeleted.value)
    .map((i) => eqPkOf(r.rows[Number(i)]))
    .filter((p): p is [string, string][] => !!p)
  if (!updates.length && !deletes.length) return
  eqSaving.value = true
  try {
    await api.applyChanges(props.tab.connId, t, updates, deletes, [])
    eqChanges.value = {}
    eqDeleted.value = {}
    message.success('已保存,重新加载结果…')
    await store.runQuery(props.tab.id)
  } catch (e) {
    message.error(String(e))
  } finally {
    eqSaving.value = false
  }
}

/** 合并未保存变更后的行(供 ResultsGrid changes prop 语义一致) */

// ── 结果二次加工:内存筛选 + 排序(不重查数据库) ──────
const memFilter = ref('')
const memSort = ref<{ key: string | null; dir: OrderDir }>({ key: null, dir: 'asc' })
const selectedRow = ref<number | null>(null)

watch(
  () => [props.tab.results, props.tab.activeSet] as const,
  () => {
    memFilter.value = ''
    memSort.value = { key: null, dir: 'asc' }
    selectedRow.value = null
  },
)

const viewResult = computed<ExecResult | null>(() => {
  const r = activeResult.value
  if (!r) return null
  let rows = r.rows
  const kw = memFilter.value.trim().toLowerCase()
  if (kw) {
    rows = rows.filter((row) => row.some((c) => c !== null && c.toLowerCase().includes(kw)))
  }
  if (memSort.value.key) {
    const i = r.columns.indexOf(memSort.value.key)
    if (i >= 0) {
      const dir = memSort.value.dir === 'asc' ? 1 : -1
      rows = [...rows].sort((a, b) => {
        const x = a[i] ?? ''
        const y = b[i] ?? ''
        const nx = Number(x)
        const ny = Number(y)
        const cmp =
          x !== '' && y !== '' && !Number.isNaN(nx) && !Number.isNaN(ny)
            ? nx - ny
            : String(x).localeCompare(String(y), undefined, { numeric: true })
        return cmp * dir
      })
    }
  }
  if (rows === r.rows) return r
  return { ...r, rows, truncated: false }
})

function onMemSort(col: string, dir?: 'asc' | 'desc' | null) {
  if (dir !== undefined) {
    memSort.value = dir === null ? { key: null, dir: 'asc' } : { key: col, dir }
    return
  }
  if (memSort.value.key === col) {
    if (memSort.value.dir === 'asc') memSort.value.dir = 'desc'
    else memSort.value = { key: null, dir: 'asc' }
  } else {
    memSort.value = { key: col, dir: 'asc' }
  }
}

// 筛选/排序会重排行序,未保存修改的行号将错位 —— 有待保存修改时直接重置并提示
watch([memFilter, () => memSort.value.key, () => memSort.value.dir], () => {
  if (eqChangeCount.value > 0) {
    eqChanges.value = {}
    eqDeleted.value = {}
    message.info('结果内筛选/排序已变化,未保存的修改已重置')
  }
})

const meta = computed(() => {
  const r = activeResult.value
  if (!r) return ''
  if (r.columns.length === 0) return `影响 ${r.affected} 行 · ${r.elapsedMs} ms`
  const n = viewResult.value?.rows.length ?? r.rows.length
  const mark = n !== r.rows.length ? `${n}/${r.rows.length}` : `${r.rows.length}`
  return `${mark}${r.truncated ? '+' : ''} 行 · ${r.elapsedMs} ms`
})

// ── SQL 片段 ──────────────────────────────────────────
const snippetOptions = computed<DropdownOption[]>(() => {
  const opts: DropdownOption[] = store.snippets.map((s, i) => ({
    key: `s${i}`,
    label: s.name,
  }))
  opts.push({ type: 'divider', key: 'd1' })
  opts.push({ key: 'save', label: '💾 保存当前 SQL 为片段' })
  if (store.snippets.length) {
    opts.push({ key: 'clear', label: `🗑 清空全部片段(${store.snippets.length})` })
  }
  return opts
})

function onSnippet(key: string | number) {
  const k = String(key)
  if (k === 'save') {
    if (!props.tab.sql.trim()) {
      message.warning('当前 SQL 为空')
      return
    }
    store.saveSnippet(props.tab.sql)
    message.success('已保存为片段')
  } else if (k === 'clear') {
    store.clearSnippets()
    message.success('片段已清空')
  } else if (k.startsWith('s')) {
    const s = store.snippets[Number(k.slice(1))]
    if (s) props.tab.sql = s.sql
  }
}

function run(selectedSql?: string) {
  if (selectedSql) {
    store.runQuery(props.tab.id, selectedSql)
    return
  }
  runWithParams()
}

async function beautify() {
  if (!props.tab.sql.trim()) {
    message.warning('没有可格式化的 SQL')
    return
  }
  try {
    const { format: formatSql } = await import('sql-formatter')
    const lang =
      dialect.value === 'postgres'
        ? 'postgresql'
        : dialect.value === 'redis'
          ? 'sql'
          : dialect.value
    props.tab.sql = formatSql(props.tab.sql, { language: lang })
  } catch {
    message.error('格式化失败,请检查 SQL 语法')
  }
}

/** 执行计划:对当前(或选中的)SELECT 附加 EXPLAIN,结果不进历史 */
async function explain() {
  const t = props.tab
  if (!t.connId) {
    message.warning('请先选择连接')
    return
  }
  const sql = t.sql.trim()
  if (!/^(select|with)\b/i.test(sql)) {
    message.warning('EXPLAIN 仅支持 SELECT / WITH 查询')
    return
  }
  if (!store.live[t.connId]) await store.connect(t.connId)
  if (!store.live[t.connId]) {
    message.error('连接不可用')
    return
  }
  const explainSql =
    (dialect.value === 'sqlite' ? 'EXPLAIN QUERY PLAN ' : 'EXPLAIN ') + sql
  t.running = true
  t.error = null
  try {
    t.results = await api.runSql(t.connId, explainSql)
    t.activeSet = 0
  } catch (e) {
    t.error = String(e)
  } finally {
    t.running = false
  }
}

const historyOptions = computed<DropdownOption[]>(() =>
  store.history.slice(0, 15).map((s, i) => ({
    key: i,
    label: s.replace(/\s+/g, ' ').slice(0, 72) || '(空)',
  })),
)

function applyHistory(key: string | number) {
  const sql = store.history[Number(key)]
  if (sql !== undefined) props.tab.sql = sql
}
</script>

<template>
  <div class="pane-root">
    <div class="toolbar" data-tauri-drag-region>
      <n-button size="small" type="primary" :loading="tab.running" class="run-btn" @click="run()">
        <Icon name="play" :size="12" /> 运行
      </n-button>
      <n-select
        v-model:value="tab.connId"
        size="small"
        :options="connOptions"
        placeholder="选择连接"
        class="conn-sel"
      />
      <n-select
        v-if="dbOptions.length"
        v-model:value="selectedDb"
        size="small"
        :options="dbOptions"
        placeholder="选择数据库"
        class="db-sel"
        @update:value="onDbChange"
      />
      <div class="seg-group">
        <n-button size="small" quaternary title="格式化 SQL (美化排版)" @click="beautify">
          <Icon name="zap" :size="13" /> 格式化
        </n-button>
        <n-button size="small" quaternary title="执行计划 (EXPLAIN)" @click="explain">
          <Icon name="list" :size="13" /> 计划
        </n-button>
        <n-button size="small" quaternary title="SQL 优化分析(EXPLAIN + 诊断建议)" @click="showOptimize = true">
          <Icon name="zap" :size="13" /> 优化
        </n-button>
        <n-dropdown :options="historyOptions" @select="applyHistory">
          <n-button size="small" quaternary title="查询历史" :disabled="!historyOptions.length">
            <Icon name="clock" :size="13" /> 历史
          </n-button>
        </n-dropdown>
        <n-dropdown :options="snippetOptions" @select="onSnippet">
          <n-button size="small" quaternary title="SQL 片段">
            <Icon name="save" :size="13" /> 片段
          </n-button>
        </n-dropdown>
      </div>
      <div class="spacer" data-tauri-drag-region />
      <span v-if="meta" class="meta">{{ meta }}</span>
    </div>
    <n-split direction="vertical" :default-size="0.45" :min="0.15" :max="0.85" class="split">
      <template #1>
        <div class="pane pane-editor" @click="editorActive = true">
          <SqlEditor
            v-if="editorActive"
            :sql="tab.sql"
            :dialect="dialect"
            :tables="tables"
            :columns="colMap"
            :theme="theme"
            @update:sql="tab.sql = $event"
            @run="run"
          />
          <div v-else class="editor-placeholder" @click.stop="editorActive = true">
            <span class="ph-glyph">✎</span>
            <span>点击开始编写 SQL(⌘P 可快速查询)</span>
          </div>
        </div>
      </template>
      <template #2>
        <div class="pane pane-results">
          <div v-if="tab.error" class="err mono">{{ tab.error }}</div>
          <template v-else-if="activeResult && activeResult.columns.length">
            <div class="set-row">
              <div v-if="tab.results.length > 1" class="set-tabs">
                <button
                  v-for="(r, i) in tab.results"
                  :key="i"
                  class="set-tab"
                  :class="{ active: tab.activeSet === i }"
                  @click="tab.activeSet = i"
                >
                  结果 {{ i + 1 }}
                  <span v-if="r.columns.length" class="set-count">{{ r.rows.length }}</span>
                </button>
              </div>
              <template v-if="eqChangeCount > 0">
                <span class="eq-info">
                  <b>{{ eqChangeCount }}</b> 处修改(未保存)
                </span>
                <n-button size="tiny" quaternary @click="() => { eqChanges = {}; eqDeleted = {} }">
                  放弃
                </n-button>
                <n-button size="tiny" type="primary" :loading="eqSaving" @click="eqSave">
                  保存更改
                </n-button>
              </template>
              <div class="flex-sp" />
              <n-input
                v-model:value="memFilter"
                size="tiny"
                clearable
                round
                placeholder="结果内筛选(内存,不重查)"
                class="mem-filter"
              >
                <template #prefix>
                  <Icon name="search" :size="11" />
                </template>
              </n-input>
              <span class="ra-label">导出:</span>
              <ResultActions
                v-if="activeResult.rows.length"
                :result="viewResult ?? activeResult"
                :base-name="(editableQuery ?? 'query') + (tab.results.length > 1 ? '_' + (tab.activeSet + 1) : '')"
                :table-name="editableQuery ?? undefined"
              />
            </div>
            <div class="results-flex">
              <div class="results-panel">
                <ResultsGrid
                  :columns="activeResult.columns"
                  :rows="viewResult?.rows ?? []"
                  :truncated="viewResult?.truncated ?? false"
                  :sortable="true"
                  :sort-key="memSort.key"
                  :sort-dir="memSort.dir"
                  :selected-row="selectedRow"
                  :editable="eqEditable"
                  :changes="eqChanges"
                  :deleted-rows="eqDeleted"
                  :table-name="editableQuery ?? undefined"
                  :mysql-dialect="dialect === 'mysql'"
                  @sort="onMemSort"
                  @select-row="(r: number) => (selectedRow = selectedRow === r ? null : r)"
                  @cell-change="(r: number, c: string, v: string | null) => {
                    if (!eqChanges[r]) eqChanges[r] = {}
                    eqChanges[r][c] = v
                  }"
                  @delete-row="(r: number) => {
                    if (eqDeleted[r]) delete eqDeleted[r]
                    else eqDeleted[r] = true
                  }"
                />
              </div>
              <RecordPanel
                v-if="selectedRow !== null && viewResult && viewResult.rows[selectedRow]"
                :columns="activeResult.columns"
                :rows="viewResult.rows"
                :row-index="selectedRow"
                :global-no="selectedRow + 1"
                @close="selectedRow = null"
              />
            </div>
          </template>
          <div v-else-if="activeResult" class="ok-line">
            ✓ 执行成功 · 影响 {{ activeResult.affected }} 行 · {{ activeResult.elapsedMs }} ms
            <template v-if="tab.results.length > 1">(共 {{ tab.results.length }} 个结果集)</template>
          </div>
          <div v-else-if="!store.saved.length" class="onboarding">
            <div class="ob-title">开始使用</div>
            <div class="ob-steps">
              <div class="ob-step">
                <span class="ob-n">1</span>
                <span>在左侧点击 <b>＋</b> 新建数据库连接</span>
              </div>
              <div class="ob-step">
                <span class="ob-n">2</span>
                <span>展开连接,点击表名快速预览数据</span>
              </div>
              <div class="ob-step">
                <span class="ob-n">3</span>
                <span>编写 SQL,按 <span class="kbd">⌘/Ctrl + ↵</span> 运行</span>
              </div>
            </div>
          </div>
          <div v-else class="hint">
            <div class="hint-key">⌘↵</div>
            <div>输入 SQL 后运行查询</div>
            <div class="hint-sub">点击左侧表名可以快速预览数据</div>
          </div>
        </div>
      </template>
    </n-split>
    <!-- 参数输入弹窗 -->
    <n-modal
      :show="showParamModal"
      preset="card"
      title="查询参数"
      :style="{ width: '420px' }"
      @update:show="(v: boolean) => (showParamModal = v)"
    >
      <div v-for="p in extractParams(pendingSql)" :key="p" class="param-row">
        <span class="param-name mono">:{{ p }}</span>
        <input
          v-model="paramValues[p]"
          class="param-input mono"
          :placeholder="`输入 ${p} 的值`"
          @keyup.enter="executeWithParams"
        />
      </div>
      <template #footer>
        <div style="display:flex; justify-content:flex-end; gap:8px">
          <n-button size="small" @click="showParamModal = false">取消</n-button>
          <n-button size="small" type="primary" @click="executeWithParams">
            <Icon name="play" :size="12" /> 执行
          </n-button>
        </div>
      </template>
    </n-modal>
    <SqlOptimizeModal
      v-model:show="showOptimize"
      :sql="tab.sql"
      :conn-id="tab.connId"
    />
  </div>
</template>

<style scoped>
.pane-root {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 42px;
  padding: 0 10px;
  background: var(--bg-elevated);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.run-btn {
  font-weight: 500;
}
.conn-sel {
  width: 180px;
}
.db-sel {
  width: 150px;
}
.spacer {
  flex: 1;
  height: 100%;
}
.meta {
  color: var(--text-tertiary);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  padding: 3px 10px;
  border-radius: 6px;
  background: var(--bg-hover);
}
.split {
  flex: 1;
  min-height: 0;
}
.pane {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.pane-editor {
  background: var(--bg-editor);
}
.editor-placeholder {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--text-tertiary);
  font-size: 12.5px;
  cursor: text;
}
.editor-placeholder:hover {
  color: var(--text-secondary);
}
.ph-glyph {
  font-size: 22px;
  opacity: 0.5;
}
.pane-results {
  background: var(--bg);
}
.set-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px 0;
  flex-shrink: 0;
}
.flex-sp {
  flex: 1;
}
.mem-filter {
  width: 230px;
}
.param-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}
.param-name {
  width: 100px;
  flex-shrink: 0;
  font-size: 12.5px;
  color: var(--accent);
  font-weight: 700;
}
.param-input {
  flex: 1;
  height: 28px;
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  background: var(--input-bg);
  color: var(--text);
  font-size: 13px;
  padding: 0 8px;
  outline: none;
}
.param-input:focus {
  border-color: var(--accent);
}
.eq-info {
  font-size: 12px;
  color: var(--edit-hl-fg);
}
.eq-info b {
  font-weight: 700;
}
.set-tabs {
  display: flex;
  gap: 4px;
}
.set-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 24px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-bottom: none;
  border-radius: 7px 7px 0 0;
  background: transparent;
  color: var(--text-tertiary);
  font-size: 11.5px;
  cursor: pointer;
}
.set-tab.active {
  background: var(--bg-grid);
  color: var(--text);
}
.set-count {
  font-size: 10px;
  color: var(--accent);
  font-variant-numeric: tabular-nums;
}
.results-flex {
  flex: 1;
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: row;
  gap: 10px;
  margin: 0 12px 12px;
}
.results-panel {
  flex: 1;
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  position: relative;
  border: 1px solid var(--border-strong);
  border-radius: 10px;
  overflow: hidden;
  background: var(--bg-grid);
  box-shadow:
    var(--panel-inset),
    var(--panel-shadow);
}
.ra-label {
  font-size: 11.5px;
  color: var(--text-tertiary);
  white-space: nowrap;
}
.set-row :deep(.actions) {
  flex-shrink: 0;
}
.err {
  margin: 12px;
  padding: 10px 14px;
  border-radius: 10px;
  background: rgba(255, 69, 58, 0.1);
  border: 1px solid rgba(255, 69, 58, 0.25);
  color: #ff8a80;
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 100%;
  overflow: auto;
}
.ok-line {
  padding: 18px;
  color: var(--text-secondary);
  font-size: 12.5px;
}
.onboarding {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 18px;
}
.ob-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-secondary);
}
.ob-steps {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.ob-step {
  display: flex;
  align-items: center;
  gap: 12px;
  color: var(--text-secondary);
  font-size: 13px;
}
.ob-n {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 1px solid var(--border-strong);
  color: var(--text-tertiary);
  font-size: 11px;
  font-weight: 600;
}
.hint {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--text-tertiary);
}
.hint-key {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 52px;
  height: 36px;
  padding: 0 10px;
  margin-bottom: 4px;
  border: 1px solid var(--border-strong);
  border-bottom-width: 2px;
  border-radius: 8px;
  font-family: var(--mono);
  font-size: 13px;
  color: var(--text-secondary);
}
.hint-sub {
  font-size: 11.5px;
  opacity: 0.75;
}
</style>
