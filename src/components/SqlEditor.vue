<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { basicSetup } from 'codemirror'
import { search, searchKeymap } from '@codemirror/search'
import { Compartment, Prec } from '@codemirror/state'
import { EditorView, keymap, placeholder } from '@codemirror/view'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'
import { MySQL, PostgreSQL, SQLite, StandardSQL, sql } from '@codemirror/lang-sql'
import type { DbType } from '../types'

/** ⌘/ 切换选中行的 SQL 注释 */
function toggleComment(view: EditorView): boolean {
  const state = view.state
  const sel = state.selection.main
  const fromLine = state.doc.lineAt(sel.from).number
  const toLine = state.doc.lineAt(sel.to).number
  let allCommented = true
  for (let n = fromLine; n <= toLine; n++) {
    const text = state.doc.line(n).text
    if (text.trim() && !text.trimStart().startsWith('--')) allCommented = false
  }
  const changes: { from: number; to?: number; insert: string }[] = []
  for (let n = fromLine; n <= toLine; n++) {
    const line = state.doc.line(n)
    if (!line.text.trim()) continue
    if (allCommented) {
      const m = line.text.match(/^(\s*)--\s?/)
      if (m) changes.push({ from: line.from + m[1].length, to: line.from + m[0].length, insert: '' })
    } else {
      const indent = line.text.match(/^\s*/)?.[0].length ?? 0
      changes.push({ from: line.from + indent, insert: '-- ' })
    }
  }
  if (changes.length) view.dispatch({ changes })
  return true
}
const sqlHighlightDark = HighlightStyle.define([
  { tag: t.comment, color: '#5c5c66', fontStyle: 'italic' },
  { tag: t.keyword, color: '#7aa2f7' },
  { tag: [t.name, t.deleted, t.character, t.propertyName, t.macroName], color: '#dcdce1' },
  { tag: [t.function(t.variableName), t.labelName], color: '#7dcfff' },
  { tag: [t.color, t.constant(t.name), t.standard(t.name)], color: '#2ac3de' },
  { tag: [t.definition(t.name), t.separator], color: '#7dcfff' },
  { tag: [t.typeName, t.className, t.number, t.changed, t.annotation, t.self, t.namespace], color: '#ff9e64' },
  { tag: [t.operator, t.operatorKeyword, t.url, t.escape, t.regexp, t.link, t.special(t.string)], color: '#89ddff' },
  { tag: [t.meta, t.comment], color: '#5c5c66' },
  { tag: t.strong, fontWeight: 'bold' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.link, color: '#89ddff', textDecoration: 'underline' },
  { tag: t.heading, fontWeight: 'bold', color: '#dcdce1' },
  { tag: [t.atom, t.bool, t.special(t.variableName)], color: '#ff7ab2' },
  { tag: [t.processingInstruction, t.string, t.inserted], color: '#9ece6a' },
  { tag: t.invalid, color: '#ff5370' },
])

const sqlHighlightLight = HighlightStyle.define([
  { tag: t.comment, color: '#a0a1a7', fontStyle: 'italic' },
  { tag: t.keyword, color: '#a626a4' },
  { tag: [t.name, t.deleted, t.character, t.propertyName, t.macroName], color: '#383a42' },
  { tag: [t.function(t.variableName), t.labelName], color: '#4078f2' },
  { tag: [t.color, t.constant(t.name), t.standard(t.name)], color: '#0184bc' },
  { tag: [t.definition(t.name), t.separator], color: '#4078f2' },
  { tag: [t.typeName, t.className, t.number, t.changed, t.annotation, t.self, t.namespace], color: '#986801' },
  { tag: [t.operator, t.operatorKeyword, t.url, t.escape, t.regexp, t.link, t.special(t.string)], color: '#0184bc' },
  { tag: t.strong, fontWeight: 'bold' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.link, color: '#4078f2', textDecoration: 'underline' },
  { tag: t.heading, fontWeight: 'bold', color: '#383a42' },
  { tag: [t.atom, t.bool, t.special(t.variableName)], color: '#b75501' },
  { tag: [t.processingInstruction, t.string, t.inserted], color: '#50a14f' },
  { tag: t.invalid, color: '#e45649' },
])

const props = defineProps<{
  sql: string
  dialect: DbType
  tables: string[]
  /** 已知的表列(打开过表/结构后缓存),用于列名补全 */
  columns?: Record<string, string[]>
  theme?: 'dark' | 'light'
}>()
const emit = defineEmits<{
  (e: 'update:sql', v: string): void
  (e: 'run', selectedSql?: string): void
}>()

const host = ref<HTMLElement | null>(null)
let view: EditorView | null = null
const langComp = new Compartment()
const hlComp = new Compartment()

function langExt(
  dialect: DbType,
  tables: string[],
  columns?: Record<string, string[]>,
): ReturnType<typeof sql> {
  // 把已加载的表名/列名喂给补全,两种 namespace 都注册以兼容不同方言
  const schema: Record<string, Record<string, string[]>> = { '': {}, public: {} }
  for (const t of tables) {
    const cols = columns?.[t] ?? []
    schema[''][t] = cols
    schema.public[t] = cols
  }
  const d =
    dialect === 'mysql'
      ? MySQL
      : dialect === 'postgres'
        ? PostgreSQL
        : dialect === 'redis'
          ? StandardSQL
          : SQLite
  return sql({ dialect: d, schema })
}

onMounted(() => {
  if (!host.value) return
  view = new EditorView({
    doc: props.sql,
    parent: host.value,
    extensions: [
      Prec.high(
        keymap.of([
          {
            key: 'Mod-Enter',
            run: () => {
              if (!view) return false
              // 有选区时只执行选中部分
              const sel = view.state.selection.main
              if (!sel.empty) {
                emit('run', view.state.doc.sliceString(sel.from, sel.to))
              } else {
                emit('run')
              }
              return true
            },
          },
          {
            key: 'Mod-/',
            run: () => (view ? toggleComment(view) : false),
          },
        ]),
      ),
      basicSetup,
      search({ top: true }),
      keymap.of(searchKeymap),
      hlComp.of(syntaxHighlighting(props.theme === 'light' ? sqlHighlightLight : sqlHighlightDark)),
      placeholder('SELECT * FROM …'),
      langComp.of(langExt(props.dialect, props.tables, props.columns)),
      EditorView.updateListener.of((u) => {
        if (u.docChanged) emit('update:sql', u.state.doc.toString())
      }),
      EditorView.theme({
        '&': { height: '100%', fontSize: '13px', backgroundColor: 'transparent', color: '#dcdce1' },
        '.cm-scroller': { fontFamily: 'var(--mono)', lineHeight: '1.65', padding: '6px 0' },
        '.cm-gutters': {
          backgroundColor: 'transparent',
          borderRight: '1px solid var(--border)',
          color: '#585860',
        },
        '.cm-activeLine': { backgroundColor: 'rgba(255, 255, 255, 0.035)' },
        '.cm-activeLineGutter': { backgroundColor: 'rgba(255, 255, 255, 0.05)' },
        '.cm-content': { caretColor: 'var(--accent)' },
        '.cm-placeholder': { color: 'var(--text-tertiary)' },
        '&.cm-focused': { outline: 'none' },
      }),
    ],
  })
})

watch(
  () => [props.dialect, props.tables, props.columns] as const,
  () => {
    view?.dispatch({
      effects: langComp.reconfigure(langExt(props.dialect, props.tables, props.columns)),
    })
  },
)

// 主题切换:重新配置高亮与基础样式
watch(
  () => props.theme,
  () => {
    view?.dispatch({
      effects: hlComp.reconfigure(
        syntaxHighlighting(props.theme === 'light' ? sqlHighlightLight : sqlHighlightDark),
      ),
    })
  },
)

// 外部替换 SQL(格式化/历史回填);与编辑器当前内容一致时跳过避免光标跳动
watch(
  () => props.sql,
  (v) => {
    if (view && view.state.doc.toString() !== v) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: v } })
    }
  },
)

onBeforeUnmount(() => view?.destroy())
</script>

<template>
  <div ref="host" class="cm-host" />
</template>

<style scoped>
.cm-host {
  height: 100%;
  overflow: hidden;
}
</style>
