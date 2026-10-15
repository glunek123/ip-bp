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
  mailCaseExecution,
  todayShanghai,
  type CaseFile,
  type MailCaseExecutionInput,
} from '../../api/cases';
import { mailClientCaseExecution } from '../../api/client-cases';
import { ApiError } from '../../api/http';
import {
  downloadMaterialVersion,
  listOwnerMaterials,
  uploadMaterialFile,
} from '../../api/materials';
import { useAuthStore } from '../../stores/auth';
import { notifyWorkflowChanged } from '../../app/workflow-events';

type VersionFile = Pick<
  CaseFile,
  'materialId' | 'contentVersionId' | 'originalFilename' | 'mimeType'
>;
type MailingRecord = {
  id: string;
  confirmationId?: string | null;
  mailedAt: string;
  recordedAt: string;
  files: VersionFile[];
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
const files = ref<VersionFile[]>([]);
const availableFiles = ref<VersionFile[]>([]);
const uploading = ref(false);
const submitting = ref(false);
const success = ref(false);
const error = ref('');
const uploadError = ref('');
const review = ref(false);
const unknownRequest = ref<MailCaseExecutionInput | null>(null);
const idempotencyKey = ref('');
let revision = 0;
let attachmentRevision = 0;
let active = true;
const downloads = new Set<AbortController>();

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
function abortDownloads() {
  for (const controller of downloads) controller.abort();
  downloads.clear();
}
watch(() => [props.item.id, props.client, props.contextKey], abortDownloads, {
  flush: 'sync',
});
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
    !uploading.value &&
    !submitting.value &&
    unknownRequest.value === null &&
    files.value.length > 0 &&
    files.value.length <= 10 &&
    isBusinessDate(mailedAt.value) &&
    mailedAt.value <= todayShanghai(),
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
  files.value = [];
  availableFiles.value = [];
  uploading.value = false;
  submitting.value = false;
  success.value = false;
  error.value = '';
  uploadError.value = '';
  review.value = false;
  unknownRequest.value = null;
  idempotencyKey.value = '';
}
function setAvailable(next: VersionFile[]) {
  availableFiles.value = next;
  files.value = next.length === 1 ? [next[0]!] : [];
}
async function loadAvailable() {
  if (!active) return;
  const context = captureContext();
  const attachment = attachmentRevision;
  if (
    !props.item.canMailExecution ||
    props.item.stage !== 'WAITING_EXECUTION_STAMP' ||
    props.item.executionMailing != null
  ) {
    if (isCurrent(context)) setAvailable([]);
    return;
  }
  if (props.client) {
    if (isCurrent(context)) {
      setAvailable(
        (props.item.pendingReceiptFiles ?? []).map((file) => ({
          materialId: file.materialId,
          contentVersionId: file.contentVersionId,
          originalFilename: file.originalFilename,
          mimeType: file.mimeType,
        })),
      );
    }
    return;
  }
  try {
    const result = await listOwnerMaterials('CASE', context.caseId);
    if (
      !isCurrent(context) ||
      attachment !== attachmentRevision ||
      files.value.length ||
      uploading.value ||
      review.value ||
      unknownRequest.value
    )
      return;
    const frozenReceiptIds = new Set(
      props.item.complaintMailing?.receiptFiles.map(
        (file) => file.contentVersionId,
      ) ?? [],
    );
    setAvailable(
      result.items
        .filter(
          (material) =>
            material.category === 'MAIL_RECEIPT' &&
            material.status === 'ACTIVE',
        )
        .flatMap((material) =>
          material.contentVersions
            .filter(
              (version) =>
                version.status === 'AVAILABLE' &&
                !frozenReceiptIds.has(version.id),
            )
            .map((version) => ({
              materialId: material.id,
              contentVersionId: version.id,
              originalFilename: version.originalFilename,
              mimeType: version.mimeType,
            })),
        ),
    );
  } catch {
    if (
      isCurrent(context) &&
      attachment === attachmentRevision &&
      files.value.length === 0
    )
      setAvailable([]);
  }
}
watch(
  () => [
    props.item.id,
    props.item.version,
    props.item.stage,
    props.item.canMailExecution,
    props.item.complaintMailing,
    props.item.pendingReceiptFiles,
    props.item.executionMailing,
    props.client,
    props.lawyer,
    props.contextKey,
    identity.value,
  ],
  (next, previous) => {
    const pending =
      previous &&
      next[0] === previous[0] &&
      next[7] === previous[7] &&
      next[8] === previous[8] &&
      next[9] === previous[9] &&
      next[10] === previous[10]
        ? unknownRequest.value
        : null;
    revision += 1;
    attachmentRevision += 1;
    reset();
    unknownRequest.value = pending;
    void loadAvailable();
  },
  { immediate: true },
);
watch(
  () => props.readRevision,
  () => {
    if (active) void loadAvailable();
  },
  { flush: 'sync' },
);
onDeactivated(() => {
  active = false;
  revision += 1;
  attachmentRevision += 1;
  abortDownloads();
  submitting.value = false;
  uploading.value = false;
});
onActivated(() => {
  active = true;
});
onBeforeUnmount(() => {
  active = false;
  revision += 1;
  attachmentRevision += 1;
  abortDownloads();
});
function isFileInputTarget(value: unknown): value is {
  files: ArrayLike<InstanceType<typeof globalThis.File>> | null;
  value: string;
} {
  return (
    typeof value === 'object' &&
    value !== null &&
    'files' in value &&
    'value' in value &&
    typeof value.value === 'string'
  );
}
async function upload(event: { target: unknown }) {
  if (!isFileInputTarget(event.target)) return;
  const context = captureContext();
  const target = event.target;
  const selected = Array.from(target.files ?? []);
  target.value = '';
  attachmentRevision += 1;
  if (!selected.length || files.value.length + selected.length > 10) {
    uploadError.value = '一次最多选择 10 个邮寄凭证。';
    return;
  }
  review.value = false;
  uploading.value = true;
  uploadError.value = '';
  try {
    for (const file of selected) {
      if (!isCurrent(context)) return;
      const result = await uploadMaterialFile({
        ownerType: 'CASE',
        ownerId: context.caseId,
        category: 'MAIL_RECEIPT',
        purpose: 'MAIL_RECEIPT',
        file,
      });
      if (!isCurrent(context)) return;
      const uploaded = {
        materialId: result.materialId,
        contentVersionId: result.contentVersionId,
        originalFilename: result.originalFilename,
        mimeType: result.mimeType,
      };
      files.value = [...files.value, uploaded];
      availableFiles.value = [...availableFiles.value, uploaded];
    }
  } catch {
    if (isCurrent(context))
      uploadError.value = '凭证上传失败，请检查文件后重试。';
  } finally {
    if (isCurrent(context)) uploading.value = false;
  }
}
function toggle(file: VersionFile, checked: boolean) {
  review.value = false;
  attachmentRevision += 1;
  files.value = checked
    ? [...files.value, file]
    : files.value.filter(
        (entry) => entry.contentVersionId !== file.contentVersionId,
      );
}
function removeFile(id: string) {
  review.value = false;
  attachmentRevision += 1;
  files.value = files.value.filter((file) => file.contentVersionId !== id);
}
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
    mailReceiptContentVersionIds: files.value.map(
      (file) => file.contentVersionId,
    ),
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
async function download(file: VersionFile) {
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
  <section class="demo-card demo-card--pad" data-test="execution-mailing-panel">
    <template v-if="item.executionMailing && !unknownRequest">
      <h2 class="form-section-title">执行邮寄登记</h2>
      <p>
        实际邮寄日期：{{ item.executionMailing.mailedAt }}；登记时间：{{
          new Date(item.executionMailing.recordedAt).toLocaleString('zh-CN', {
            timeZone: 'Asia/Shanghai',
            hour12: false,
          })
        }}
      </p>
      <ul>
        <li
          v-for="file in item.executionMailing.files"
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
      v-else-if="unknownRequest || item.stage === 'WAITING_EXECUTION_STAMP'"
    >
      <h2 class="form-section-title">登记执行材料邮寄</h2>
      <p class="field-help">
        确认执行申请材料已邮寄后，选择实际邮寄日期并上传邮寄凭证。本操作只记录邮寄事实。
      </p>
      <template
        v-if="
          unknownRequest ||
          (item.canMailExecution && (confirmationId || directEntry))
        "
      >
        <label
          >实际邮寄日期 <span aria-hidden="true">*</span
          ><input
            v-model="mailedAt"
            type="date"
            class="text-input"
            :max="todayShanghai()"
            :disabled="unknownRequest !== null"
            @input="review = false"
            required
            aria-required="true"
            data-test="execution-mailed-at"
        /></label>
        <label
          >邮寄凭证 <span aria-hidden="true">*</span
          ><input
            type="file"
            class="text-input"
            accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
            multiple
            :disabled="
              uploading || files.length >= 10 || unknownRequest !== null
            "
            @change="upload"
            data-test="execution-mailing-file-input"
        /></label>
        <p class="field-help">
          PDF、JPG 或 PNG，最多 10
          份。可上传新文件，也可选择已有材料的具体版本。
        </p>
        <p v-if="uploading" role="status">正在上传邮寄凭证</p>
        <p v-if="uploadError" role="alert" class="submit-error">
          {{ uploadError }}
        </p>
        <fieldset v-if="availableFiles.length > 1" class="demo-form-grid">
          <legend>
            选择本次登记使用的凭证版本 <span aria-hidden="true">*</span>
          </legend>
          <label v-for="file in availableFiles" :key="file.contentVersionId"
            ><input
              data-test="execution-mailing-choice"
              type="checkbox"
              :checked="
                files.some(
                  (selected) =>
                    selected.contentVersionId === file.contentVersionId,
                )
              "
              :disabled="unknownRequest !== null"
              @change="
                toggle(file, ($event.target as HTMLInputElement).checked)
              "
            />
            {{ file.originalFilename }}（{{ file.mimeType }}）</label
          >
        </fieldset>
        <ul>
          <li v-for="file in files" :key="file.contentVersionId">
            {{ file.originalFilename }}（{{ file.mimeType }}）<ElButton
              text
              @click="download(file)"
              >下载</ElButton
            ><ElButton
              v-if="unknownRequest === null"
              text
              @click="removeFile(file.contentVersionId)"
              >移除</ElButton
            >
          </li>
        </ul>
        <p v-if="error" role="alert" class="submit-error">{{ error }}</p>
        <p
          v-if="review && !unknownRequest"
          data-test="execution-mailing-review-summary"
        >
          将登记 {{ mailedAt }} 邮寄，并关联 {{ files.length }} 份已选凭证。
        </p>
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
          :disabled="!ready"
          data-test="execution-mailing-review"
          @click="review = true"
          >核对邮寄信息</ElButton
        >
        <ElButton
          v-if="review && !unknownRequest"
          type="primary"
          :loading="submitting"
          :disabled="!ready"
          data-test="execution-mailing-submit"
          @click="submit"
          >确认邮寄并登记</ElButton
        >
        <p v-if="success" role="status">邮寄登记已完成，请刷新查看记录。</p>
      </template>
      <p v-else data-test="execution-mailing-read-only" class="field-help">
        当前账号无权登记此案件的邮寄事实。
      </p>
    </template>
  </section>
</template>
