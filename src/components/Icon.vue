<script setup lang="ts">
import type { IconName } from '../types'

defineProps<{ name: IconName; size?: number }>()

const paths: Record<IconName, string[]> = {
  play: ['M6 4.5v15l13-7.5L6 4.5z'],
  plus: ['M12 5v14', 'M5 12h14'],
  x: ['M18 6L6 18', 'M6 6l12 12'],
  table: ['M3 5h18v14H3z', 'M3 12h18', 'M9 5v14'],
  eye: [
    'M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z',
    'M15 12a3 3 0 11-6 0 3 3 0 016 0',
  ],
  pencil: ['M17 3a2.83 2.83 0 114 4L7.5 20.5 2 22l1.5-5.5L17 3z'],
  trash: [
    'M3 6h18',
    'M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6',
    'M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2',
    'M10 11v6',
    'M14 11v6',
  ],
  refresh: ['M23 4v6h-6', 'M20.49 15a9 9 0 11-2.12-9.36L23 10'],
  power: ['M18.36 6.64a9 9 0 11-12.73 0', 'M12 2v10'],
  chevronDown: ['M6 9l6 6 6-6'],
  chevronRight: ['M9 18l6-6-6-6'],
  code: ['M16 18l6-6-6-6', 'M8 6l-6 6 6 6'],
  list: [
    'M8 6h13',
    'M8 12h13',
    'M8 18h13',
    'M3.5 6h.01',
    'M3.5 12h.01',
    'M3.5 18h.01',
  ],
  zap: ['M13 2L3 14h9l-1 8 10-12h-9l1-8z'],
  clock: ['M12 22a10 10 0 100-20 10 10 0 000 20z', 'M12 6v6l4 2'],
  save: [
    'M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z',
    'M17 21v-8H7v8',
    'M7 3v5h8',
  ],
  undo: ['M1 4v6h6', 'M3.51 15a9 9 0 102.13-9.36L1 10'],
  download: ['M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4', 'M7 10l5 5 5-5', 'M12 15V3'],
  copy: [
    'M20 9h-9a2 2 0 00-2 2v9a2 2 0 002 2h9a2 2 0 002-2v-9a2 2 0 00-2-2z',
    'M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1',
  ],
  minus: ['M5 12h14'],
  database: [
    'M12 8c4.97 0 9-1.34 9-3s-4.03-3-9-3-9 1.34-9 3 4.03 3 9 3z',
    'M21 12c0 1.66-4 3-9 3s-9-1.34-9-3',
    'M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5',
  ],
  plusCircle: ['M12 22a10 10 0 100-20 10 10 0 000 20z', 'M12 8v8', 'M8 12h8'],
  search: ['M11 19a8 8 0 100-16 8 8 0 000 16z', 'M21 21l-4.35-4.35'],
  box: ['M21 8l-9-5-9 5v8l9 5 9-5V8z', 'M3.3 8.3L12 13l8.7-4.7', 'M12 22V13'],
  layers: ['M12 2L2 7l10 5 10-5-10-5z', 'M2 17l10 5 10-5', 'M2 12l10 5 10-5'],
  diamond: ['M12 2l10 10-10 10L2 12z'],
  sun: [
    'M12 17a5 5 0 100-10 5 5 0 000 10z',
    'M12 1v2',
    'M12 21v2',
    'M4.22 4.22l1.42 1.42',
    'M18.36 18.36l1.42 1.42',
    'M1 12h2',
    'M21 12h2',
    'M4.22 19.78l1.42-1.42',
    'M18.36 5.64l1.42-1.42',
  ],
}
</script>

<template>
  <svg
    :width="size ?? 14"
    :height="size ?? 14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    class="icon"
    aria-hidden="true"
  >
    <path v-for="(d, i) in paths[name]" :key="i" :d="d" />
  </svg>
</template>

<style scoped>
.icon {
  flex-shrink: 0;
  display: inline-block;
  vertical-align: -0.14em;
}
</style>
