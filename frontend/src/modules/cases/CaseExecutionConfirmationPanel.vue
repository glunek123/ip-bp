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
  confirmCaseExecution,
  type CaseDetail,
  type LawyerCaseDetail,
  type ConfirmExecutionInput,
  type ExecutionSubmissionFile,
} from '../../api/cases';
import { ApiError } from '../../api/http';
import { downloadMaterialVersion } from '../../api/materials';
import { notifyWorkflowChanged } from '../../app/workflow-events';

const props = defineProps<{
  item: CaseDetail | LawyerCaseDetail;
  lawyer?: boolean;
  contextKey: string;
  actorKey: string;
}>();
const emit = defineEmits<{ changed: []; refresh: [] }>();
const submitting = ref(false);
const postSucceeded = ref(false);
const accessDenied = ref(false);
const conflict = ref(false);
const error = ref('');
const downloadError = ref('');
const unknownCommand = ref<ConfirmExecutionInput | null>(null);
const downloads = new Set<AbortController>();
let mounted = true;
let revision = 0;
let fingerprint = '';

const confirmed = computed(() =>
  accessDenied.value ? null : props.item.executionConfirmation,
);
const submission = computed(() =>
  accessDenied.value ? null : props.item.executionSubmission.current,
);
const files = computed<ExecutionSubmissionFile[]>(
  () => confirmed.value?.files ?? submission.value?.files ?? [],
);
const canConfirm = computed(
  () =>
    !accessDenied.value &&
    !submitting.value &&
    !postSucceeded.value &&
    !unknownCommand.value &&
    !conflict.value &&
    props.item.stage === 'WAITING_EXECUTION_CONFIRMATION' &&
    props.item.canConfirmExecution &&
    submission.value !== null,
);
const operationKey = () =>
  `${props.actorKey}:${props.item.id}:${props.contextKey}`;
const operationContext = () => ({ key: operationKey(), revision });
const isCurrent = (context: ReturnType<typeof operationContext>) =>
  mounted && context.key === operationKey() && context.revision === revision;

function resetContext(): void {
  revision += 1;
  error.value = '';
  downloadError.value = '';
  accessDenied.value = false;
  conflict.value = false;
  submitting.value = false;
  if (fingerprint !== operationKey()) {
    fingerprint = operationKey();
    unknownCommand.value = null;
    postSucceeded.value = false;
  }
}

function clearSensitive(): void {
  accessDenied.value = true;
  revision += 1;
  error.value = '';
  downloadError.value = '';
  unknownCommand.value = null;
  for (const controller of downloads) controller.abort();
  downloads.clear();
}

function makeKey(): string {
  return typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function confirm(command?: ConfirmExecutionInput): Promise<void> {
  if (
    submitting.value ||
    postSucceeded.value ||
    accessDenied.value ||
    conflict.value ||
    (command !== undefined && command !== unknownCommand.value)
  )
    return;
  if (!command && !canConfirm.value) return;
  const currentSubmission = submission.value;
  if (!command && !currentSubmission) return;
  const input = command ?? {
    expectedVersion: props.item.version,
    idempotencyKey: makeKey(),
    expectedSubmissionId: currentSubmission!.id,
  };
  const context = operationContext();
  unknownCommand.value = input;
  submitting.value = true;
  error.value = '';
  try {
    await confirmCaseExecution(
      props.item.id,
      input,
      props.lawyer ? 'lawyer' : 'internal',
    );
    if (!isCurrent(context)) return;
    unknownCommand.value = null;
    postSucceeded.value = true;
    notifyWorkflowChanged();
    emit('changed');
    emit('refresh');
  } catch (reason) {
    if (!isCurrent(context)) return;
    if (reason instanceof ApiError && reason.status === 403) {
      clearSensitive();
      return;
    }
    if (reason instanceof ApiError && reason.status === 409) {
      unknownCommand.value = null;
      conflict.value = true;
      error.value = '案件版本或提交材料已变化，请刷新案件后核对最新材料。';
      return;
    }
    if (
      reason instanceof ApiError &&
      reason.status >= 400 &&
      reason.status < 500
    ) {
      unknownCommand.value = null;
      error.value = reason.message || '确认未完成，请检查案件状态后重试。';
      return;
    }
    unknownCommand.value = input;
    error.value =
      '确认结果暂时未知。请使用原请求重试，系统会按原提交编号去重。';
  } finally {
    if (isCurrent(context)) submitting.value = false;
  }
}

async function download(file: ExecutionSubmissionFile): Promise<void> {
  if (accessDenied.value) return;
  const context = operationContext();
  const controller = new AbortController();
  downloads.add(controller);
  downloadError.value = '';
  try {
    await downloadMaterialVersion(
      file.materialId,
      file.contentVersionId,
      controller.signal,
    );
  } catch (reason) {
    if (!isCurrent(context) || controller.signal.aborted) return;
    if (reason instanceof ApiError && reason.status === 403) clearSensitive();
    else downloadError.value = '执行材料下载失败，请稍后重试。';
  } finally {
    downloads.delete(controller);
  }
}

function timestamp(value: string): string {
  return new Date(value).toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour12: false,
  });
}

watch(operationKey, resetContext, { flush: 'sync', immediate: true });
watch(
  () => [
    props.item.version,
    props.item.stage,
    props.item.executionSubmission.current?.id ?? null,
  ],
  () => {
    error.value = '';
    downloadError.value = '';
    if (conflict.value) conflict.value = false;
  },
  { flush: 'sync' },
);
onDeactivated(() => {
  mounted = false;
  revision += 1;
  submitting.value = false;
  for (const controller of downloads) controller.abort();
  downloads.clear();
});
onActivated(() => {
  mounted = true;
});
onBeforeUnmount(() => {
  mounted = false;
  revision += 1;
  for (const controller of downloads) controller.abort();
  downloads.clear();
});
</script>

<template>
  <section
    v-if="submission || confirmed || props.item.canConfirmExecution"
    class="demo-card demo-card--pad"
    data-test="execution-confirmation-panel"
  >
    <h2 class="form-section-title">执行材料确认</h2>
    <p v-if="!accessDenied && confirmed" role="status">
      已确认本次提交的整套执行材料。确认时间：
      <time
        data-test="execution-confirmed-at"
        :datetime="confirmed.confirmedAt"
        >{{ timestamp(confirmed.confirmedAt) }}</time
      >
    </p>
    <p v-else-if="!accessDenied && submission">
      请核对当前提交的整套执行材料。确认后材料版本将固定，案件进入待盖章阶段。
    </p>
    <p v-if="!accessDenied && files.length === 0" class="field-help">
      当前没有可展示的执行材料。
    </p>
    <ul v-if="!accessDenied">
      <li
        v-for="file in files"
        :key="file.contentVersionId"
        :data-test="`execution-confirmation-file-${file.contentVersionId}`"
      >
        {{ file.originalFilename }} · {{ file.mimeType }}
        <span v-if="file.uploadedAt"
          >· 上传于 {{ timestamp(file.uploadedAt) }}</span
        >
        <button type="button" @click="download(file)">下载</button>
      </li>
    </ul>
    <p v-if="downloadError" role="alert">{{ downloadError }}</p>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="postSucceeded && !confirmed" role="status">
      确认已提交，正在刷新案件状态。
    </p>
    <button
      v-if="canConfirm"
      type="button"
      data-test="confirm-execution"
      :disabled="submitting"
      @click="confirm()"
    >
      {{ submitting ? '正在确认…' : '确认执行材料' }}
    </button>
    <button
      v-if="unknownCommand && !accessDenied"
      type="button"
      data-test="retry-confirm-execution"
      :disabled="submitting"
      @click="confirm(unknownCommand)"
    >
      使用原请求重试
    </button>
    <button
      v-if="unknownCommand && !accessDenied"
      type="button"
      data-test="refresh-unknown-execution-confirmation"
      @click="emit('refresh')"
    >
      刷新核对状态
    </button>
    <button
      v-if="conflict && !accessDenied"
      type="button"
      data-test="refresh-execution-conflict"
      @click="emit('refresh')"
    >
      刷新案件
    </button>
  </section>
</template>
