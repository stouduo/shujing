<script setup lang="ts">
// 放在 <n-message-provider> 内部,把 message API 桥接给非组件模块(exportImport 等)使用
import { useDialog, useMessage } from 'naive-ui'

window.$msg = useMessage()
window.$dialog = useDialog()
</script>

<template></template>
