<script setup lang="ts">
import { computed, ref } from 'vue'
import { NButton, NModal, NSpin, useMessage } from 'naive-ui'
import * as api from '../api'
import { explainSql, planCheck, staticCheck, type Finding } from '../sqlAdvisor'
import { useAppStore } from '../stores/app'
import type { DbType, ExecResult } from '../types'
import Icon from './Icon.vue'
import ResultsGrid from './ResultsGrid.vue'

const props = defineProps<{ show: boolean; sql: string; connId: string | null }>()
const emit = defineEmits<{ (e: 'update:show', v: boolean): void }>()

const store = useAppStore()
const message = useMessage()

const running = ref(false)
const ran = ref(false)
const plan = ref<ExecResult | null>(null)
const error = ref('')

const dbType = computed<DbType>(() => {
  const c = store.connById(props.connId ?? '')
  return c?.dbType ?? 'mysql'
})

const staticFindings = computed<Finding[]>(() => staticCheck(props.sql))
const planFindings = computed<Finding[]>(() =>
  plan.value ? planCheck(dbType.value, plan.value) : [],
)

const allFindings = computed(() => [...staticFindings.value, ...planFindings.value])
const dangerN = computed(() => allFindings.value.filter((f) => f.level === 'danger').length)
const warnN = computed(() => allFindings.value.filter((f) => f.level === 'warn').length)

const grade = computed(() => {
  if (!ran.value) return ''
  if (dangerN.value > 0) return { t: '需优化', c: 'g3' }
  if (warnN.value > 0) return { t: '可改进', c: 'g2' }
  return { t: '良好', c: 'g1' }
})

async function runExplain() {
  const sql = props.sql.trim()
  if (!sql) {
    message.warning('当前查询页没有 SQL')
    return
  }
  if (!/^select\b/i.test(sql)) {
    message.warning('优化分析仅支持 SELECT 语句')
    return
  }
  if (!props.connId) {
    message.warning('请先选择连接')
    return
  }
  running.value = true
  error.value = ''
  try {
    if (!store.live[props.connId]) await store.connect(props.connId)
    const rs = await api.runSql(props.connId, explainSql(dbType.value, sql), 200)
    plan.value = rs[0] ?? null
    ran.value = true
  } catch (e) {
    error.value = String(e)
  } finally {
    running.value = false
  }
}
</script>

<template>
  <n-modal
    :show="props.show"
    preset="card"
    title="SQL 优化分析"
    :style="{ width: '760px' }"
    @update:show="(v: boolean) => emit('update:show', v)"
  >
    <div class="ctrl">
      <n-button size="small" type="primary" :loading="running" @click="runExplain">
        <Icon name="play" :size="12" /> 运行分析
      </n-button>
      <span v-if="grade" class="grade" :class="grade.c">{{ grade.t }}</span>
      <span v-if="ran" class="summary">
        {{ dangerN }} 项风险 · {{ warnN }} 项警告 · {{ allFindings.length - dangerN - warnN }} 项提示
      </span>
      <div class="gap" />
      <span class="dialect">{{ dbType }} · {{ dbType === 'postgres' ? 'EXPLAIN ANALYZE' : 'EXPLAIN' }}</span>
    </div>

    <div class="sql-preview mono" :title="props.sql">{{ props.sql.trim().slice(0, 160) }}</div>

    <n-spin v-if="running" size="small" style="width: 100%; padding: 30px 0" />
    <div v-else-if="error" class="err mono">{{ error }}</div>

    <template v-else-if="ran">
      <!-- 诊断结果 -->
      <div class="sec-title">诊断建议</div>
      <div v-if="allFindings.length" class="findings">
        <div v-for="(f, i) in allFindings" :key="i" class="finding" :class="f.level">
          <span class="f-badge">{{ f.level === 'danger' ? '危险' : f.level === 'warn' ? '警告' : '提示' }}</span>
          <div class="f-body">
            <div class="f-title">{{ f.title }}</div>
            <div class="f-detail">{{ f.detail }}</div>
          </div>
        </div>
      </div>

      <!-- 执行计划 -->
      <template v-if="plan && plan.columns.length">
        <div class="sec-title">执行计划</div>
        <div class="plan-grid">
          <ResultsGrid
            :columns="plan.columns"
            :rows="plan.rows"
            :truncated="false"
            :row-height="'compact'"
          />
        </div>
      </template>
    </template>
    <div v-else class="empty">点击「运行分析」执行 EXPLAIN 并给出优化建议;静态规则无需连接即可检查</div>
  </n-modal>
</template>

<style scoped>
.ctrl {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}
.grade {
  font-size: 13px;
  font-weight: 700;
  padding: 2px 12px;
  border-radius: 6px;
}
.grade.g1 {
  color: var(--green);
  background: rgba(48, 209, 88, 0.12);
}
.grade.g2 {
  color: var(--warn);
  background: rgba(255, 214, 10, 0.12);
}
.grade.g3 {
  color: var(--danger);
  background: rgba(255, 69, 58, 0.12);
}
.summary {
  font-size: 12px;
  color: var(--text-tertiary);
}
.gap {
  flex: 1;
}
.dialect {
  font-size: 11px;
  color: var(--text-tertiary);
}
.sql-preview {
  font-size: 11.5px;
  color: var(--text-secondary);
  background: var(--bg-grid);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 7px 12px;
  margin-bottom: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.err {
  margin: 8px 0;
  padding: 8px 12px;
  border-radius: 8px;
  background: rgba(255, 69, 58, 0.1);
  border: 1px solid rgba(255, 69, 58, 0.25);
  color: #ff8a80;
  font-size: 12px;
}
.sec-title {
  font-size: 12px;
  font-weight: 700;
  color: var(--text-secondary);
  margin: 6px 0 8px;
}
.findings {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 14px;
  max-height: 260px;
  overflow-y: auto;
}
.finding {
  display: flex;
  gap: 10px;
  padding: 8px 12px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--bg-grid);
}
.finding.danger {
  border-color: rgba(255, 69, 58, 0.35);
}
.finding.warn {
  border-color: rgba(255, 214, 10, 0.3);
}
.f-badge {
  flex-shrink: 0;
  width: 38px;
  height: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 5px;
  font-size: 10.5px;
  font-weight: 700;
  margin-top: 1px;
}
.danger .f-badge {
  color: #fff;
  background: var(--danger);
}
.warn .f-badge {
  color: #1d1d1f;
  background: var(--warn);
}
.info .f-badge {
  color: var(--accent);
  border: 1px solid rgba(133, 135, 246, 0.4);
}
.f-title {
  font-size: 12.5px;
  font-weight: 700;
  color: var(--text);
}
.f-detail {
  font-size: 11.5px;
  color: var(--text-secondary);
  line-height: 1.6;
  margin-top: 2px;
}
.plan-grid {
  height: 220px;
  border: 1px solid var(--border-strong);
  border-radius: 10px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.empty {
  padding: 40px;
  text-align: center;
  color: var(--text-tertiary);
  font-size: 12.5px;
}
</style>
