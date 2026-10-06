<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import {
  registerCaseAcceptance,
  todayShanghai,
  type AcceptanceMaterials,
  type CaseFile,
  type CaseWorkflowItem,
  type RegisterCaseAcceptanceInput,
} from '../../api/cases';
import { ApiError } from '../../api/http';
import {
  downloadMaterialVersion,
  uploadMaterialFile,
} from '../../api/materials';
import { notifyWorkflowChanged } from '../../app/workflow-events';

type Category = keyof AcceptanceMaterials;
type PanelItem = CaseWorkflowItem & {
  filingSubmission: { submittedAt: string } | null;
};
const categories: ReadonlyArray<{ value: Category; label: string }> = [
  { value: 'ACCEPTANCE_NOTICE', label: '受理通知书' },
  { value: 'PAYMENT_LIST', label: '缴费清单' },
  { value: 'SERVICE_DOCUMENT', label: '送达文书' },
];
const buckets = ['frozen', 'later'] as const;
const props = defineProps<{
  item: PanelItem;
  contextKey: string;
  lawyer?: boolean;
}>();
const emit = defineEmits<{ changed: []; refresh: [] }>();

const acceptedAt = ref(todayShanghai());
const courtCaseNo = ref('');
const selected = ref(new Set<string>());
const uploaded = ref<Record<Category, CaseFile[]>>({
  ACCEPTANCE_NOTICE: [],
  PAYMENT_LIST: [],
  SERVICE_DOCUMENT: [],
});
const uploading = ref<Category | null>(null);
const uploadError = ref<Record<Category, string>>({
  ACCEPTANCE_NOTICE: '',
  PAYMENT_LIST: '',
  SERVICE_DOCUMENT: '',
});
const error = ref('');
const success = ref('');
const submitting = ref(false);
const unknownRequest = ref<RegisterCaseAcceptanceInput | null>(null);
let requestFingerprint = '';
let requestKey = '';
let revision = 0;
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
function abortDownloads(): void {
  for (const controller of downloads) controller.abort();
  downloads.clear();
}
function clearContext(): void {
  acceptedAt.value = todayShanghai();
  courtCaseNo.value = '';
  selected.value = new Set();
  uploaded.value = {
    ACCEPTANCE_NOTICE: [],
    PAYMENT_LIST: [],
    SERVICE_DOCUMENT: [],
  };
  uploadError.value = {
    ACCEPTANCE_NOTICE: '',
    PAYMENT_LIST: '',
    SERVICE_DOCUMENT: '',
  };
  uploading.value = null;
  error.value = '';
  success.value = '';
  submitting.value = false;
  unknownRequest.value = null;
  requestFingerprint = '';
  requestKey = '';
}
watch(
  [() => props.item.id, () => props.contextKey],
  () => {
    revision += 1;
    abortDownloads();
    clearContext();
  },
  { immediate: true, flush: 'sync' },
);
watch(
  [() => props.item.acceptance, () => props.item.stage] as const,
  ([acceptance]) => {
    const request = unknownRequest.value;
    if (
      request &&
      acceptance &&
      acceptance.acceptedAt === request.acceptedAt &&
      acceptance.courtCaseNo === request.courtCaseNo.trim()
    ) {
      unknownRequest.value = null;
      success.value = '正式立案登记已完成，案件当前阶段为待开庭。';
      requestFingerprint = '';
      requestKey = '';
      emit('changed');
    }
  },
  { flush: 'sync' },
);
onBeforeUnmount(() => {
  active = false;
  revision += 1;
  abortDownloads();
});

const canRegister = computed(
  () =>
    props.item.stage === 'WAITING_FORMAL_ACCEPTANCE' &&
    props.item.canRegisterAcceptance &&
    props.item.acceptance === null,
);
const canUpload = computed(
  () =>
    props.item.canUploadAcceptanceMaterials &&
    (props.item.stage === 'WAITING_FORMAL_ACCEPTANCE' ||
      props.item.stage === 'WAITING_HEARING'),
);
function files(category: Category, bucket: 'available' | 'frozen' | 'later') {
  const serverFiles = props.item.acceptanceMaterials[category][bucket];
  if (bucket !== 'available') return serverFiles;
  const known = new Set(
    [
      ...props.item.acceptanceMaterials[category].available,
      ...props.item.acceptanceMaterials[category].frozen,
      ...props.item.acceptanceMaterials[category].later,
    ].map((file) => file.contentVersionId),
  );
  return [
    ...serverFiles,
    ...uploaded.value[category].filter(
      (file) => !known.has(file.contentVersionId),
    ),
  ];
}
function activeMaterialCount(category: Category): number {
  return new Set(
    [
      ...props.item.acceptanceMaterials[category].available,
      ...props.item.acceptanceMaterials[category].frozen,
      ...props.item.acceptanceMaterials[category].later,
      ...uploaded.value[category],
    ].map((file) => file.materialId),
  ).size;
}
function validBusinessDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}
const ready = computed(
  () =>
    canRegister.value &&
    validBusinessDate(acceptedAt.value) &&
    acceptedAt.value <= todayShanghai() &&
    props.item.filingSubmission !== null &&
    acceptedAt.value >= props.item.filingSubmission.submittedAt &&
    courtCaseNo.value.trim().length >= 1 &&
    courtCaseNo.value.trim().length <= 100 &&
    uploading.value === null &&
    unknownRequest.value === null &&
    !submitting.value,
);
function makeKey(): string {
  return typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
function selectedIds(category: Category): string[] {
  return files(category, 'available')
    .filter((file) => selected.value.has(file.contentVersionId))
    .map((file) => file.contentVersionId);
}
function makeInput(): RegisterCaseAcceptanceInput {
  const input: RegisterCaseAcceptanceInput = {
    expectedVersion: props.item.version,
    idempotencyKey: requestKey || (requestKey = makeKey()),
    acceptedAt: acceptedAt.value,
    courtCaseNo: courtCaseNo.value.trim(),
    acceptanceNoticeContentVersionIds: selectedIds('ACCEPTANCE_NOTICE'),
    paymentListContentVersionIds: selectedIds('PAYMENT_LIST'),
    serviceDocumentContentVersionIds: selectedIds('SERVICE_DOCUMENT'),
  };
  const fingerprint = JSON.stringify({ ...input, idempotencyKey: undefined });
  if (fingerprint !== requestFingerprint) {
    requestFingerprint = fingerprint;
    requestKey = makeKey();
    input.idempotencyKey = requestKey;
  }
  return input;
}
function failureMessage(reason: unknown): string {
  if (
    reason instanceof ApiError &&
    ['NETWORK_ERROR', 'TIMEOUT', 'INTERNAL_ERROR', 'INVALID_RESPONSE'].includes(
      reason.code,
    )
  )
    return '登记结果暂时未知；请刷新核对，或使用相同请求安全重试。';
  if (
    reason instanceof ApiError &&
    ['VERSION_CONFLICT', 'INVALID_STATE'].includes(reason.code)
  )
    return '案件阶段或版本已变化，请刷新案件后核对登记结果。';
  if (reason instanceof ApiError && reason.code === 'IDEMPOTENCY_CONFLICT')
    return '请求键已用于不同的正式立案信息，请刷新案件后重新填写。';
  if (
    reason instanceof ApiError &&
    ['ACTION_FORBIDDEN', 'CASE_ACTION_FORBIDDEN', 'FORBIDDEN'].includes(
      reason.code,
    )
  )
    return '当前账号无权登记此案件。';
  if (reason instanceof ApiError && reason.code === 'VALIDATION_ERROR')
    return '正式立案信息未通过校验，请核对日期、案号和材料。';
  return '正式立案登记失败，请稍后重试或刷新核对。';
}
async function register(input: RegisterCaseAcceptanceInput): Promise<void> {
  const context = captureContext();
  submitting.value = true;
  error.value = '';
  try {
    await registerCaseAcceptance(
      context.caseId,
      input,
      props.lawyer ? 'lawyer' : 'internal',
    );
    if (!isCurrent(context)) return;
    unknownRequest.value = null;
    success.value = '正式立案登记已完成，案件当前阶段为待开庭。';
    requestFingerprint = '';
    requestKey = '';
    notifyWorkflowChanged();
    emit('changed');
    emit('refresh');
  } catch (reason) {
    if (!isCurrent(context)) return;
    error.value = failureMessage(reason);
    if (error.value.startsWith('登记结果暂时未知'))
      unknownRequest.value = input;
    else if (
      reason instanceof ApiError &&
      ['VERSION_CONFLICT', 'INVALID_STATE', 'IDEMPOTENCY_CONFLICT'].includes(
        reason.code,
      )
    ) {
      unknownRequest.value = null;
      requestFingerprint = '';
      requestKey = '';
      emit('refresh');
    }
  } finally {
    if (isCurrent(context)) submitting.value = false;
  }
}
async function submit(): Promise<void> {
  if (!ready.value) return;
  await register(makeInput());
}
async function retry(): Promise<void> {
  if (!unknownRequest.value || submitting.value) return;
  await register(unknownRequest.value);
}
function supported(file: File): boolean {
  const extension = file.name.toLowerCase().match(/\.[^.]+$/u)?.[0];
  const types = new Map([
    ['.pdf', 'application/pdf'],
    ['.jpg', 'image/jpeg'],
    ['.jpeg', 'image/jpeg'],
    ['.png', 'image/png'],
  ]);
  return extension !== undefined && types.get(extension) === file.type;
}
async function uploadFiles(event: Event, category: Category): Promise<void> {
  const input = event.target;
  if (!(input instanceof globalThis.HTMLInputElement)) return;
  const chosen = Array.from(input.files ?? []);
  input.value = '';
  uploadError.value[category] = '';
  if (!chosen.length || !canUpload.value || unknownRequest.value) return;
  if (activeMaterialCount(category) + chosen.length > 10) {
    uploadError.value[category] =
      '该类材料已达到每案10份上限；系统不能删除、替换或扩容。';
    return;
  }
  if (chosen.some((file) => file.size > 50 * 1024 * 1024 || !supported(file))) {
    uploadError.value[category] = '仅支持单份不超过50MiB的PDF、JPEG或PNG文件。';
    return;
  }
  const context = captureContext();
  uploading.value = category;
  try {
    for (const file of chosen) {
      if (!isCurrent(context)) return;
      const result = await uploadMaterialFile({
        ownerType: 'CASE',
        ownerId: context.caseId,
        category,
        purpose: category,
        file,
      });
      if (!isCurrent(context)) return;
      uploaded.value[category] = [
        ...uploaded.value[category],
        {
          materialId: result.materialId,
          contentVersionId: result.contentVersionId,
          originalFilename: result.originalFilename,
          mimeType: result.mimeType,
        },
      ];
    }
    emit('refresh');
  } catch (reason) {
    if (isCurrent(context))
      uploadError.value[category] =
        reason instanceof ApiError && reason.code === 'VALIDATION_ERROR'
          ? '仅支持单份不超过50MiB的PDF、JPEG或PNG文件。'
          : '材料上传失败，请检查连接后重试。';
  } finally {
    if (isCurrent(context)) uploading.value = null;
  }
}
async function download(file: CaseFile): Promise<void> {
  const context = captureContext();
  const controller = new AbortController();
  downloads.add(controller);
  error.value = '';
  try {
    await downloadMaterialVersion(
      file.materialId,
      file.contentVersionId,
      controller.signal,
    );
  } catch {
    if (isCurrent(context) && !controller.signal.aborted)
      error.value = '材料下载失败，请稍后重试。';
  } finally {
    downloads.delete(controller);
  }
}
</script>

<template>
  <section class="demo-card demo-card--pad" data-test="case-acceptance-panel">
    <h2 class="form-section-title">正式立案登记</h2>
    <p>
      登记实际受理日期和法院案号后，案件进入“待开庭”。三类材料均可后补；每类最多10份有效材料，每份不超过50MiB，仅支持PDF、JPEG或PNG。
    </p>
    <p>本登记不会发起缴费，也不会安排开庭。</p>

    <form v-if="canRegister" class="form-stack" @submit.prevent="submit">
      <label>
        <span>受理日期 <span class="required-mark">*</span></span>
        <input
          v-model="acceptedAt"
          data-test="acceptance-accepted-at"
          type="date"
          required
          :min="item.filingSubmission?.submittedAt"
          :max="todayShanghai()"
          :disabled="unknownRequest !== null || submitting"
          @input="
            error = '';
            success = '';
          "
        />
      </label>
      <label>
        <span>法院案号 <span class="required-mark">*</span></span>
        <input
          v-model="courtCaseNo"
          data-test="acceptance-court-case-no"
          maxlength="100"
          required
          :disabled="unknownRequest !== null || submitting"
          @input="
            error = '';
            success = '';
          "
        />
      </label>
      <ElButton
        type="primary"
        native-type="submit"
        data-test="acceptance-register"
        :disabled="!ready"
        :loading="submitting"
        @click="submit"
        >登记正式立案</ElButton
      >
    </form>

    <p v-else-if="item.acceptance" data-test="case-acceptance-record">
      实际受理日期：{{ item.acceptance.acceptedAt }} · 法院案号：{{
        item.acceptance.courtCaseNo
      }}
      · 系统登记时间：{{ item.acceptance.recordedAt }}
    </p>
    <p
      v-else-if="item.stage === 'WAITING_FORMAL_ACCEPTANCE'"
      class="field-help"
    >
      当前账号仅可查看此案件及其获准材料。
    </p>

    <p v-if="success" role="status">{{ success }}</p>
    <p v-if="error" class="submit-error" role="alert">{{ error }}</p>
    <ElButton
      v-if="unknownRequest"
      type="primary"
      data-test="acceptance-retry"
      :loading="submitting"
      :disabled="submitting"
      @click="retry"
      >使用相同请求重试</ElButton
    >

    <div class="form-stack">
      <section v-for="category in categories" :key="category.value">
        <h3>{{ category.label }}</h3>
        <p v-if="canRegister" class="field-help">
          可选材料（登记时未选择的材料仍可查看）
        </p>
        <ul
          v-if="files(category.value, 'available').length"
          class="notary-offices-list"
        >
          <li
            v-for="file in files(category.value, 'available')"
            :key="file.contentVersionId"
          >
            <label v-if="canRegister" class="checkbox-row">
              <input
                type="checkbox"
                :checked="selected.has(file.contentVersionId)"
                :disabled="unknownRequest !== null || submitting"
                @change="
                  selected.has(file.contentVersionId)
                    ? selected.delete(file.contentVersionId)
                    : selected.add(file.contentVersionId)
                "
              />
              {{ file.originalFilename }}
            </label>
            <template v-else>{{ file.originalFilename }}</template>
            <ElButton text @click="download(file)">下载</ElButton>
          </li>
        </ul>
        <p v-else class="field-help">当前没有可选材料。</p>
        <template v-for="bucket in buckets" :key="bucket">
          <h4 v-if="files(category.value, bucket).length">
            {{ bucket === 'frozen' ? '受理时冻结的版本' : '受理后补传材料' }}
          </h4>
          <ul
            v-if="files(category.value, bucket).length"
            class="notary-offices-list"
          >
            <li
              v-for="file in files(category.value, bucket)"
              :key="file.contentVersionId"
            >
              {{ file.originalFilename }}
              <ElButton text @click="download(file)">下载</ElButton>
            </li>
          </ul>
        </template>
        <label v-if="canUpload" class="upload-field">
          <span>上传{{ category.label }}（可多选）</span>
          <input
            :data-test="`acceptance-material-input-${category.value}`"
            type="file"
            accept="application/pdf,image/jpeg,image/png"
            multiple
            :disabled="
              uploading !== null ||
              unknownRequest !== null ||
              activeMaterialCount(category.value) >= 10
            "
            @change="uploadFiles($event, category.value)"
          />
        </label>
        <p v-if="activeMaterialCount(category.value) >= 10" class="field-help">
          该类材料已达到每案10份有效材料上限。
        </p>
        <p v-if="uploadError[category.value]" class="submit-error" role="alert">
          {{ uploadError[category.value] }}
        </p>
      </section>
    </div>
  </section>
</template>
