<script setup lang="ts">
import { reactive, ref, watch } from 'vue'
import {
  NButton,
  NForm,
  NFormItem,
  NInput,
  NInputNumber,
  NInputGroup,
  NModal,
  NRadioButton,
  NRadioGroup,
  NSwitch,
  useMessage,
} from 'naive-ui'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import * as api from '../api'
import { useAppStore } from '../stores/app'
import type { ConnInfo, DbType } from '../types'

const props = defineProps<{ show: boolean; editing: ConnInfo | null }>()
const emit = defineEmits<{ (e: 'update:show', v: boolean): void }>()

const store = useAppStore()
const message = useMessage()
const testing = ref(false)

const form = reactive({
  name: '',
  dbType: 'mysql' as DbType,
  host: '127.0.0.1',
  port: 3306,
  user: 'root',
  password: '',
  database: '',
  filePath: '',
  color: '' as string,
  readOnly: false,
})

const COLORS = ['#0a84ff', '#30d158', '#f2915a', '#bf7af0', '#ff6482', '#64d2ff']

function defaultPort(t: DbType): number {
  if (t === 'postgres') return 5432
  if (t === 'redis') return 6379
  return 3306
}

function defaultName(t: DbType): string {
  return {
    sqlite: 'SQLite 数据库',
    mysql: 'MySQL 连接',
    postgres: 'PostgreSQL 连接',
    redis: 'Redis 连接',
  }[t]!
}

watch(
  () => props.show,
  (v) => {
    if (!v) return
    const e = props.editing
    if (e) {
      form.name = e.name
      form.dbType = e.dbType
      form.host = e.host ?? '127.0.0.1'
      form.port = e.port ?? defaultPort(e.dbType)
      form.user = e.user ?? ''
      form.password = e.password ?? ''
      form.database = e.database ?? ''
      form.filePath = e.filePath ?? ''
      form.color = e.color ?? ''
      form.readOnly = !!e.readOnly
    } else {
      Object.assign(form, {
        name: '',
        dbType: 'mysql',
        host: '127.0.0.1',
        port: 3306,
        user: 'root',
        password: '',
        database: '',
        filePath: '',
        color: '',
        readOnly: false,
      })
    }
  },
)

// 类型切换时端口跟随默认值(仅当用户没改过)
watch(
  () => form.dbType,
  (t) => {
    if (form.port === 3306 || form.port === 5432) form.port = defaultPort(t)
    if (form.user === 'root' || form.user === 'postgres') {
      form.user = t === 'postgres' ? 'postgres' : 'root'
    }
  },
)

function buildInfo(): ConnInfo {
  const s = (v: string): string | null => (v.trim() === '' ? null : v.trim())
  const isServer = form.dbType !== 'sqlite'
  return {
    id: props.editing?.id ?? crypto.randomUUID(),
    name: form.name.trim() || defaultName(form.dbType),
    dbType: form.dbType,
    host: isServer ? s(form.host) : null,
    port: isServer ? form.port : null,
    user: isServer ? s(form.user) : null,
    password: isServer && form.password !== '' ? form.password : null,
    database: isServer ? s(form.database) : null,
    filePath: !isServer ? s(form.filePath) : null,
    color: form.color || null,
    readOnly: form.readOnly,
  }
}

async function test() {
  testing.value = true
  try {
    const r = await api.testConnection(buildInfo())
    message.success(`连接成功 · ${r.version}`)
  } catch (e) {
    message.error(String(e))
  } finally {
    testing.value = false
  }
}

async function save() {
  const info = buildInfo()
  if (info.dbType === 'sqlite' && !info.filePath) {
    message.warning('请选择 SQLite 数据库文件')
    return
  }
  if (info.dbType === 'mysql' || info.dbType === 'postgres') {
    if (!info.user) {
      message.warning('请填写用户名')
      return
    }
    if (!info.database) {
      message.warning('请填写数据库名')
      return
    }
  }
  try {
    await store.upsertConn(info)
    emit('update:show', false)
  } catch (e) {
    message.error(String(e))
  }
}

async function pickFile() {
  try {
    const f = await openDialog({
      title: '选择 SQLite 数据库文件',
      filters: [{ name: 'SQLite', extensions: ['db', 'sqlite', 'sqlite3', 'db3'] }],
    })
    if (typeof f === 'string' && f) form.filePath = f
  } catch {
    message.error('无法打开文件选择器')
  }
}
</script>

<template>
  <n-modal
    :show="props.show"
    preset="card"
    :title="props.editing ? '编辑连接' : '新建连接'"
    class="conn-modal"
    :style="{ width: '480px' }"
    :mask-closable="!testing"
    @update:show="(v: boolean) => emit('update:show', v)"
  >
    <n-form label-placement="left" label-width="76" size="small">
      <n-form-item label="名称">
        <n-input v-model:value="form.name" :placeholder="defaultName(form.dbType)" />
      </n-form-item>
      <n-form-item label="标识色">
        <div class="color-row">
          <button
            v-for="c in COLORS"
            :key="c"
            class="color-dot"
            :class="{ sel: form.color === c }"
            :style="{ background: c }"
            :title="c"
            @click="form.color = form.color === c ? '' : c"
          />
          <span v-if="!form.color" class="color-hint">不标色</span>
        </div>
      </n-form-item>
      <n-form-item label="只读模式">
        <div class="ro-row">
          <n-switch v-model:value="form.readOnly" size="small" />
          <span class="ro-hint">开启后仅允许查询,所有写入/DDL 被拦截(适合生产库)</span>
        </div>
      </n-form-item>
      <n-form-item label="类型">
        <n-radio-group v-model:value="form.dbType">
          <n-radio-button value="sqlite">SQLite</n-radio-button>
          <n-radio-button value="mysql">MySQL</n-radio-button>
          <n-radio-button value="postgres">PostgreSQL</n-radio-button>
          <n-radio-button value="redis">Redis</n-radio-button>
        </n-radio-group>
      </n-form-item>
      <template v-if="form.dbType === 'sqlite'">
        <n-form-item label="数据库文件">
          <n-input-group>
            <n-input v-model:value="form.filePath" placeholder="文件不存在时会自动创建" />
            <n-button @click="pickFile">浏览…</n-button>
          </n-input-group>
        </n-form-item>
      </template>
      <template v-else>
        <n-form-item label="主机">
          <n-input v-model:value="form.host" placeholder="127.0.0.1" />
        </n-form-item>
        <n-form-item label="端口">
          <n-input-number v-model:value="form.port" :min="1" :max="65535" style="width: 100%" />
        </n-form-item>
        <n-form-item v-if="form.dbType !== 'redis'" label="用户名">
          <n-input v-model:value="form.user" />
        </n-form-item>
        <n-form-item label="密码">
          <n-input
            v-model:value="form.password"
            type="password"
            show-password-on="click"
            placeholder="留空表示无密码"
          />
        </n-form-item>
        <n-form-item :label="form.dbType === 'redis' ? 'DB 编号' : '数据库'">
          <n-input
            v-model:value="form.database"
            :placeholder="form.dbType === 'redis' ? '0 - 15,默认 0' : ''"
            class={undefined}
          />
        </n-form-item>
      </template>
    </n-form>
    <template #footer>
      <div class="modal-footer">
        <n-button size="small" :loading="testing" @click="test">测试连接</n-button>
        <div class="gap" />
        <n-button size="small" @click="emit('update:show', false)">取消</n-button>
        <n-button size="small" type="primary" @click="save">保存</n-button>
      </div>
    </template>
  </n-modal>
</template>

<style scoped>
.modal-footer {
  display: flex;
  align-items: center;
}
.gap {
  flex: 1;
}
.color-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding-top: 2px;
}
.color-dot {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: 2px solid transparent;
  cursor: pointer;
  transition: transform 0.1s ease;
}
.color-dot:hover {
  transform: scale(1.15);
}
.color-dot.sel {
  border-color: #f5f5f7;
  box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.25);
}
.color-hint {
  font-size: 11.5px;
  color: var(--text-tertiary);
}
.ro-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.ro-hint {
  font-size: 11.5px;
  color: var(--text-tertiary);
  line-height: 1.5;
}
</style>
