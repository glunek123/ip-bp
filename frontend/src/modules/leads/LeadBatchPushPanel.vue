<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import {
  pushLeadsBatch,
  type Lead,
  type LeadBatchPushItem,
} from '../../api/leads';
import { ApiError } from '../../api/http';
import {
  clearPendingLeadBatchPush,
  readPendingLeadBatchPush,
  savePendingLeadBatchPush,
  sameLeadBatchPush,
  type FrozenLeadBatchPush,
} from './lead-batch-push-recovery';

const props = defineProps<{
  leads: Lead[];
  identity: string;
  contextGeneration: string;
  pending?: FrozenLeadBatchPush | null;
}>();
const emit = defineEmits<{
  close: [];
  pending: [FrozenLeadBatchPush | null, FrozenLeadBatchPush, string, string];
  succeeded: [FrozenLeadBatchPush, string, string];
}>();
const busy = ref(false);
const error = ref('');
const failures = ref<Array<{ index: number; code: string }>>([]);
const items = computed<LeadBatchPushItem[]>(
  () =>
    props.pending?.items ??
    props.leads.map(({ id, version }) => ({
      leadId: id,
      expectedVersion: version,
    })),
);
const groups = computed(() => {
  const counts = new Map<string, { name: string; count: number }>();
  for (const lead of props.leads) {
    const current = counts.get(lead.customerId);
    counts.set(lead.customerId, {
      name: lead.displayNames.customerName,
      count: (current?.count ?? 0) + 1,
    });
  }
  return [...counts.entries()];
});
let frozen = props.pending ?? null;
let mounted = true;
onBeforeUnmount(() => {
  mounted = false;
});
function persistFrozen(attempt: FrozenLeadBatchPush): boolean {
  const stored = readPendingLeadBatchPush();
  if (stored === null) return false;
  if (attempt.identity !== props.identity) return false;
  const current = stored[attempt.identity];
  if (props.pending) {
    if (!current || !sameLeadBatchPush(current, props.pending)) return false;
  } else if (current) return false;
  stored[attempt.identity] = attempt;
  return savePendingLeadBatchPush(stored);
}
async function submit() {
  if (busy.value || !items.value.length) return;
  const requestIdentity = props.identity;
  const requestGeneration = props.contextGeneration;
  const hadPriorUnknown = frozen !== null;
  frozen ??= {
    identity: props.identity,
    idempotencyKey: globalThis.crypto.randomUUID(),
    items: items.value.map((item) => ({ ...item })),
    uncertain: false,
  };
  // Persist the uncertainty before sending so a crash after server commit cannot
  // make a recovered request look like a known first attempt.
  frozen = { ...frozen, uncertain: true };
  if (!persistFrozen(frozen)) {
    error.value = '无法安全保存原请求，批量推送未发送。请检查本机存储后重试。';
    if (!hadPriorUnknown) frozen = null;
    return;
  }
  const attempt = frozen;
  emit('pending', attempt, attempt, requestIdentity, requestGeneration);
  busy.value = true;
  error.value = '';
  failures.value = [];
  try {
    await pushLeadsBatch(attempt.items, attempt.idempotencyKey);
    if (
      !mounted ||
      props.identity !== requestIdentity ||
      props.contextGeneration !== requestGeneration
    )
      return;
    if (!clearPendingLeadBatchPush(attempt)) {
      error.value =
        '结果已返回，但原请求仍保存在本地；请保留原请求并安全重试。';
      return;
    }
    emit('pending', null, attempt, requestIdentity, requestGeneration);
    emit('succeeded', attempt, requestIdentity, requestGeneration);
  } catch (cause) {
    if (
      !mounted ||
      props.identity !== requestIdentity ||
      props.contextGeneration !== requestGeneration
    )
      return;
    if (cause instanceof ApiError && cause.code === 'BATCH_PUSH_REJECTED') {
      const rawFailures = cause.details?.failures;
      if (Array.isArray(rawFailures)) {
        failures.value = rawFailures.flatMap((failure) => {
          if (!failure || typeof failure !== 'object' || Array.isArray(failure))
            return [];
          const candidate = failure as Record<string, unknown>;
          const allowedCodes = [
            'NOT_AVAILABLE',
            'INVALID_STATE',
            'VERSION_CONFLICT',
            'CUSTOMER_NOT_ADMITTED',
            'LEAD_PRODUCTS_REQUIRED',
            'CLIENT_ACCOUNT_UNAVAILABLE',
          ];
          return Number.isInteger(candidate.index) &&
            (candidate.index as number) >= 0 &&
            (candidate.index as number) < items.value.length &&
            typeof candidate.code === 'string' &&
            allowedCodes.includes(candidate.code)
            ? [{ index: candidate.index as number, code: candidate.code }]
            : [];
        });
      }
    }
    if (
      cause instanceof ApiError &&
      cause.code === 'BATCH_PUSH_REJECTED' &&
      !hadPriorUnknown
    ) {
      if (!clearPendingLeadBatchPush(attempt)) {
        error.value = '请求已明确拒绝，但本地原请求无法更新；请保留原请求。';
        return;
      }
      emit('pending', null, attempt, requestIdentity, requestGeneration);
      frozen = null;
      error.value =
        '本次批量请求已明确拒绝且未写入。可关闭面板后调整选择，再重新发起。';
      busy.value = false;
      return;
    }
    frozen = { ...frozen, uncertain: true };
    emit('pending', frozen, attempt, requestIdentity, requestGeneration);
    error.value =
      '请求结果尚未确认。保留原请求和幂等键；恢复权限后只能原样重试。';
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <section
    class="demo-card lead-batch-panel"
    role="dialog"
    aria-modal="true"
    aria-labelledby="lead-batch-title"
  >
    <h2 id="lead-batch-title">批量推送</h2>
    <p data-test="batch-count">已选 {{ items.length }} 条线索</p>
    <ul aria-label="按可见客户分组计数">
      <li
        v-for="[customerId, group] in groups"
        :key="customerId"
        data-test="customer-group"
      >
        {{ group.name }}：{{ group.count }} 条
      </li>
    </ul>
    <p v-if="error" role="alert">{{ error }}</p>
    <ul v-if="failures.length" aria-label="批次失败项">
      <li v-for="failure in failures" :key="`${failure.index}:${failure.code}`">
        第 {{ failure.index + 1 }} 项：{{ failure.code }}
      </li>
    </ul>
    <ElButton
      type="primary"
      data-test="batch-submit"
      :disabled="busy || items.length < 1"
      @click="submit"
      >{{ busy ? '正在提交' : '整批推送' }}</ElButton
    >
    <ElButton
      data-test="batch-close"
      :disabled="busy || !!pending"
      @click="emit('close')"
      >取消</ElButton
    >
  </section>
</template>
