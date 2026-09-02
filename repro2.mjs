import { createApp, h, ref } from 'vue'
// 完整浏览器环境无法模拟;直接检查 watch(colVirtOptions) 的 setOptions 是否在
// 旧版 virtual-core 上不存在 → setup 抛 TypeError → 组件渲染失败!
import { useVirtualizer } from '@tanstack/vue-virtual'
import { version } from '@tanstack/vue-virtual/package.json'

console.log('version:', version)
