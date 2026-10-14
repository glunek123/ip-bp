<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import {
  saveSecondInstanceAcceptance,
  todayShanghai,
  type CaseDetail,
  type SaveSecondInstanceAcceptanceInput,
  type SecondInstanceAcceptanceEdit,
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
const entries = computed(
  () => props.item.recordEdits?.secondInstanceAcceptances ?? [],
);
const currentChoiceId = computed(() => {
  const choice = props.item.judgmentNextStep.current;
  return choice?.next === 'APPEAL' ? choice.id : null;
});
const selectedChoiceId = ref('');
const selected = computed(() =>
  entries.value.find((entry) => entry.choiceId === selectedChoiceId.value),
);
const acceptedAt = ref('');
const courtCaseNo = ref('');
const reason = ref('');
const submitting = ref(false);
const error = ref('');
const success = ref('');
const unknownRequest = ref<SaveSecondInstanceAcceptanceInput | null>(null);
const draftBase = ref<{
  acceptanceRevision: number;
  acceptedAt: string | null;
  courtCaseNo: string | null;
} | null>(null);
let revision = 0;
let active = true;
let requestController: AbortController | null = null;

function defaultChoiceId(): string {
  return (
    entries.value.find((entry) => entry.choiceId === currentChoiceId.value)
      ?.choiceId ??
    entries.value.find((entry) => entry.canEdit)?.choiceId ??
    entries.value[0]?.choiceId ??
    ''
  );
}
function setSelectedValues(): void {
  const entry = entries.value.find(
    (value) => value.choiceId === selectedChoiceId.value,
  );
  acceptedAt.value = entry?.acceptedAt ?? '';
  courtCaseNo.value = entry?.courtCaseNo ?? '';
  reason.value = '';
  draftBase.value = entry
    ? {
        acceptanceRevision: entry.acceptanceRevision,
        acceptedAt: entry.acceptedAt,
        courtCaseNo: entry.courtCaseNo,
      }
    : null;
}
const allowed = computed(
  () =>
    props.item.recordEdits?.canSaveSecondInstanceAcceptance === true &&
    selected.value?.canEdit === true,
);
const acceptedAtValue = computed(() => acceptedAt.value.trim() || null);
const courtCaseNoValue = computed(() => courtCaseNo.value.trim() || null);
const canSave = computed(() => {
  const entry = selected.value;
  const base = draftBase.value;
  const nextAcceptedAt = acceptedAtValue.value;
  const nextCourtCaseNo = courtCaseNoValue.value;
  const nextReason = reason.value.trim();
  return (
    allowed.value &&
    entry !== undefined &&
    base !== null &&
    base.acceptanceRevision === entry.acceptanceRevision &&
    base.acceptedAt === entry.acceptedAt &&
    base.courtCaseNo === entry.courtCaseNo &&
    !submitting.value &&
    unknownRequest.value === null &&
    (nextAcceptedAt === null ||
      (/^\d{4}-\d{2}-\d{2}$/u.test(nextAcceptedAt) &&
        !Number.isNaN(Date.parse(`${nextAcceptedAt}T00:00:00Z`)) &&
        new Date(`${nextAcceptedAt}T00:00:00Z`).toISOString().slice(0, 10) ===
          nextAcceptedAt &&
        nextAcceptedAt <= todayShanghai())) &&
    (nextCourtCaseNo === null || nextCourtCaseNo.length <= 100) &&
    (entry.acceptanceRevision > 0 ||
      nextAcceptedAt !== null ||
      nextCourtCaseNo !== null) &&
    (entry.acceptanceRevision === 0
      ? nextReason.length === 0
      : nextReason.length >= 1 && nextReason.length <= 500) &&
    (nextAcceptedAt !== entry.acceptedAt ||
      nextCourtCaseNo !== entry.courtCaseNo)
  );
});
const canRetryOriginal = computed(
  () =>
    unknownRequest.value !== null &&
    !submitting.value &&
    props.item.recordEdits?.canSaveSecondInstanceAcceptance === true &&
    selected.value?.canEdit === true,
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
    if (
      !entries.value.some((entry) => entry.choiceId === selectedChoiceId.value)
    )
      selectedChoiceId.value = defaultChoiceId();
    setSelectedValues();
  },
  { immediate: true, flush: 'sync' },
);
watch(selectedChoiceId, setSelectedValues, { flush: 'sync' });
watch(
  [
    () => selected.value?.acceptanceRevision,
    () => selected.value?.acceptedAt,
    () => selected.value?.courtCaseNo,
  ],
  (next, previous) => {
    if (!previous || unknownRequest.value) return;
    const hasDraft =
      acceptedAtValue.value !== (draftBase.value?.acceptedAt ?? null) ||
      courtCaseNoValue.value !== (draftBase.value?.courtCaseNo ?? null) ||
      reason.value.trim().length > 0;
    setSelectedValues();
    if (
      hasDraft &&
      !success.value &&
      (next[0] !== previous[0] ||
        next[1] !== previous[1] ||
        next[2] !== previous[2])
    )
      error.value = '二审受理资料已更新，请核对当前值后重新编辑。';
  },
  { flush: 'sync' },
);

function reset(): void {
  if (unknownRequest.value) return;
  error.value = '';
  success.value = '';
  setSelectedValues();
  emit('cancel');
}
function captureContext() {
  return {
    caseId: props.item.id,
    contextKey: props.contextKey,
    revision,
  };
}
function isCurrent(context: ReturnType<typeof captureContext>): boolean {
  return (
    active &&
    context.revision === revision &&
    context.caseId === props.item.id &&
    context.contextKey === props.contextKey
  );
}
function failureMessage(failure: unknown): string {
  if (failure instanceof ApiError && failure.code === 'VERSION_CONFLICT')
    return '二审受理资料版本已变化，请刷新并核对当前值后重新编辑。';
  if (failure instanceof ApiError && failure.code === 'INVALID_STATE')
    return '当前上诉选择已变化，请刷新后重新核对。';
  if (failure instanceof ApiError && failure.status === 403)
    return '当前账号已无权编辑该二审受理资料。';
  if (failure instanceof ApiError && failure.status === 404)
    return '案件或上诉记录已不可访问，旧表单已停止并刷新案件数据。';
  if (
    failure instanceof ApiError &&
    ['NETWORK_ERROR', 'TIMEOUT', 'INTERNAL_ERROR', 'INVALID_RESPONSE'].includes(
      failure.code,
    )
  )
    return '请求结果待核对；保留原请求内容和请求键。';
  return '二审受理资料保存失败，请核对后重试。';
}
async function send(input: SaveSecondInstanceAcceptanceInput): Promise<void> {
  const context = captureContext();
  const controller = new AbortController();
  requestController = controller;
  unknownRequest.value = input;
  submitting.value = true;
  error.value = '';
  success.value = '';
  try {
    await saveSecondInstanceAcceptance(context.caseId, input, {
      signal: controller.signal,
    });
    if (!isCurrent(context)) return;
    unknownRequest.value = null;
    success.value = '二审受理资料已保存。';
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
  const entry = selected.value;
  const base = draftBase.value;
  if (!canSave.value || !entry || !base) return;
  const key = globalThis.crypto?.randomUUID?.();
  if (!key) {
    error.value = '当前浏览器不能生成安全请求键，请刷新后重试。';
    return;
  }
  void send({
    choiceId: entry.choiceId,
    trialRoundId: entry.trialRoundId,
    expectedAcceptanceRevision: base.acceptanceRevision,
    idempotencyKey: key,
    acceptedAt: acceptedAtValue.value,
    courtCaseNo: courtCaseNoValue.value,
    reason: entry.acceptanceRevision === 0 ? null : reason.value.trim(),
  });
}
function retryOriginal(): void {
  if (canRetryOriginal.value && unknownRequest.value)
    void send(unknownRequest.value);
}
function choiceLabel(entry: SecondInstanceAcceptanceEdit): string {
  const choice = [
    ...props.item.judgmentNextStep.history,
    ...(props.item.judgmentNextStep.current
      ? [props.item.judgmentNextStep.current]
      : []),
  ].find((value) => value.id === entry.choiceId);
  const round = props.item.secondInstance.rounds.find(
    (value) => value.id === entry.trialRoundId,
  );
  return `上诉选择 ${choice?.recordedAt ?? entry.trialRoundId}${round ? ` · 第${round.sequence}轮` : ''}`;
}
onBeforeUnmount(() => {
  active = false;
  revision += 1;
  submitting.value = false;
  requestController?.abort();
  requestController = null;
});
</script>

<template>
  <section
    class="demo-card demo-card--pad"
    data-test="second-instance-acceptance-panel"
  >
    <h2 class="form-section-title">二审受理信息</h2>
    <p>记录真实上诉选择对应的二审受理日期和法院案号，不改变案件阶段。</p>
    <p
      v-if="props.item.recordEdits?.secondInstanceAcceptances === undefined"
      class="field-help"
      data-test="second-instance-acceptance-unavailable"
    >
      当前接口未提供二审受理资料版本，暂不可编辑。
    </p>
    <template v-else>
      <label v-if="entries.length > 1" class="form-field">
        上诉选择
        <select
          v-model="selectedChoiceId"
          class="text-input"
          data-test="second-instance-acceptance-choice"
          :disabled="unknownRequest !== null"
        >
          <option
            v-for="entry in entries"
            :key="entry.choiceId"
            :value="entry.choiceId"
          >
            {{ choiceLabel(entry) }}
          </option>
        </select>
      </label>
      <p v-else-if="selected">{{ choiceLabel(selected) }}</p>
      <p v-else class="field-help">没有可编辑的真实上诉选择。</p>
      <form v-if="selected" class="form-stack" @submit.prevent="save">
        <label class="form-field">
          二审受理日期
          <input
            v-model="acceptedAt"
            class="text-input"
            type="date"
            :max="todayShanghai()"
            data-test="second-instance-acceptance-date"
            :disabled="!allowed || unknownRequest !== null || submitting"
          />
        </label>
        <label class="form-field">
          二审法院案号
          <input
            v-model="courtCaseNo"
            class="text-input"
            maxlength="100"
            data-test="second-instance-acceptance-case-no"
            :disabled="!allowed || unknownRequest !== null || submitting"
          />
        </label>
        <label v-if="selected.acceptanceRevision > 0" class="form-field">
          更正原因
          <textarea
            v-model="reason"
            class="text-input"
            rows="3"
            maxlength="500"
            data-test="second-instance-acceptance-reason"
            :disabled="!allowed || unknownRequest !== null || submitting"
          />
        </label>
        <p v-if="!selected.canEdit" class="field-help" role="status">
          当前账号不能编辑此上诉选择的二审受理资料。
        </p>
        <button
          type="submit"
          data-test="second-instance-acceptance-save"
          :disabled="!canSave"
        >
          {{
            selected.acceptanceRevision === 0
              ? '登记二审受理信息'
              : '保存二审受理更正'
          }}
        </button>
        <button
          type="button"
          data-test="second-instance-acceptance-cancel"
          :disabled="unknownRequest !== null || submitting"
          @click="reset"
        >
          取消
        </button>
      </form>
      <ol
        v-if="selected?.history.length"
        data-test="second-instance-acceptance-history"
      >
        <li v-for="change in selected.history" :key="change.id">
          <p>二审受理日期：{{ change.acceptedAt ?? '未登记' }}</p>
          <p>二审法院案号：{{ change.courtCaseNo ?? '未登记' }}</p>
          <p v-if="change.reason">更正原因：{{ change.reason }}</p>
          <p>记录时间：{{ change.recordedAt }}</p>
        </li>
      </ol>
    </template>
    <p v-if="error" role="alert" data-test="second-instance-acceptance-error">
      {{ error }}
    </p>
    <p v-if="success" role="status">{{ success }}</p>
    <p v-if="unknownRequest" class="field-help">
      请求结果待核对；重试将使用原请求内容和请求键。
    </p>
    <button
      v-if="unknownRequest"
      type="button"
      data-test="second-instance-acceptance-retry"
      :disabled="!canRetryOriginal"
      @click="retryOriginal"
    >
      按原请求重试
    </button>
  </section>
</template>
