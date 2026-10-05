<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import {
  mailCaseComplaint,
  todayShanghai,
  type CaseFile,
  type MailCaseComplaintInput,
} from '../../api/cases';
import { mailClientCaseComplaint } from '../../api/client-cases';
import { ApiError } from '../../api/http';
import {
  downloadMaterialVersion,
  listOwnerMaterials,
  uploadMaterialFile,
} from '../../api/materials';
import { useAuthStore } from '../../stores/auth';
import { notifyWorkflowChanged } from '../../app/workflow-events';

const props = defineProps<{
  item: {
    id: string;
    stage: string;
    version: number;
    canMailComplaint: boolean;
    complaintMailing?: {
      mailedAt: string;
      recordedAt: string;
      receiptFiles: CaseFile[];
    } | null;
    pendingReceiptFiles?: CaseFile[];
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
const files = ref<CaseFile[]>([]);
const availableFiles = ref<CaseFile[]>([]);
const busyUpload = ref(false);
const submitting = ref(false);
const success = ref(false);
const error = ref('');
const uploadError = ref('');
const review = ref(false);
const unknownRequest = ref<MailCaseComplaintInput | null>(null);
const idempotencyKey = ref('');
let contextRevision = 0;
let attachmentRevision = 0;
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
    !busyUpload.value &&
    !submitting.value &&
    files.value.length > 0 &&
    files.value.length <= 10 &&
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
function setAvailable(next: CaseFile[]) {
  availableFiles.value = next;
  files.value = next.length === 1 ? [next[0]!] : [];
}
async function loadAvailable() {
  const context = captureContext();
  const attachments = attachmentRevision;
  if (props.client) {
    if (isCurrent(context) && attachments === attachmentRevision)
      setAvailable(props.item.pendingReceiptFiles ?? []);
    return;
  }
  try {
    const result = await listOwnerMaterials('CASE', context.caseId);
    if (!isCurrent(context)) return;
    if (
      attachments !== attachmentRevision ||
      files.value.length > 0 ||
      busyUpload.value ||
      submitting.value ||
      review.value ||
      unknownRequest.value !== null
    )
      return;
    const next = result.items
      .filter(
        (material) =>
          material.category === 'MAIL_RECEIPT' && material.status === 'ACTIVE',
      )
      .flatMap((material) =>
        material.contentVersions
          .filter((version) => version.status === 'AVAILABLE')
          .map((version) => ({
            materialId: material.id,
            contentVersionId: version.id,
            originalFilename: version.originalFilename,
            mimeType: version.mimeType,
          })),
      );
    setAvailable(next);
  } catch {
    if (
      isCurrent(context) &&
      attachments === attachmentRevision &&
      files.value.length === 0 &&
      !busyUpload.value &&
      !submitting.value &&
      !review.value &&
      unknownRequest.value === null
    )
      setAvailable([]);
  }
}
watch(
  () => [
    props.item.id,
    props.item.version,
    props.item.stage,
    props.client,
    identity.value,
  ],
  () => {
    contextRevision += 1;
    attachmentRevision += 1;
    files.value = [];
    availableFiles.value = [];
    busyUpload.value = false;
    submitting.value = false;
    success.value = false;
    review.value = false;
    unknownRequest.value = null;
    idempotencyKey.value = '';
    error.value = '';
    uploadError.value = '';
    void loadAvailable();
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  active = false;
  contextRevision += 1;
  attachmentRevision += 1;
  abortDownloads();
});
function isFileInputTarget(value: unknown): value is {
  files: ArrayLike<Parameters<typeof uploadMaterialFile>[0]['file']> | null;
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
  attachmentRevision += 1;
  const target = event.target;
  const selected = Array.from(target.files ?? []);
  target.value = '';
  if (!selected.length || files.value.length + selected.length > 10) {
    uploadError.value = '最多选择 10 份凭证。';
    return;
  }
  busyUpload.value = true;
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
      uploadError.value = '凭证上传失败，请检查文件格式后重试。';
  } finally {
    if (isCurrent(context)) busyUpload.value = false;
  }
}
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
    mailReceiptContentVersionIds: files.value.map(
      (file) => file.contentVersionId,
    ),
  };
  unknownRequest.value = payload;
  idempotencyKey.value = payload.idempotencyKey;
  submitting.value = true;
  error.value = '';
  try {
    if (props.client) await mailClientCaseComplaint(context.caseId, payload);
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
function toggleAvailable(file: CaseFile, checked: boolean) {
  attachmentRevision += 1;
  files.value = checked
    ? [...files.value, file]
    : files.value.filter(
        (item) => item.contentVersionId !== file.contentVersionId,
      );
}
function removeFile(contentVersionId: string) {
  attachmentRevision += 1;
  files.value = files.value.filter(
    (file) => file.contentVersionId !== contentVersionId,
  );
}
</script>

<template>
  <section class="demo-card demo-card--pad" data-test="complaint-mailing-panel">
    <template v-if="item.complaintMailing">
      <h2 class="form-section-title">邮寄登记记录</h2>
      <p>
        实际邮寄日：{{ item.complaintMailing.mailedAt }} · 系统登记时间：{{
          new Date(item.complaintMailing.recordedAt).toLocaleString('zh-CN', {
            timeZone: 'Asia/Shanghai',
            hour12: false,
          })
        }}
      </p>
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
    <template v-else-if="item.stage === 'WAITING_COMPLAINT_STAMP'">
      <h2 class="form-section-title">登记诉状邮寄</h2>
      <p class="field-help">
        登记后案件将进入“待提交立案”；请填写实际邮寄日并上传邮寄凭证。此操作不会提交法院。
      </p>
      <template v-if="item.canMailComplaint">
        <label
          >实际邮寄日期 <span aria-hidden="true">*</span
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
          >邮寄凭证 <span aria-hidden="true">*</span
          ><input
            type="file"
            class="text-input"
            accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
            multiple
            :disabled="
              busyUpload || files.length >= 10 || unknownRequest !== null
            "
            @change="upload"
        /></label>
        <p class="field-help">
          PDF、JPG 或 PNG，单份不超过 20MB；至少 1 份，最多 10 份。
        </p>
        <p v-if="busyUpload" role="status">正在上传凭证…</p>
        <p v-if="uploadError" role="alert" class="submit-error">
          {{ uploadError }}
        </p>
        <fieldset v-if="availableFiles.length > 1" class="demo-form-grid">
          <legend>
            选择用于本次登记的凭证 <span aria-hidden="true">*</span>
          </legend>
          <label v-for="file in availableFiles" :key="file.contentVersionId"
            ><input
              data-test="receipt-choice"
              type="checkbox"
              :checked="
                files.some(
                  (selected) =>
                    selected.contentVersionId === file.contentVersionId,
                )
              "
              :disabled="unknownRequest !== null"
              @change="
                toggleAvailable(
                  file,
                  ($event.target as HTMLInputElement).checked,
                )
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
              v-if="!locked && unknownRequest === null"
              text
              @click="removeFile(file.contentVersionId)"
              >移除</ElButton
            >
          </li>
        </ul>
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
          >确认登记并进入待提交立案</ElButton
        >
        <p v-if="success" role="status">邮寄登记已完成，正在读取服务端记录。</p>
      </template>
      <p v-else data-test="case-read-only" class="field-help">
        你可以查看案件和下载获准材料；当前账号不能办理此案。
      </p>
    </template>
  </section>
</template>
