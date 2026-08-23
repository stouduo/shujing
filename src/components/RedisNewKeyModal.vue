<script setup lang="ts">
import { computed, ref } from 'vue'
import { NButton, NInput, NModal, NRadioButton, NRadioGroup, useMessage } from 'naive-ui'
import { redisNewKey } from '../api'
import type { RedisTab } from '../types'
import Icon from './Icon.vue'

const props = defineProps<{ show: boolean; tab: RedisTab }>()
const emit = defineEmits<{ (e: 'update:show', v: boolean): void }>()

const message = useMessage()

const keyName = ref('')
const keyType = ref<'string' | 'hash' | 'list' | 'set' | 'zset'>('string')
const text = ref('')
/** 每行:hash 为 field=value / zset 为 member score / list、set 为 member */
const lines = ref('')

const parsedPairs = computed<[string, string][]>(() => {
  const out: [string, string][] = []
  for (const raw of lines.value.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    if (keyType.value === 'hash') {
      const i = line.indexOf('=')
      if (i > 0) out.push([line.slice(0, i).trim(), line.slice(i + 1).trim()])
    } else if (keyType.value === 'zset') {
      const parts = line.split(/\s+/)
      if (parts.length >= 2) {
        const score = parts[parts.length - 1]
        const member = parts.slice(0, -1).join(' ')
        if (!Number.isNaN(Number(score))) out.push([member, score])
      }
    } else {
      out.push(['', line])
    }
  }
  return out
})

const preview = computed(() => `${parsedPairs.value.length} 条${keyType.value === 'string' ? '' : '记录'}`)

async function create() {
  const t = props.tab
  if (!t.connId) return
  const k = keyName.value.trim()
  if (!k) {
    message.warning('请填写 key 名称')
    return
  }
  if (keyType.value !== 'string' && !parsedPairs.value.length) {
    message.warning('请至少输入一条记录')
    return
  }
  try {
    await redisNewKey(t.connId, t.db, k, keyType.value, text.value, parsedPairs.value)
    message.success(`已创建 ${k}`)
    emit('update:show', false)
    // 刷新浏览页
    window.dispatchEvent(new CustomEvent('redis-refresh', { detail: { tabId: t.id, key: k } }))
  } catch (e) {
    message.error(String(e))
  }
}

const hint = computed(() => {
  switch (keyType.value) {
    case 'hash': return '每行一条:field=value'
    case 'zset': return '每行一条:member score(如 张三 98)'
    case 'list': return '每行一个元素(尾部追加)'
    case 'set': return '每行一个成员'
    default: return ''
  }
})
</script>

<template>
  <n-modal
    :show="props.show"
    preset="card"
    :title="`新建 key · db${tab.db}`"
    :style="{ width: '520px' }"
    @update:show="(v: boolean) => emit('update:show', v)"
  >
    <div class="form-col">
      <n-input v-model:value="keyName" size="small" class="mono" placeholder="key 名称,如 user:1001" />
      <n-radio-group v-model:value="keyType" size="small">
        <n-radio-button value="string">STRING</n-radio-button>
        <n-radio-button value="hash">HASH</n-radio-button>
        <n-radio-button value="list">LIST</n-radio-button>
        <n-radio-button value="set">SET</n-radio-button>
        <n-radio-button value="zset">ZSET</n-radio-button>
      </n-radio-group>
      <n-input
        v-if="keyType === 'string'"
        v-model:value="text"
        type="textarea"
        class="mono"
        :autosize="{ minRows: 6, maxRows: 14 }"
        placeholder="字符串值"
      />
      <template v-else>
        <div class="hint mono">{{ hint }}</div>
        <n-input
          v-model:value="lines"
          type="textarea"
          class="mono"
          :autosize="{ minRows: 6, maxRows: 14 }"
          :placeholder="keyType === 'hash' ? 'name=张三\ncity=北京' : keyType === 'zset' ? '张三 98\n李四 87' : '值1\n值2'"
        />
        <div class="pv">{{ preview }}</div>
      </template>
    </div>
    <template #footer>
      <div class="footer">
        <n-button size="small" @click="emit('update:show', false)">取消</n-button>
        <n-button size="small" type="primary" @click="create">
          <Icon name="plus" :size="12" /> 创建
        </n-button>
      </div>
    </template>
  </n-modal>
</template>

<style scoped>
.form-col {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.hint {
  font-size: 11.5px;
  color: var(--text-tertiary);
}
.pv {
  font-size: 11.5px;
  color: var(--accent);
}
.footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
