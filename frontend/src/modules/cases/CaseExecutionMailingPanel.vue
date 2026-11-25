<script setup lang="ts">
import { computed, onActivated, onDeactivated, ref, watch } from 'vue';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import {
  mailCaseExecution,
  todayShanghai,
  type CaseFile,
  type MailCaseExecutionInput,
} from '../../api/cases';
import { mailClientCaseExecution } from '../../api/client-cases';
import { ApiError } from '../../api/http';
import { useAuthStore } from '../../stores/auth';
import { notifyWorkflowChanged } from '../../app/workflow-events';

type MailingRecord = {
  id: string;
  confirmationId?: string | null;
  mailedAt: string;
  recordedAt: string;
  remark?: string | null;
  files?: CaseFile[];
};
const props = defineProps<{
  submitCommand?: (input: MailCaseExecutionInput) => Promise<void>;
  readRevision?: number;
  item: {
    id: string;
    stage: string;
    version: number;
    canMailExecution: boolean;
    origin?:
      { kind: 'NOTARY' } | { kind: 'EXTERNAL_ENTRY'; initialStage: string };
    complaintMailing?: { receiptFiles: CaseFile[] } | null;
    executionConfirmation?: {
      id: string;
      submissionId?: string | null;
      confirmedAt: string;
    } | null;
    executionConfirmationId?: string | null;
    executionMailing?: MailingRecord | null;
    pendingReceiptFiles?: CaseFile[];
  };
  client?: boolean;
  lawyer?: boolean;
  contextKey?: string;
}>();
const emit = defineEmits<{ changed: []; refresh: [] }>();
const auth = useAuthStore();
const identity = computed(() =>
  auth.session === null
    ? ''
    : `${auth.session.principalType}:${auth.session.user.id}:${auth.session.authorizationRevision}`,
);
const mailedAt = ref(todayShanghai());
const remark = ref('');
const submitting = ref(false);
const success = ref(false);
const error = ref('');
const unknownRequest = ref<MailCaseExecutionInput | null>(null);
const idempotencyKey = ref('');
let revision = 0;
let active = true;

type Context = {
  caseId: string;
  identity: string;
  contextKey: string;
  revision: number;
};
function captureContext(): Context {
  return {
    caseId: props.item.id,
    identity: identity.value,
    contextKey: props.contextKey ?? '',
    revision,
  };
}
function isCurrent(context: Context): boolean {
  return (
    active &&
    context.revision === revision &&
    context.caseId === props.item.id &&
    context.identity === identity.value &&
    context.contextKey === (props.contextKey ?? '')
  );
}
const confirmationId = computed(() =>
  props.client
    ? (props.item.executionConfirmationId ?? null)
    : (props.item.executionConfirmation?.id ?? null),
);
const directEntry = computed(
  () =>
    !props.client &&
    props.item.origin?.kind === 'EXTERNAL_ENTRY' &&
    props.item.origin.initialStage === 'WAITING_EXECUTION_STAMP' &&
    props.item.executionConfirmation == null,
);
const locked = computed(
  () =>
    props.item.stage !== 'WAITING_EXECUTION_STAMP' ||
    !props.item.canMailExecution ||
    props.item.executionMailing != null ||
    success.value,
);
const ready = computed(
  () =>
    !locked.value &&
    (confirmationId.value !== null || directEntry.value) &&
    !submitting.value &&
    unknownRequest.value === null &&
    isBusinessDate(mailedAt.value) &&
    mailedAt.value <= todayShanghai() &&
    remark.value.length <= 1000,
);
function isBusinessDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}
function reset() {
  mailedAt.value = todayShanghai();
  remark.value = '';
  submitting.value = false;
  success.value = false;
  error.value = '';
  unknownRequest.value = null;
  idempotencyKey.value = '';
}
watch(
  () => [
    props.item.id,
    props.item.version,
    props.item.stage,
    props.item.canMailExecution,
    props.item.executionMailing,
    props.client,
    props.lawyer,
    props.contextKey,
    identity.value,
  ],
  () => {
    revision += 1;
    reset();
  },
  { immediate: true },
);
onDeactivated(() => {
  active = false;
  revision += 1;
  submitting.value = false;
});
onActivated(() => {
  active = true;
});
async function submit() {
  if (submitting.value) return;
  const retry = unknownRequest.value;
  if (!retry && !ready.value) return;
  const context = captureContext();
  const input: MailCaseExecutionInput = retry ?? {
    expectedVersion: props.item.version,
    idempotencyKey:
      idempotencyKey.value ||
      globalThis.crypto?.randomUUID?.() ||
      `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    expectedConfirmationId: confirmationId.value,
    mailedAt: mailedAt.value,
    remark: remark.value.trim() ? remark.value.trim() : null,
  };
  unknownRequest.value = input;
  idempotencyKey.value = input.idempotencyKey;
  submitting.value = true;
  error.value = '';
  try {
    if (props.submitCommand) await props.submitCommand(input);
    else if (props.client) await mailClientCaseExecution(context.caseId, input);
    else
      await mailCaseExecution(
        context.caseId,
        input,
        props.lawyer ? 'lawyer' : undefined,
      );
    if (!isCurrent(context)) return;
    success.value = true;
    unknownRequest.value = null;
    notifyWorkflowChanged();
    emit('changed');
  } catch (reason) {
    console.warn(
      'PROBE_MAILING',
      reason instanceof ApiError ? `${reason.code}/${reason.status}: ${reason.message}` : String(reason),
    );
    if (!isCurrent(context)) return;
    if (
      reason instanceof ApiError &&
      ['VERSION_CONFLICT', 'INVALID_STATE'].includes(reason.code)
    ) {
      error.value = '案件状态已变化，请刷新后核对记录。';
      unknownRequest.value = null;
      emit('refresh');
    } else if (
      reason instanceof ApiError &&
      reason.code === 'IDEMPOTENCY_CONFLICT'
    ) {
      error.value = '原请求键对应了其他内容，请刷新后核对。';
      unknownRequest.value = null;
    } else if (
      !(reason instanceof ApiError) ||
      ['NETWORK_ERROR', 'TIMEOUT'].includes(reason.code) ||
      reason.status >= 500 ||
      reason.code === 'INVALID_RESPONSE'
    ) {
      error.value = '提交结果暂时未知。请使用原请求重试，或刷新后核实记录。';
    } else {
      error.value = '邮寄登记未完成，请检查信息后重试。';
      unknownRequest.value = null;
    }
  } finally {
    if (isCurrent(context)) submitting.value = false;
  }
}
</script>

<template>
  <section class="demo-card demo-card--pad" data-test="execution-mailing-panel">
    <template v-if="item.executionMailing && !unknownRequest">
      <h2 class="form-section-title">执行邮寄登记</h2>
      <p>
        邮寄日期：{{ item.executionMailing.mailedAt }}；登记时间：{{
          new Date(item.executionMailing.recordedAt).toLocaleString('zh-CN', {
            timeZone: 'Asia/Shanghai',
            hour12: false,
          })
        }}
      </p>
      <p v-if="item.executionMailing.remark" class="field-help">
        备注：{{ item.executionMailing.remark }}
      </p>
    </template>
    <template
      v-else-if="unknownRequest || item.stage === 'WAITING_EXECUTION_STAMP'"
    >
      <h2 class="form-section-title">登记执行材料邮寄</h2>
      <p class="field-help">
        确认执行申请材料已邮寄后，选择邮寄日期；备注选填。本操作只记录邮寄事实。
      </p>
      <template
        v-if="
          unknownRequest ||
          (item.canMailExecution && (confirmationId || directEntry))
        "
      >
        <label class="mailing-field">
          <span>邮寄日期 <span aria-hidden="true">*</span></span>
          <input
            v-model="mailedAt"
            type="date"
            class="text-input"
            :max="todayShanghai()"
            :disabled="unknownRequest !== null"
            required
            aria-required="true"
            data-test="execution-mailed-at"
        /></label>
        <label class="mailing-field">
          <span>备注</span>
          <textarea
            v-model="remark"
            class="text-input"
            rows="3"
            maxlength="1000"
            placeholder="选填，例如快递公司或投递说明"
            :disabled="unknownRequest !== null"
            data-test="execution-mailing-remark"
          ></textarea>
        </label>
        <p class="field-help">最多 1000 字，可不填。</p>
        <p v-if="error" role="alert" class="submit-error">{{ error }}</p>
        <ElButton
          v-if="unknownRequest"
          type="primary"
          :loading="submitting"
          :disabled="submitting"
          data-test="execution-mailing-retry"
          @click="submit"
          >使用原请求重试</ElButton
        >
        <ElButton
          v-else
          type="primary"
          :loading="submitting"
          :disabled="!ready"
          data-test="execution-mailing-submit"
          @click="submit"
          >提交</ElButton
        >
        <p v-if="success" role="status">邮寄登记已完成，请刷新查看记录。</p>
      </template>
      <p v-else data-test="execution-mailing-read-only" class="field-help">
        当前账号无权登记此案件的邮寄事实。
      </p>
    </template>
  </section>
</template>

<style scoped>
.mailing-field {
  display: grid;
  gap: 6px;
}
</style>
