<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { NInput } from 'naive-ui'
import { useAppStore } from '../stores/app'
import type { TableMeta } from '../types'
import Icon from './Icon.vue'

const props = defineProps<{ show: boolean }>()
const emit = defineEmits<{ (e: 'update:show', v: boolean): void }>()

const store = useAppStore()
const kw = ref('')
const sel = ref(0)

interface Item {
  connId: string
  connName: string
  table: TableMeta
}

// 最近使用(最多 8 张表)
const RECENT_KEY = 'dblens_recent_tables'

function getRecent(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
  } catch {
    return []
  }
}

function pushRecent(name: string) {
  const list = getRecent().filter((n) => n !== name)
  list.unshift(name)
  localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 8)))
}

const recentSet = computed(() => new Set(getRecent()))

const all = computed<Item[]>(() => {
  const out: Item[] = []
  for (const c of store.saved) {
    const live = store.live[c.id]
    if (!live) continue
    for (const t of live.tables) {
      if (t.kind === 'table' || t.kind === 'view') {
        out.push({ connId: c.id, connName: c.name, table: t })
      } else if (t.kind.startsWith('redis-db')) {
        // Redis 键空间条目
        out.push({ connId: c.id, connName: c.name, table: { name: t.name, kind: 'redis-db' } })
      }
    }
  }
  return out
})

// ── 输入解析:表名 / 表名+条件 / SQL ───────────────────
type Parsed =
  | { mode: 'tables' }
  | { mode: 'sql'; sql: string }
  | { mode: 'filter'; item: Item; cond: string }

const parsed = computed<Parsed>(() => {
  const t = kw.value.trim()
  if (!t) return { mode: 'tables' }
  if (/^(select|with|insert|update|delete|create|alter|drop|explain|pragma)\b/i.test(t)) {
    return { mode: 'sql', sql: t }
  }
  const sp = t.indexOf(' ')
  if (sp > 0) {
    const tableName = t.slice(0, sp)
    const cond = t.slice(sp + 1).trim()
    const exact = all.value.find((it) => it.table.name === tableName)
    if (exact && cond) return { mode: 'filter', item: exact, cond }
  }
  return { mode: 'tables' }
})

const filtered = computed<Item[]>(() => {
  const q = kw.value.trim().toLowerCase()
  if (!q || parsed.value.mode !== 'tables') return all.value.slice(0, 10)
  return all.value
    .filter(
      (it) =>
        it.table.kind === 'redis-db' || it.table.name.toLowerCase().includes(q),
    )
    .sort((a, b) => {
      // 最近使用优先
      const ra = recentSet.value.has(a.table.name) ? 0 : 1
      const rb = recentSet.value.has(b.table.name) ? 0 : 1
      if (ra !== rb) return ra - rb
      const ai = a.table.name.toLowerCase().indexOf(q)
      const bi = b.table.name.toLowerCase().indexOf(q)
      return ai - bi
    })
    .slice(0, 10)
})

interface Row {
  kind: 'action' | 'table'
  label: string
  sub?: string
  icon: 'play' | 'search' | 'table' | 'eye' | 'diamond'
  run: () => void | Promise<void>
}

const rows = computed<Row[]>(() => {
  const p = parsed.value
  const out: Row[] = []
  if (p.mode === 'sql') {
    out.push({
      kind: 'action',
      label: '执行 SQL',
      sub: p.sql.replace(/\s+/g, ' ').slice(0, 54),
      icon: 'play',
      run: () => execSql(p.sql),
    })
  } else if (p.mode === 'filter') {
    out.push({
      kind: 'action',
      label: `在 ${p.item.table.name} 中筛选`,
      sub: p.cond.replace(/\s+/g, ' ').slice(0, 54),
      icon: 'search',
      run: () => openWithFilter(p.item, p.cond),
    })
  }
  for (const it of filtered.value) {
    out.push({
      kind: 'table',
      label: it.table.name,
      sub: it.connName,
      icon:
        it.table.kind === 'view' ? 'eye' : it.table.kind === 'redis-db' ? 'diamond' : 'table',
      run: () => {
        if (it.table.kind === 'redis-db') {
          const idx = Number(it.table.name.replace('db', '')) || 0
          store.openRedis(it.connId, idx)
        } else {
          store.openTable(it.connId, it.table)
          pushRecent(it.table.name)
        }
        emit('update:show', false)
      },
    })
  }
  return out
})

watch(
  () => props.show,
  (v) => {
    if (v) {
      kw.value = ''
      sel.value = 0
    }
  },
)
watch(rows, () => {
  sel.value = 0
})

/** SQL 执行目标:当前标签连接 → 唯一在线连接 → 第一个已保存连接 */
function targetConn(): string | null {
  const cur = store.activeTab?.connId
  if (cur && store.connById(cur)) return cur
  const liveIds = Object.keys(store.live)
  if (liveIds.length === 1) return liveIds[0]
  return store.saved[0]?.id ?? null
}

async function execSql(sql: string) {
  const connId = targetConn()
  if (!connId) return
  store.openQueryTab(connId)
  const tab = store.tabs[store.tabs.length - 1]
  if (tab?.kind === 'query') {
    tab.sql = sql
    emit('update:show', false)
    await store.runQuery(tab.id)
  }
}

async function openWithFilter(item: Item, cond: string) {
  emit('update:show', false)
  await store.openTable(item.connId, item.table)
  const tab = store.tabs[store.tabs.length - 1]
  if (tab?.kind !== 'table') return
  const cols = tab.result?.columns ?? []
  const m = cond.match(/^(\w+)\s*=\s*(.+)$/)
  if (m && cols.includes(m[1])) {
    tab.filters = [{ column: m[1], op: '=', value: m[2].trim() }]
  } else {
    // 无列名条件:挑第一个非主键列做 LIKE
    const pick = cols.find((c) => !tab.pkCols.includes(c)) ?? cols[0]
    if (pick) tab.filters = [{ column: pick, op: 'LIKE', value: cond }]
  }
  await store.applyFilters(tab.id)
}

/** 名称按关键词分段,命中部分高亮 */
function parts(name: string): { t: string; hit: boolean }[] {
  const q = kw.value.trim().toLowerCase()
  if (!q) return [{ t: name, hit: false }]
  const out: { t: string; hit: boolean }[] = []
  const lower = name.toLowerCase()
  let i = 0
  while (i < name.length) {
    const idx = lower.indexOf(q, i)
    if (idx < 0) {
      out.push({ t: name.slice(i), hit: false })
      break
    }
    if (idx > i) out.push({ t: name.slice(i, idx), hit: false })
    out.push({ t: name.slice(idx, idx + q.length), hit: true })
    i = idx + q.length
  }
  return out
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    sel.value = Math.min(rows.value.length - 1, sel.value + 1)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    sel.value = Math.max(0, sel.value - 1)
  } else if (e.key === 'Enter') {
    rows.value[sel.value]?.run()
  } else if (e.key === 'Escape') {
    emit('update:show', false)
  }
}
</script>

<template>
  <teleport to="body">
    <div v-if="show" class="qo-mask" @click="emit('update:show', false)">
      <div class="qo" @click.stop @keydown="onKeydown">
        <div class="qo-input-row">
          <Icon name="search" :size="14" class="qo-ic" />
          <n-input
            v-model:value="kw"
            placeholder="表名 · 表名 关键词/列=值 · 直接输入 SQL…"
            class="qo-input"
            :bordered="false"
            autofocus
          />
          <span class="kbd">esc</span>
        </div>
        <div class="qo-list">
          <div
            v-for="(r, i) in rows"
            :key="i"
            class="qo-item"
            :class="{ sel: i === sel, action: r.kind === 'action' }"
            @mousemove="sel = i"
            @click="r.run()"
          >
            <Icon :name="r.icon" :size="12" class="qo-tic" :class="{ acc: r.kind === 'action' }" />
            <span class="qo-name mono" :class="{ act: r.kind === 'action' }">
              <template v-if="r.kind === 'table'" v-for="(seg, si) in parts(r.label)" :key="si">
                <mark v-if="seg.hit" class="qo-hit">{{ seg.t }}</mark>
                <template v-else>{{ seg.t }}</template>
              </template>
              <template v-else>{{ r.label }}</template>
            </span>
            <span v-if="r.sub" class="qo-sub mono">{{ r.sub }}</span>
          </div>
          <div v-if="!rows.length" class="qo-empty">
            {{ all.length ? '没有匹配的表' : '先在左侧连接一个数据库' }}
          </div>
        </div>
        <div class="qo-foot">
          ↑↓ 选择 · ↵ 执行 · <span class="kbd">users 张</span> 筛数据 ·
          <span class="kbd">SELECT…</span> 跑 SQL
        </div>
      </div>
    </div>
  </teleport>
</template>

<style scoped>
.qo-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding-top: 14vh;
  z-index: 3000;
}
.qo {
  width: 520px;
  border-radius: 14px;
  background: var(--quick-bg);
  border: 1px solid var(--border-strong);
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.5);
  overflow: hidden;
  animation: qo-in 0.14s ease;
}
@keyframes qo-in {
  from {
    transform: translateY(-8px) scale(0.98);
    opacity: 0;
  }
}
.qo-input-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--border);
}
.qo-ic {
  color: var(--text-tertiary);
}
.qo-input {
  flex: 1;
}
.qo-list {
  max-height: 340px;
  overflow-y: auto;
  padding: 6px;
}
.qo-item {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 8px 10px;
  border-radius: 8px;
  cursor: pointer;
}
.qo-item.sel {
  background: rgba(133, 135, 246, 0.14);
}
.qo-item.action {
  background: rgba(133, 135, 246, 0.07);
  border: 1px dashed rgba(133, 135, 246, 0.3);
  margin-bottom: 4px;
}
.qo-item.action.sel {
  background: rgba(133, 135, 246, 0.2);
}
.qo-tic {
  color: var(--text-tertiary);
  flex-shrink: 0;
}
.qo-tic.acc {
  color: var(--accent);
}
.qo-item.sel .qo-tic {
  color: var(--accent);
}
.qo-name {
  font-size: 13px;
  color: var(--text);
  white-space: nowrap;
}
.qo-hit {
  background: rgba(133, 135, 246, 0.3);
  color: var(--accent);
  border-radius: 2px;
  padding: 0 1px;
}
.qo-name.act {
  color: var(--accent);
  font-weight: 600;
}
.qo-sub {
  margin-left: auto;
  font-size: 11px;
  color: var(--text-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 260px;
}
.qo-empty {
  padding: 22px;
  text-align: center;
  color: var(--text-tertiary);
  font-size: 12.5px;
}
.qo-foot {
  padding: 7px 14px;
  border-top: 1px solid var(--border);
  font-size: 10.5px;
  color: var(--text-tertiary);
  display: flex;
  align-items: center;
  gap: 4px;
}
</style>
