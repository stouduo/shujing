<script setup lang="ts">
import { computed, ref } from 'vue'
import { NButton, NRadioButton, NRadioGroup, NSpin, useMessage } from 'naive-ui'
import { redisAnalyze } from '../api'
import type { RedisTab } from '../types'
import Icon from './Icon.vue'

interface Stat {
  key: string
  keyType: string
  mem: number
  len: number
  freq: number
}

const props = defineProps<{ show: boolean; tab: RedisTab }>()
const emit = defineEmits<{ (e: 'update:show', v: boolean): void }>()

const message = useMessage()
const mode = ref<'big' | 'hot'>('big')
const sample = ref(1000)
const running = ref(false)
const stats = ref<Stat[]>([])
const error = ref('')
const ran = ref(false)

async function run() {
  const t = props.tab
  if (!t.connId) return
  running.value = true
  error.value = ''
  try {
    stats.value = await redisAnalyze(t.connId, t.db, sample.value, mode.value)
    ran.value = true
    if (!stats.value.length) message.info('没有扫描到 key')
  } catch (e) {
    error.value = String(e)
  } finally {
    running.value = false
  }
}

const top = computed(() => stats.value.slice(0, 50))
const maxVal = computed(() => {
  if (!stats.value.length) return 1
  return mode.value === 'hot'
    ? Math.max(...stats.value.map((s) => s.freq), 1)
    : Math.max(...stats.value.map((s) => (s.mem > 0 ? s.mem : 0)), 1)
})

function fmtMem(b: number): string {
  if (b < 0) return '—'
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  return `${(b / 1024 / 1024).toFixed(2)} MB`
}

function memClass(b: number): string {
  if (b > 1024 * 1024) return 'lvl3'
  if (b > 64 * 1024) return 'lvl2'
  return ''
}

function goto(stat: Stat) {
  emit('update:show', false)
  window.dispatchEvent(new CustomEvent('redis-refresh', { detail: { tabId: props.tab.id, key: stat.key } }))
}
</script>

<template>
  <n-modal
    :show="props.show"
    preset="card"
    :title="`扫描分析 · db${tab.db}`"
    :style="{ width: '720px' }"
    @update:show="(v: boolean) => emit('update:show', v)"
  >
    <div class="ctrl">
      <n-radio-group v-model:value="mode" size="small">
        <n-radio-button value="big">大 key(内存/元素)</n-radio-button>
        <n-radio-button value="hot">热 key(LFU 频率)</n-radio-button>
      </n-radio-group>
      <n-radio-group v-model:value="sample" size="small">
        <n-radio-button :value="500">采样 500</n-radio-button>
        <n-radio-button :value="1000">1000</n-radio-button>
        <n-radio-button :value="5000">5000</n-radio-button>
      </n-radio-group>
      <n-button size="small" type="primary" :loading="running" @click="run">
        <Icon name="play" :size="12" /> 扫描
      </n-button>
    </div>
    <div v-if="mode === 'hot'" class="note">需要服务端 maxmemory-policy 为 LFU 策略,否则无法统计频率</div>
    <div v-else class="note">SCAN 采样 + MEMORY USAGE 批量统计,按内存降序;>64KB 黄色、>1MB 红色高亮</div>

    <div class="result">
      <n-spin v-if="running" class="loading" size="medium" />
      <div v-else-if="error" class="err mono">{{ error }}</div>
      <template v-else-if="ran">
        <div class="row head-row">
          <span class="c-key">key</span>
          <span class="c-type">类型</span>
          <span class="c-val">{{ mode === 'hot' ? '频率' : '内存' }}</span>
          <span v-if="mode === 'big'" class="c-len">元素</span>
          <span class="c-bar" />
        </div>
        <div
          v-for="(s, i) in top"
          :key="s.key"
          class="row"
          @click="goto(s)"
        >
          <span class="c-rank">{{ i + 1 }}</span>
          <span class="c-key mono" :title="s.key">{{ s.key }}</span>
          <span class="c-type">{{ s.keyType.toUpperCase() }}</span>
          <span class="c-val" :class="mode === 'big' ? memClass(s.mem) : ''">
            {{ mode === 'hot' ? s.freq : fmtMem(s.mem) }}
          </span>
          <span v-if="mode === 'big'" class="c-len">{{ s.len >= 0 ? s.len.toLocaleString() : '—' }}</span>
          <span class="c-bar">
            <i
              class="bar"
              :style="{ width: ((mode === 'hot' ? s.freq : s.mem > 0 ? s.mem : 0) / maxVal) * 100 + '%' }"
              :class="mode === 'big' ? memClass(s.mem) : 'hotbar'"
            />
          </span>
        </div>
        <div v-if="!top.length" class="empty">无数据</div>
      </template>
      <div v-else class="empty">选择模式与采样数后点击扫描</div>
    </div>
  </n-modal>
</template>

<style scoped>
.ctrl {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
  flex-wrap: wrap;
}
.note {
  font-size: 11px;
  color: var(--text-tertiary);
  margin-bottom: 10px;
}
.result {
  border: 1px solid var(--border-strong);
  border-radius: 10px;
  background: var(--bg-grid);
  max-height: 420px;
  overflow-y: auto;
  padding: 4px;
  min-height: 160px;
}
.loading {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 60px 0;
}
.err {
  margin: 10px;
  padding: 8px 12px;
  border-radius: 8px;
  background: rgba(255, 69, 58, 0.1);
  border: 1px solid rgba(255, 69, 58, 0.25);
  color: #ff8a80;
  font-size: 12px;
}
.empty {
  padding: 50px;
  text-align: center;
  color: var(--text-tertiary);
}
.row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 5px 10px;
  border-radius: 7px;
  cursor: pointer;
  font-size: 12px;
}
.row:hover {
  background: var(--bg-hover);
}
.head-row {
  color: var(--text-tertiary);
  font-size: 11px;
  cursor: default;
}
.head-row:hover {
  background: none;
}
.c-rank {
  width: 26px;
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}
.c-key {
  width: 210px;
  flex-shrink: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text);
}
.c-type {
  width: 56px;
  flex-shrink: 0;
  font-size: 9.5px;
  color: var(--danger);
  border: 1px solid rgba(255, 107, 112, 0.4);
  border-radius: 4px;
  text-align: center;
}
.c-val {
  width: 74px;
  flex-shrink: 0;
  text-align: right;
  font-family: var(--mono);
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}
.c-val.lvl2 {
  color: var(--warn);
}
.c-val.lvl3 {
  color: var(--danger);
}
.c-len {
  width: 70px;
  flex-shrink: 0;
  text-align: right;
  font-family: var(--mono);
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
}
.c-bar {
  flex: 1;
  min-width: 60px;
  height: 10px;
}
.bar {
  display: block;
  height: 100%;
  border-radius: 5px;
  background: linear-gradient(90deg, rgba(122, 162, 247, 0.5), rgba(122, 162, 247, 0.9));
  min-width: 2px;
}
.bar.hotbar {
  background: linear-gradient(90deg, rgba(255, 107, 112, 0.5), rgba(255, 107, 112, 0.9));
}
.bar.lvl2 {
  background: linear-gradient(90deg, rgba(255, 214, 10, 0.4), rgba(255, 214, 10, 0.85));
}
.bar.lvl3 {
  background: linear-gradient(90deg, rgba(255, 107, 112, 0.5), rgba(255, 107, 112, 0.95));
}
</style>
