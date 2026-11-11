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
  registerCaseAcceptance,
  scheduleCaseHearing,
  caseAcceptanceDraft,
  listFilingCourts,
  todayShanghai,
  type AcceptanceMaterials,
  type CaseFile,
  type CaseOrigin,
  type LawyerCaseOrigin,
  type FilingCourt,
  type CaseWorkflowItem,
  type RegisterCaseAcceptanceInput,
} from '../../api/cases';
import { ApiError } from '../../api/http';
import {
  downloadMaterialVersion,
  uploadMaterialFile,
} from '../../api/materials';
import { createFee } from '../../api/settlements';
import { notifyWorkflowChanged } from '../../app/workflow-events';

type Category = keyof AcceptanceMaterials;
type PanelItem = CaseWorkflowItem & {
  filingSubmission: { submittedAt: string } | null;
  origin?: CaseOrigin | LawyerCaseOrigin;
  hearing?: {
    currentArrangement: {
      hearingAt?: string | null;
      hearingPlace?: string | null;
      judgeName?: string | null;
    } | null;
  };
};
const categories: ReadonlyArray<{ value: Category; label: string }> = [
  { value: 'ACCEPTANCE_NOTICE', label: '受理通知书' },
  { value: 'PAYMENT_LIST', label: '缴费清单' },
  { value: 'SERVICE_DOCUMENT', label: '送达文书' },
];
const buckets = ['frozen', 'later'] as const;
const props = defineProps<{
  submitCommand?: (input: RegisterCaseAcceptanceInput) => Promise<void>;
  item: PanelItem;
  contextKey: string;
  lawyer?: boolean;
}>();
const emit = defineEmits<{ changed: []; refresh: [] }>();

const acceptedAt = ref(todayShanghai());
const courtCaseNo = ref('');
const paymentDueAt = ref('');
const courtId = ref('');
const hearingAt = ref('');
const hearingPlace = ref('');
const judgeName = ref('');
const courtDisclosureText = ref('');
type DisclosureFile = { contentVersionId: string; filename: string };
const disclosureFiles = ref<DisclosureFile[]>([]);
const disclosureUploading = ref(false);
const disclosureError = ref('');
const feeOpen = ref(false);
const feeAmount = ref('');
const feeSubmitting = ref(false);
const feeError = ref('');
const courts = ref<FilingCourt[]>([]);
const courtsLoading = ref(false);
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
const draftLoading = ref(false);
const draftSaving = ref(false);
const savedVersion = ref<number | null>(null);
const draftBusy = computed(() => draftLoading.value || draftSaving.value);
const audience = computed(() => (props.lawyer ? 'lawyer' : 'internal'));
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
  paymentDueAt.value = '';
  courtId.value = '';
  hearingAt.value = '';
  hearingPlace.value = '';
  judgeName.value = '';
  courtDisclosureText.value = '';
  disclosureFiles.value = [];
  disclosureUploading.value = false;
  disclosureError.value = '';
  feeOpen.value = false;
  feeAmount.value = '';
  feeSubmitting.value = false;
  feeError.value = '';
  courts.value = [];
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
  draftLoading.value = false;
  draftSaving.value = false;
  savedVersion.value = null;
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
    if (
      props.item.origin?.kind === 'EXTERNAL_ENTRY' &&
      !props.item.filingSubmission
    )
      void loadCourts();
  },
  { immediate: true, flush: 'sync' },
);
const needsCourt = computed(
  () =>
    props.item.origin?.kind === 'EXTERNAL_ENTRY' &&
    props.item.filingSubmission === null,
);
const minimumAcceptedAt = computed(() => {
  const candidates = [props.item.filingSubmission?.submittedAt];
  if (props.item.origin?.kind === 'EXTERNAL_ENTRY')
    candidates.push(props.item.origin.stageReachedOn);
  return (
    candidates
      .filter((value): value is string => value !== undefined)
      .sort()
      .at(-1) ?? ''
  );
});
async function loadCourts(): Promise<void> {
  const context = captureContext();
  courtsLoading.value = true;
  try {
    const result = await listFilingCourts(
      context.caseId,
      props.lawyer ? 'lawyer' : 'internal',
    );
    if (isCurrent(context)) courts.value = result;
  } catch {
    if (isCurrent(context))
      error.value = '无法读取可选法院，请刷新案件后重试。';
  } finally {
    if (isCurrent(context)) courtsLoading.value = false;
  }
}
watch(
  [() => props.item.stage, () => unknownRequest.value !== null] as const,
  ([stage, hasUnknownRequest], [previousStage, previouslyUnknown]) => {
    if (
      hasUnknownRequest &&
      stage === 'WAITING_HEARING' &&
      (previousStage !== stage || !previouslyUnknown)
    ) {
      notifyWorkflowChanged();
    }
  },
  { flush: 'sync' },
);
onDeactivated(() => {
  active = false;
  revision += 1;
  abortDownloads();
  submitting.value = false;
  uploading.value = null;
});
onActivated(() => {
  active = true;
});
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

// 待开庭阶段的「更新」卡：直接改开庭时间与地点，不必再走单独的更正流程。
const arranged = computed(() => props.item.hearing?.currentArrangement ?? null);
const updateHearingAt = ref(arranged.value?.hearingAt?.slice(0, 10) ?? '');
const updateHearingPlace = ref(arranged.value?.hearingPlace ?? '');
const updateJudgeName = ref(arranged.value?.judgeName ?? '');
const hearingBusy = ref(false);
const hearingError = ref('');
const hearingSuccess = ref('');
watch(arranged, (value) => {
  updateHearingAt.value = value?.hearingAt?.slice(0, 10) ?? '';
  updateHearingPlace.value = value?.hearingPlace ?? '';
  updateJudgeName.value = value?.judgeName ?? '';
});
async function saveHearing(): Promise<void> {
  if (hearingBusy.value) return;
  hearingBusy.value = true;
  hearingError.value = '';
  hearingSuccess.value = '';
  try {
    await scheduleCaseHearing(props.item.id, {
      expectedVersion: props.item.version,
      idempotencyKey: globalThis.crypto.randomUUID(),
      hearingAt: updateHearingAt.value || null,
      hearingPlace: updateHearingPlace.value.trim() || null,
      judgeName: updateJudgeName.value.trim() || null,
    });
    hearingSuccess.value = '开庭时间已更新。';
    emit('refresh');
  } catch (error) {
    hearingError.value =
      error instanceof Error && error.message
        ? error.message
        : '开庭时间更新失败，请重试。';
  } finally {
    hearingBusy.value = false;
  }
}

watch(
  [() => props.item.id, () => props.contextKey, canRegister],
  async ([id, , allowed]) => {
    if (!allowed) return;
    const context = captureContext();
    draftLoading.value = true;
    try {
      const { draft, version } = await caseAcceptanceDraft(id, audience.value);
      if (!isCurrent(context) || !draft) return;
      savedVersion.value = version;
      acceptedAt.value = draft.acceptedAt ?? '';
      paymentDueAt.value = draft.paymentDueAt ?? '';
      courtCaseNo.value = draft.courtCaseNo ?? '';
      courtId.value = draft.courtId ?? '';
      hearingAt.value = draft.hearingAt ?? '';
      hearingPlace.value = draft.hearingPlace ?? '';
      judgeName.value = draft.judgeName ?? '';
      courtDisclosureText.value = draft.courtDisclosureText ?? '';
      disclosureFiles.value = (
        draft.courtDisclosureContentVersionIds ?? []
      ).map((contentVersionId) => ({
        contentVersionId,
        filename: '已保存的披露附件',
      }));
      selected.value = new Set([
        ...draft.acceptanceNoticeContentVersionIds,
        ...draft.paymentListContentVersionIds,
        ...draft.serviceDocumentContentVersionIds,
      ]);
    } catch {
      if (isCurrent(context))
        error.value = '无法读取正式立案草稿，请刷新后核对。';
    } finally {
      if (isCurrent(context)) draftLoading.value = false;
    }
  },
  { immediate: true },
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
    !draftBusy.value &&
    validBusinessDate(acceptedAt.value) &&
    acceptedAt.value <= todayShanghai() &&
    acceptedAt.value >= minimumAcceptedAt.value &&
    (needsCourt.value
      ? courts.value.some((court) => court.id === courtId.value)
      : props.item.filingSubmission !== null) &&
    courtCaseNo.value.trim().length >= 1 &&
    courtCaseNo.value.trim().length <= 100 &&
    (!hearingAt.value ||
      (validBusinessDate(hearingAt.value) &&
        hearingAt.value >= acceptedAt.value)) &&
    hearingPlace.value.trim().length <= 500 &&
    judgeName.value.trim().length <= 200 &&
    courtDisclosureText.value.trim().length <= 2000 &&
    uploading.value === null &&
    !disclosureUploading.value &&
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
    expectedVersion: savedVersion.value ?? props.item.version,
    idempotencyKey: requestKey || (requestKey = makeKey()),
    paymentDueAt: paymentDueAt.value || null,
    acceptedAt: acceptedAt.value,
    courtCaseNo: courtCaseNo.value.trim(),
    ...(needsCourt.value ? { courtId: courtId.value } : {}),
    acceptanceNoticeContentVersionIds: selectedIds('ACCEPTANCE_NOTICE'),
    paymentListContentVersionIds: selectedIds('PAYMENT_LIST'),
    serviceDocumentContentVersionIds: selectedIds('SERVICE_DOCUMENT'),
    hearingAt: hearingAt.value || null,
    hearingPlace: hearingPlace.value.trim() || null,
    judgeName: judgeName.value.trim() || null,
    courtDisclosureText: courtDisclosureText.value.trim() || null,
    courtDisclosureContentVersionIds: disclosureFiles.value.map(
      (file) => file.contentVersionId,
    ),
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
  unknownRequest.value = input;
  submitting.value = true;
  error.value = '';
  try {
    if (props.submitCommand) await props.submitCommand(input);
    else
      await registerCaseAcceptance(
        context.caseId,
        input,
        props.lawyer ? 'lawyer' : 'internal',
      );
    if (!isCurrent(context)) return;
    unknownRequest.value = null;
    success.value =
      '正式立案登记已完成；填写的开庭与披露信息已一并登记，案件进入待开庭。';
    requestFingerprint = '';
    requestKey = '';
    notifyWorkflowChanged();
    emit('changed');
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
    } else unknownRequest.value = null;
  } finally {
    if (isCurrent(context)) submitting.value = false;
  }
}
async function saveDraft(): Promise<void> {
  if (
    !canRegister.value ||
    draftBusy.value ||
    submitting.value ||
    uploading.value ||
    unknownRequest.value
  )
    return;
  const context = captureContext();
  draftSaving.value = true;
  error.value = '';
  success.value = '';
  try {
    const result = await caseAcceptanceDraft(context.caseId, audience.value, {
      expectedVersion: savedVersion.value ?? props.item.version,
      ...(acceptedAt.value ? { acceptedAt: acceptedAt.value } : {}),
      paymentDueAt: paymentDueAt.value || null,
      ...(courtCaseNo.value.trim()
        ? { courtCaseNo: courtCaseNo.value.trim() }
        : {}),
      ...(needsCourt.value && courtId.value ? { courtId: courtId.value } : {}),
      acceptanceNoticeContentVersionIds: selectedIds('ACCEPTANCE_NOTICE'),
      paymentListContentVersionIds: selectedIds('PAYMENT_LIST'),
      serviceDocumentContentVersionIds: selectedIds('SERVICE_DOCUMENT'),
      hearingAt: updateHearingAt.value || null,
      hearingPlace: updateHearingPlace.value.trim() || null,
      judgeName: updateJudgeName.value.trim() || null,
      courtDisclosureText: courtDisclosureText.value.trim() || null,
      courtDisclosureContentVersionIds: disclosureFiles.value.map(
        (file) => file.contentVersionId,
      ),
    });
    if (!isCurrent(context)) return;
    savedVersion.value = result.version;
    success.value = '已保存草稿，案件仍在待正式立案。';
  } catch (reason) {
    if (isCurrent(context))
      error.value =
        reason instanceof ApiError
          ? reason.message
          : '草稿保存失败，请刷新后核对。';
  } finally {
    if (isCurrent(context)) draftSaving.value = false;
  }
}

const feeValid = computed(() => {
  const value = feeAmount.value.trim();
  return (
    /^(?:0|[1-9]\d{0,13})(?:\.\d{1,2})?$/u.test(value) && Number(value) > 0
  );
});
function openFee(): void {
  feeOpen.value = true;
  feeError.value = '';
}
function closeFee(): void {
  if (feeSubmitting.value) return;
  feeOpen.value = false;
  feeError.value = '';
}
async function confirmFee(): Promise<void> {
  if (!feeValid.value || feeSubmitting.value || !canRegister.value) return;
  const context = captureContext();
  feeSubmitting.value = true;
  feeError.value = '';
  try {
    await createFee({
      caseId: context.caseId,
      type: '诉讼费',
      direction: '支出',
      amount: feeAmount.value.trim(),
      status: '发起',
      feeDate: todayShanghai(),
      idempotencyKey: makeKey(),
    });
    if (!isCurrent(context)) return;
    feeOpen.value = false;
    feeAmount.value = '';
    success.value = '已在费用中心创建一条状态为“发起”的诉讼费记录。';
    notifyWorkflowChanged();
    emit('refresh');
  } catch (reason) {
    if (isCurrent(context))
      feeError.value =
        reason instanceof ApiError
          ? reason.message
          : '发起缴费失败，请稍后重试。';
  } finally {
    if (isCurrent(context)) feeSubmitting.value = false;
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
function supported(file: InstanceType<typeof globalThis.File>): boolean {
  const extension = file.name.toLowerCase().match(/\.[^.]+$/u)?.[0];
  const types = new Map([
    ['.pdf', 'application/pdf'],
    ['.jpg', 'image/jpeg'],
    ['.jpeg', 'image/jpeg'],
    ['.png', 'image/png'],
  ]);
  return extension !== undefined && types.get(extension) === file.type;
}
async function uploadFiles(
  event: InstanceType<typeof globalThis.Event>,
  category: Category,
): Promise<void> {
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
async function uploadDisclosureFiles(
  event: InstanceType<typeof globalThis.Event>,
): Promise<void> {
  const input = event.target;
  if (!(input instanceof globalThis.HTMLInputElement)) return;
  const chosen = Array.from(input.files ?? []);
  input.value = '';
  disclosureError.value = '';
  if (!chosen.length || !canRegister.value || unknownRequest.value) return;
  if (disclosureFiles.value.length + chosen.length > 10) {
    disclosureError.value = '披露附件每案最多10份；系统不能删除、替换或扩容。';
    return;
  }
  if (chosen.some((file) => file.size > 50 * 1024 * 1024 || !supported(file))) {
    disclosureError.value = '仅支持单份不超过50MiB的PDF、JPEG或PNG文件。';
    return;
  }
  const context = captureContext();
  disclosureUploading.value = true;
  try {
    for (const file of chosen) {
      if (!isCurrent(context)) return;
      const result = await uploadMaterialFile({
        ownerType: 'CASE',
        ownerId: context.caseId,
        category: 'CASE_COURT_DISCLOSURE_ATTACHMENT',
        purpose: 'CASE_COURT_DISCLOSURE_ATTACHMENT',
        file,
        caseSupplementReason: '正式立案登记时录入法院披露',
      });
      if (!isCurrent(context)) return;
      disclosureFiles.value = [
        ...disclosureFiles.value,
        {
          contentVersionId: result.contentVersionId,
          filename: result.originalFilename,
        },
      ];
    }
    success.value = '';
  } catch (reason) {
    if (isCurrent(context))
      disclosureError.value =
        reason instanceof ApiError && reason.code === 'VALIDATION_ERROR'
          ? '仅支持单份不超过50MiB的PDF、JPEG或PNG文件。'
          : '披露附件上传失败，请检查连接后重试。';
  } finally {
    if (isCurrent(context)) disclosureUploading.value = false;
  }
}
function removeDisclosureFile(contentVersionId: string): void {
  disclosureFiles.value = disclosureFiles.value.filter(
    (file) => file.contentVersionId !== contentVersionId,
  );
  disclosureError.value = '';
  error.value = '';
  success.value = '';
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
    <template v-if="canRegister">
      <h2 class="form-section-title">正式立案登记</h2>
      <p class="field-help">
        填写受理日期与法院案号即可进入待开庭；三类材料可后补。
      </p>
    </template>
    <template v-else>
      <h2 class="form-section-title">更新</h2>
      <div class="form-stack" data-test="acceptance-hearing-form">
        <label>
          <span>开庭日期</span>
          <input
            v-model="updateHearingAt"
            type="date"
            data-test="acceptance-hearing-at"
          />
        </label>
        <label>
          <span>法庭</span>
          <input
            v-model="updateHearingPlace"
            data-test="acceptance-hearing-place"
          />
        </label>
        <label>
          <span>法官</span>
          <input
            v-model="updateJudgeName"
            data-test="acceptance-hearing-judge"
          />
        </label>
        <p v-if="hearingError" role="alert" class="submit-error">
          {{ hearingError }}
        </p>
        <p v-if="hearingSuccess" role="status">{{ hearingSuccess }}</p>
        <ElButton
          type="primary"
          data-test="acceptance-hearing-save"
          :loading="hearingBusy"
          :disabled="hearingBusy"
          @click="saveHearing"
        >
          保存开庭时间
        </ElButton>
      </div>
      <h3 class="form-section-title">补交受理材料</h3>
    </template>

    <form v-if="canRegister" class="form-stack" @submit.prevent="submit">
      <label>
        <span>立案受理日期 <span class="required-mark">*</span></span>
        <input
          v-model="acceptedAt"
          data-test="acceptance-accepted-at"
          type="date"
          required
          :min="minimumAcceptedAt"
          :max="todayShanghai()"
          :disabled="unknownRequest !== null || submitting || draftBusy"
          @input="
            error = '';
            success = '';
          "
        />
      </label>
      <label
        >缴费截止日期<input
          v-model="paymentDueAt"
          type="date"
          :disabled="submitting || draftBusy"
      /></label>
      <label>
        <span>法院案号 <span class="required-mark">*</span></span>
        <input
          v-model="courtCaseNo"
          data-test="acceptance-court-case-no"
          maxlength="100"
          required
          :disabled="unknownRequest !== null || submitting || draftBusy"
          @input="
            error = '';
            success = '';
          "
        />
      </label>
      <label v-if="needsCourt">
        <span>受理法院 <span class="required-mark">*</span></span>
        <select
          v-model="courtId"
          data-test="acceptance-court-id"
          required
          :disabled="
            courtsLoading || unknownRequest !== null || submitting || draftBusy
          "
          @change="
            error = '';
            success = '';
          "
        >
          <option value="" disabled>请选择案件实际受理法院</option>
          <option v-for="court in courts" :key="court.id" :value="court.id">
            {{ court.name }}
          </option>
        </select>
        <span v-if="courtsLoading" class="field-help">正在读取可选法院…</span>
      </label>
      <label>
        <span>开庭日期</span>
        <input
          v-model="hearingAt"
          data-test="acceptance-hearing-at"
          type="date"
          :min="acceptedAt"
          :disabled="unknownRequest !== null || submitting || draftBusy"
          @input="
            error = '';
            success = '';
          "
        />
        <span class="field-help"
          >法院通知的开庭日期；填写后随本次登记一并建立开庭安排。</span
        >
      </label>
      <label>
        <span>开庭地点</span>
        <input
          v-model="hearingPlace"
          data-test="acceptance-hearing-place"
          maxlength="500"
          :disabled="unknownRequest !== null || submitting || draftBusy"
          @input="
            error = '';
            success = '';
          "
        />
      </label>
      <label>
        <span>承办法官</span>
        <input
          v-model="judgeName"
          data-test="acceptance-judge-name"
          maxlength="200"
          :disabled="unknownRequest !== null || submitting || draftBusy"
          @input="
            error = '';
            success = '';
          "
        />
      </label>
      <label>
        <span>披露数据</span>
        <textarea
          v-model="courtDisclosureText"
          data-test="acceptance-disclosure-text"
          maxlength="2000"
          rows="3"
          :disabled="unknownRequest !== null || submitting || draftBusy"
          @input="
            error = '';
            success = '';
          "
        ></textarea>
        <span class="field-help"
          >法院披露的文本；与附件一起记入本案法院披露补录。</span
        >
      </label>
      <label>
        <span>披露附件</span>
        <input
          data-test="acceptance-disclosure-files"
          type="file"
          accept=".pdf,.jpg,.jpeg,.png"
          multiple
          :disabled="
            unknownRequest !== null ||
            submitting ||
            draftBusy ||
            disclosureUploading ||
            disclosureFiles.length >= 10
          "
          @change="uploadDisclosureFiles"
        />
      </label>
      <p v-if="disclosureUploading" class="field-help">正在上传披露附件…</p>
      <p v-if="disclosureError" class="submit-error" role="alert">
        {{ disclosureError }}
      </p>
      <ul
        v-if="disclosureFiles.length"
        data-test="acceptance-disclosure-list"
        class="field-help"
      >
        <li v-for="file in disclosureFiles" :key="file.contentVersionId">
          {{ file.filename }}
          <button
            type="button"
            :disabled="unknownRequest !== null || submitting || draftBusy"
            @click="removeDisclosureFile(file.contentVersionId)"
          >
            移除
          </button>
        </li>
      </ul>
    </form>

    <p
      v-else-if="item.stage === 'WAITING_FORMAL_ACCEPTANCE'"
      class="field-help"
    >
      当前账号仅可查看此案件及其获准材料。
    </p>

    <p v-if="success" role="status">{{ success }}</p>
    <p v-if="error" class="submit-error" role="alert">{{ error }}</p>
    <p v-if="unknownRequest && item.acceptance" class="field-help">
      案件已有正式立案记录，本次提交结果尚未确认；请使用相同请求重试核对。
    </p>
    <ElButton
      v-if="unknownRequest"
      type="primary"
      data-test="acceptance-retry"
      :loading="submitting"
      :disabled="submitting || draftBusy"
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
                :disabled="unknownRequest !== null || submitting || draftBusy"
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
              draftBusy ||
              submitting ||
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
    <div v-if="canRegister" class="operation-bar acceptance-actions">
      <ElButton
        data-test="acceptance-save"
        :disabled="
          draftBusy ||
          submitting ||
          uploading !== null ||
          unknownRequest !== null
        "
        :loading="draftSaving"
        @click="saveDraft"
        >保存</ElButton
      >
      <ElButton
        data-test="acceptance-fee-issue"
        :disabled="submitting || unknownRequest !== null"
        @click="openFee"
        >发起缴费</ElButton
      >
      <ElButton
        type="primary"
        data-test="acceptance-register"
        :disabled="!ready"
        :loading="submitting"
        @click="submit"
        >提交</ElButton
      >
    </div>

    <div
      v-if="feeOpen"
      class="fee-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="发起缴费"
      data-test="acceptance-fee-dialog"
      @click.self="closeFee"
    >
      <div class="fee-dialog">
        <header class="fee-dialog__head">
          <h3>发起缴费</h3>
          <button
            type="button"
            class="fee-dialog__close"
            aria-label="关闭"
            :disabled="feeSubmitting"
            @click="closeFee"
          >
            ×
          </button>
        </header>
        <div class="fee-dialog__body">
          <label class="fee-field">
            <span>费用类型</span>
            <input class="text-input" value="诉讼费" readonly />
          </label>
          <label class="fee-field">
            <span>金额（元） <span class="required-mark">*</span></span>
            <input
              v-model="feeAmount"
              class="text-input"
              inputmode="decimal"
              data-test="acceptance-fee-amount"
              placeholder="如：6500"
              :disabled="feeSubmitting"
            />
          </label>
          <p class="field-help">
            确认后将在「费用中心」创建一条状态为发起的缴费记录。
          </p>
          <p v-if="feeError" class="submit-error" role="alert">
            {{ feeError }}
          </p>
        </div>
        <footer class="fee-dialog__foot">
          <ElButton :disabled="feeSubmitting" @click="closeFee">取消</ElButton>
          <ElButton
            type="primary"
            data-test="acceptance-fee-confirm"
            :disabled="!feeValid || feeSubmitting"
            :loading="feeSubmitting"
            @click="confirmFee"
            >确认发起</ElButton
          >
        </footer>
      </div>
    </div>
  </section>
</template>

<style scoped>
.acceptance-actions {
  justify-content: flex-end;
}
.fee-backdrop {
  position: fixed;
  inset: 0;
  z-index: 2100;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgb(0 0 0 / 45%);
}
.fee-dialog {
  width: min(420px, calc(100vw - 32px));
  border-radius: 10px;
  background: #fff;
  color: #1f2329;
  box-shadow: 0 12px 40px rgb(0 0 0 / 25%);
}
.fee-dialog__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid #ebeef5;
}
.fee-dialog__head h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}
.fee-dialog__close {
  border: 0;
  background: none;
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
  color: #8a919f;
}
.fee-dialog__body {
  display: grid;
  gap: 12px;
  padding: 16px 20px;
}
.fee-field {
  display: grid;
  gap: 6px;
  font-size: 13px;
  color: #4e5969;
}
.fee-dialog__foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 20px 16px;
}
</style>
