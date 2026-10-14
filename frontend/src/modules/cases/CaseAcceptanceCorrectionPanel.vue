<script setup lang="ts">
import {
  computed,
  onActivated,
  onBeforeUnmount,
  onDeactivated,
  ref,
  watch,
} from 'vue';
import {
  correctCaseAcceptance,
  type CaseAcceptanceHistory,
  type CaseDetail,
  type CorrectCaseAcceptanceInput,
} from '../../api/cases';
import { ApiError } from '../../api/http';
import { notifyWorkflowChanged } from '../../app/workflow-events';

const props = defineProps<{ item: CaseDetail; contextKey: string }>();
const emit = defineEmits<{ changed: []; refresh: []; 'access-lost': [] }>();
const acceptanceId = ref(props.item.acceptances[0]?.id ?? '');
const acceptedAt = ref('');
const courtCaseNo = ref('');
const reason = ref('');
const submitting = ref(false);
const error = ref('');
const success = ref('');
const unknownRequest = ref<CorrectCaseAcceptanceInput | null>(null);
let revision = 0;
let active = true;
let requestController: AbortController | null = null;

type Context = { caseId: string; contextKey: string; revision: number };
function captureContext(): Context {
  return { caseId: props.item.id, contextKey: props.contextKey, revision };
}
function isCurrent(context: Context): boolean {
  return (
    active &&
    context.revision === revision &&
    context.caseId === props.item.id &&
    context.contextKey === props.contextKey
  );
}
const acceptances = computed(() => {
  const entries = new Map(
    props.item.acceptances.map((value) => [value.id, value]),
  );
  if (props.item.acceptance)
    entries.set(props.item.acceptance.id, props.item.acceptance);
  return [...entries.values()];
});
const selected = computed(() =>
  acceptances.value.find((value) => value.id === acceptanceId.value),
);
const recordEdit = computed(() =>
  props.item.recordEdits?.acceptanceCorrections.find(
    (value) => value.acceptanceId === acceptanceId.value,
  ),
);
const allowed = computed(
  () =>
    props.item.recordEdits?.canCorrectAcceptance === true &&
    selected.value !== undefined &&
    recordEdit.value !== undefined,
);
function setSelectedValues(): void {
  acceptedAt.value = selected.value?.acceptedAt ?? '';
  courtCaseNo.value = selected.value?.courtCaseNo ?? '';
  reason.value = '';
}
const canSave = computed(() => {
  const nextNo = courtCaseNo.value.trim();
  const nextReason = reason.value.trim();
  return (
    allowed.value &&
    !submitting.value &&
    unknownRequest.value === null &&
    /^\d{4}-\d{2}-\d{2}$/u.test(acceptedAt.value) &&
    nextNo.length >= 1 &&
    nextNo.length <= 100 &&
    nextReason.length >= 1 &&
    nextReason.length <= 500 &&
    (acceptedAt.value !== selected.value?.acceptedAt ||
      nextNo !== selected.value?.courtCaseNo)
  );
});
watch(
  () => props.item.id,
  () => {
    acceptanceId.value = acceptances.value[0]?.id ?? '';
    setSelectedValues();
  },
  { flush: 'sync' },
);
watch(
  [() => props.item.id, () => props.contextKey],
  () => {
    revision += 1;
    requestController?.abort();
    requestController = null;
    unknownRequest.value = null;
    submitting.value = false;
    error.value = '';
    success.value = '';
    setSelectedValues();
  },
  { immediate: true, flush: 'sync' },
);
watch(acceptanceId, setSelectedValues, { flush: 'sync' });
function reset(): void {
  if (unknownRequest.value) return;
  error.value = '';
  success.value = '';
  setSelectedValues();
}
function unavailableReason(): string {
  if (!props.item.recordEdits)
    return '\u6b64\u8d44\u6599\u6682\u4e0d\u53ef\u7f16\u8f91\uff0c\u8bf7\u5237\u65b0\u540e\u91cd\u8bd5\u3002';
  if (!props.item.recordEdits.canCorrectAcceptance)
    return '\u5f53\u524d\u8d26\u53f7\u6ca1\u6709\u66f4\u6b63\u4e00\u5ba1\u53d7\u7406\u4fe1\u606f\u7684\u6848\u4ef6\u6743\u9650\u3002';
  if (acceptances.value.length === 0)
    return '\u5f53\u524d\u6848\u4ef6\u6ca1\u6709\u5df2\u767b\u8bb0\u7684\u4e00\u5ba1\u53d7\u7406\u4e8b\u5b9e\uff0c\u4e0d\u80fd\u66f4\u6b63\u3002';
  if (!selected.value)
    return '\u8bf7\u9009\u62e9\u4e00\u6761\u5df2\u767b\u8bb0\u7684\u4e00\u5ba1\u53d7\u7406\u5b9e\u4f8b\u3002';
  if (!recordEdit.value)
    return '\u6b64\u8d44\u6599\u6682\u4e0d\u53ef\u7f16\u8f91\uff0c\u8bf7\u5237\u65b0\u540e\u91cd\u8bd5\u3002';
  return '\u5f53\u524d\u53d7\u7406\u4fe1\u606f\u6682\u4e0d\u53ef\u66f4\u6b63\u3002';
}
function failureMessage(reason: unknown): string {
  if (reason instanceof ApiError && reason.code === 'VERSION_CONFLICT')
    return '\u53d7\u7406\u4fe1\u606f\u7248\u672c\u5df2\u53d8\u5316\u3002\u8bf7\u5237\u65b0\u9875\u9762\uff0c\u6838\u5bf9\u5f53\u524d\u503c\u540e\u91cd\u65b0\u7f16\u8f91\u3002';
  if (reason instanceof ApiError && reason.code === 'INVALID_STATE')
    return '\u5f53\u524d\u53d7\u7406\u5b9e\u4f8b\u5df2\u53d8\u5316\u3002\u8bf7\u5237\u65b0\u9875\u9762\u5e76\u91cd\u65b0\u6838\u5bf9\u3002';
  if (reason instanceof ApiError && reason.status === 403)
    return '\u5f53\u524d\u8d26\u53f7\u5df2\u65e0\u6743\u66f4\u6b63\u8be5\u53d7\u7406\u5b9e\u4f8b\u3002';
  if (reason instanceof ApiError && reason.status === 404)
    return '\u6848\u4ef6\u6216\u53d7\u7406\u5b9e\u4f8b\u5df2\u4e0d\u53ef\u8bbf\u95ee\u3002\u5df2\u505c\u6b62\u65e7\u8868\u5355\u5e76\u5237\u65b0\u6848\u4ef6\u6570\u636e\u3002';
  if (
    reason instanceof ApiError &&
    ['NETWORK_ERROR', 'TIMEOUT', 'INTERNAL_ERROR', 'INVALID_RESPONSE'].includes(
      reason.code,
    )
  )
    return '\u8bf7\u6c42\u7ed3\u679c\u5f85\u6838\u5bf9\uff0c\u4fdd\u7559\u539f\u8bf7\u6c42\u5185\u5bb9\u548c\u8bf7\u6c42\u952e\u3002';
  return '\u53d7\u7406\u4fe1\u606f\u66f4\u6b63\u5931\u8d25\uff0c\u8bf7\u6838\u5bf9\u540e\u91cd\u8bd5\u3002';
}
async function send(input: CorrectCaseAcceptanceInput): Promise<void> {
  const context = captureContext();
  const controller = new AbortController();
  requestController = controller;
  unknownRequest.value = input;
  submitting.value = true;
  error.value = '';
  success.value = '';
  try {
    await correctCaseAcceptance(context.caseId, input, {
      signal: controller.signal,
    });
    if (!isCurrent(context)) return;
    unknownRequest.value = null;
    success.value =
      '\u53d7\u7406\u4fe1\u606f\u66f4\u6b63\u5df2\u4fdd\u5b58\u3002';
    notifyWorkflowChanged();
    emit('changed');
  } catch (failure) {
    if (!isCurrent(context)) return;
    error.value = failureMessage(failure);
    const uncertain =
      failure instanceof ApiError &&
      [
        'NETWORK_ERROR',
        'TIMEOUT',
        'INTERNAL_ERROR',
        'INVALID_RESPONSE',
      ].includes(failure.code);
    if (!uncertain) unknownRequest.value = null;
    if (
      failure instanceof ApiError &&
      ['VERSION_CONFLICT', 'INVALID_STATE'].includes(failure.code)
    )
      emit('refresh');
    if (failure instanceof ApiError && [401, 403, 404].includes(failure.status))
      emit('access-lost');
  } finally {
    if (requestController === controller) requestController = null;
    if (isCurrent(context)) submitting.value = false;
  }
}
function save(): void {
  if (!canSave.value || !selected.value || !recordEdit.value) return;
  const key = globalThis.crypto?.randomUUID?.();
  if (!key) {
    error.value = '当前浏览器不能生成安全请求键，请刷新后重试。';
    return;
  }
  void send({
    acceptanceId: selected.value.id,
    expectedAcceptanceRevision: recordEdit.value.acceptanceRevision,
    idempotencyKey: key,
    acceptedAt: acceptedAt.value,
    courtCaseNo: courtCaseNo.value.trim(),
    reason: reason.value.trim(),
  });
}
function retryOriginal(): void {
  if (unknownRequest.value && !submitting.value)
    void send(unknownRequest.value);
}
function acceptanceLabel(value: CaseAcceptanceHistory): string {
  return `${value.acceptedAt} · ${value.courtCaseNo}`;
}
onDeactivated(() => {
  active = false;
  revision += 1;
  submitting.value = false;
  requestController?.abort();
  requestController = null;
});
onActivated(() => {
  active = true;
});
onBeforeUnmount(() => {
  active = false;
  revision += 1;
  requestController?.abort();
});
</script>

<template>
  <section
    class="demo-card demo-card--pad"
    data-test="case-acceptance-correction-panel"
  >
    <h3>&#x66f4;&#x6b63;&#x4e00;&#x5ba1;&#x53d7;&#x7406;&#x4fe1;&#x606f;</h3>
    <p v-if="!allowed" class="field-help" data-test="record-edit-unavailable">
      {{ unavailableReason() }}
    </p>
    <template v-else>
      <label v-if="acceptances.length > 1" class="form-field">
        &#x9009;&#x62e9;&#x5df2;&#x767b;&#x8bb0;&#x53d7;&#x7406;
        <select
          v-model="acceptanceId"
          class="text-input"
          data-test="acceptance-correction-record"
          :disabled="!!unknownRequest"
        >
          <option
            v-for="entry in acceptances"
            :key="entry.id"
            :value="entry.id"
          >
            {{ acceptanceLabel(entry) }}
          </option>
        </select>
      </label>
      <p v-else class="field-help">
        &#x5df2;&#x767b;&#x8bb0;&#x53d7;&#x7406;&#xff1a;{{
          selected ? acceptanceLabel(selected) : ''
        }}
      </p>
      <label class="form-field">
        &#x53d7;&#x7406;&#x65e5;&#x671f;
        <input
          v-model="acceptedAt"
          type="date"
          class="text-input"
          data-test="acceptance-correction-date"
          :disabled="!!unknownRequest"
        />
      </label>
      <label class="form-field">
        &#x6cd5;&#x9662;&#x6848;&#x53f7;
        <input
          v-model="courtCaseNo"
          class="text-input"
          maxlength="100"
          data-test="acceptance-correction-court-case-no"
          :disabled="!!unknownRequest"
        />
      </label>
      <label class="form-field">
        &#x66f4;&#x6b63;&#x539f;&#x56e0;
        <textarea
          v-model="reason"
          class="text-input"
          maxlength="500"
          rows="3"
          data-test="acceptance-correction-reason"
          :disabled="!!unknownRequest"
        />
      </label>
      <p class="field-help">
        &#x53ea;&#x80fd;&#x4fee;&#x6539;&#x5df2;&#x767b;&#x8bb0;&#x53d7;&#x7406;&#x8bb0;&#x5f55;&#x7684;&#x5f53;&#x524d;&#x5c55;&#x793a;&#x503c;&#xff0c;&#x539f;&#x767b;&#x8bb0;&#x4e8b;&#x5b9e;&#x4e0e;&#x9636;&#x6bb5;&#x7ee7;&#x7eed;&#x4fdd;&#x6301;&#x4e0d;&#x53d8;&#x3002;
      </p>
    </template>
    <p v-if="error" role="alert" data-test="record-edit-unknown">{{ error }}</p>
    <p v-if="success" role="status">{{ success }}</p>
    <div class="form-actions">
      <button
        type="button"
        data-test="acceptance-correction-save"
        :disabled="!canSave"
        @click="save"
      >
        &#x4fdd;&#x5b58;&#x53d7;&#x7406;&#x66f4;&#x6b63;
      </button>
      <button
        type="button"
        data-test="acceptance-correction-cancel"
        :disabled="!!unknownRequest"
        @click="reset"
      >
        &#x53d6;&#x6d88;
      </button>
      <button
        v-if="unknownRequest"
        type="button"
        data-test="acceptance-correction-retry-original"
        :disabled="submitting"
        @click="retryOriginal"
      >
        &#x6309;&#x539f;&#x8bf7;&#x6c42;&#x91cd;&#x8bd5;
      </button>
    </div>
  </section>
</template>
