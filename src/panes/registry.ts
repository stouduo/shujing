/**
 * Pane Registry —— 标签页面板注册表
 *
 * 新增一种标签页只需三步:
 *   1. 在 types.ts 扩展 Tab 联合类型(新 kind + 数据接口)
 *   2. 写组件(接收 props.tab),用 defineAsyncComponent 懒加载
 *   3. 在下方 PANE_DEFS 添加一条注册(组件/图标/序列化)
 *
 * 分发(EditorTab)、图标(App)、会话持久化(serialize/revive)自动生效。
 */
import { defineAsyncComponent, type Component } from 'vue'
import type { IconName, Tab } from '../types'

export interface PaneDef {
  /** Tab kind */
  kind: Tab['kind']
  /** 标签页图标 */
  icon: IconName
  /** 面板组件(推荐 defineAsyncComponent 懒加载) */
  component: Component
  /** 会话保存:提取需要持久化的结构性字段;返回 null 表示不保存该标签 */
  serialize?: (tab: Tab) => Record<string, unknown> | null
  /** 会话恢复:由持久化数据重建完整 Tab(带默认运行时字段);返回 null 表示无法恢复 */
  revive?: (st: Record<string, unknown>) => Tab | null
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function num(v: unknown, d = 0): number {
  return typeof v === 'number' ? v : d
}
function str(v: unknown, d = ''): string {
  return typeof v === 'string' ? v : d
}
function nstr(v: unknown): string | null {
  return typeof v === 'string' ? v : null
}

export const PANE_DEFS: PaneDef[] = [
  {
    kind: 'query',
    icon: 'code',
    component: defineAsyncComponent(() => import('../components/QueryPane.vue')),
    serialize: (t) => (t.kind === 'query' ? { sql: t.sql } : null),
    revive: (st) => ({
      kind: 'query',
      id: str(st.id),
      title: str(st.title, '查询'),
      connId: nstr(st.connId),
      sql: str(st.sql),
      results: [],
      activeSet: 0,
      error: null,
      running: false,
    }),
  },
  {
    kind: 'table',
    icon: 'table',
    component: defineAsyncComponent(() => import('../components/TableDataPane.vue')),
    serialize: (t) =>
      t.kind === 'table'
        ? {
            table: t.table,
            page: t.page,
            pageSize: t.pageSize,
            orderKey: t.orderKey,
            orderDir: t.orderDir,
            filters: t.filters,
            filterMode: t.filterMode,
            freeWhere: t.freeWhere,
          }
        : null,
    revive: (st) => ({
      kind: 'table',
      id: str(st.id),
      title: str(st.title, str(st.table, '表')),
      connId: nstr(st.connId),
      table: str(st.table),
      page: num(st.page, 1),
      pageSize: num(st.pageSize, 100),
      total: null,
      orderKey: nstr(st.orderKey),
      orderDir: st.orderDir === 'desc' ? 'desc' : 'asc',
      filters: Array.isArray(st.filters) ? st.filters : [],
      filterMode: st.filterMode === 'free' ? 'free' : 'fields',
      freeWhere: str(st.freeWhere),
      checkedRows: {},
      result: null,
      loading: true,
      error: null,
      pkCols: [],
      fks: [],
      changes: {},
      deletedRows: {},
      newRows: [],
      loadSeq: 0,
    }),
  },
  {
    kind: 'structure',
    icon: 'list',
    component: defineAsyncComponent(() => import('../components/StructurePane.vue')),
    serialize: (t) => (t.kind === 'structure' ? { table: t.table } : null),
    revive: (st) => ({
      kind: 'structure',
      id: str(st.id),
      title: str(st.title, `${str(st.table)} 结构`),
      connId: nstr(st.connId),
      table: str(st.table),
      data: null,
      loading: true,
      error: null,
    }),
  },
  {
    kind: 'designer',
    icon: 'pencil',
    component: defineAsyncComponent(() => import('../components/TableDesigner.vue')),
    serialize: (t) =>
      t.kind === 'designer' ? { mode: t.mode, tableName: t.tableName, columns: t.columns } : null,
    revive: (st) => ({
      kind: 'designer',
      id: str(st.id),
      title: str(st.title, '新表'),
      connId: nstr(st.connId),
      mode: st.mode === 'edit' ? 'edit' : 'create',
      tableName: str(st.tableName),
      columns: Array.isArray(st.columns) ? st.columns : [],
      saving: false,
      error: null,
      info: null,
    }),
  },
  {
    kind: 'er',
    icon: 'database',
    component: defineAsyncComponent(() => import('../components/ErPane.vue')),
    serialize: (t) => (t.kind === 'er' ? {} : null),
    revive: (st) => ({
      kind: 'er',
      id: str(st.id),
      title: str(st.title, 'ER 图'),
      connId: nstr(st.connId),
      fks: [],
      loading: true,
      error: null,
      positions: {},
    }),
  },
  {
    kind: 'ddl',
    icon: 'zap',
    component: defineAsyncComponent(() => import('../components/DdlPane.vue')),
    serialize: (t) => (t.kind === 'ddl' ? { objKind: t.objKind } : null),
    revive: (st) => ({
      kind: 'ddl',
      id: str(st.id),
      title: str(st.title, '对象'),
      connId: nstr(st.connId),
      objKind: str(st.objKind, 'function'),
      ddl: '',
      loading: true,
      error: null,
    }),
  },
  {
    kind: 'redis',
    icon: 'diamond',
    component: defineAsyncComponent(() => import('../components/RedisPane.vue')),
    serialize: (t) => (t.kind === 'redis' ? { db: t.db } : null),
    revive: (st) => ({
      kind: 'redis',
      id: str(st.id),
      title: str(st.title, 'Redis'),
      connId: nstr(st.connId),
      db: num(st.db),
      cursor: 0,
      keys: [],
      pattern: '*',
      scanning: false,
      selectedKey: null,
      detail: null,
      detailLoading: false,
      error: null,
    }),
  },
]

const byKind = new Map(PANE_DEFS.map((d) => [d.kind as string, d]))

export function paneOf(kind: string): PaneDef | undefined {
  return byKind.get(kind)
}

/** 会话序列化:遍历注册表 */
export function serializeTab(t: Tab): Record<string, unknown> | null {
  const def = byKind.get(t.kind)
  if (!def?.serialize) return null
  const data = def.serialize(t)
  if (!data) return null
  return { kind: t.kind, id: t.id, title: t.title, connId: t.connId, ...data }
}

/** 会话恢复:遍历注册表 */
export function reviveTab(st: any): Tab | null {
  if (!st?.kind || !st.id) return null
  const def = byKind.get(String(st.kind))
  if (!def?.revive) return null
  return def.revive(st)
}
