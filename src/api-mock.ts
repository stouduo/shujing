/**
 * 浏览器预览模式的 mock IPC 层。
 * 无 Tauri 环境时提供确定性的示例数据,让 UI(连接树/分页/排序/结构/编辑)
 * 可以脱离真实数据库完整交互与测试。
 */
import type {
  ConnInfo,
  ConnectResult,
  ExecResult,
  FkMeta,
  SearchHit,
  TableMeta,
  TableStructure,
} from './types'

// ── 确定性伪随机 ──────────────────────────────────────
function seeded(seed: number): number {
  let x = Math.sin(seed * 12.9898) * 43758.5453
  x = x - Math.floor(x)
  return x
}
function pick<T>(arr: T[], seed: number): T {
  return arr[Math.floor(seeded(seed) * arr.length) % arr.length]
}

const SURNAMES = ['王', '李', '张', '刘', '陈', '杨', '赵', '黄', '周', '吴']
const GIVEN = ['伟', '芳', '娜', '敏', '静', '磊', '军', '洋', '勇', '艳', '杰', '涛', '明', '超', '秀英']
const CITIES = ['北京', '上海', '广州', '深圳', '杭州', '成都', '武汉', '南京', '西安', '苏州']
const STATUSES = ['pending', 'paid', 'shipped', 'completed', 'refunded']
const CATEGORIES = ['电子', '家居', '服饰', '食品', '图书', '运动']

interface MockTable {
  name: string
  kind: string
  total: number
  columns: { name: string; type: string; key?: string; nullable?: boolean }[]
  ddl: string
  row: (i: number) => (string | null)[]
}

function userName(i: number): string {
  return `${pick(SURNAMES, i * 7 + 1)}${pick(GIVEN, i * 13 + 2)}${seeded(i * 3 + 5) > 0.6 ? pick(GIVEN, i * 17 + 3) : ''}`
}
function dateStr(i: number, base = '2024'): string {
  const day = (i * 37) % 365
  const m = String(Math.floor(day / 30) + 1).padStart(2, '0')
  const d = String((day % 30) + 1).padStart(2, '0')
  return `${base}-${m}-${d} ${String((i * 5) % 24).padStart(2, '0')}:${String((i * 11) % 60).padStart(2, '0')}:${String((i * 29) % 60).padStart(2, '0')}`
}

const TABLES: MockTable[] = [
  {
    name: 'users',
    kind: 'table',
    total: 2345,
    columns: [
      { name: 'id', type: 'INTEGER', key: 'PRI' },
      { name: 'name', type: 'VARCHAR(50)' },
      { name: 'email', type: 'VARCHAR(120)' },
      { name: 'age', type: 'INT' },
      { name: 'city', type: 'VARCHAR(20)' },
      { name: 'balance', type: 'DECIMAL(12,2)' },
      { name: 'is_vip', type: 'TINYINT' },
      { name: 'created_at', type: 'DATETIME' },
      { name: 'bio', type: 'TEXT', nullable: true },
      { name: 'profile', type: 'JSON', nullable: true },
    ],
    ddl: 'CREATE TABLE `users` (\n  `id` INTEGER PRIMARY KEY AUTOINCREMENT,\n  `name` VARCHAR(50) NOT NULL,\n  `email` VARCHAR(120),\n  `age` INT,\n  `city` VARCHAR(20),\n  `balance` DECIMAL(12,2) DEFAULT 0,\n  `is_vip` TINYINT DEFAULT 0,\n  `created_at` DATETIME,\n  `bio` TEXT,\n  `profile` JSON\n);',
    row: (i) => [
      String(i + 1),
      userName(i + 1),
      `${userName(i + 1)}${i + 1}@example.com`,
      String(18 + (i * 7) % 48),
      seeded(i * 3 + 2) > 0.08 ? pick(CITIES, i + 4) : null,
      (seeded(i * 11 + 6) * 100000).toFixed(2),
      seeded(i * 5 + 9) > 0.7 ? '1' : '0',
      dateStr(i + 1),
      seeded(i * 13 + 3) > 0.15
        ? `第 ${i + 1} 位注册用户。${userName(i + 1)}擅长数据库设计与性能调优,长期关注分布式存储与查询优化方向,曾在多个技术大会上分享高并发场景下的索引实践经验。加入平台以来持续输出高质量内容,是社区公认的资深贡献者。个人信条:把复杂的问题拆简单,把简单的问题做扎实。`
        : null,
      seeded(i * 17 + 5) > 0.1
        ? JSON.stringify({
            id: i + 1,
            level: 1 + ((i * 3) % 9),
            tags: ['database', 'sql', pick(CATEGORIES, i + 2)],
            address: { city: pick(CITIES, i + 4), street: `科技路 ${(i % 200) + 1} 号` },
            vip: seeded(i * 5 + 9) > 0.7,
            joinedAt: dateStr(i + 1, '2023').slice(0, 10),
          })
        : null,
    ],
  },
  {
    name: 'orders',
    kind: 'table',
    total: 876,
    columns: [
      { name: 'id', type: 'INTEGER', key: 'PRI' },
      { name: 'user_id', type: 'INT' },
      { name: 'product_id', type: 'INT' },
      { name: 'amount', type: 'DECIMAL(10,2)' },
      { name: 'status', type: 'VARCHAR(20)' },
      { name: 'created_at', type: 'DATETIME' },
    ],
    ddl: 'CREATE TABLE `orders` (\n  `id` INTEGER PRIMARY KEY,\n  `user_id` INT NOT NULL,\n  `product_id` INT,\n  `amount` DECIMAL(10,2),\n  `status` VARCHAR(20),\n  `created_at` DATETIME\n);',
    row: (i) => [
      String(10000 + i),
      String((i * 17) % 2345 + 1),
      String((i * 13) % 120 + 1),
      (9.9 + seeded(i * 7 + 3) * 2000).toFixed(2),
      pick(STATUSES, i + 2),
      dateStr(i + 1, '2025'),
    ],
  },
  {
    name: 'products',
    kind: 'table',
    total: 120,
    columns: [
      { name: 'id', type: 'INTEGER', key: 'PRI' },
      { name: 'name', type: 'VARCHAR(80)' },
      { name: 'category', type: 'VARCHAR(20)' },
      { name: 'price', type: 'DECIMAL(8,2)' },
      { name: 'stock', type: 'INT' },
    ],
    ddl: 'CREATE TABLE `products` (\n  `id` INTEGER PRIMARY KEY,\n  `name` VARCHAR(80) NOT NULL,\n  `category` VARCHAR(20),\n  `price` DECIMAL(8,2),\n  `stock` INT DEFAULT 0\n);',
    row: (i) => [
      String(i + 1),
      `${pick(CATEGORIES, i + 1)}商品 ${String.fromCharCode(65 + (i % 26))}${i + 1}`,
      pick(CATEGORIES, i + 3),
      (1 + seeded(i * 5 + 2) * 999).toFixed(2),
      String((i * 31) % 500),
    ],
  },
  {
    name: 'vw_stats',
    kind: 'view',
    total: 60,
    columns: [
      { name: 'city', type: 'VARCHAR(20)' },
      { name: 'order_count', type: 'BIGINT' },
      { name: 'total_amount', type: 'DECIMAL(14,2)' },
    ],
    ddl: 'CREATE VIEW `vw_stats` AS\nSELECT city, COUNT(*) AS order_count, SUM(amount) AS total_amount\nFROM orders GROUP BY city;',
    row: (i) => [
      CITIES[i % CITIES.length],
      String(50 + ((i * 37) % 300)),
      (((i * 53) % 9000) + 0.5).toFixed(2),
    ],
  },
]

function findTable(name: string | undefined): MockTable | undefined {
  return TABLES.find((t) => t.name === name)
}

// ── 内存连接存储 ──────────────────────────────────────
function findRk(args?: Record<string, unknown>) {
  const db = Number(args?.db ?? 0)
  return (REDIS_KEYS[db] ?? []).find((x) => x.key === String(args?.key))
}

// Redis 模拟数据
const REDIS_KEYS: Record<number, { key: string; type: string; value: string; pairs: [string, string][]; ttl: number }[]> = {
  0: [
    { key: 'session:1001', type: 'string', value: 'user=张三&role=admin&login=2026-08-20 10:00:00', pairs: [], ttl: 3600 },
    { key: 'session:1002', type: 'string', value: 'user=李四&role=user&login=2026-08-21 09:30:00', pairs: [], ttl: 7200 },
    { key: 'cache:user:profile:1', type: 'hash', value: '', pairs: [['name', '张三'], ['city', '北京'], ['vip', '1'], ['balance', '1024.50']], ttl: -1 },
    { key: 'queue:emails', type: 'list', value: '', pairs: [['', 'a@x.com'], ['', 'b@x.com'], ['', 'c@x.com']], ttl: -1 },
    { key: 'rank:score', type: 'zset', value: '', pairs: [['张三', '98'], ['李四', '87'], ['王五', '75']], ttl: -1 },
    { key: 'tags', type: 'set', value: '', pairs: [['', 'red'], ['', 'green'], ['', 'blue']], ttl: -1 },
  ],
  1: [
    { key: 'db1:config', type: 'string', value: '{\"mode\":\"prod\",\"debug\":false}', pairs: [], ttl: -1 },
  ],
}
let mockConns: ConnInfo[] = [
  {
    id: 'mock-sqlite',
    name: '示例 · SQLite',
    dbType: 'sqlite',
    host: null,
    port: null,
    user: null,
    password: null,
    database: null,
    filePath: '/tmp/demo.db',
    color: '#0a84ff',
  },
  {
    id: 'mock-redis',
    name: '示例 · Redis',
    dbType: 'redis',
    host: '127.0.0.1',
    port: 6379,
    user: null,
    password: null,
    database: '0',
    filePath: null,
    color: '#ff6b70',
  },
  {
    id: 'mock-mysql',
    name: '示例 · MySQL',
    dbType: 'mysql',
    host: '127.0.0.1',
    port: 3306,
    user: 'root',
    password: null,
    database: 'shop',
    filePath: null,
    color: '#f2915a',
  },
]

// ── SQL 解析(分页/排序/计数) ─────────────────────────
interface ParsedQuery {
  table?: string
  limit: number
  offset: number
  orderKey?: string
  orderDir: 'asc' | 'desc'
  where?: { col: string; op: string; value: string }
}

function parseQuery(sql: string): ParsedQuery {
  const from = sql.match(/FROM\s+[`"[]?(\w+)[`"\]]?/i)
  const limit = sql.match(/LIMIT\s+(\d+)/i)
  const offset = sql.match(/OFFSET\s+(\d+)/i)
  const order = sql.match(/ORDER\s+BY\s+[`"]?(\w+)[`"]?\s+(ASC|DESC)/i)
  const where = sql.match(
    /WHERE\s+[`"]?(\w+)[`"]?\s*(=|<>|>=|<=|>|<|LIKE)\s*('([^']*)'|(-?[\d.]+))/i,
  )
  return {
    table: from?.[1],
    limit: limit ? Number(limit[1]) : 100,
    offset: offset ? Number(offset[1]) : 0,
    orderKey: order?.[1],
    orderDir: (order?.[2]?.toLowerCase() as 'asc' | 'desc') ?? 'asc',
    where: where
      ? { col: where[1], op: where[2].toUpperCase(), value: where[4] ?? where[5] }
      : undefined,
  }
}

function rowMatches(
  row: (string | null)[],
  colIdx: number,
  where: { col: string; op: string; value: string },
): boolean {
  const v = row[colIdx] ?? ''
  const isNum = /^-?\d+(\.\d+)?$/.test(v) && /^-?\d+(\.\d+)?$/.test(where.value)
  switch (where.op) {
    case '=':
      return v === where.value
    case '<>':
      return v !== where.value
    case '>':
      return isNum ? Number(v) > Number(where.value) : v > where.value
    case '<':
      return isNum ? Number(v) < Number(where.value) : v < where.value
    case '>=':
      return isNum ? Number(v) >= Number(where.value) : v >= where.value
    case '<=':
      return isNum ? Number(v) <= Number(where.value) : v <= where.value
    case 'LIKE':
      return v.toLowerCase().includes(where.value.replace(/%/g, '').toLowerCase())
    default:
      return true
  }
}

function tableRows(t: MockTable, q: ParsedQuery): { rows: (string | null)[][]; truncated: boolean } {
  let rows: (string | null)[][] = []
  for (let i = 0; i < t.total; i++) rows.push(t.row(i))
  if (q.where) {
    const ci = t.columns.findIndex((c) => c.name === q.where!.col)
    if (ci >= 0) {
      const w = q.where
      rows = rows.filter((r) => rowMatches(r, ci, w))
    }
  }
  if (q.orderKey) {
    const ci = t.columns.findIndex((c) => c.name === q.orderKey)
    if (ci >= 0) {
      rows.sort((a, b) => {
        const x = a[ci] ?? ''
        const y = b[ci] ?? ''
        const cmp = String(x).localeCompare(String(y), undefined, { numeric: true })
        return q.orderDir === 'asc' ? cmp : -cmp
      })
    }
  }
  rows = rows.slice(q.offset, q.offset + q.limit)
  return { rows, truncated: q.offset + q.limit < t.total }
}

function structureOf(t: MockTable): TableStructure {
  return {
    columns: t.columns.map((c) => ({
      name: c.name,
      dataType: c.type,
      nullable: !c.key && c.name !== 'name',
      key: c.key ?? '',
      default: c.name === 'balance' ? '0' : null,
      extra: c.key ? 'PRIMARY KEY' : '',
      comment: '',
    })),
    indexes: t.kind === 'view'
      ? []
      : [
          { name: 'PRIMARY', columns: 'id', unique: true },
          ...(t.name === 'users'
            ? [{ name: 'idx_city', columns: 'city', unique: false }]
            : []),
        ],
    ddl: t.ddl,
  }
}

export async function mockInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  await new Promise((r) => setTimeout(r, 60 + Math.random() * 120))
  switch (cmd) {
    case 'list_saved_connections':
      return [...mockConns] as T
    case 'save_connection': {
      const info = args?.info as ConnInfo
      mockConns = mockConns.filter((c) => c.id !== info.id)
      mockConns.push(info)
      return [...mockConns] as T
    }
    case 'delete_connection':
      mockConns = mockConns.filter((c) => c.id !== args?.id)
      return [...mockConns] as T
    case 'test_connection':
    case 'connect': {
      const info = args?.info as ConnInfo
      const version =
        info.dbType === 'sqlite'
          ? 'SQLite 3.45.1 (预览模式示例数据)'
          : info.dbType === 'mysql'
            ? 'MySQL 8.0.36 (预览模式示例数据)'
            : 'PostgreSQL 16.2 (预览模式示例数据)'
      return { version } satisfies ConnectResult as T
    }
    case 'disconnect':
      return undefined as T
    case 'list_tables':
      return [
        ...TABLES.map((t) => ({ name: t.name, kind: t.kind })),
        { name: 'trg_users_audit', kind: 'trigger' },
        { name: 'fn_calc_total', kind: 'function' },
        { name: 'proc_sync_stock', kind: 'procedure' },
      ] satisfies TableMeta[] as T
    case 'get_object_ddl': {
      const kind = String(args?.kind ?? '')
      const name = String(args?.name ?? '')
      if (kind === 'trigger') {
        return `CREATE TRIGGER trg_users_audit\nAFTER UPDATE ON users\nBEGIN\n  INSERT INTO users_log(user_id, action, at) VALUES (NEW.id, 'update', datetime('now'));\nEND;` as T
      }
      if (kind === 'procedure') {
        return `CREATE PROCEDURE proc_sync_stock()\nBEGIN\n  UPDATE products SET stock = stock - 1 WHERE id IN (SELECT product_id FROM orders WHERE status = 'paid');\nEND;` as T
      }
      return `CREATE FUNCTION fn_calc_total(p_user_id INT)\nRETURNS DECIMAL(12,2)\nDETERMINISTIC\nBEGIN\n  DECLARE total DECIMAL(12,2);\n  SELECT SUM(amount) INTO total FROM orders WHERE user_id = p_user_id;\n  RETURN IFNULL(total, 0);\nEND; -- ${name}` as T
    }
    case 'count_rows': {
      const t = findTable(args?.table as string)
      return (t?.total ?? 0) as T
    }
    case 'search_all_tables': {
      const kw = String(args?.keyword ?? '').toLowerCase()
      const max = Number(args?.maxHits ?? 50)
      const hits: SearchHit[] = []
      for (const t of TABLES) {
        if (t.kind !== 'table') continue
        let perTable = 0
        for (let i = 0; i < t.total && hits.length < max && perTable < 3; i++) {
          const row = t.row(i)
          const ci = row.findIndex((v) => v !== null && v.toLowerCase().includes(kw))
          if (ci >= 0) {
            hits.push({ table: t.name, column: t.columns[ci].name, columns: t.columns.map((c) => c.name), row })
            perTable++
          }
        }
      }
      return hits satisfies SearchHit[] as T
    }
    case 'redis_databases': {
      const dbs = Object.keys(REDIS_KEYS).map(Number)
      if (!dbs.includes(0)) dbs.push(0)
      return dbs.sort((a, b) => a - b).map((d) => [d, (REDIS_KEYS[d] ?? []).length]) as T
    }
    case 'redis_scan': {
      const db = Number(args?.db ?? 0)
      const pattern = String(args?.pattern ?? '*')
      const kw = pattern.replace(/\*/g, '').toLowerCase()
      const keys = (REDIS_KEYS[db] ?? [])
        .filter((k) => !kw || k.key.toLowerCase().includes(kw))
        .map((k) => k.key)
      return [0, keys] as T
    }
    case 'redis_key_types': {
      const db = Number(args?.db ?? 0)
      const keys = (args?.keys ?? []) as string[]
      return keys.map((k) => (REDIS_KEYS[db] ?? []).find((x) => x.key === k)?.type ?? 'none') as T
    }
    case 'redis_key_detail': {
      const db = Number(args?.db ?? 0)
      const key = String(args?.key ?? '')
      const k = (REDIS_KEYS[db] ?? []).find((x) => x.key === key)
      if (!k) throw new Error('key 不存在')
      return {
        keyType: k.type,
        ttl: k.ttl,
        len: k.type === 'string' ? k.value.length : k.pairs.length,
        text: k.type === 'string' ? k.value : null,
        pairs: k.pairs,
      } as T
    }
    case 'redis_del': {
      const db = Number(args?.db ?? 0)
      const list = REDIS_KEYS[db] ?? []
      const i = list.findIndex((x) => x.key === String(args?.key))
      if (i >= 0) list.splice(i, 1)
      return 1 as T
    }
    case 'redis_set': {
      const db = Number(args?.db ?? 0)
      const list = REDIS_KEYS[db] ?? (REDIS_KEYS[db] = [])
      const key = String(args?.key)
      const exist = list.find((x) => x.key === key)
      if (exist) {
        exist.value = String(args?.value)
        exist.type = 'string'
        exist.pairs = []
      } else {
        list.push({ key, type: 'string', value: String(args?.value), pairs: [], ttl: -1 })
      }
      return undefined as T
    }
    case 'redis_set_ttl': {
      const k = findRk(args)
      if (k) k.ttl = Number(args?.seconds) < 0 ? -1 : Number(args?.seconds)
      return undefined as T
    }
    case 'redis_rename': {
      const k = findRk(args)
      if (k) k.key = String(args?.newKey)
      return undefined as T
    }
    case 'redis_ttl_batch': {
      const db = Number(args?.db ?? 0)
      const keys = (args?.keys ?? []) as string[]
      return keys.map((k) => (REDIS_KEYS[db] ?? []).find((x) => x.key === k)?.ttl ?? -2) as T
    }
    case 'redis_new_key': {
      const db = Number(args?.db ?? 0)
      const list = REDIS_KEYS[db] ?? (REDIS_KEYS[db] = [])
      const type = String(args?.keyType ?? 'string')
      if (list.some((x) => x.key === String(args?.key))) throw new Error('key 已存在')
      list.push({
        key: String(args?.key),
        type,
        value: String(args?.text ?? ''),
        pairs: type === 'string' ? [] : ((args?.pairs ?? []) as [string, string][]),
        ttl: -1,
      })
      return undefined as T
    }
    case 'redis_member_op': {
      const k = findRk(args)
      if (!k) throw new Error('key 不存在')
      const op = String(args?.op)
      const member = String(args?.member ?? '')
      const extra = String(args?.extra ?? '')
      if (k.type === 'hash') {
        if (op === 'del') k.pairs = k.pairs.filter((p) => p[0] !== member)
        else k.pairs = [...k.pairs.filter((p) => p[0] !== member), [member, extra] as [string, string]].sort((a, b) => a[0].localeCompare(b[0]))
      } else if (k.type === 'zset') {
        if (op === 'del') k.pairs = k.pairs.filter((p) => p[0] !== member)
        else k.pairs = [...k.pairs.filter((p) => p[0] !== member), [member, extra] as [string, string]].sort((a, b) => Number(b[1]) - Number(a[1]))
      } else {
        // list / set
        if (op === 'del') k.pairs = k.pairs.filter((p) => p[1] !== member)
        else k.pairs = [...k.pairs, ['', member] as [string, string]]
      }
      return undefined as T
    }
    case 'redis_analyze': {
      const db = Number(args?.db ?? 0)
      const mode = String(args?.mode ?? 'big')
      const list = REDIS_KEYS[db] ?? []
      const stats = list.map((k, i) => ({
        key: k.key,
        keyType: k.type,
        mem:
          k.type === 'string'
            ? k.value.length * 2 + 90
            : k.pairs.reduce((n, p) => n + (p[0].length + p[1].length) * 2 + 120, 56),
        len: k.type === 'string' ? k.value.length : k.pairs.length,
        freq: mode === 'hot' ? Math.floor(seeded(i * 7 + 3) * 255) : -1,
      }))
      if (mode === 'hot') stats.sort((a, b) => b.freq - a.freq)
      else stats.sort((a, b) => b.mem - a.mem)
      return stats as T
    }
    case 'redis_run': {
      const cmd = String(args?.command ?? '').trim()
      const head = cmd.split(/\s+/)[0]?.toUpperCase() ?? ''
      if (head === 'PING') return ['PONG'] as T
      if (head === 'DBSIZE') {
        const db = Number((cmd.match(/(\d+)/) ?? ['0'])[0])
        return [String((REDIS_KEYS[db] ?? []).length)] as T
      }
      if (head === 'KEYS') {
        return Object.values(REDIS_KEYS).flat().map((k) => k.key).slice(0, 50) as T
      }
      if (head === 'INFO') return ['redis_version:7.2.4 (预览模式示例)', 'tcp_port:6379'] as T
      return ['(预览模式仅支持 PING / DBSIZE / KEYS / INFO 演示)'] as T
    }
    case 'list_foreign_keys':
      return [
        { table: 'orders', column: 'user_id', refTable: 'users', refColumn: 'id' },
        { table: 'orders', column: 'product_id', refTable: 'products', refColumn: 'id' },
        { table: 'vw_stats', column: 'city', refTable: 'users', refColumn: 'city' },
      ] satisfies FkMeta[] as T
    case 'get_table_structure': {
      const t = findTable(args?.table as string)
      if (!t) throw new Error(`表 ${args?.table} 不存在`)
      return structureOf(t) as T
    }
    case 'run_sql': {
      const sql = String(args?.sql ?? '')
      const maxRows = Number(args?.maxRows ?? 1000)
      // 只读连接白名单(与后端一致)
      const roConn = mockConns.find((c) => c.id === args?.id)
      if (roConn?.readOnly && !/^\s*(select|with|explain|show|describe|desc|pragma)\b/i.test(sql)) {
        throw new Error('只读连接:仅允许 SELECT/WITH/EXPLAIN/SHOW/DESCRIBE/PRAGMA')
      }
      let single: ExecResult
      // COUNT
      const countM = sql.match(/COUNT\(\*\)\s+FROM\s+[`"[]?(\w+)/i)
      if (countM) {
        const t = findTable(countM[1])
        let n = t?.total ?? 0
        if (t) {
          const q0 = parseQuery(sql)
          if (q0.where) {
            const ci = t.columns.findIndex((c) => c.name === q0.where!.col)
            if (ci >= 0) {
              const w = q0.where
              let cnt = 0
              for (let i = 0; i < t.total; i++) {
                if (rowMatches(t.row(i), ci, w)) cnt++
              }
              n = cnt
            }
          }
        }
        single = {
          columns: ['count'],
          rows: [[String(n)]],
          affected: 1,
          truncated: false,
          elapsedMs: 3,
        }
      } else {
        const q = parseQuery(sql)
        const t = findTable(q.table)
        if (t) {
          const { rows, truncated } = tableRows(t, q)
          single = {
            columns: t.columns.map((c) => c.name),
            rows: rows.slice(0, maxRows),
            affected: rows.length,
            truncated,
            elapsedMs: 5 + Math.floor(Math.random() * 40),
          }
        } else if (/^\s*(insert|update|delete|create|drop|alter)\b/i.test(sql)) {
          single = {
            columns: [],
            rows: [],
            affected: 1 + Math.floor(Math.random() * 5),
            truncated: false,
            elapsedMs: 12,
          }
        } else {
          single = {
            columns: ['提示'],
            rows: [['预览模式下仅能查询示例表:users / orders / products / vw_stats']],
            affected: 1,
            truncated: false,
            elapsedMs: 2,
          }
        }
      }
      // 多语句(分号分隔)模拟多结果集,便于验证切换 UI
      const stmts = sql.split(';').map((s) => s.trim()).filter(Boolean)
      if (stmts.length > 1 && !/^\s*(insert|update|delete|create|drop|alter)/i.test(stmts[0])) {
        const extra = parseQuery(stmts[1] ?? '')
        const t2 = findTable(extra.table)
        if (t2) {
          const r2 = tableRows(t2, { ...extra, limit: 5 })
          return [
            single,
            {
              columns: t2.columns.map((c) => c.name),
              rows: r2.rows,
              affected: r2.rows.length,
              truncated: false,
              elapsedMs: single.elapsedMs,
            },
          ] satisfies ExecResult[] as T
        }
      }
      return [single] satisfies ExecResult[] as T
    }
    case 'apply_changes':
      return Math.max(
        ((args?.updates as unknown[] | undefined)?.length ?? 0) +
          ((args?.deletes as unknown[] | undefined)?.length ?? 0) +
          ((args?.inserts as unknown[] | undefined)?.length ?? 0),
        1,
      ) as T
    case 'write_text_file':
      console.info('[mock] 导出文件(预览模式仅记录):', args?.path)
      return undefined as T
    case 'read_text_file':
      throw new Error('预览模式请使用文件选择控件读取本地文件')
    case 'read_binary_file':
      throw new Error('预览模式请使用文件选择控件读取本地文件')
    case 'write_binary_file':
      console.info('[mock] 写二进制文件(预览模式仅记录):', args?.path)
      return undefined as T
    case 'export_table_sql': {
      const t = findTable(args?.table as string)
      const withData = args?.withData !== false
      const ddl = t?.ddl ?? ''
      let sql = `-- 数镜 dump: table ${args?.table}\n${ddl}\n`
      let rows = 0
      if (withData && t) {
        const limit = Math.min(t.total, 20)
        sql += `\nINSERT INTO ${t.name} VALUES\n`
        for (let i = 0; i < limit; i++) {
          sql += `(${t.row(i).map((v) => (v === null ? 'NULL' : `'${v}'`)).join(', ')}),\n`
          rows++
        }
        sql = sql.trimEnd().replace(/,$/, ';\n')
      }
      return { sql, rows } as T
    }
    case 'export_database_sql': {
      const withData = args?.withData !== false
      let sql = '-- 数镜 database dump (预览模式示例)\n\n'
      let rows = 0
      for (const t of TABLES.filter((x) => x.kind === 'table')) {
        sql += `${t.ddl}\n`
        if (withData) {
          sql += `INSERT INTO ${t.name} VALUES (...示例 ${Math.min(t.total, 5)} 行)...;\n`
          rows += Math.min(t.total, 5)
        }
        sql += '\n'
      }
      return { sql, rows } as T
    }
    default:
      throw new Error(`mock 未实现命令: ${cmd}`)
  }
}
