<script setup lang="ts">
import { ref } from 'vue';
import {
  ElSelect,
  ElOption,
} from 'element-plus/es/components/select/index.mjs';
import {
  ElTable,
  ElTableColumn,
} from 'element-plus/es/components/table/index.mjs';

interface Row {
  id: number;
  label: string;
}
const selected = ref('');
const rows: Row[] = [
  { id: 1, label: 'Alpha' },
  { id: 2, label: 'Beta' },
];
const selection = ref<Row[]>([]);
function updateSelection(value: Row[]) {
  selection.value = value;
}
</script>

<template>
  <main>
    <h1>组件兼容测试夹具</h1>
    <ElSelect
      v-model="selected"
      aria-label="测试选项"
      placeholder="请选择"
      clearable
      style="width: 240px"
    >
      <ElOption label="Alpha" value="alpha" />
      <ElOption label="Beta" value="beta" />
    </ElSelect>
    <output data-testid="selected">{{ selected || 'empty' }}</output>
    <ElTable :data="rows" row-key="id" @selection-change="updateSelection">
      <ElTableColumn type="selection" width="60" />
      <ElTableColumn prop="label" label="名称" sortable />
    </ElTable>
    <output data-testid="selection">{{
      selection.map((row) => row.id).join(',') || 'empty'
    }}</output>
  </main>
</template>
