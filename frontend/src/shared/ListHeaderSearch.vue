<script setup lang="ts">
import { onMounted, ref } from 'vue';

const props = defineProps<{ modelValue: string; placeholder: string }>();
const emit = defineEmits<{
  'update:modelValue': [value: string];
  search: [];
}>();
const target = ref<ReturnType<typeof globalThis.document.getElementById>>(null);
onMounted(() => {
  target.value = globalThis.document.getElementById('module-list-search');
});
function update(event: InstanceType<typeof globalThis.Event>) {
  emit(
    'update:modelValue',
    (event.target as InstanceType<typeof globalThis.HTMLInputElement>).value,
  );
}
function clear() {
  emit('update:modelValue', '');
  emit('search');
}
</script>

<template>
  <Teleport :to="target ?? 'body'" :disabled="!target">
    <form
      class="list-header-search"
      role="search"
      @submit.prevent="emit('search')"
    >
      <input
        :value="props.modelValue"
        type="search"
        :placeholder="props.placeholder"
        :aria-label="props.placeholder"
        @input="update"
        @search="!props.modelValue && emit('search')"
      />
      <button
        v-if="props.modelValue"
        type="button"
        aria-label="清空关键词"
        @click="clear"
      >
        ×
      </button>
    </form>
  </Teleport>
</template>

<style scoped>
.list-header-search {
  display: flex;
  align-items: center;
  width: 100%;
  min-width: 0;
  position: relative;
}
.list-header-search input {
  width: 100%;
  min-width: 0;
  height: 34px;
  padding: 0 32px 0 10px;
  border: 1px solid var(--color-hairline-strong);
  border-radius: 6px;
  background: var(--color-surface-1);
  font: inherit;
  font-size: 13px;
}
.list-header-search input::-webkit-search-cancel-button {
  display: none;
}
.list-header-search button {
  position: absolute;
  right: 5px;
  border: 0;
  background: transparent;
  cursor: pointer;
  font-size: 18px;
  line-height: 1;
  color: var(--color-ink-muted);
}
</style>
