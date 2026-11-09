<script setup lang="ts">
import {
  computed,
  onActivated,
  onBeforeUnmount,
  onDeactivated,
  ref,
  watch,
} from 'vue';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import {
  mailCaseComplaint,
  todayShanghai,
  type CaseFile,
  type MailCaseComplaintInput,
} from '../../api/cases';
import { mailClientCaseComplaint } from '../../api/client-cases';
import { ApiError } from '../../api/http';
import { downloadMaterialVersion } from '../../api/materials';
import { useAuthStore } from '../../stores/auth';
import { notifyWorkflowChanged } from '../../app/workflow-events';

const props = defineProps<{
  submitCommand?: (input: MailCaseComplaintInput) => Promise<void>;
  batchDefaults?: { mailedAt: string; remark: string };
  item: {
    id: string;
    stage: string;
    version: number;
    canMailComplaint: boolean;
    complaintMailing?: {
      mailedAt: string;
      remark: string | null;
      recordedAt: string;
      receiptFiles: CaseFile[];
    } | null;
  };
  client?: boolean;
  lawyer?: boolean;
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
const review = ref(false);
const unknownRequest = ref<MailCaseComplaintInput | null>(null);
const idempotencyKey = ref('');
let contextRevision = 0;
let active = true;
const downloads = new Set<AbortController>();

function abortDownloads(): void {
  for (const controller of downloads) controller.abort();
  downloads.clear();
}

type ContextSnapshot = {
  caseId: string;
  identity: string;
  revision: number;
};
function captureContext(): ContextSnapshot {
  return {
    caseId: props.item.id,
    identity: identity.value,
    revision: contextRevision,
  };
}
function isCurrent(context: ContextSnapshot): boolean {
  return (
    active &&
    context.revision === contextRevision &&
    context.caseId === props.item.id &&
    context.identity === identity.value
  );
}
watch(() => [props.item.id, props.client, identity.value], abortDownloads, {
  flush: 'sync',
});
const locked = computed(
  () =>
    props.item.stage !== 'WAITING_COMPLAINT_STAMP' ||
    !props.item.canMailComplaint ||
    props.item.complaintMailing !== null ||
    success.value,
);
const ready = computed(
  () =>
    !locked.value &&
    !submitting.value &&
    remark.value.length <= 1000 &&
    businessDate(mailedAt.value) &&
    mailedAt.value <= todayShanghai(),
);
function businessDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}
watch(
  () => [
    props.item.id,
    props.item.version,
    props.item.stage,
    props.client,
    identity.value,
  ],
  (next, previous) => {
    const pending =
      previous &&
      next[0] === previous[0] &&
      next[3] === previous[3] &&
      next[4] === previous[4]
        ? unknownRequest.value
        : null;
    contextRevision += 1;
    mailedAt.value = props.batchDefaults?.mailedAt ?? todayShanghai();
    remark.value = props.batchDefaults?.remark ?? '';
    submitting.value = false;
    success.value = false;
    review.value = false;
    unknownRequest.value = null;
    unknownRequest.value = pending;
    idempotencyKey.value = '';
    error.value = '';
  },
  { immediate: true },
);
onDeactivated(() => {
  active = false;
  contextRevision += 1;
  abortDownloads();
  submitting.value = false;
});
onActivated(() => {
  active = true;
});
onBeforeUnmount(() => {
  active = false;
  contextRevision += 1;
  abortDownloads();
});
async function submit() {
  if (submitting.value) return;
  const existingRequest = unknownRequest.value;
  if (existingRequest === null && !ready.value) return;
  const context = captureContext();
  const payload = existingRequest ?? {
    expectedVersion: props.item.version,
    idempotencyKey:
      idempotencyKey.value ||
      globalThis.crypto?.randomUUID?.() ||
      `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    mailedAt: mailedAt.value,
    remark: remark.value.trim(),
    mailReceiptContentVersionIds: [],
  };
  unknownRequest.value = payload;
  idempotencyKey.value = payload.idempotencyKey;
  submitting.value = true;
  error.value = '';
  try {
    if (props.submitCommand) await props.submitCommand(payload);
    else if (props.client)
      await mailClientCaseComplaint(context.caseId, payload);
    else if (props.lawyer)
      await mailCaseComplaint(context.caseId, payload, 'lawyer');
    else await mailCaseComplaint(context.caseId, payload);
    if (!isCurrent(context)) return;
    success.value = true;
    unknownRequest.value = null;
    notifyWorkflowChanged();
    emit('changed');
  } catch (reason) {
    if (!isCurrent(context)) return;
    if (
      reason instanceof ApiError &&
      ['VERSION_CONFLICT', 'INVALID_STATE'].includes(reason.code)
    ) {
      error.value = '案件状态已变化，正在读取最新记录。';
      unknownRequest.value = null;
      emit('refresh');
    } else if (
      reason instanceof ApiError &&
      reason.code === 'IDEMPOTENCY_CONFLICT'
    ) {
      error.value = '请求键已用于不同内容，请刷新后核实。';
      unknownRequest.value = null;
    } else if (
      reason instanceof ApiError &&
      ['NETWORK_ERROR', 'TIMEOUT'].includes(reason.code)
    )
      error.value = '提交结果暂时未知；已保留原请求，可安全重试或刷新核实。';
    else error.value = '邮寄登记未能完成，请检查信息后重试。';
  } finally {
    if (isCurrent(context)) submitting.value = false;
  }
}
async function download(file: CaseFile) {
  const context = captureContext();
  const controller = new AbortController();
  downloads.add(controller);
  try {
    await downloadMaterialVersion(
      file.materialId,
      file.contentVersionId,
      controller.signal,
    );
  } catch {
    if (!controller.signal.aborted && isCurrent(context))
      error.value = '文件下载失败，请稍后重试。';
  } finally {
    downloads.delete(controller);
  }
}
</script>

<template>
  <section class="demo-card demo-card--pad" data-test="complaint-mailing-panel">
    <template v-if="item.complaintMailing && !unknownRequest">
      <h2 class="form-section-title">邮寄登记记录</h2>
      <p>
        邮寄日期：{{ item.complaintMailing.mailedAt }} · 系统登记时间：{{
          new Date(item.complaintMailing.recordedAt).toLocaleString('zh-CN', {
            timeZone: 'Asia/Shanghai',
            hour12: false,
          })
        }}
      </p>
      <p>邮寄备注：{{ item.complaintMailing.remark || '未填写' }}</p>
      <ul>
        <li
          v-for="file in item.complaintMailing.receiptFiles"
          :key="file.contentVersionId"
        >
          {{ file.originalFilename }}（{{ file.mimeType }}）<ElButton
            text
            @click="download(file)"
            >下载</ElButton
          >
        </li>
      </ul>
    </template>
    <template
      v-else-if="unknownRequest || item.stage === 'WAITING_COMPLAINT_STAMP'"
    >
      <h2 class="form-section-title">登记诉状邮寄</h2>
      <template v-if="unknownRequest || item.canMailComplaint">
        <label
          >邮寄日期 <span aria-hidden="true">*</span
          ><input
            v-model="mailedAt"
            type="date"
            class="text-input"
            :max="todayShanghai()"
            :disabled="unknownRequest !== null"
            required
            aria-required="true"
        /></label>
        <label
          >邮寄备注
          <textarea
            v-model="remark"
            class="text-input"
            maxlength="1000"
            :disabled="unknownRequest !== null"
            data-test="complaint-mail-remark"
          />
        </label>
        <p v-if="error" role="alert" class="submit-error">{{ error }}</p>
        <ElButton type="primary" :disabled="!ready" @click="review = true"
          >核对邮寄信息</ElButton
        >
        <ElButton
          v-if="unknownRequest"
          type="primary"
          :loading="submitting"
          :disabled="submitting"
          data-test="mailing-submit"
          @click="submit"
          >使用原请求重试</ElButton
        >
        <ElButton
          v-else-if="review"
          type="primary"
          :loading="submitting"
          :disabled="submitting"
          data-test="mailing-submit"
          @click="submit"
          >提交</ElButton
        >
        <p v-if="success" role="status">邮寄登记已完成，正在读取服务端记录。</p>
      </template>
      <p v-else data-test="case-read-only" class="field-help">
        你可以查看案件和下载获准材料；当前账号不能办理此案。
      </p>
    </template>
  </section>
</template>
