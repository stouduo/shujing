<script setup lang="ts">
import type { Tab } from '../types'
import QueryPane from './QueryPane.vue'
import TableDataPane from './TableDataPane.vue'
import StructurePane from './StructurePane.vue'
import TableDesigner from './TableDesigner.vue'
import ErPane from './ErPane.vue'
import RedisPane from './RedisPane.vue'
import DdlPane from './DdlPane.vue'

defineProps<{ tab: Tab }>()
</script>

<template>
  <QueryPane v-if="tab.kind === 'query'" :tab="tab" />
  <TableDataPane v-else-if="tab.kind === 'table'" :tab="tab" />
  <StructurePane v-else-if="tab.kind === 'structure'" :tab="tab" />
  <TableDesigner v-else-if="tab.kind === 'designer'" :tab="tab" />
  <ErPane v-else-if="tab.kind === 'er'" :tab="tab" />
  <RedisPane v-else-if="tab.kind === 'redis'" :tab="tab" />
  <DdlPane v-else :tab="tab" />
</template>
