<script lang="ts">
// Component adapter seam only; this is not the reports API DTO.
export type ReportSummaryView =
  | { kind: 'value'; decimalText: string }
  | { kind: 'unavailable' | 'no-records'; messageText: string };
export type LoadReportSummary = (options: {
  signal: globalThis.AbortSignal;
}) => Promise<ReportSummaryView>;
</script>

<script setup lang="ts">
import { onActivated, onBeforeUnmount, onDeactivated, ref, watch } from 'vue';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import { ApiError } from '../../api/http';

const props = defineProps<{
  actorKey: string;
  contextKey: string;
  scopeKey: string;
  access: 'checking' | 'allowed' | 'denied';
  load: LoadReportSummary;
}>();
const projection = ref<ReportSummaryView | null>(null);
const busy = ref(false);
const failed = ref(false);
const permissionLost = ref(false);
let generation = 0;
let controller: AbortController | undefined;
let mounted = true;
let active = true;
function context(): string {
  return JSON.stringify([props.actorKey, props.contextKey, props.scopeKey]);
}
function clear(): void {
  generation += 1;
  controller?.abort();
  controller = undefined;
  projection.value = null;
  busy.value = false;
  failed.value = false;
}
function current(
  epoch: number,
  key: string,
  signal: globalThis.AbortSignal,
): boolean {
  return (
    mounted &&
    active &&
    !signal.aborted &&
    generation === epoch &&
    context() === key &&
    props.access === 'allowed'
  );
}
async function read(): Promise<void> {
  if (
    !mounted ||
    !active ||
    busy.value ||
    permissionLost.value ||
    props.access !== 'allowed'
  )
    return;
  clear();
  const epoch = generation;
  const key = context();
  controller = new AbortController();
  const signal = controller.signal;
  busy.value = true;
  try {
    const result = await props.load({ signal });
    if (!current(epoch, key, signal)) return;
    // Copy only the frozen view fields; no formatting or numeric conversion.
    if (
      result.kind === 'value' &&
      typeof result.decimalText === 'string' &&
      result.decimalText.trim().length > 0
    )
      projection.value = { kind: 'value', decimalText: result.decimalText };
    else if (
      (result.kind === 'unavailable' || result.kind === 'no-records') &&
      typeof result.messageText === 'string'
    )
      projection.value = { kind: result.kind, messageText: result.messageText };
    else throw new Error('Invalid report view');
  } catch (cause) {
    if (!current(epoch, key, signal)) return;
    projection.value = null;
    if (
      cause instanceof ApiError &&
      (cause.status === 401 || cause.status === 403)
    )
      permissionLost.value = true;
    else failed.value = true;
  } finally {
    if (current(epoch, key, signal)) busy.value = false;
  }
}
watch(
  () => [props.actorKey, props.contextKey, props.scopeKey, props.access],
  () => {
    clear();
    permissionLost.value = false;
    void read();
  },
  { immediate: true, flush: 'sync' },
);
onDeactivated(() => {
  active = false;
  clear();
});
onActivated(() => {
  if (active) return;
  active = true;
  void read();
});
onBeforeUnmount(() => {
  mounted = false;
  active = false;
  clear();
});
</script>

<template>
  <section
    class="report-summary"
    aria-label="已归档案件平均标的额"
    :aria-busy="busy"
  >
    <header>
      <h2>已归档案件平均标的额</h2>
      <ElButton
        v-if="access === 'allowed' && !permissionLost"
        data-test="refresh-report"
        :disabled="busy"
        :loading="busy"
        @click="read"
        >刷新</ElButton
      >
    </header>
    <p v-if="access === 'checking'" role="status">正在核对报表读取权限…</p>
    <p v-else-if="access === 'denied' || permissionLost" role="alert">
      当前无法读取报表，请核对登录状态与读取权限。
    </p>
    <p v-else-if="busy" role="status">正在读取报表…</p>
    <p v-else-if="failed" role="alert">报表读取失败，请重试。</p>
    <template v-else-if="projection">
      <p v-if="projection.kind === 'value'" class="report-value">
        <span data-test="report-decimal">{{ projection.decimalText }}</span>
        <span class="report-currency">元</span>
      </p>
      <p v-else role="status" :data-test="`report-${projection.kind}`">
        {{ projection.messageText }}
      </p>
    </template>
  </section>
</template>

<style scoped>
.report-summary {
  padding: var(--s-5);
  border: 1px solid var(--color-hairline);
  background: var(--color-surface-1);
}
.report-summary header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--s-3);
}
.report-summary h2 {
  margin: 0;
  font-size: 1rem;
  color: var(--color-ink);
}
.report-value {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--s-2);
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
  font-size: 1.75rem;
}
.report-currency {
  font-size: 0.875rem;
  color: var(--color-ink-muted);
}
</style>
