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
  submitCaseExecutionFiling,
  todayShanghai,
  type CaseFile,
  type SubmitCaseExecutionFilingInput,
} from '../../api/cases';
import { ApiError } from '../../api/http';
import {
  downloadMaterialVersion,
  listOwnerMaterials,
  uploadMaterialFile,
} from '../../api/materials';
import { notifyWorkflowChanged } from '../../app/workflow-events';

type VersionFile = Pick<
  CaseFile,
  'materialId' | 'contentVersionId' | 'originalFilename' | 'mimeType'
>;
type MailingRecord = {
  id: string;
  mailedAt: string;
  recordedAt: string;
  files: VersionFile[];
};
type FilingRecord = {
  id: string;
  mailingId: string;
  submittedAt: string;
  recordedAt: string;
  files: VersionFile[];
};
const props = defineProps<{
  readRevision?: number;
  item: {
    id: string;
    stage: string;
    version: number;
    canSubmitExecutionFiling: boolean;
    executionMailing?: MailingRecord | null;
    executionFiling?: FilingRecord | null;
  };
  lawyer?: boolean;
  contextKey: string;
}>();
const emit = defineEmits<{ changed: []; refresh: [] }>();
const submittedAt = ref(todayShanghai());
const files = ref<VersionFile[]>([]);
const availableFiles = ref<VersionFile[]>([]);
const uploading = ref(false);
const submitting = ref(false);
const success = ref(false);
const error = ref('');
const uploadError = ref('');
const review = ref(false);
const unknownRequest = ref<SubmitCaseExecutionFilingInput | null>(null);
let revision = 0;
let attachmentRevision = 0;
let active = true;
const downloads = new Set<AbortController>();
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
function abortDownloads() {
  for (const controller of downloads) controller.abort();
  downloads.clear();
}
watch(() => [props.item.id, props.contextKey], abortDownloads, {
  flush: 'sync',
});
const locked = computed(
  () =>
    props.item.stage !== 'WAITING_EXECUTION_FILING' ||
    !props.item.canSubmitExecutionFiling ||
    props.item.executionFiling != null ||
    success.value,
);
const ready = computed(
  () =>
    !locked.value &&
    props.item.executionMailing != null &&
    !uploading.value &&
    !submitting.value &&
    unknownRequest.value === null &&
    files.value.length > 0 &&
    files.value.length <= 10 &&
    isBusinessDate(submittedAt.value) &&
    submittedAt.value <= todayShanghai(),
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
  submittedAt.value = todayShanghai();
  files.value = [];
  availableFiles.value = [];
  uploading.value = false;
  submitting.value = false;
  success.value = false;
  error.value = '';
  uploadError.value = '';
  review.value = false;
  unknownRequest.value = null;
}
function setAvailable(next: VersionFile[]) {
  availableFiles.value = next;
  files.value = next.length === 1 ? [next[0]!] : [];
}
async function loadAvailable() {
  if (!props.item.canSubmitExecutionFiling) return;
  const context = captureContext();
  const attachment = attachmentRevision;
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
    setAvailable(
      result.items
        .filter(
          (material) =>
            material.category === 'EXECUTION_FILING_PROOF' &&
            material.status === 'ACTIVE',
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
    props.item.canSubmitExecutionFiling,
    props.item.executionMailing?.id,
    props.contextKey,
    props.lawyer,
  ],
  (next, previous) => {
    const pending =
      previous &&
      next[0] === previous[0] &&
      next[5] === previous[5] &&
      next[6] === previous[6]
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
    uploadError.value = '一次最多选择 10 个执行备案凭证。';
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
        category: 'EXECUTION_FILING_PROOF',
        purpose: 'EXECUTION_FILING_PROOF',
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
  const input: SubmitCaseExecutionFilingInput = retry ?? {
    expectedVersion: props.item.version,
    idempotencyKey:
      globalThis.crypto?.randomUUID?.() ||
      `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    expectedMailingId: props.item.executionMailing!.id,
    submittedAt: submittedAt.value,
    executionFilingProofContentVersionIds: files.value.map(
      (file) => file.contentVersionId,
    ),
  };
  unknownRequest.value = input;
  submitting.value = true;
  error.value = '';
  try {
    await submitCaseExecutionFiling(
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
      error.value = '执行备案登记未完成，请检查信息后重试。';
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
  <section class="demo-card demo-card--pad" data-test="execution-filing-panel">
    <template v-if="item.executionFiling && !unknownRequest">
      <h2 class="form-section-title">执行备案登记</h2>
      <p>
        实际提交日期：{{ item.executionFiling.submittedAt }}；登记时间：{{
          new Date(item.executionFiling.recordedAt).toLocaleString('zh-CN', {
            timeZone: 'Asia/Shanghai',
            hour12: false,
          })
        }}
      </p>
      <ul>
        <li
          v-for="file in item.executionFiling.files"
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
      v-else-if="unknownRequest || item.stage === 'WAITING_EXECUTION_FILING'"
    >
      <h2 class="form-section-title">登记执行备案</h2>
      <p class="field-help">
        执行申请邮寄登记完成后，记录实际向法院提交执行材料的日期并上传备案凭证。
      </p>
      <template
        v-if="
          unknownRequest ||
          (item.canSubmitExecutionFiling && item.executionMailing)
        "
      >
        <label
          >实际提交日期 <span aria-hidden="true">*</span
          ><input
            v-model="submittedAt"
            type="date"
            class="text-input"
            :max="todayShanghai()"
            :disabled="unknownRequest !== null"
            @input="review = false"
            required
            aria-required="true"
            data-test="execution-filing-submitted-at"
        /></label>
        <label
          >执行备案凭证 <span aria-hidden="true">*</span
          ><input
            type="file"
            class="text-input"
            accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
            multiple
            :disabled="
              uploading || files.length >= 10 || unknownRequest !== null
            "
            @change="upload"
            data-test="execution-filing-file-input"
        /></label>
        <p class="field-help">
          PDF、JPG 或 PNG，单个文件不超过 50 MB，最多 10
          份。可上传新文件，也可选择已有材料的具体版本。
        </p>
        <p v-if="uploading" role="status">正在上传备案凭证</p>
        <p v-if="uploadError" role="alert" class="submit-error">
          {{ uploadError }}
        </p>
        <fieldset v-if="availableFiles.length > 1" class="demo-form-grid">
          <legend>
            选择本次登记使用的凭证版本 <span aria-hidden="true">*</span>
          </legend>
          <label v-for="file in availableFiles" :key="file.contentVersionId"
            ><input
              data-test="execution-filing-choice"
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
          data-test="execution-filing-review-summary"
        >
          将登记 {{ submittedAt }} 向法院提交，并关联
          {{ files.length }} 份已选凭证。
        </p>
        <ElButton
          v-if="unknownRequest"
          type="primary"
          :loading="submitting"
          :disabled="submitting"
          data-test="execution-filing-retry"
          @click="submit"
          >使用原请求重试</ElButton
        >
        <ElButton
          v-else
          type="primary"
          :disabled="!ready"
          data-test="execution-filing-review"
          @click="review = true"
          >核对备案信息</ElButton
        >
        <ElButton
          v-if="review && !unknownRequest"
          type="primary"
          :loading="submitting"
          :disabled="!ready"
          data-test="execution-filing-submit"
          @click="submit"
          >确认提交并登记</ElButton
        >
        <p v-if="success" role="status">执行备案登记已完成，请刷新查看记录。</p>
      </template>
      <p v-else data-test="execution-filing-read-only" class="field-help">
        当前账号无权登记此案件的执行备案事实。
      </p>
    </template>
  </section>
</template>
