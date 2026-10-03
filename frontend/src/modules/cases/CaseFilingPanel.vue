<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import {
  createFilingCourt,
  listFilingCourts,
  submitCaseFiling,
  todayShanghai,
  type CaseDetail,
  type CaseFile,
  type FilingCourt,
  type SubmitCaseFilingInput,
} from '../../api/cases';
import { ApiError } from '../../api/http';
import {
  downloadMaterialVersion,
  uploadMaterialFile,
} from '../../api/materials';
import { notifyWorkflowChanged } from '../../app/workflow-events';

const props = defineProps<{
  item: CaseDetail;
  contextKey: string;
}>();
const emit = defineEmits<{ changed: []; refresh: [] }>();

const courts = ref<FilingCourt[]>([]);
const courtsLoading = ref(false);
const courtsError = ref('');
const courtName = ref('');
const courtId = ref('');
const submittedAt = ref(todayShanghai());
const mediationNo = ref('');
const evidenceFiles = ref<CaseFile[]>([]);
const screenshotFiles = ref<CaseFile[]>([]);
const uploading = ref<'evidence' | 'screenshot' | null>(null);
const uploadError = ref('');
const error = ref('');
const success = ref(false);
const review = ref(false);
const submitting = ref(false);
const unknownRequest = ref<SubmitCaseFilingInput | null>(null);
let requestFingerprint = '';
let requestKey = '';
let revision = 0;
let active = true;

type Context = { caseId: string; contextKey: string; revision: number };
function captureContext(): Context {
  return {
    caseId: props.item.id,
    contextKey: props.contextKey,
    revision,
  };
}
function isCurrent(context: Context): boolean {
  return (
    active &&
    context.revision === revision &&
    context.caseId === props.item.id &&
    context.contextKey === props.contextKey
  );
}
function clearContext() {
  courts.value = [];
  courtName.value = '';
  courtId.value = '';
  submittedAt.value = todayShanghai();
  mediationNo.value = '';
  evidenceFiles.value = [];
  screenshotFiles.value = [];
  uploading.value = null;
  uploadError.value = '';
  courtsError.value = '';
  error.value = '';
  success.value = false;
  review.value = false;
  submitting.value = false;
  unknownRequest.value = null;
  requestFingerprint = '';
  requestKey = '';
}
async function loadCourts() {
  if (!props.item.canSubmitFiling) return;
  const context = captureContext();
  courtsLoading.value = true;
  courtsError.value = '';
  try {
    const result = await listFilingCourts(context.caseId);
    if (!isCurrent(context)) return;
    courts.value = result;
    if (result.length === 1) courtId.value = result[0]!.id;
    else if (!result.some((court) => court.id === courtId.value))
      courtId.value = '';
  } catch {
    if (isCurrent(context))
      courtsError.value = '法院列表暂时无法读取，请重试。';
  } finally {
    if (isCurrent(context)) courtsLoading.value = false;
  }
}
watch(
  () => [
    props.item.id,
    props.item.version,
    props.item.stage,
    props.item.canSubmitFiling,
    props.contextKey,
  ],
  () => {
    revision += 1;
    clearContext();
    void loadCourts();
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  active = false;
  revision += 1;
});

const locked = computed(
  () =>
    props.item.stage !== 'WAITING_FILING' ||
    !props.item.canSubmitFiling ||
    success.value,
);
const ready = computed(
  () =>
    !locked.value &&
    !courtsLoading.value &&
    courtsError.value === '' &&
    courts.value.length > 0 &&
    courtId.value !== '' &&
    isBusinessDate(submittedAt.value) &&
    submittedAt.value <= todayShanghai() &&
    evidenceFiles.value.length > 0 &&
    evidenceFiles.value.length <= 50 &&
    screenshotFiles.value.length <= 10 &&
    mediationNo.value.trim().length <= 100 &&
    uploading.value === null &&
    unknownRequest.value === null &&
    !submitting.value,
);
function isBusinessDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}
function editing() {
  review.value = false;
  error.value = '';
}
function key(): string {
  return typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
type FilingCategory = 'FILING_EVIDENCE' | 'FILING_SCREENSHOT';
function supported(
  file: InstanceType<typeof globalThis.File>,
  category: FilingCategory,
): boolean {
  const extension = file.name.toLowerCase().match(/\.[^.]+$/u)?.[0];
  const types =
    category === 'FILING_EVIDENCE'
      ? new Map([
          ['.pdf', 'application/pdf'],
          ['.doc', 'application/msword'],
          [
            '.docx',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          ],
          ['.jpg', 'image/jpeg'],
          ['.jpeg', 'image/jpeg'],
          ['.png', 'image/png'],
        ])
      : new Map([
          ['.pdf', 'application/pdf'],
          ['.jpg', 'image/jpeg'],
          ['.jpeg', 'image/jpeg'],
          ['.png', 'image/png'],
        ]);
  return extension !== undefined && types.get(extension) === file.type;
}
async function uploadFiles(
  event: InstanceType<typeof globalThis.Event>,
  category: FilingCategory,
) {
  const input = event.target;
  if (!(input instanceof globalThis.HTMLInputElement)) return;
  const selected = Array.from(input.files ?? []);
  input.value = '';
  if (!selected.length || locked.value || unknownRequest.value !== null) return;
  const isEvidence = category === 'FILING_EVIDENCE';
  const files = isEvidence ? evidenceFiles : screenshotFiles;
  const maxCount = isEvidence ? 50 : 10;
  const maxSize = isEvidence ? 50 * 1024 * 1024 : 20 * 1024 * 1024;
  const label = isEvidence ? '起诉及证据材料' : '立案截图';
  if (files.value.length + selected.length > maxCount) {
    uploadError.value = `${label}最多上传 ${maxCount} 份。`;
    return;
  }
  if (
    selected.some((file) => file.size > maxSize || !supported(file, category))
  ) {
    uploadError.value = `${label}格式不支持或超过单份大小限制。`;
    return;
  }
  const context = captureContext();
  uploading.value = isEvidence ? 'evidence' : 'screenshot';
  uploadError.value = '';
  editing();
  try {
    for (const file of selected) {
      if (!isCurrent(context)) return;
      const result = await uploadMaterialFile({
        ownerType: 'CASE',
        ownerId: context.caseId,
        category,
        purpose: category,
        file,
      });
      if (!isCurrent(context)) return;
      files.value = [
        ...files.value,
        {
          materialId: result.materialId,
          contentVersionId: result.contentVersionId,
          originalFilename: result.originalFilename,
          mimeType: result.mimeType,
        },
      ];
    }
  } catch (reason) {
    if (isCurrent(context))
      uploadError.value =
        reason instanceof ApiError && reason.code === 'VALIDATION_ERROR'
          ? `${label}格式不支持或超过单份大小限制。`
          : `${label}上传失败，请检查连接后重试。`;
  } finally {
    if (isCurrent(context)) uploading.value = null;
  }
}
async function addCourt() {
  if (!props.item.canSubmitFiling || !courtName.value.trim()) return;
  const context = captureContext();
  courtsLoading.value = true;
  courtsError.value = '';
  editing();
  try {
    const created = await createFilingCourt(context.caseId, {
      name: courtName.value,
    });
    if (!isCurrent(context)) return;
    courts.value = [...courts.value, created];
    courtId.value = created.id;
    courtName.value = '';
  } catch (reason) {
    if (!isCurrent(context)) return;
    courtsError.value =
      reason instanceof ApiError && reason.status === 409
        ? '该部门已登记同名法院，请从已有法院中选择。'
        : '法院登记未完成，请检查名称后重试。';
  } finally {
    if (isCurrent(context)) courtsLoading.value = false;
  }
}
function makeInput(): SubmitCaseFilingInput {
  const input = {
    expectedVersion: props.item.version,
    idempotencyKey: requestKey || (requestKey = key()),
    courtId: courtId.value,
    submittedAt: submittedAt.value,
    filingEvidenceContentVersionIds: evidenceFiles.value.map(
      (file) => file.contentVersionId,
    ),
    filingScreenshotContentVersionIds: screenshotFiles.value.map(
      (file) => file.contentVersionId,
    ),
    ...(mediationNo.value.trim()
      ? { mediationNo: mediationNo.value.trim() }
      : {}),
  };
  const fingerprint = JSON.stringify({ ...input, idempotencyKey: undefined });
  if (fingerprint !== requestFingerprint) {
    requestFingerprint = fingerprint;
    requestKey = key();
    input.idempotencyKey = requestKey;
  }
  return input;
}
function errorMessage(reason: unknown): string {
  if (
    reason instanceof ApiError &&
    ['VERSION_CONFLICT', 'INVALID_STATE'].includes(reason.code)
  )
    return '案件阶段或版本已变化，正在读取最新信息。';
  if (reason instanceof ApiError && reason.code === 'IDEMPOTENCY_CONFLICT')
    return '请求键与提交内容不匹配，请刷新案件核对当前记录。';
  if (reason instanceof ApiError && reason.status === 403)
    return '当前账号无权办理此案件。';
  return '立案提交未能完成，请检查信息后重试。';
}
function isUnknownResult(reason: unknown): boolean {
  if (!(reason instanceof ApiError)) return true;
  return (
    reason.status >= 500 ||
    ['NETWORK_ERROR', 'TIMEOUT', 'INVALID_RESPONSE'].includes(reason.code)
  );
}
async function submit() {
  if (submitting.value) return;
  const existing = unknownRequest.value;
  if (existing === null && !ready.value) return;
  const context = captureContext();
  const input = existing ?? makeInput();
  unknownRequest.value = input;
  submitting.value = true;
  error.value = '';
  try {
    await submitCaseFiling(context.caseId, input);
    if (!isCurrent(context)) return;
    success.value = true;
    unknownRequest.value = null;
    notifyWorkflowChanged();
    emit('changed');
  } catch (reason) {
    if (!isCurrent(context)) return;
    if (isUnknownResult(reason)) {
      error.value =
        '提交结果暂时未知；已保留原请求，可核对或使用同一请求键重试。';
    } else {
      error.value = errorMessage(reason);
      unknownRequest.value = null;
      if (
        reason instanceof ApiError &&
        ['VERSION_CONFLICT', 'INVALID_STATE'].includes(reason.code)
      ) {
        emit('refresh');
      }
      if (
        reason instanceof ApiError &&
        reason.code === 'IDEMPOTENCY_CONFLICT'
      ) {
        requestFingerprint = '';
        requestKey = '';
      }
    }
  } finally {
    if (isCurrent(context)) submitting.value = false;
  }
}
async function download(file: CaseFile) {
  const context = captureContext();
  try {
    await downloadMaterialVersion(file.materialId, file.contentVersionId);
  } catch {
    if (isCurrent(context)) error.value = '文件下载失败，请稍后重试。';
  }
}
</script>

<template>
  <section class="demo-card demo-card--pad" data-test="case-filing-panel">
    <h2 class="form-section-title">提交法院立案</h2>
    <template v-if="item.canSubmitFiling && item.stage === 'WAITING_FILING'">
      <p class="field-help">
        请确认真实法院、实际提交日期和本次材料。确认后案件将进入“待正式立案”，系统会保存法院、日期、诉调号及所选文件版本；已确认金额保持不变。
      </p>
      <p v-if="courtsLoading" role="status">正在读取本部门法院…</p>
      <p v-if="courtsError" role="alert" class="submit-error">
        {{ courtsError }}
        <ElButton text @click="loadCourts">重新读取法院</ElButton>
      </p>
      <label v-if="courts.length > 0">
        法院 <span aria-hidden="true">*</span>
        <select
          v-model="courtId"
          class="text-input"
          required
          :aria-required="true"
          :disabled="locked || unknownRequest !== null"
          :data-test="
            courts.length === 1 ? 'filing-court-fixed' : 'filing-court-select'
          "
          @change="editing"
        >
          <option v-if="courts.length > 1" value="">请选择法院</option>
          <option v-for="court in courts" :key="court.id" :value="court.id">
            {{ court.name }}
          </option>
        </select>
      </label>
      <p v-else-if="!courtsLoading" class="field-help">
        本部门还没有可选法院，请在下方录入真实法院名称。
      </p>
      <div v-if="!locked && unknownRequest === null" class="demo-form-grid">
        <label>
          登记本部门真实法院
          <input
            v-model="courtName"
            class="text-input"
            maxlength="200"
            autocomplete="organization"
            data-test="filing-court-name"
            @input="editing"
          />
        </label>
        <ElButton
          text
          :disabled="courtsLoading || courtName.trim().length === 0"
          data-test="filing-court-create"
          @click="addCourt"
          >登记法院</ElButton
        >
      </div>
      <label>
        实际提交日期 <span aria-hidden="true">*</span>
        <input
          v-model="submittedAt"
          type="date"
          class="text-input"
          :max="todayShanghai()"
          required
          :aria-required="true"
          :disabled="locked || unknownRequest !== null"
          data-test="filing-submitted-at"
          @input="editing"
        />
      </label>
      <label>
        诉调号（选填）
        <input
          v-model="mediationNo"
          class="text-input"
          maxlength="100"
          :disabled="locked || unknownRequest !== null"
          data-test="filing-mediation-no"
          @input="editing"
        />
      </label>
      <label>
        起诉及证据材料 <span aria-hidden="true">*</span>
        <input
          type="file"
          class="text-input"
          accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/jpeg,image/png"
          multiple
          :disabled="
            locked ||
            unknownRequest !== null ||
            uploading !== null ||
            evidenceFiles.length >= 50
          "
          data-test="filing-evidence-input"
          @change="uploadFiles($event, 'FILING_EVIDENCE')"
        />
      </label>
      <p class="field-help">
        PDF、DOC、DOCX、JPG 或 PNG，单份不超过 50MB；至少 1 份，最多 50 份。
      </p>
      <p v-if="uploading === 'evidence'" role="status">
        正在上传起诉及证据材料…
      </p>
      <ul>
        <li v-for="file in evidenceFiles" :key="file.contentVersionId">
          {{ file.originalFilename }}（{{ file.mimeType }}）
          <ElButton text @click="download(file)">下载</ElButton>
          <ElButton
            v-if="unknownRequest === null"
            text
            @click="
              evidenceFiles = evidenceFiles.filter(
                (entry) => entry.contentVersionId !== file.contentVersionId,
              );
              editing();
            "
            >移除</ElButton
          >
        </li>
      </ul>
      <label>
        立案截图（选填）
        <input
          type="file"
          class="text-input"
          accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
          multiple
          :disabled="
            locked ||
            unknownRequest !== null ||
            uploading !== null ||
            screenshotFiles.length >= 10
          "
          data-test="filing-screenshot-input"
          @change="uploadFiles($event, 'FILING_SCREENSHOT')"
        />
      </label>
      <p class="field-help">PDF、JPG 或 PNG，单份不超过 20MB；最多 10 份。</p>
      <p v-if="uploading === 'screenshot'" role="status">正在上传立案截图…</p>
      <ul>
        <li v-for="file in screenshotFiles" :key="file.contentVersionId">
          {{ file.originalFilename }}（{{ file.mimeType }}）
          <ElButton text @click="download(file)">下载</ElButton>
          <ElButton
            v-if="unknownRequest === null"
            text
            @click="
              screenshotFiles = screenshotFiles.filter(
                (entry) => entry.contentVersionId !== file.contentVersionId,
              );
              editing();
            "
            >移除</ElButton
          >
        </li>
      </ul>
      <p v-if="uploadError" role="alert" class="submit-error">
        {{ uploadError }}
      </p>
      <ElButton text :disabled="courtsLoading" @click="loadCourts"
        >刷新法院列表</ElButton
      >
      <ElButton
        v-if="unknownRequest === null"
        type="primary"
        :disabled="!ready"
        data-test="filing-review"
        @click="review = true"
        >核对立案信息</ElButton
      >
      <section
        v-if="review && unknownRequest === null"
        class="demo-card demo-card--pad"
        data-test="filing-review-summary"
      >
        <h3>提交内容核对</h3>
        <p>法院：{{ courts.find((court) => court.id === courtId)?.name }}</p>
        <p>实际提交日期：{{ submittedAt }}</p>
        <p>诉调号：{{ mediationNo.trim() || '未填写' }}</p>
        <p>
          起诉及证据材料：{{ evidenceFiles.length }} 份；立案截图：{{
            screenshotFiles.length
          }}
          份
        </p>
        <p>
          提交后案件进入“待正式立案”；所选材料版本和法院名称将固定保存，已确认金额不会改变。
        </p>
        <ElButton
          type="primary"
          :loading="submitting"
          :disabled="submitting || !ready"
          data-test="filing-submit"
          @click="submit"
          >确认提交并进入待正式立案</ElButton
        >
      </section>
      <template v-if="unknownRequest !== null">
        <p role="alert" class="submit-error">{{ error }}</p>
        <ElButton text :loading="courtsLoading" @click="emit('refresh')"
          >核对提交结果</ElButton
        >
        <ElButton
          type="primary"
          :loading="submitting"
          :disabled="submitting"
          data-test="filing-retry"
          @click="submit"
          >使用原请求键重试</ElButton
        >
      </template>
      <p v-else-if="error" role="alert" class="submit-error">{{ error }}</p>
      <p v-if="success" role="status">立案提交成功，正在同步服务端记录。</p>
    </template>
    <p v-else class="field-help" data-test="filing-read-only">
      你可以查看案件详情；当前账号不能办理法院立案。
    </p>
  </section>
</template>
