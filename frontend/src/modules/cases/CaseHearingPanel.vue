<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import {
  correctCaseHearing,
  scheduleCaseHearing,
  todayShanghai,
  type CaseDetail,
  type CorrectCaseHearingInput,
  type LawyerCaseDetail,
  type SaveCaseHearingInput,
} from '../../api/cases';
import { ApiError } from '../../api/http';
import { notifyWorkflowChanged } from '../../app/workflow-events';

type PanelItem = Pick<
  CaseDetail | LawyerCaseDetail,
  | 'id'
  | 'stage'
  | 'version'
  | 'acceptance'
  | 'canScheduleHearing'
  | 'canCorrectHearing'
  | 'hearing'
>;

const props = defineProps<{
  item: PanelItem;
  contextKey: string;
  lawyer?: boolean;
}>();

const emit = defineEmits<{ changed: []; refresh: [] }>();
const hearingAt = ref(props.item.hearing.currentArrangement?.hearingAt ?? '');
const clearDate = ref(false);
const correctionReason = ref('');
const submitting = ref(false);
const error = ref('');
const success = ref('');
const unknownRequest = ref<
  | { kind: 'schedule'; input: SaveCaseHearingInput }
  | { kind: 'correct'; input: CorrectCaseHearingInput }
  | null
>(null);
let revision = 0;
let active = true;

type OperationContext = { id: string; contextKey: string; revision: number };
function captureContext(): OperationContext {
  return { id: props.item.id, contextKey: props.contextKey, revision };
}
function isCurrent(context: OperationContext): boolean {
  return (
    active &&
    context.revision === revision &&
    context.id === props.item.id &&
    context.contextKey === props.contextKey
  );
}
function resetContext(): void {
  hearingAt.value = props.item.hearing.currentArrangement?.hearingAt ?? '';
  clearDate.value = false;
  correctionReason.value = '';
  submitting.value = false;
  error.value = '';
  success.value = '';
  unknownRequest.value = null;
}
watch(
  [() => props.item.id, () => props.contextKey],
  () => {
    revision += 1;
    resetContext();
  },
  { immediate: true, flush: 'sync' },
);
onBeforeUnmount(() => {
  active = false;
  revision += 1;
});

const canSchedule = computed(
  () =>
    props.item.stage === 'WAITING_HEARING' &&
    props.item.canScheduleHearing &&
    props.item.acceptance !== null,
);
const canCorrect = computed(
  () =>
    !props.lawyer &&
    props.item.stage === 'WAITING_JUDGMENT' &&
    props.item.canCorrectHearing,
);
const acceptanceDate = computed(() => props.item.acceptance?.acceptedAt ?? '');
const selectedDate = computed(() => (clearDate.value ? null : hearingAt.value));
const validDate = computed(() => {
  if (clearDate.value) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(hearingAt.value)) return false;
  const parsed = new Date(`${hearingAt.value}T00:00:00.000Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === hearingAt.value &&
    hearingAt.value >= acceptanceDate.value
  );
});
const reasonValid = computed(() => {
  const trimmed = correctionReason.value.trim();
  return trimmed.length >= 1 && trimmed.length <= 500;
});
const scheduleReady = computed(
  () =>
    canSchedule.value &&
    validDate.value &&
    !submitting.value &&
    unknownRequest.value === null,
);
const correctionReady = computed(
  () =>
    canCorrect.value &&
    validDate.value &&
    reasonValid.value &&
    !submitting.value &&
    unknownRequest.value === null,
);
function makeKey(): string {
  return typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
function makeInput(): SaveCaseHearingInput {
  return {
    expectedVersion: props.item.version,
    idempotencyKey: makeKey(),
    hearingAt: selectedDate.value,
  };
}
function isUnknownOutcome(reason: unknown): boolean {
  return (
    reason instanceof ApiError &&
    (reason.status >= 500 ||
      [
        'NETWORK_ERROR',
        'TIMEOUT',
        'INTERNAL_ERROR',
        'INVALID_RESPONSE',
      ].includes(reason.code))
  );
}
function failureMessage(reason: unknown): string {
  if (isUnknownOutcome(reason))
    return '开庭安排结果暂时未知。请保留本次请求，并使用相同请求安全重试；刷新详情不能证明本次请求是否成功。';
  if (
    reason instanceof ApiError &&
    ['VERSION_CONFLICT', 'INVALID_STATE'].includes(reason.code)
  )
    return '案件已自动推进或版本已变化。请刷新案件；若已进入待判决且当前账号有纠错权限，请使用受控纠错。';
  if (reason instanceof ApiError && reason.code === 'IDEMPOTENCY_CONFLICT')
    return '请求键已用于不同的开庭安排，请刷新案件后重新填写。';
  if (
    reason instanceof ApiError &&
    ['ACTION_FORBIDDEN', 'CASE_ACTION_FORBIDDEN', 'FORBIDDEN'].includes(
      reason.code,
    )
  )
    return '当前账号无权办理此案件。';
  if (reason instanceof ApiError && reason.code === 'VALIDATION_ERROR')
    return '开庭日期或纠错原因未通过校验，请核对后重试。';
  return '开庭安排没有完成，请稍后重试或刷新案件核对。';
}
async function send(
  kind: 'schedule' | 'correct',
  input: SaveCaseHearingInput | CorrectCaseHearingInput,
): Promise<void> {
  const context = captureContext();
  submitting.value = true;
  error.value = '';
  success.value = '';
  try {
    if (kind === 'schedule')
      await scheduleCaseHearing(
        context.id,
        input,
        props.lawyer ? 'lawyer' : 'internal',
      );
    else await correctCaseHearing(context.id, input as CorrectCaseHearingInput);
    if (!isCurrent(context)) return;
    unknownRequest.value = null;
    success.value = '开庭命令已受理，正在读取案件当前状态。';
    notifyWorkflowChanged();
    emit('changed');
  } catch (reason) {
    if (!isCurrent(context)) return;
    error.value = failureMessage(reason);
    if (isUnknownOutcome(reason))
      unknownRequest.value = { kind, input } as
        | { kind: 'schedule'; input: SaveCaseHearingInput }
        | { kind: 'correct'; input: CorrectCaseHearingInput };
    else if (
      reason instanceof ApiError &&
      ['VERSION_CONFLICT', 'INVALID_STATE', 'IDEMPOTENCY_CONFLICT'].includes(
        reason.code,
      )
    ) {
      unknownRequest.value = null;
      emit('refresh');
    }
  } finally {
    if (isCurrent(context)) submitting.value = false;
  }
}
async function schedule(): Promise<void> {
  if (!scheduleReady.value) return;
  await send('schedule', makeInput());
}
async function correct(): Promise<void> {
  if (!correctionReady.value) return;
  await send('correct', {
    ...makeInput(),
    reason: correctionReason.value.trim(),
  });
}
async function retry(): Promise<void> {
  const request = unknownRequest.value;
  if (!request || submitting.value) return;
  await send(request.kind, request.input);
}
const history = computed(() => {
  const corrections = new Map(
    props.item.hearing.corrections.map((item) => [item.newArrangementId, item]),
  );
  const arrangements = props.item.hearing.arrangements.map((item) => {
    const correction = corrections.get(item.id);
    return {
      id: `arrangement-${item.id}`,
      at: item.recordedAt,
      kind: 'arrangement' as const,
      label: item.source === 'CORRECTION' ? '人工更正安排' : '登记开庭安排',
      hearingAt: item.hearingAt,
      reason:
        !props.lawyer && correction && 'reason' in correction
          ? correction.reason
          : undefined,
    };
  });
  const advances = props.item.hearing.advances.map((item) => ({
    id: `advance-${item.id}`,
    at: item.executedAt,
    kind: 'advance' as const,
    label: '系统自动推进至待判决',
    dueAt: item.dueAt,
    executedAt: item.executedAt,
  }));
  return [...arrangements, ...advances].sort(
    (left, right) => Date.parse(left.at) - Date.parse(right.at),
  );
});
function formatTime(value: string): string {
  return new Date(value).toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour12: false,
  });
}
function setClearDate(): void {
  clearDate.value = true;
  error.value = '';
}
function setDateMode(): void {
  clearDate.value = false;
  error.value = '';
}
</script>

<template>
  <section class="demo-card demo-card--pad" data-test="case-hearing-panel">
    <h2 class="form-section-title">开庭安排</h2>
    <p v-if="item.stage === 'WAITING_JUDGMENT'" role="status">
      当前阶段：待判决。此阶段仅表示系统已按开庭日期推进，不代表法院已经判决。
    </p>
    <p>
      系统会在开庭日期次日
      00:00（北京时间）自动推进至待判决。登记已到期日期后，服务器会补跑；待判决不代表法院已经判决。
    </p>

    <form
      v-if="canSchedule"
      data-test="hearing-schedule-form"
      @submit.prevent="schedule"
    >
      <label class="field-label" for="hearing-date">开庭日期</label>
      <input
        id="hearing-date"
        v-model="hearingAt"
        data-test="hearing-date"
        type="date"
        :min="acceptanceDate"
        :disabled="clearDate || submitting || unknownRequest !== null"
        aria-describedby="hearing-date-guidance"
      />
      <p id="hearing-date-guidance" class="field-guidance">
        日期不得早于正式立案日期 {{ acceptanceDate }}。允许补录真实过去日期。
      </p>
      <div class="form-actions">
        <button
          v-if="!clearDate"
          type="button"
          data-test="hearing-clear-date"
          :disabled="submitting"
          @click="setClearDate"
        >
          清除开庭日期
        </button>
        <button
          v-else
          type="button"
          data-test="hearing-set-date"
          :disabled="submitting"
          @click="setDateMode"
        >
          改填开庭日期
        </button>
        <button
          type="submit"
          data-test="hearing-save"
          :disabled="!scheduleReady"
          @click="schedule"
        >
          {{ submitting ? '正在保存…' : '保存开庭安排' }}
        </button>
      </div>
      <p v-if="clearDate" role="status">
        清除后案件保持待开庭，后续可重新登记日期。
      </p>
    </form>

    <section v-if="canCorrect" data-test="hearing-correction-form">
      <h3>更正自动推进</h3>
      <p>
        更正会保留旧安排和系统推进历史。未来日期或清除日期后返回待开庭；已到期的更正仍保持待判决。后续再登记到期日期时，系统会再次推进。
      </p>
      <label class="field-label" for="hearing-correction-date"
        >更正后的开庭日期</label
      >
      <input
        id="hearing-correction-date"
        v-model="hearingAt"
        data-test="hearing-date"
        type="date"
        :min="acceptanceDate"
        :disabled="clearDate || submitting || unknownRequest !== null"
      />
      <button
        v-if="!clearDate"
        type="button"
        data-test="hearing-clear-date"
        :disabled="submitting"
        @click="setClearDate"
      >
        清除开庭日期
      </button>
      <button
        v-else
        type="button"
        data-test="hearing-set-date"
        :disabled="submitting"
        @click="setDateMode"
      >
        改填开庭日期
      </button>
      <label class="field-label" for="hearing-correction-reason"
        >纠错原因</label
      >
      <textarea
        id="hearing-correction-reason"
        v-model="correctionReason"
        data-test="hearing-correction-reason"
        maxlength="500"
        rows="3"
        :disabled="submitting || unknownRequest !== null"
        aria-describedby="hearing-reason-guidance"
      />
      <p id="hearing-reason-guidance" class="field-guidance">
        必填，去除首尾空格后 1～500 个字符。
      </p>
      <p v-if="clearDate" role="status">
        清除后案件返回待开庭，并保留原安排和系统推进记录。
      </p>
      <button
        type="button"
        data-test="hearing-correct"
        :disabled="!correctionReady"
        @click="correct"
      >
        {{ submitting ? '正在更正…' : '提交更正' }}
      </button>
    </section>

    <p v-if="error" class="submit-error" role="alert">{{ error }}</p>
    <p v-if="success" role="status">{{ success }}</p>
    <button
      v-if="unknownRequest"
      type="button"
      data-test="hearing-retry"
      :disabled="submitting"
      @click="retry"
    >
      使用相同请求安全重试
    </button>

    <section aria-label="开庭历史" data-test="hearing-history">
      <h3>开庭历史</h3>
      <p v-if="history.length === 0">暂无开庭安排或系统推进记录。</p>
      <ol v-else>
        <li v-for="entry in history" :key="entry.id">
          <strong>{{ entry.label }}</strong>
          <template v-if="entry.kind === 'arrangement'">
            <p>开庭业务日期：{{ entry.hearingAt ?? '未确定（已清除）' }}</p>
            <p>记录时间：{{ formatTime(entry.at) }}</p>
            <p v-if="entry.reason">更正原因：{{ entry.reason }}</p>
          </template>
          <template v-else>
            <p>应推进时间：{{ formatTime(entry.dueAt) }}</p>
            <p>系统执行时间：{{ formatTime(entry.executedAt) }}</p>
          </template>
        </li>
      </ol>
    </section>
  </section>
</template>
