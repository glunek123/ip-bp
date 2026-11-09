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
  createFilingCourt,
  listFilingCourts,
  submitCaseFiling,
  todayShanghai,
  type CaseWorkflowItem,
  type CaseFile,
  type FilingCourt,
  type SubmitCaseFilingInput,
} from '../../api/cases';
import { ApiError } from '../../api/http';
import {
  getCaseConsolidation,
  type ConsolidationTrace,
} from '../../api/case-consolidation';
import {
  downloadMaterialVersion,
  uploadMaterialFile,
} from '../../api/materials';
import { notifyWorkflowChanged } from '../../app/workflow-events';

const props = defineProps<{
  submitCommand?: (input: SubmitCaseFilingInput) => Promise<void>;
  readRevision?: number;
  item: CaseWorkflowItem;
  contextKey: string;
  lawyer?: boolean;
  prepareOnly?: boolean;
  preparedInput?: SubmitCaseFilingInput;
  preparedEvidenceFiles?: CaseFile[];
  preparedScreenshotFiles?: CaseFile[];
}>();
const emit = defineEmits<{
  changed: [];
  refresh: [];
  prepared: [
    input: SubmitCaseFilingInput,
    details: {
      courtName: string;
      evidenceFiles: CaseFile[];
      screenshotFiles: CaseFile[];
    },
  ];
}>();

const courts = ref<FilingCourt[]>([]);
const courtsLoading = ref(false);
const courtsError = ref('');
const courtName = ref('');
const courtId = ref('');
const submittedAt = ref(todayShanghai());
const claimAmount = ref('');
const originalClaimAmount = computed(() => {
  const confirmation = props.item.complaintConfirmation;
  return (
    (confirmation ? confirmation.amount : props.item.complaint?.amount) ?? ''
  );
});
const mediationNo = ref('');
const evidenceFiles = ref<CaseFile[]>([]);
const screenshotFiles = ref<CaseFile[]>([]);
const consolidationTrace = ref<ConsolidationTrace | null>(null);
const sourceVersionIds = ref<string[]>([]);
const sourceOptions = computed(() => {
  const seen = new Set<string>();
  return (consolidationTrace.value?.cases ?? [])
    .filter((source) => !source.isMain)
    .flatMap((source) =>
      source.materials
        .filter((material) => material.category !== 'FEE_PROOF')
        .flatMap((material) =>
          material.contentVersions
            .filter((version) => {
              if (seen.has(version.id)) return false;
              seen.add(version.id);
              return true;
            })
            .map((version) => ({
              id: version.id,
              name: version.originalFilename,
              caseNo: source.businessNo,
              category: material.category,
            })),
        ),
    );
});
let sourceRequest: AbortController | null = null;
watch(
  () => [props.item.id, props.contextKey],
  async () => {
    sourceRequest?.abort();
    const controller = new AbortController();
    sourceRequest = controller;
    consolidationTrace.value = null;
    sourceVersionIds.value = [];
    try {
      const result = await getCaseConsolidation(props.item.id, {
        signal: controller.signal,
      });
      if (!controller.signal.aborted) consolidationTrace.value = result;
    } catch {
      /* Ordinary filing remains available when source access is denied. */
    }
  },
  { immediate: true },
);
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
const downloads = new Set<AbortController>();

function abortDownloads(): void {
  for (const controller of downloads) controller.abort();
  downloads.clear();
}

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
watch(() => [props.item.id, props.contextKey], abortDownloads, {
  flush: 'sync',
});
function clearContext() {
  courts.value = [];
  courtName.value = '';
  courtId.value = '';
  submittedAt.value = todayShanghai();
  claimAmount.value = originalClaimAmount.value;
  mediationNo.value = '';
  evidenceFiles.value = [];
  screenshotFiles.value = [];
  sourceVersionIds.value = [];
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
  if (props.prepareOnly && props.preparedInput) {
    courtId.value = props.preparedInput.courtId;
    submittedAt.value = props.preparedInput.submittedAt;
    claimAmount.value = props.preparedInput.claimAmount ?? claimAmount.value;
    mediationNo.value = props.preparedInput.mediationNo ?? '';
    sourceVersionIds.value = [
      ...(props.preparedInput.consolidationSourceContentVersionIds ?? []),
    ];
    evidenceFiles.value = [...(props.preparedEvidenceFiles ?? [])];
    screenshotFiles.value = [...(props.preparedScreenshotFiles ?? [])];
  }
}
async function loadCourts() {
  if (!active || !props.item.canSubmitFiling) return;
  const context = captureContext();
  courtsLoading.value = true;
  courtsError.value = '';
  try {
    const result = props.lawyer
      ? await listFilingCourts(context.caseId, 'lawyer')
      : await listFilingCourts(context.caseId);
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
  (next, previous) => {
    const pending =
      previous && next[0] === previous[0] && next[4] === previous[4]
        ? unknownRequest.value
        : null;
    revision += 1;
    clearContext();
    unknownRequest.value = pending;
    void loadCourts();
  },
  { immediate: true },
);
watch(
  () => props.readRevision,
  () => {
    if (active) void loadCourts();
  },
  { flush: 'sync' },
);
onDeactivated(() => {
  active = false;
  revision += 1;
  abortDownloads();
  sourceRequest?.abort();
  submitting.value = false;
  uploading.value = null;
  courtsLoading.value = false;
});
onActivated(() => {
  active = true;
});
onBeforeUnmount(() => {
  active = false;
  revision += 1;
  abortDownloads();
  sourceRequest?.abort();
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
    (claimAmount.value === '' ||
      /^(0|[1-9]\d{0,13})(\.\d{1,2})?$/u.test(claimAmount.value)) &&
    evidenceFiles.value.length <= 50 &&
    sourceVersionIds.value.length <= 50 &&
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
    const created = props.lawyer
      ? await createFilingCourt(
          context.caseId,
          { name: courtName.value },
          'lawyer',
        )
      : await createFilingCourt(context.caseId, { name: courtName.value });
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
    ...(claimAmount.value !== '' &&
    claimAmount.value !== originalClaimAmount.value
      ? { claimAmount: claimAmount.value }
      : {}),
    filingEvidenceContentVersionIds: evidenceFiles.value.map(
      (file) => file.contentVersionId,
    ),
    filingScreenshotContentVersionIds: screenshotFiles.value.map(
      (file) => file.contentVersionId,
    ),
    ...(sourceVersionIds.value.length
      ? { consolidationSourceContentVersionIds: [...sourceVersionIds.value] }
      : {}),
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
    if (props.submitCommand) await props.submitCommand(input);
    else if (props.lawyer)
      await submitCaseFiling(context.caseId, input, 'lawyer');
    else await submitCaseFiling(context.caseId, input);
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
function prepare() {
  if (!props.prepareOnly || !ready.value) return;
  emit('prepared', makeInput(), {
    courtName:
      courts.value.find((court) => court.id === courtId.value)?.name ?? '',
    evidenceFiles: [...evidenceFiles.value],
    screenshotFiles: [...screenshotFiles.value],
  });
  review.value = false;
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
  <section class="demo-card demo-card--pad" data-test="case-filing-panel">
    <h2 class="form-section-title">提交立案</h2>
    <template
      v-if="
        unknownRequest ||
        (item.canSubmitFiling && item.stage === 'WAITING_FILING')
      "
    >
      <p v-if="courtsLoading" role="status">正在读取本部门法院…</p>
      <p v-if="courtsError" role="alert" class="submit-error">
        {{ courtsError }}
        <ElButton text @click="loadCourts">重新读取法院</ElButton>
      </p>
      <div class="filing-fields">
        <label v-if="courts.length > 0" class="filing-fields__court">
          立案法院 <span aria-hidden="true">*</span>
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
        <details
          v-if="!locked && unknownRequest === null"
          class="filing-fields__court-extra"
        >
          <summary>补录法院</summary>
          <div class="demo-form-grid">
            <label>
              法院名称
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
        </details>
        <label class="filing-fields__date">
          提交立案日期 <span aria-hidden="true">*</span>
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
        <label class="filing-fields__amount"
          >标的额（元）
          <input
            v-model="claimAmount"
            class="text-input"
            inputmode="decimal"
            data-test="filing-claim-amount"
            placeholder="留空沿用原标的额"
            :disabled="locked || unknownRequest !== null"
            @input="editing"
          />
        </label>
        <label class="filing-fields__mediation">
          诉调号／立案编号
          <input
            v-model="mediationNo"
            class="text-input"
            maxlength="100"
            :disabled="locked || unknownRequest !== null"
            data-test="filing-mediation-no"
            @input="editing"
          />
        </label>
        <div class="filing-fields__evidence">
          <label>
            证据材料
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
          <fieldset v-if="sourceOptions.length" class="filing-source-options">
            <legend>已合案来源材料（引用原版本，不复制文件）</legend>
            <label v-for="source in sourceOptions" :key="source.id">
              <input
                v-model="sourceVersionIds"
                type="checkbox"
                :value="source.id"
                :disabled="locked || unknownRequest !== null"
                @change="editing"
              />
              {{ source.caseNo }} · {{ source.name }}（{{ source.category }}）
            </label>
          </fieldset>
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
        </div>
        <div class="filing-fields__screenshot">
          <label>
            立案截图
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
          <p v-if="uploading === 'screenshot'" role="status">
            正在上传立案截图…
          </p>
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
        </div>
      </div>
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
        <p>提交立案日期：{{ submittedAt }}</p>
        <p>标的额：{{ claimAmount || originalClaimAmount || '未确认' }}</p>
        <p>诉调号：{{ mediationNo.trim() || '未填写' }}</p>
        <p>
          起诉及证据材料：{{ evidenceFiles.length }} 份；合案来源引用：{{
            sourceVersionIds.length
          }}
          份；立案截图：{{ screenshotFiles.length }}
          份
        </p>
        <ElButton
          v-if="prepareOnly"
          type="primary"
          :disabled="!ready"
          data-test="filing-prepare"
          @click="prepare"
          >保存本案资料</ElButton
        >
        <ElButton
          v-else
          type="primary"
          :loading="submitting"
          :disabled="submitting || !ready"
          data-test="filing-submit"
          @click="submit"
          >提交</ElButton
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

<style scoped>
.filing-fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1rem 1.25rem;
}
.filing-fields > * {
  min-width: 0;
}
.filing-fields__court {
  order: 1;
}
.filing-fields__date {
  order: 2;
}
.filing-fields__amount {
  order: 3;
}
.filing-fields__screenshot {
  order: 4;
}
.filing-fields__mediation {
  order: 5;
}
.filing-fields__evidence {
  order: 6;
}
.filing-fields__court-extra {
  order: 7;
  grid-column: 1 / -1;
}
@media (max-width: 680px) {
  .filing-fields {
    grid-template-columns: 1fr;
  }
  .filing-fields__court-extra {
    grid-column: 1;
  }
}
</style>
