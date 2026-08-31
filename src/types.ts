export type DbType = 'sqlite' | 'mysql' | 'postgres' | 'redis'

export interface ConnInfo {
  id: string
  name: string
  dbType: DbType
  host: string | null
  port: number | null
  user: string | null
  password: string | null
  database: string | null
  filePath: string | null
  color?: string | null
  readOnly?: boolean
}

export interface TableMeta {
  name: string
  kind: string
}

export interface ConnectResult {
  version: string
}

export interface ExecResult {
  /** 为空数组表示非查询语句(INSERT/UPDATE/...) */
  columns: string[]
  rows: (string | null)[][]
  affected: number
  truncated: boolean
  elapsedMs: number
}

export interface ColumnDef {
  name: string
  dataType: string
  nullable: boolean
  key: string
  default: string | null
  extra: string
  comment: string
}

export interface IndexDef {
  name: string
  columns: string
  unique: boolean
}

export interface TableStructure {
  columns: ColumnDef[]
  indexes: IndexDef[]
  ddl: string
}

export type OrderDir = 'asc' | 'desc'

/** SVG 图标名(见 Icon.vue) */
export type IconName =
  | 'play'
  | 'plus'
  | 'x'
  | 'table'
  | 'eye'
  | 'pencil'
  | 'trash'
  | 'refresh'
  | 'power'
  | 'chevronDown'
  | 'chevronRight'
  | 'code'
  | 'list'
  | 'zap'
  | 'clock'
  | 'save'
  | 'undo'
  | 'download'
  | 'copy'
  | 'minus'
  | 'database'
  | 'plusCircle'
  | 'search'
  | 'sun'
  | 'moon'
  | 'box'
  | 'layers'
  | 'diamond'

/** 一行的编辑回写:主键定位 + 修改的列与新值(null 表示置 NULL) */
export interface CellUpdate {
  pk: [string, string][]
  sets: [string, string | null][]
}

// ── 标签页类型 ────────────────────────────────────────

interface TabBase {
  id: string
  title: string
  connId: string | null
}

export interface QueryTab extends TabBase {
  kind: 'query'
  sql: string
  /** 多结果集(PostgreSQL) */
  results: ExecResult[]
  activeSet: number
  error: string | null
  running: boolean
}

export interface TableFilter {
  column: string
  op: string
  value: string
}

export interface TableTab extends TabBase {
  kind: 'table'
  table: string
  /** 表所属库(多库树打开时记录;读操作据此限定 库.表) */
  database?: string | null
  /** 列注释(列头悬停提示) */
  colComments?: Record<string, string>
  page: number
  pageSize: number
  total: number | null
  orderKey: string | null
  orderDir: OrderDir
  filters: TableFilter[]
  /** 筛选模式:字段构建 / 自由 WHERE */
  filterMode: 'fields' | 'free'
  /** 自由模式:WHERE 之后的 SQL 片段 */
  freeWhere: string
  /** 勾选行(绝对行号) */
  checkedRows: Record<number, true>
  result: ExecResult | null
  loading: boolean
  error: string | null
  /** 主键列(无主键则不可编辑) */
  pkCols: string[]
  /** 本表外键(编辑 FK 列时给候选值) */
  fks: FkMeta[]
  /** 未保存的单元格变更:绝对行号(当前页) → 列 → 新值 */
  changes: Record<number, Record<string, string | null>>
  /** 未保存的删除行:绝对行号 → 主键值 */
  deletedRows: Record<number, [string, string][]>
  /** 未保存的新增行:列 → 值(仅填了值的列会写入 INSERT) */
  newRows: Record<string, string>[]
  /** 加载请求代际,防竞态 */
  loadSeq: number
}

export interface StructureTab extends TabBase {
  kind: 'structure'
  table: string
  data: TableStructure | null
  loading: boolean
  error: string | null
}

/** 设计器里的一个字段定义 */
export interface ColumnSpec {
  name: string
  dataType: string
  length: string
  nullable: boolean
  pk: boolean
  autoInc: boolean
  default: string
  comment: string
  /** 编辑模式下:是否本次新增(旧列参与 ALTER diff) */
  isNew?: boolean
  /** 编辑模式下:原始列(存在 = 已有列) */
  existing?: boolean
}

export interface DesignerTab extends TabBase {
  kind: 'designer'
  mode: 'create' | 'edit'
  tableName: string
  columns: ColumnSpec[]
  saving: boolean
  error: string | null
  info: string | null
}

export interface FkMeta {
  table: string
  column: string
  refTable: string
  refColumn: string
}

export interface SearchHit {
  table: string
  column: string
  columns: string[]
  row: (string | null)[]
}

export interface ErTab extends TabBase {
  kind: 'er'
  fks: FkMeta[]
  loading: boolean
  error: string | null
  /** 用户拖拽过的节点位置:表名 → {x, y} */
  positions: Record<string, { x: number; y: number }>
}

export interface RedisDetail {
  keyType: string
  ttl: number
  len: number
  text: string | null
  pairs: [string, string][]
}

export interface RedisTab extends TabBase {
  kind: 'redis'
  db: number
  /** 当前 SCAN 游标 */
  cursor: number
  keys: string[]
  pattern: string
  scanning: boolean
  selectedKey: string | null
  detail: RedisDetail | null
  detailLoading: boolean
  error: string | null
}

export interface DdlTab extends TabBase {
  kind: 'ddl'
  objKind: string
  ddl: string
  loading: boolean
  error: string | null
}

export type Tab = QueryTab | TableTab | StructureTab | DesignerTab | ErTab | DdlTab | RedisTab
