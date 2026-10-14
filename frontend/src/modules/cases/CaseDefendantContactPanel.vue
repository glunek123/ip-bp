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
  updateCaseDefendantContact,
  type CaseDetail,
  type UpdateCaseDefendantContactInput,
} from '../../api/cases';
import { ApiError } from '../../api/http';
import { notifyWorkflowChanged } from '../../app/workflow-events';

const props = defineProps<{ item: CaseDetail; contextKey: string }>();
const emit = defineEmits<{
  changed: [];
  refresh: [];
  'access-lost': [];
  cancel: [];
}>();
const defendantId = ref(props.item.defendants[0]?.id ?? '');
const phone = ref('');
const address = ref('');
const submitting = ref(false);
const error = ref('');
const success = ref('');
const unknownRequest = ref<UpdateCaseDefendantContactInput | null>(null);
const draftBase = ref<{
  contactRevision: number;
  phone: string;
  address: string;
} | null>(null);
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
const selected = computed(() =>
  props.item.defendants.find((value) => value.id === defendantId.value),
);
const recordEdit = computed(() =>
  props.item.recordEdits?.defendantContacts.find(
    (value) => value.defendantId === defendantId.value,
  ),
);
const allowed = computed(
  () =>
    props.item.recordEdits?.canUpdateDefendantContact === true &&
    selected.value !== undefined &&
    recordEdit.value !== undefined,
);
const canRetryOriginal = computed(
  () =>
    unknownRequest.value !== null &&
    !submitting.value &&
    props.item.recordEdits?.canUpdateDefendantContact === true &&
    selected.value !== undefined &&
    recordEdit.value !== undefined,
);
const canSave = computed(() => {
  const nextPhone = phone.value.trim() || null;
  const nextAddress = address.value.trim() || null;
  return (
    allowed.value &&
    draftBase.value !== null &&
    recordEdit.value !== undefined &&
    draftBase.value.contactRevision === recordEdit.value.contactRevision &&
    draftBase.value.phone === (selected.value?.phone ?? '') &&
    draftBase.value.address === (selected.value?.address ?? '') &&
    !submitting.value &&
    unknownRequest.value === null &&
    (nextPhone?.length ?? 0) <= 100 &&
    (nextAddress?.length ?? 0) <= 500 &&
    (nextPhone !== selected.value?.phone ||
      nextAddress !== selected.value?.address)
  );
});
function setSelectedValues(): void {
  phone.value = selected.value?.phone ?? '';
  address.value = selected.value?.address ?? '';
  draftBase.value =
    selected.value && recordEdit.value
      ? {
          contactRevision: recordEdit.value.contactRevision,
          phone: selected.value.phone ?? '',
          address: selected.value.address ?? '',
        }
      : null;
}
watch(
  () => props.item.id,
  () => {
    defendantId.value = props.item.defendants[0]?.id ?? '';
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
watch(defendantId, setSelectedValues, { flush: 'sync' });
watch(
  [
    () => recordEdit.value?.contactRevision,
    () => selected.value?.phone,
    () => selected.value?.address,
  ],
  (next, previous) => {
    if (!previous || unknownRequest.value) return;
    const hasDraft =
      phone.value !== (draftBase.value?.phone ?? '') ||
      address.value !== (draftBase.value?.address ?? '');
    setSelectedValues();
    if (
      hasDraft &&
      !success.value &&
      (next[0] !== previous[0] ||
        next[1] !== previous[1] ||
        next[2] !== previous[2])
    )
      error.value =
        '\u8d44\u6599\u5df2\u66f4\u65b0\uff0c\u8bf7\u6838\u5bf9\u5f53\u524d\u503c\u540e\u91cd\u65b0\u7f16\u8f91\u3002';
  },
  { flush: 'sync' },
);
function reset(): void {
  if (unknownRequest.value) return;
  unknownRequest.value = null;
  error.value = '';
  success.value = '';
  setSelectedValues();
  emit('cancel');
}
function unavailableReason(): string {
  if (!props.item.recordEdits)
    return '\u6b64\u8d44\u6599\u6682\u4e0d\u53ef\u7f16\u8f91\uff0c\u8bf7\u5237\u65b0\u540e\u91cd\u8bd5\u3002';
  if (!props.item.recordEdits.canUpdateDefendantContact)
    return '\u5f53\u524d\u8d26\u53f7\u6ca1\u6709\u66f4\u65b0\u88ab\u544a\u8054\u7cfb\u65b9\u5f0f\u7684\u6848\u4ef6\u6743\u9650\u3002';
  if (!selected.value)
    return '\u5f53\u524d\u6848\u4ef6\u6ca1\u6709\u53ef\u7f16\u8f91\u7684\u88ab\u544a\u8d44\u6599\u3002';
  if (!recordEdit.value)
    return '\u6b64\u8d44\u6599\u6682\u4e0d\u53ef\u7f16\u8f91\uff0c\u8bf7\u5237\u65b0\u540e\u91cd\u8bd5\u3002';
  return '\u5f53\u524d\u88ab\u544a\u8054\u7cfb\u65b9\u5f0f\u6682\u4e0d\u53ef\u7f16\u8f91\u3002';
}
function failureMessage(reason: unknown): string {
  if (reason instanceof ApiError && reason.code === 'VERSION_CONFLICT')
    return '\u8054\u7cfb\u65b9\u5f0f\u7248\u672c\u5df2\u53d8\u5316\u3002\u8bf7\u5237\u65b0\u9875\u9762\uff0c\u6838\u5bf9\u5f53\u524d\u503c\u540e\u91cd\u65b0\u7f16\u8f91\u3002';
  if (reason instanceof ApiError && reason.code === 'INVALID_STATE')
    return '\u5f53\u524d\u6848\u4ef6\u72b6\u6001\u5df2\u53d8\u5316\u3002\u8bf7\u5237\u65b0\u9875\u9762\u5e76\u91cd\u65b0\u6838\u5bf9\u3002';
  if (reason instanceof ApiError && reason.status === 403)
    return '\u5f53\u524d\u8d26\u53f7\u5df2\u65e0\u6743\u66f4\u65b0\u8be5\u88ab\u544a\u8054\u7cfb\u65b9\u5f0f\u3002';
  if (reason instanceof ApiError && reason.status === 404)
    return '\u6848\u4ef6\u6216\u88ab\u544a\u5df2\u4e0d\u53ef\u8bbf\u95ee\u3002\u5df2\u505c\u6b62\u65e7\u8868\u5355\u5e76\u5237\u65b0\u6848\u4ef6\u6570\u636e\u3002';
  if (
    reason instanceof ApiError &&
    ['NETWORK_ERROR', 'TIMEOUT', 'INTERNAL_ERROR', 'INVALID_RESPONSE'].includes(
      reason.code,
    )
  )
    return '\u8bf7\u6c42\u7ed3\u679c\u5f85\u6838\u5bf9\uff0c\u4fdd\u7559\u539f\u8bf7\u6c42\u5185\u5bb9\u548c\u8bf7\u6c42\u952e\u3002';
  return '\u8054\u7cfb\u65b9\u5f0f\u66f4\u65b0\u5931\u8d25\uff0c\u8bf7\u6838\u5bf9\u540e\u91cd\u8bd5\u3002';
}
async function send(input: UpdateCaseDefendantContactInput): Promise<void> {
  const context = captureContext();
  const controller = new AbortController();
  requestController = controller;
  unknownRequest.value = input;
  submitting.value = true;
  error.value = '';
  success.value = '';
  try {
    await updateCaseDefendantContact(context.caseId, input, {
      signal: controller.signal,
    });
    if (!isCurrent(context)) return;
    unknownRequest.value = null;
    success.value =
      '\u88ab\u544a\u8054\u7cfb\u65b9\u5f0f\u5df2\u4fdd\u5b58\u3002';
    notifyWorkflowChanged();
    emit('changed');
  } catch (reason) {
    if (!isCurrent(context)) return;
    error.value = failureMessage(reason);
    const uncertain =
      reason instanceof ApiError &&
      [
        'NETWORK_ERROR',
        'TIMEOUT',
        'INTERNAL_ERROR',
        'INVALID_RESPONSE',
      ].includes(reason.code);
    if (!uncertain) unknownRequest.value = null;
    if (
      reason instanceof ApiError &&
      ['VERSION_CONFLICT', 'INVALID_STATE'].includes(reason.code)
    )
      emit('refresh');
    if (reason instanceof ApiError && [401, 403, 404].includes(reason.status))
      emit('access-lost');
  } finally {
    if (requestController === controller) requestController = null;
    if (isCurrent(context)) submitting.value = false;
  }
}
function save(): void {
  if (
    !canSave.value ||
    !selected.value ||
    !recordEdit.value ||
    !draftBase.value
  )
    return;
  const key =
    typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  void send({
    defendantId: selected.value.id,
    expectedContactRevision: draftBase.value.contactRevision,
    idempotencyKey: key,
    phone: phone.value.trim() || null,
    address: address.value.trim() || null,
  });
}
function retryOriginal(): void {
  if (canRetryOriginal.value && unknownRequest.value)
    void send(unknownRequest.value);
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
    data-test="case-defendant-contact-panel"
  >
    <h3>&#x66f4;&#x65b0;&#x88ab;&#x544a;&#x8054;&#x7cfb;&#x65b9;&#x5f0f;</h3>
    <p v-if="!allowed" class="field-help" data-test="record-edit-unavailable">
      {{ unavailableReason() }}
    </p>
    <template v-else>
      <label v-if="item.defendants.length > 1" class="form-field">
        选择被告
        <select
          v-model="defendantId"
          class="text-input"
          :disabled="!!unknownRequest"
        >
          <option
            v-for="entry in item.defendants"
            :key="entry.id"
            :value="entry.id"
          >
            {{ entry.name }}
          </option>
        </select>
      </label>
      <p v-else class="field-help">
        &#x88ab;&#x544a;&#xff1a;{{ selected?.name }}
      </p>
      <label class="form-field">
        &#x8054;&#x7cfb;&#x7535;&#x8bdd;
        <input
          v-model="phone"
          class="text-input"
          data-test="defendant-contact-phone"
          :disabled="!!unknownRequest"
        />
      </label>
      <label class="form-field">
        &#x8054;&#x7cfb;&#x5730;&#x5740;
        <textarea
          v-model="address"
          class="text-input"
          rows="3"
          data-test="defendant-contact-address"
          :disabled="!!unknownRequest"
        />
      </label>
      <p class="field-help">
        &#x4fdd;&#x5b58;&#x540e;&#x4f1a;&#x8bb0;&#x5f55;&#x524d;&#x540e;&#x503c;&#x548c;&#x64cd;&#x4f5c;&#x4eba;&#xff1b;&#x7535;&#x8bdd;&#x3001;&#x5730;&#x5740;&#x65e0;&#x9700;&#x586b;&#x5199;&#x539f;&#x56e0;&#x3002;
      </p>
    </template>
    <p v-if="error" role="alert" data-test="record-edit-unknown">{{ error }}</p>
    <p v-if="success" role="status">{{ success }}</p>
    <div class="form-actions">
      <button
        type="button"
        data-test="defendant-contact-save"
        :disabled="!canSave"
        @click="save"
      >
        &#x4fdd;&#x5b58;&#x8054;&#x7cfb;&#x65b9;&#x5f0f;
      </button>
      <button
        type="button"
        data-test="defendant-contact-cancel"
        :disabled="!!unknownRequest"
        @click="reset"
      >
        &#x53d6;&#x6d88;
      </button>
      <button
        v-if="unknownRequest"
        type="button"
        data-test="defendant-contact-retry-original"
        :disabled="!canRetryOriginal"
        @click="retryOriginal"
      >
        &#x6309;&#x539f;&#x8bf7;&#x6c42;&#x91cd;&#x8bd5;
      </button>
    </div>
  </section>
</template>
