import { invoke } from '@tauri-apps/api/core'
import { mockInvoke } from './api-mock'
import type {
  CellUpdate,
  ConnInfo,
  ConnectResult,
  ExecResult,
  FkMeta,
  RedisDetail,
  SearchHit,
  TableMeta,
  TableStructure,
} from './types'

const inTauri = '__TAURI_INTERNALS__' in window

export { inTauri as isTauri }

function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!inTauri) return mockInvoke<T>(cmd, args)
  return invoke<T>(cmd, args)
}

export const listSavedConnections = () => call<ConnInfo[]>('list_saved_connections')

export const saveConnection = (info: ConnInfo) => call<ConnInfo[]>('save_connection', { info })

export const deleteConnection = (id: string) => call<ConnInfo[]>('delete_connection', { id })

export const testConnection = (info: ConnInfo) => call<ConnectResult>('test_connection', { info })

export const connect = (info: ConnInfo) => call<ConnectResult>('connect', { info })

export const disconnect = (id: string) => call<void>('disconnect', { id })

export const listTables = (id: string) => call<TableMeta[]>('list_tables', { id })

export const getTableStructure = (id: string, table: string) =>
  call<TableStructure>('get_table_structure', { id, table })

export const countRows = (id: string, table: string) => call<number>('count_rows', { id, table })

export const listForeignKeys = (id: string) => call<FkMeta[]>('list_foreign_keys', { id })

export const getObjectDdl = (id: string, kind: string, name: string) =>
  call<string>('get_object_ddl', { id, kind, name })

// ── Redis ────────────────────────────────────────────
export const redisDatabases = (id: string) => call<[number, number][]>('redis_databases', { id })

export const redisScan = (id: string, db: number, pattern: string, cursor: number, count = 200) =>
  call<[number, string[]]>('redis_scan', { id, db, pattern, cursor, count })

export const redisKeyTypes = (id: string, db: number, keys: string[]) =>
  call<string[]>('redis_key_types', { id, db, keys })

export const redisKeyDetail = (id: string, db: number, key: string) =>
  call<RedisDetail>('redis_key_detail', { id, db, key })

export const redisDel = (id: string, db: number, key: string) =>
  call<number>('redis_del', { id, db, key })

export const redisSet = (id: string, db: number, key: string, value: string) =>
  call<void>('redis_set', { id, db, key, value })

export const redisSetTtl = (id: string, db: number, key: string, seconds: number) =>
  call<void>('redis_set_ttl', { id, db, key, seconds })

export const redisRename = (id: string, db: number, key: string, newKey: string) =>
  call<void>('redis_rename', { id, db, key, newKey })

export const redisTtlBatch = (id: string, db: number, keys: string[]) =>
  call<number[]>('redis_ttl_batch', { id, db, keys })

export const redisNewKey = (
  id: string,
  db: number,
  key: string,
  keyType: string,
  text: string,
  pairs: [string, string][],
) => call<void>('redis_new_key', { id, db, key, keyType, text, pairs })

export const redisMemberOp = (
  id: string,
  db: number,
  key: string,
  keyType: string,
  op: string,
  member: string,
  extra: string,
) => call<void>('redis_member_op', { id, db, key, keyType, op, member, extra })

export interface RedisKeyStat {
  key: string
  keyType: string
  mem: number
  len: number
  freq: number
}

export const redisAnalyze = (id: string, db: number, sample: number, mode: 'big' | 'hot') =>
  call<RedisKeyStat[]>('redis_analyze', { id, db, sample, mode })

export const redisRun = (id: string, command: string) =>
  call<string[]>('redis_run', { id, command })

/** 全局数据搜索:在连接的全部表中查找关键词 */
export const searchAllTables = (id: string, keyword: string, maxHits = 50) =>
  call<SearchHit[]>('search_all_tables', { id, keyword, maxHits })

/** 返回多结果集(PostgreSQL 完整支持,MySQL/SQLite 为第一个结果集) */
export const runSql = (id: string, sql: string, maxRows = 1000) =>
  call<ExecResult[]>('run_sql', { id, sql, maxRows })

export const readTextFile = (path: string) => call<string>('read_text_file', { path })

export const readBinaryFile = (path: string) => call<number[]>('read_binary_file', { path })

export const writeBinaryFile = (path: string, data: Uint8Array) =>
  call<void>('write_binary_file', { path, data: Array.from(data) })

/** 编辑回写:updates 为每行变更(主键定位 + 新值),deletes 为待删除行的主键,inserts 为新行的列值 */
export const applyChanges = (
  id: string,
  table: string,
  updates: CellUpdate[],
  deletes: [string, string][][],
  inserts: [string, string][][],
) =>
  call<number>('apply_changes', { id, table, updates, deletes, inserts })

/** 前端生成内容写入用户选择的路径(配合 dialog save) */
export const writeTextFile = (path: string, content: string) =>
  call<void>('write_text_file', { path, content })

/** 导出整表 SQL(结构+可选数据),返回文本由前端落盘 */
export const exportTableSql = (id: string, table: string, withData = true) =>
  call<{ sql: string; rows: number }>('export_table_sql', { id, table, withData })

/** 导出整个数据库 SQL */
export const exportDatabaseSql = (id: string, withData = true) =>
  call<{ sql: string; rows: number }>('export_database_sql', { id, withData })
