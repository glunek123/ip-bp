<script setup lang="ts">
import { computed, ref } from 'vue';

const props = defineProps<{
  label: string;
  start: string;
  end: string;
  startLabel: string;
  endLabel: string;
}>();
const panel = ref<{ open: boolean } | null>(null);
const alignment = ref<'start' | 'end' | 'viewport'>('start');
function alignPanel(event: InstanceType<typeof globalThis.Event>) {
  const element = event.currentTarget;
  if (!(element instanceof globalThis.HTMLDetailsElement) || !element.open)
    return;
  const rect = element.getBoundingClientRect();
  const width = Math.min(420, globalThis.innerWidth * 0.9);
  alignment.value =
    rect.left + width <= globalThis.innerWidth - 8
      ? 'start'
      : rect.right - width >= 8
        ? 'end'
        : 'viewport';
}
const displayValue = computed(() => {
  if (props.start && props.end) return `${props.start} 至 ${props.end}`;
  if (props.start) return `自 ${props.start} 起`;
  if (props.end) return `至 ${props.end}`;
  return '不限日期';
});
const emit = defineEmits<{
  'update:start': [value: string | undefined];
  'update:end': [value: string | undefined];
}>();

function clearRange() {
  emit('update:start', undefined);
  emit('update:end', undefined);
}
</script>

<template>
  <details
    ref="panel"
    class="date-range"
    :aria-label="props.label"
    @toggle="alignPanel"
  >
    <summary>
      <span>{{ props.label }}</span>
      <span class="range-value">{{ displayValue }}</span>
    </summary>
    <div class="range-panel" :class="`range-panel--${alignment}`">
      <label>
        <span>{{ props.startLabel }}</span>
        <input
          type="date"
          :value="props.start"
          @input="
            emit(
              'update:start',
              ($event.target as HTMLInputElement).value || undefined,
            )
          "
        />
      </label>
      <span class="separator" aria-hidden="true">至</span>
      <label>
        <span>{{ props.endLabel }}</span>
        <input
          type="date"
          :value="props.end"
          @input="
            emit(
              'update:end',
              ($event.target as HTMLInputElement).value || undefined,
            )
          "
        />
      </label>
      <div class="panel-actions">
        <button type="button" @click="clearRange">清空范围</button>
        <button type="button" @click="panel && (panel.open = false)">
          收起
        </button>
      </div>
    </div>
  </details>
</template>

<style scoped>
.date-range {
  position: relative;
  min-width: 0;
  margin: 0;
}
.date-range summary {
  display: grid;
  gap: 2px;
  min-height: var(--app-control-height, 32px);
  padding: 4px 9px;
  border: 1px solid var(--color-hairline-strong, #d2d2d8);
  border-radius: 6px;
  background: #fff;
  cursor: pointer;
  color: var(--color-ink-muted, #5c5e66);
  font-size: 12px;
}
.range-value {
  color: var(--color-ink, #0f1011);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
.range-panel {
  position: absolute;
  z-index: 20;
  top: calc(100% + 4px);
  left: 0;
  display: grid;
  grid-template-columns: minmax(125px, 1fr) auto minmax(125px, 1fr);
  align-items: end;
  gap: 8px;
  width: min(420px, 90vw);
  padding: 12px;
  border: 1px solid var(--color-hairline, #e5e5e9);
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 8px 24px rgba(15, 16, 17, 0.14);
}
.range-panel label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  color: var(--color-ink-muted, #5c5e66);
  font-size: 11px;
}
.range-panel--end {
  left: auto;
  right: 0;
}
.range-panel--viewport {
  position: fixed;
  left: 5vw;
  right: auto;
  top: 20vh;
}
.range-panel input {
  width: 100%;
  min-width: 0;
  min-height: var(--app-control-height, 32px);
  padding: 4px 6px;
  border: 1px solid var(--color-hairline-strong, #d2d2d8);
  border-radius: 6px;
  background: #fff;
  color: inherit;
}
.separator {
  padding-bottom: 8px;
  color: var(--color-ink-muted, #5c5e66);
  font-size: 11px;
}
.panel-actions {
  grid-column: 1 / -1;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.panel-actions button {
  min-height: 30px;
  padding: 4px 8px;
  border: 1px solid var(--color-hairline-strong, #d2d2d8);
  border-radius: 6px;
  background: #fff;
  color: inherit;
  cursor: pointer;
}
</style>
