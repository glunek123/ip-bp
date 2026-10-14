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
  registerSecondInstanceResult,
  revokeSecondInstanceResult,
  saveSecondInstance,
  todayShanghai,
  type CaseDetail,
  type LawyerCaseDetail,
  type RegisterSecondInstanceResultInput,
  type SaveSecondInstanceInput,
  type SecondInstanceProgressInput,
} from '../../api/cases';
import { ApiError } from '../../api/http';
import {
  downloadMaterialVersion,
  listOwnerMaterials,
  uploadMaterialFile,
  type MaterialCategory,
} from '../../api/materials';
import { notifyWorkflowChanged } from '../../app/workflow-events';
import {
  beginSecondInstanceCommandAttempt,
  beginSecondInstanceUpload,
  clearSecondInstanceCommand,
  clearSecondInstanceUpload,
  hasUnclearedSecondInstanceUpload,
  pendingSecondInstanceCommand,
  readSecondInstanceUpload,
  secondInstanceCommandState,
  settleSecondInstanceCommandAttempt,
  subscribeSecondInstanceCommand,
  type SecondInstanceCommand,
  type SecondInstanceUploadKind,
} from './case-second-instance-recovery';

type PanelItem = Pick<
  CaseDetail | LawyerCaseDetail,
  | 'id'
  | 'stage'
  | 'version'
  | 'acceptance'
  | 'acceptances'
  | 'hearing'
  | 'judgment'
  | 'judgmentNextStep'
  | 'secondInstance'
  | 'canSaveSecondInstance'
  | 'canRegisterSecondInstanceResult'
  | 'canRevokeSecondInstanceResult'
>;
type PendingCommand = SecondInstanceCommand;
type UploadKind = SecondInstanceUploadKind;
type ResultChoice = '' | 'REMAND' | 'CHANGE' | 'AFFIRM';
type AmountState = '' | 'KNOWN' | 'PENDING';
type PanelFile = {
  materialId: string;
  contentVersionId: string;
  originalFilename: string;
  mimeType: string;
};

const props = defineProps<{
  item: PanelItem;
  contextKey: string;
  actorKey: string;
  lawyer?: boolean;
}>();
const emit = defineEmits<{ changed: []; refresh: [] }>();
const hearingAt = ref('');
const hearingPlace = ref('');
const judgeName = ref('');
const documentFiles = ref<PanelFile[]>([]);
const serviceFiles = ref<PanelFile[]>([]);
const judgmentFiles = ref<PanelFile[]>([]);
const resultChoice = ref<ResultChoice>('');
const receivedAt = ref('');
const feeState = ref<AmountState>('');
const feeAmount = ref('');
const changedAmountState = ref<AmountState>('');
const changedAmount = ref('');
const revokeReason = ref('');
const revokeImpactConfirmed = ref(false);
const pending = ref(false);
const pendingUnknown = ref<PendingCommand | null>(null);
const confirmation = ref<'' | 'result' | 'revoke'>('');
const error = ref('');
const uploadMessage = ref('');
const conflictNeedsReview = ref(false);
const accessDenied = ref(false);
const success = ref('');
const uploading = ref<UploadKind | null>(null);
const uploadUnknown = ref(false);
const recoveryFiles = ref<
  Array<{
    materialId: string;
    version: {
      id: string;
      originalFilename: string;
      mimeType: string;
      createdAt: string;
    };
  }>
>([]);
const verifiedRecoveryFiles = ref(new Set<string>());
const recoveryLoading = ref(false);
let revision = 0;
let mounted = true;
let settlingCurrent = false;
let unsubscribeCommand: (() => void) | null = null;

const second = computed(() => props.item.secondInstance);
const currentRoundId = computed(() => second.value.currentTrialRoundId);
const currentChoice = computed(() => {
  const roundId = currentRoundId.value;
  const choice = props.item.judgmentNextStep.current;
  return roundId && choice?.trialRoundId === roundId && choice.next === 'APPEAL'
    ? choice
    : null;
});
const canSaveCurrent = computed(
  () =>
    !accessDenied.value &&
    props.item.stage === 'SECOND_INSTANCE' &&
    props.item.canSaveSecondInstance &&
    currentRoundId.value !== null &&
    currentChoice.value !== null,
);
const canRegister = computed(
  () =>
    !accessDenied.value &&
    props.item.stage === 'SECOND_INSTANCE' &&
    props.item.canRegisterSecondInstanceResult &&
    currentRoundId.value !== null &&
    currentChoice.value !== null &&
    second.value.currentResult === null,
);
const canRevoke = computed(
  () =>
    !props.lawyer &&
    !accessDenied.value &&
    !conflictNeedsReview.value &&
    props.item.canRevokeSecondInstanceResult &&
    activeResult.value !== null,
);
const activeResult = computed(() => second.value.currentResult);
const minReceivedDate = computed(() => props.item.acceptance?.acceptedAt ?? '');
const validReceivedDate = computed(
  () =>
    /^\d{4}-\d{2}-\d{2}$/u.test(receivedAt.value) &&
    receivedAt.value >= minReceivedDate.value &&
    receivedAt.value <= todayShanghai(),
);
const validMoney = (value: string) =>
  /^(0|[1-9]\d{0,13})(\.\d{1,2})?$/u.test(value.trim());
const validFee = computed(
  () =>
    feeState.value === 'PENDING' ||
    (feeState.value === 'KNOWN' && validMoney(feeAmount.value)),
);
const validChangedAmount = computed(
  () =>
    changedAmountState.value === 'PENDING' ||
    (changedAmountState.value === 'KNOWN' && validMoney(changedAmount.value)),
);
const selectedDocumentIds = computed(() =>
  documentFiles.value.map((file) => file.contentVersionId),
);
const selectedServiceIds = computed(() =>
  serviceFiles.value.map((file) => file.contentVersionId),
);
const selectedJudgmentIds = computed(() =>
  judgmentFiles.value.map((file) => file.contentVersionId),
);
const progressReady = computed(
  () =>
    canSaveCurrent.value &&
    !conflictNeedsReview.value &&
    pendingUnknown.value === null &&
    !uploadUnknown.value &&
    !pending.value &&
    uploading.value === null,
);
const resultReady = computed(
  () =>
    canRegister.value &&
    !conflictNeedsReview.value &&
    pendingUnknown.value === null &&
    !uploadUnknown.value &&
    !pending.value &&
    uploading.value === null &&
    resultChoice.value !== '' &&
    validReceivedDate.value &&
    feeState.value !== '' &&
    validFee.value &&
    selectedJudgmentIds.value.length > 0 &&
    (resultChoice.value !== 'CHANGE' ||
      (changedAmountState.value !== '' && validChangedAmount.value)),
);
const confirmationText = computed(() => {
  if (confirmation.value === 'revoke')
    return '撤销后案件返回二审；原结果保留在历史中，已取消的发回子轮次不会重新启用。';
  if (resultChoice.value === 'REMAND')
    return '登记后仍是同一案件，并转入“待正式立案”。';
  return '登记后案件转入“准备执行文书”。';
});
const roundHistory = computed(() =>
  [...second.value.rounds].sort((a, b) => a.sequence - b.sequence),
);
const documentOptions = computed(() =>
  uniqueFiles([
    ...second.value.progresses.flatMap((entry) => entry.documentFiles),
    ...documentFiles.value,
  ]),
);
const serviceOptions = computed(() =>
  uniqueFiles([
    ...second.value.progresses.flatMap((entry) => entry.serviceFiles),
    ...serviceFiles.value,
  ]),
);
const judgmentOptions = computed(() =>
  uniqueFiles([
    ...second.value.results.flatMap((entry) => entry.files),
    ...judgmentFiles.value,
  ]),
);
function uniqueFiles(files: PanelFile[]): PanelFile[] {
  return [
    ...new Map(files.map((file) => [file.contentVersionId, file])).values(),
  ];
}

function resetDraft(): void {
  const current = second.value.currentProgress;
  hearingAt.value = current?.hearingAt ?? '';
  hearingPlace.value = current?.hearingPlace ?? '';
  judgeName.value = current?.judgeName ?? '';
  documentFiles.value =
    current?.documentFiles.map((file) => ({ ...file })) ?? [];
  serviceFiles.value = current?.serviceFiles.map((file) => ({ ...file })) ?? [];
  judgmentFiles.value = [];
  resultChoice.value = '';
  receivedAt.value = '';
  feeState.value = '';
  feeAmount.value = '';
  changedAmountState.value = '';
  changedAmount.value = '';
  revokeReason.value = '';
  revokeImpactConfirmed.value = false;
  confirmation.value = '';
}
function clearSensitive(): void {
  resetDraft();
  documentFiles.value = [];
  serviceFiles.value = [];
  judgmentFiles.value = [];
  accessDenied.value = true;
}
watch(
  [() => props.item.id, () => props.actorKey],
  () => {
    unsubscribeCommand?.();
    revision += 1;
    resetDraft();
    pending.value = false;
    pendingUnknown.value = pendingSecondInstanceCommand(recoveryIdentity());
    error.value = '';
    uploadMessage.value = '';
    conflictNeedsReview.value = false;
    accessDenied.value = false;
    success.value = '';
    uploadUnknown.value =
      !!readSecondInstanceUpload(recoveryIdentity()) ||
      hasUnclearedSecondInstanceUpload(recoveryIdentity());
    recoveryFiles.value = [];
    verifiedRecoveryFiles.value.clear();
    const identity = recoveryIdentity();
    const stored = secondInstanceCommandState(identity);
    if (stored?.status === 'confirmed')
      success.value =
        '原轮次请求已确认。请核对最新案件详情；此回执不代表当前轮次已登记。';
    unsubscribeCommand = subscribeSecondInstanceCommand(identity, (state) => {
      if (
        !mounted ||
        props.item.id !== identity.caseId ||
        props.actorKey !== identity.actor
      )
        return;
      if (settlingCurrent) return;
      if (state.status === 'confirmed') {
        pendingUnknown.value = null;
        error.value = '';
        success.value =
          '原轮次请求已确认。请核对最新案件详情；此回执不代表当前轮次已登记。';
        emit('refresh');
      } else if (state.status === 'unknown') {
        pendingUnknown.value = state.command;
        error.value =
          '原请求结果未知。请使用原请求核对；旧回执只确认原轮次请求。';
      } else if (state.status === 'rejected') {
        pendingUnknown.value = null;
        if (
          state.rejection instanceof ApiError &&
          [403, 404].includes(state.rejection.status)
        )
          clearSensitive();
        if (
          state.rejection instanceof ApiError &&
          (state.rejection.status === 409 ||
            [
              'VERSION_CONFLICT',
              'INVALID_STATE',
              'IDEMPOTENCY_CONFLICT',
            ].includes(state.rejection.code))
        )
          conflictNeedsReview.value = true;
        error.value = '原请求已返回明确结果。请刷新并核对当前案件详情。';
        clearSecondInstanceCommand(identity, state.command);
        emit('refresh');
      }
    });
  },
  { immediate: true, flush: 'sync' },
);
watch(
  () => props.contextKey,
  () => {
    revision += 1;
    pending.value = false;
    pendingUnknown.value = pendingSecondInstanceCommand(recoveryIdentity());
    uploadUnknown.value =
      !!readSecondInstanceUpload(recoveryIdentity()) ||
      hasUnclearedSecondInstanceUpload(recoveryIdentity());
    if (pendingUnknown.value)
      error.value =
        '原请求结果未知。请使用原请求核对；旧回执只确认原轮次请求。';
  },
  { flush: 'sync' },
);
watch(
  [
    () => props.item.version,
    currentRoundId,
    () => second.value.currentProgress?.id,
    () => activeResult.value?.id,
  ],
  () => {
    resetDraft();
    if (pendingUnknown.value === null) {
      if (!conflictNeedsReview.value) error.value = '';
      if (
        !success.value.startsWith('原轮次请求已确认') ||
        secondInstanceCommandState(recoveryIdentity())?.status !== 'confirmed'
      )
        success.value = '';
      uploadMessage.value = '';
    }
  },
  { flush: 'sync' },
);
onDeactivated(() => {
  mounted = false;
  revision += 1;
  pending.value = false;
  uploading.value = null;
  recoveryLoading.value = false;
});
onActivated(() => {
  mounted = true;
  pendingUnknown.value = pendingSecondInstanceCommand(recoveryIdentity());
  uploadUnknown.value =
    !!readSecondInstanceUpload(recoveryIdentity()) ||
    hasUnclearedSecondInstanceUpload(recoveryIdentity());
});
onBeforeUnmount(() => {
  mounted = false;
  revision += 1;
  unsubscribeCommand?.();
});

function capture() {
  return {
    id: props.item.id,
    actorKey: props.actorKey,
    contextKey: props.contextKey,
    revision,
  };
}
function recoveryIdentity() {
  return { actor: props.actorKey, caseId: props.item.id };
}
function currentContext(context: ReturnType<typeof capture>): boolean {
  return (
    mounted &&
    context.revision === revision &&
    context.id === props.item.id &&
    context.actorKey === props.actorKey &&
    context.contextKey === props.contextKey
  );
}
function isUnknown(reason: unknown): boolean {
  return (
    reason instanceof ApiError &&
    (reason.status >= 500 ||
      [
        'NETWORK_ERROR',
        'TIMEOUT',
        'INTERNAL_ERROR',
        'INVALID_RESPONSE',
      ].includes(reason.code))
  );
}
function progressPayload(): SecondInstanceProgressInput {
  return {
    hearingAt: hearingAt.value || null,
    hearingPlace: hearingPlace.value.trim() || null,
    judgeName: judgeName.value.trim() || null,
    documentContentVersionIds: selectedDocumentIds.value,
    serviceContentVersionIds: selectedServiceIds.value,
  };
}
function makeProgressInput(): SaveSecondInstanceInput {
  return {
    expectedVersion: props.item.version,
    idempotencyKey: globalThis.crypto.randomUUID(),
    trialRoundId: currentRoundId.value!,
    choiceId: currentChoice.value!.id,
    expectedProgressId: second.value.currentProgress?.id ?? null,
    progress: progressPayload(),
  };
}
function makeResultInput(): RegisterSecondInstanceResultInput {
  const paidLitigationFee =
    feeState.value === 'PENDING'
      ? { state: 'PENDING' as const, amount: null }
      : { state: 'KNOWN' as const, amount: feeAmount.value.trim() };
  return {
    expectedVersion: props.item.version,
    idempotencyKey: globalThis.crypto.randomUUID(),
    trialRoundId: currentRoundId.value!,
    choiceId: currentChoice.value!.id,
    expectedProgressId: second.value.currentProgress?.id ?? null,
    result: resultChoice.value as Exclude<ResultChoice, ''>,
    resultReceivedAt: receivedAt.value,
    judgmentContentVersionIds: selectedJudgmentIds.value,
    paidLitigationFee,
    ...(resultChoice.value === 'CHANGE'
      ? {
          judgmentAmount:
            changedAmountState.value === 'PENDING'
              ? { state: 'PENDING' as const, amount: null }
              : { state: 'KNOWN' as const, amount: changedAmount.value.trim() },
        }
      : {}),
    progress: progressPayload(),
  };
}
async function send(command: PendingCommand): Promise<void> {
  const context = capture();
  const identity = recoveryIdentity();
  let attempt: symbol;
  try {
    const started = beginSecondInstanceCommandAttempt(identity, command);
    attempt = started.attempt;
    command = started.command;
  } catch {
    error.value = '原请求仍待核对。请使用原请求安全重试。';
    return;
  }
  pending.value = true;
  error.value = '';
  conflictNeedsReview.value = false;
  success.value = '';
  confirmation.value = '';
  try {
    if (command.kind === 'progress')
      await saveSecondInstance(
        context.id,
        command.input,
        props.lawyer ? 'lawyer' : 'internal',
      );
    else if (command.kind === 'result')
      await registerSecondInstanceResult(
        context.id,
        command.input,
        props.lawyer ? 'lawyer' : 'internal',
      );
    else await revokeSecondInstanceResult(context.id, command.input);
    settlingCurrent = currentContext(context);
    const state = settleSecondInstanceCommandAttempt(
      identity,
      command,
      attempt,
      'confirmed',
    );
    settlingCurrent = false;
    if (!currentContext(context) || state === null) return;
    if (state.count > 1) {
      pendingUnknown.value = null;
      success.value =
        '原轮次请求已确认。请核对最新案件详情；此回执不代表当前轮次已登记。';
      emit('refresh');
      return;
    }
    pendingUnknown.value = null;
    success.value =
      props.item.version !== command.input.expectedVersion ||
      (command.kind !== 'revoke' &&
        currentRoundId.value !== command.input.trialRoundId)
        ? '原轮次请求已确认。请核对最新案件详情；此回执不代表当前轮次已登记。'
        : command.kind === 'progress'
          ? '二审进展已登记，正在读取最新案件详情。'
          : command.kind === 'result'
            ? '二审结果已登记，正在读取最新案件详情。'
            : '二审结果已撤销，历史记录已保留。';
    notifyWorkflowChanged();
    emit('changed');
  } catch (reason) {
    settlingCurrent = currentContext(context);
    const state = settleSecondInstanceCommandAttempt(
      identity,
      command,
      attempt,
      isUnknown(reason) ? 'unknown' : 'rejected',
      reason,
    );
    settlingCurrent = false;
    if (
      currentContext(context) &&
      reason instanceof ApiError &&
      [403, 404].includes(reason.status)
    ) {
      clearSensitive();
      error.value =
        reason.status === 403
          ? '当前账号已不能办理此案件，敏感内容已清除，正在核对访问权限。'
          : '案件已不可访问，敏感内容已清除，正在核对案件状态。';
      if (state?.status === 'rejected')
        clearSecondInstanceCommand(identity, command);
      emit('refresh');
      return;
    }
    if (
      !currentContext(context) ||
      state === null ||
      state.status === 'confirmed' ||
      state.status === 'sending'
    )
      return;
    if (state.status === 'unknown') {
      pendingUnknown.value = command;
      error.value =
        '操作结果未知。请使用相同请求安全重试；刷新详情不能确认提交结果。';
    } else if (
      reason instanceof ApiError &&
      (reason.status === 409 ||
        ['VERSION_CONFLICT', 'INVALID_STATE', 'IDEMPOTENCY_CONFLICT'].includes(
          reason.code,
        ))
    ) {
      clearSecondInstanceCommand(identity, command);
      pendingUnknown.value = null;
      conflictNeedsReview.value = true;
      error.value =
        '案件版本或轮次已变化。旧请求不会改用新版本，请刷新并核对后重新填写。';
      emit('refresh');
    } else {
      clearSecondInstanceCommand(identity, command);
      error.value = '操作未完成，请核对案件详情后重试。';
    }
  } finally {
    if (currentContext(context)) pending.value = false;
  }
}
async function saveProgress(): Promise<void> {
  if (progressReady.value)
    await send({ kind: 'progress', input: makeProgressInput() });
}
function openResultConfirmation(): void {
  if (!resultReady.value) return;
  error.value = '';
  confirmation.value = 'result';
}
async function confirmResult(): Promise<void> {
  if (confirmation.value === 'result' && resultReady.value)
    await send({ kind: 'result', input: makeResultInput() });
}
function openRevokeConfirmation(): void {
  if (
    canRevoke.value &&
    revokeReason.value.trim().length > 0 &&
    revokeImpactConfirmed.value
  )
    confirmation.value = 'revoke';
}
async function confirmRevoke(): Promise<void> {
  if (
    confirmation.value !== 'revoke' ||
    !activeResult.value ||
    !revokeReason.value.trim()
  )
    return;
  await send({
    kind: 'revoke',
    input: {
      expectedVersion: props.item.version,
      idempotencyKey: globalThis.crypto.randomUUID(),
      trialRoundId: activeResult.value.trialRoundId,
      resultId: activeResult.value.id,
      reason: revokeReason.value.trim(),
    },
  });
}
async function retryUnknown(): Promise<void> {
  if (pendingUnknown.value && !pending.value) await send(pendingUnknown.value);
}
function acknowledgeConflict(): void {
  conflictNeedsReview.value = false;
  error.value = '';
}
function toggleFile(
  kind: 'document' | 'service',
  contentVersionId: string,
  checked: boolean,
): void {
  const target = kind === 'document' ? documentFiles : serviceFiles;
  const options =
    kind === 'document' ? documentOptions.value : serviceOptions.value;
  const next = new Map(
    target.value.map((file) => [file.contentVersionId, file]),
  );
  if (checked) {
    if (!next.has(contentVersionId) && next.size >= 10) {
      error.value = '每类进展材料最多选择10个文件版本。';
      return;
    }
    const file = options.find(
      (entry) => entry.contentVersionId === contentVersionId,
    );
    if (file) next.set(contentVersionId, file);
  } else next.delete(contentVersionId);
  target.value = [...next.values()];
}
function toggleJudgmentFile(contentVersionId: string, checked: boolean): void {
  const next = new Map(
    judgmentFiles.value.map((file) => [file.contentVersionId, file]),
  );
  const file = judgmentOptions.value.find(
    (entry) => entry.contentVersionId === contentVersionId,
  );
  if (checked && !next.has(contentVersionId) && next.size >= 10) {
    error.value = '本次结果最多选择10个裁判文书版本。';
    return;
  }
  if (checked && file) next.set(contentVersionId, file);
  else if (!checked) next.delete(contentVersionId);
  judgmentFiles.value = [...next.values()];
}
async function upload(
  kind: UploadKind,
  event: globalThis.Event,
): Promise<void> {
  const input = event.target as globalThis.HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file || uploading.value || uploadUnknown.value || pendingUnknown.value)
    return;
  const context = capture();
  const identity = recoveryIdentity();
  let marker: ReturnType<typeof beginSecondInstanceUpload>;
  try {
    marker = beginSecondInstanceUpload(identity, kind);
  } catch {
    uploadUnknown.value = true;
    uploadMessage.value =
      '无法记录上传恢复状态，已停止上传；请联系管理员核查。';
    return;
  }
  uploading.value = kind;
  uploadMessage.value = '';
  error.value = '';
  const category: MaterialCategory =
    kind === 'document'
      ? 'SECOND_INSTANCE_DOCUMENT'
      : kind === 'service'
        ? 'SECOND_INSTANCE_SERVICE'
        : 'SECOND_INSTANCE_JUDGMENT';
  try {
    const uploaded = await uploadMaterialFile({
      ownerType: 'CASE',
      ownerId: context.id,
      category,
      purpose: category,
      file,
    });
    if (!currentContext(context)) return;
    try {
      clearSecondInstanceUpload(marker);
    } catch {
      uploadUnknown.value = true;
      uploadMessage.value =
        '文件已返回，但无法清除恢复标记；请停止重传并联系管理员核查。';
      return;
    }
    const choice = {
      materialId: uploaded.materialId,
      contentVersionId: uploaded.contentVersionId,
      originalFilename: uploaded.originalFilename,
      mimeType: uploaded.mimeType,
    };
    if (kind === 'document')
      documentFiles.value = [
        ...documentFiles.value.filter(
          (entry) => entry.contentVersionId !== choice.contentVersionId,
        ),
        choice,
      ];
    else if (kind === 'service')
      serviceFiles.value = [
        ...serviceFiles.value.filter(
          (entry) => entry.contentVersionId !== choice.contentVersionId,
        ),
        choice,
      ];
    else
      judgmentFiles.value = [
        ...judgmentFiles.value.filter(
          (entry) => entry.contentVersionId !== choice.contentVersionId,
        ),
        choice,
      ];
    uploadMessage.value = '文件已上传并可选择；业务登记尚未提交。';
  } catch (reason) {
    if (currentContext(context)) {
      if (isUnknown(reason)) {
        uploadUnknown.value = true;
        uploadMessage.value =
          '上传结果未知。请刷新已有材料并下载精确版本核对；不要重新上传。';
      } else {
        try {
          clearSecondInstanceUpload(marker);
        } catch {
          uploadUnknown.value = true;
        }
        uploadMessage.value = uploadUnknown.value
          ? '无法清除恢复标记，请联系管理员核查。'
          : '文件未能加入本次办理，请检查文件后重试。';
      }
    }
  } finally {
    if (currentContext(context)) uploading.value = null;
  }
}
function recoveryFileKey(file: {
  materialId: string;
  version: { id: string };
}): string {
  return `${file.materialId}:${file.version.id}`;
}
async function refreshRecoveryFiles(): Promise<void> {
  if (!mounted) return;
  if (
    !uploadUnknown.value ||
    recoveryLoading.value ||
    uploading.value ||
    accessDenied.value
  )
    return;
  const context = capture();
  const marker = readSecondInstanceUpload(recoveryIdentity());
  if (!marker) {
    uploadMessage.value = '恢复标记不可读取，请停止重传并联系管理员核查。';
    return;
  }
  const category: MaterialCategory =
    marker.kind === 'document'
      ? 'SECOND_INSTANCE_DOCUMENT'
      : marker.kind === 'service'
        ? 'SECOND_INSTANCE_SERVICE'
        : 'SECOND_INSTANCE_JUDGMENT';
  const frozenKeys = new Set(
    (category === 'SECOND_INSTANCE_DOCUMENT'
      ? second.value.progresses.flatMap((progress) => progress.documentFiles)
      : category === 'SECOND_INSTANCE_SERVICE'
        ? second.value.progresses.flatMap((progress) => progress.serviceFiles)
        : second.value.results.flatMap((result) => result.files)
    ).map((file) => `${file.materialId}:${file.contentVersionId}`),
  );
  recoveryLoading.value = true;
  recoveryFiles.value = [];
  verifiedRecoveryFiles.value.clear();
  try {
    const result = await listOwnerMaterials('CASE', context.id);
    if (!currentContext(context)) return;
    recoveryFiles.value = result.items
      .filter(
        (material) =>
          material.ownerType === 'CASE' &&
          material.ownerId === context.id &&
          material.category === category &&
          material.purpose === category &&
          material.status === 'ACTIVE',
      )
      .flatMap((material) =>
        material.contentVersions
          .filter(
            (version) =>
              version.status === 'AVAILABLE' &&
              (version.id === material.currentVersionId ||
                frozenKeys.has(`${material.id}:${version.id}`)),
          )
          .map((version) => ({ materialId: material.id, version })),
      );
    uploadMessage.value = recoveryFiles.value.length
      ? '请下载候选版本人工核对，再确认选用精确版本。'
      : '没有可核对的材料版本。未知上传标记保留，请联系管理员核查。';
  } catch (reason) {
    if (!currentContext(context)) return;
    if (reason instanceof ApiError && [403, 404].includes(reason.status))
      clearSensitive();
    uploadMessage.value =
      '材料列表无法读取。未知上传标记保留，请联系管理员核查。';
  } finally {
    if (currentContext(context)) recoveryLoading.value = false;
  }
}
async function downloadRecoveryFile(
  file: (typeof recoveryFiles.value)[number],
): Promise<void> {
  const context = capture();
  try {
    await downloadMaterialVersion(file.materialId, file.version.id);
    if (currentContext(context))
      verifiedRecoveryFiles.value.add(recoveryFileKey(file));
  } catch {
    if (currentContext(context))
      uploadMessage.value = '候选版本下载失败，请稍后重试。';
  }
}
function adoptRecoveryFile(file: (typeof recoveryFiles.value)[number]): void {
  if (
    !uploadUnknown.value ||
    !verifiedRecoveryFiles.value.has(recoveryFileKey(file)) ||
    accessDenied.value
  )
    return;
  const marker = readSecondInstanceUpload(recoveryIdentity());
  if (!marker) return;
  if (marker.kind === 'judgment' ? !canRegister.value : !canSaveCurrent.value)
    return;
  try {
    clearSecondInstanceUpload(marker);
  } catch {
    uploadMessage.value = '无法清除恢复标记，请停止重传并联系管理员核查。';
    return;
  }
  const chosen = {
    materialId: file.materialId,
    contentVersionId: file.version.id,
    originalFilename: file.version.originalFilename,
    mimeType: file.version.mimeType,
  };
  const target =
    marker.kind === 'document'
      ? documentFiles
      : marker.kind === 'service'
        ? serviceFiles
        : judgmentFiles;
  target.value = uniqueFiles([...target.value, chosen]);
  uploadUnknown.value = false;
  recoveryFiles.value = [];
  verifiedRecoveryFiles.value.clear();
  uploadMessage.value = '已人工核对并选用此精确文件版本；业务登记尚未提交。';
}
async function download(file: {
  materialId: string;
  contentVersionId: string;
}): Promise<void> {
  try {
    await downloadMaterialVersion(file.materialId, file.contentVersionId);
  } catch {
    error.value = '附件下载失败，请稍后重试。';
  }
}
function resultName(result: string): string {
  return result === 'REMAND'
    ? '发回重审'
    : result === 'CHANGE'
      ? '改判'
      : '维持原判';
}
function money(state: 'KNOWN' | 'PENDING', amount: string | null): string {
  return state === 'KNOWN' && amount !== null ? '¥ ' + amount : '待确认';
}
function roundLabel(round: (typeof roundHistory.value)[number]): string {
  if (round.revokedAt) return '第' + round.sequence + '轮办理（已撤销）';
  return '第' + round.sequence + '轮办理';
}
</script>

<template>
  <section class="demo-card demo-card--pad" data-test="second-instance-panel">
    <h2 class="form-section-title">二审办理</h2>
    <p>进展、裁判结果和材料按办理轮次保存。文件上传完成不代表结果已登记。</p>
    <template v-for="round in roundHistory" :key="round.id">
      <section
        v-if="!accessDenied"
        class="demo-card demo-card--pad"
        :data-test="'second-instance-round-' + round.sequence"
      >
        <h3>{{ roundLabel(round) }}</h3>
        <p
          v-for="acceptance in item.acceptances.filter(
            (entry) => entry.trialRoundId === round.id,
          )"
          :key="acceptance.id"
        >
          正式立案：{{ acceptance.acceptedAt }} · {{ acceptance.courtCaseNo }}
          <button
            v-for="file in acceptance.files"
            :key="file.contentVersionId"
            type="button"
            @click="download(file)"
          >
            {{ file.originalFilename }}（下载）
          </button>
        </p>
        <p
          v-for="arrangement in item.hearing.arrangements.filter(
            (entry) => entry.trialRoundId === round.id,
          )"
          :key="arrangement.id"
        >
          开庭安排：{{ arrangement.hearingAt ?? '未安排' }}
        </p>
        <p
          v-for="fact in item.judgment.history.filter(
            (entry) => entry.trialRoundId === round.id,
          )"
          :key="fact.id"
        >
          一审裁判：{{ fact.judgmentReceivedAt }} ·
          {{ money(fact.judgmentAmountState, fact.judgmentAmount) }}
          <button
            v-for="file in fact.files"
            :key="file.contentVersionId"
            type="button"
            @click="download(file)"
          >
            {{ file.originalFilename }}（下载）
          </button>
        </p>
        <p
          v-for="choice in item.judgmentNextStep.history.filter(
            (entry) => entry.trialRoundId === round.id,
          )"
          :key="choice.id"
        >
          后续选择：{{ choice.next === 'APPEAL' ? '上诉' : '执行' }}
        </p>
        <div
          v-for="progress in second.progresses.filter(
            (entry) => entry.trialRoundId === round.id,
          )"
          :key="progress.id"
        >
          <p>
            二审进展：{{ progress.hearingAt ?? '未填写开庭日期' }} ·
            {{ progress.hearingPlace ?? '未填写地点' }} ·
            {{ progress.judgeName ?? '未填写法官' }}
          </p>
          <button
            v-for="file in [
              ...progress.documentFiles,
              ...progress.serviceFiles,
            ]"
            :key="file.contentVersionId"
            type="button"
            @click="download(file)"
          >
            {{ file.originalFilename }}（下载）
          </button>
        </div>
        <div
          v-for="result in second.results.filter(
            (entry) => entry.trialRoundId === round.id,
          )"
          :key="result.id"
        >
          <p>
            二审结果：{{ resultName(result.result) }} · 收到日期
            {{ result.resultReceivedAt }}
          </p>
          <p v-if="result.result !== 'REMAND'">
            裁判金额：{{
              money(result.judgmentAmountState, result.judgmentAmount)
            }}
          </p>
          <p>
            诉讼费：{{
              money(result.paidLitigationFeeState, result.paidLitigationFee)
            }}
          </p>
          <button
            v-for="file in result.files"
            :key="file.contentVersionId"
            type="button"
            @click="download(file)"
          >
            {{ file.originalFilename }}（下载）
          </button>
        </div>
        <p
          v-for="revocation in second.revocations.filter(
            (entry) =>
              second.results.find((result) => result.id === entry.resultId)
                ?.trialRoundId === round.id,
          )"
          :key="revocation.id"
        >
          结果已撤销<span v-if="'reason' in revocation && revocation.reason"
            >：{{ revocation.reason }}</span
          >
        </p>
      </section>
    </template>
    <p v-if="accessDenied" role="status">
      当前账号不能查看或办理此案件，请刷新案件详情。
    </p>
    <template v-if="canSaveCurrent">
      <form
        data-test="second-instance-progress-form"
        @submit.prevent="saveProgress"
      >
        <h3>当前轮进展</h3>
        <label
          >开庭日期<input
            v-model="hearingAt"
            data-test="second-instance-hearing-at"
            type="date"
        /></label>
        <label>开庭地点<input v-model="hearingPlace" maxlength="500" /></label>
        <label>法官<input v-model="judgeName" maxlength="200" /></label>
        <label
          >普通文书<input
            type="file"
            accept="application/pdf,image/jpeg,image/png"
            data-test="second-instance-document-upload"
            :disabled="
              uploading !== null || uploadUnknown || pendingUnknown !== null
            "
            @change="upload('document', $event)"
        /></label>
        <label
          >送达文书<input
            type="file"
            accept="application/pdf,image/jpeg,image/png"
            data-test="second-instance-service-upload"
            :disabled="
              uploading !== null || uploadUnknown || pendingUnknown !== null
            "
            @change="upload('service', $event)"
        /></label>
        <fieldset>
          <legend>普通文书版本</legend>
          <label v-for="file in documentOptions" :key="file.contentVersionId"
            ><input
              type="checkbox"
              :checked="selectedDocumentIds.includes(file.contentVersionId)"
              :disabled="
                selectedDocumentIds.length >= 10 &&
                !selectedDocumentIds.includes(file.contentVersionId)
              "
              @change="
                toggleFile(
                  'document',
                  file.contentVersionId,
                  ($event.target as HTMLInputElement).checked,
                )
              "
            />{{ file.originalFilename }}</label
          >
        </fieldset>
        <fieldset>
          <legend>送达文书版本</legend>
          <label v-for="file in serviceOptions" :key="file.contentVersionId"
            ><input
              type="checkbox"
              :checked="selectedServiceIds.includes(file.contentVersionId)"
              :disabled="
                selectedServiceIds.length >= 10 &&
                !selectedServiceIds.includes(file.contentVersionId)
              "
              @change="
                toggleFile(
                  'service',
                  file.contentVersionId,
                  ($event.target as HTMLInputElement).checked,
                )
              "
            />{{ file.originalFilename }}</label
          >
        </fieldset>
        <button
          data-test="second-instance-progress-save"
          type="submit"
          :disabled="!progressReady"
        >
          保存当前轮进展
        </button>
      </form>
      <form
        data-test="second-instance-result-form"
        @submit.prevent="openResultConfirmation"
      >
        <h3>登记当前轮二审结果</h3>
        <p>结果将结束当前轮办理，并按结果进入对应案件阶段。</p>
        <label
          v-for="option in [
            { value: 'REMAND', label: '发回重审' },
            { value: 'CHANGE', label: '改判' },
            { value: 'AFFIRM', label: '维持原判' },
          ]"
          :key="option.value"
        >
          <input
            v-model="resultChoice"
            data-test="second-instance-result-option"
            type="radio"
            name="second-instance-result"
            :value="option.value"
          />{{ option.label }}
        </label>
        <label
          >结果收到日期<input
            v-model="receivedAt"
            data-test="second-instance-received-at"
            type="date"
            :min="minReceivedDate"
            :max="todayShanghai()"
        /></label>
        <p v-if="resultChoice === 'REMAND'">
          同一案件将转入待正式立案，等待登记新一轮立案信息。
        </p>
        <p v-else-if="resultChoice === 'CHANGE' || resultChoice === 'AFFIRM'">
          案件将进入准备执行文书。
        </p>
        <div v-if="resultChoice === 'CHANGE'">
          <fieldset>
            <legend>改判金额状态</legend>
            <label
              ><input
                v-model="changedAmountState"
                type="radio"
                name="changed-amount-state"
                value="KNOWN"
              />已确定</label
            ><label
              ><input
                v-model="changedAmountState"
                type="radio"
                name="changed-amount-state"
                value="PENDING"
              />待确认</label
            >
          </fieldset>
          <label v-if="changedAmountState === 'KNOWN'"
            >改判金额<input v-model="changedAmount" inputmode="decimal"
          /></label>
        </div>
        <div v-if="resultChoice === 'AFFIRM'">
          <p>
            维持原判金额（只读）：{{
              item.judgment.current
                ? money(
                    item.judgment.current.judgmentAmountState,
                    item.judgment.current.judgmentAmount,
                  )
                : '原判金额未提供'
            }}
          </p>
        </div>
        <fieldset>
          <legend>已缴诉讼费</legend>
          <label
            ><input
              v-model="feeState"
              data-test="second-instance-fee-state"
              type="radio"
              name="second-instance-fee-state"
              value="KNOWN"
            />已确定</label
          ><label
            ><input
              v-model="feeState"
              data-test="second-instance-fee-state"
              type="radio"
              name="second-instance-fee-state"
              value="PENDING"
            />待确认</label
          >
        </fieldset>
        <label v-if="feeState === 'KNOWN'"
          >诉讼费金额<input v-model="feeAmount" inputmode="decimal"
        /></label>
        <label
          >二审裁判文书<input
            type="file"
            accept="application/pdf,image/jpeg,image/png"
            data-test="second-instance-judgment-upload"
            :disabled="
              uploading !== null || uploadUnknown || pendingUnknown !== null
            "
            @change="upload('judgment', $event)"
        /></label>
        <label v-for="file in judgmentOptions" :key="file.contentVersionId"
          ><input
            data-test="second-instance-result-file-choice"
            type="checkbox"
            :checked="selectedJudgmentIds.includes(file.contentVersionId)"
            :disabled="
              selectedJudgmentIds.length >= 10 &&
              !selectedJudgmentIds.includes(file.contentVersionId)
            "
            @change="
              toggleJudgmentFile(
                file.contentVersionId,
                ($event.target as HTMLInputElement).checked,
              )
            "
          />{{
            file.originalFilename
          }}（已上传或历史冻结，尚未用于本次登记）</label
        >
        <button
          data-test="second-instance-result-submit"
          type="submit"
          :disabled="!resultReady"
        >
          核对并登记结果
        </button>
      </form>
    </template>
    <section
      v-if="
        !lawyer &&
        !accessDenied &&
        item.canRevokeSecondInstanceResult &&
        activeResult
      "
      data-test="second-instance-revoke-section"
    >
      <h3>撤销当前二审结果</h3>
      <label
        >撤销原因<textarea v-model="revokeReason" maxlength="500"></textarea>
      </label>
      <label
        ><input
          v-model="revokeImpactConfirmed"
          type="checkbox"
        />我已确认案件会返回二审，发回子轮次不会恢复。</label
      >
      <button
        data-test="second-instance-revoke"
        type="button"
        :disabled="
          !revokeReason.trim() ||
          !revokeImpactConfirmed ||
          pending ||
          pendingUnknown !== null ||
          uploadUnknown
        "
        @click="openRevokeConfirmation"
      >
        核对并撤销结果
      </button>
    </section>
    <p v-if="uploadMessage" role="status">{{ uploadMessage }}</p>
    <div v-if="uploadUnknown && !accessDenied" class="demo-card demo-card--pad">
      <p role="alert">
        上传结果未知。请下载已有材料的精确版本核对，再明确选用。
      </p>
      <button
        data-test="second-instance-recovery-refresh"
        type="button"
        :disabled="recoveryLoading || uploading !== null"
        @click="refreshRecoveryFiles"
      >
        刷新已有材料
      </button>
      <ul>
        <li v-for="file in recoveryFiles" :key="recoveryFileKey(file)">
          {{ file.version.originalFilename }} · {{ file.version.createdAt }}
          <button
            data-test="second-instance-recovery-download"
            type="button"
            @click="downloadRecoveryFile(file)"
          >
            下载核对
          </button>
          <button
            data-test="second-instance-recovery-adopt"
            type="button"
            :disabled="!verifiedRecoveryFiles.has(recoveryFileKey(file))"
            @click="adoptRecoveryFile(file)"
          >
            确认选用此版本
          </button>
        </li>
      </ul>
    </div>
    <p v-if="success" role="status">{{ success }}</p>
    <p v-if="error" role="alert">{{ error }}</p>
    <button
      v-if="conflictNeedsReview"
      data-test="second-instance-conflict-acknowledge"
      type="button"
      @click="acknowledgeConflict"
    >
      我已核对最新案件详情，继续填写
    </button>
    <button
      v-if="pendingUnknown && !accessDenied"
      data-test="second-instance-result-retry"
      type="button"
      :disabled="pending"
      @click="retryUnknown"
    >
      使用原请求重试
    </button>
    <div
      v-if="confirmation"
      class="demo-card demo-card--pad"
      data-test="second-instance-confirmation"
    >
      <p>{{ confirmationText }}</p>
      <button
        v-if="confirmation === 'result'"
        data-test="second-instance-confirm-result"
        type="button"
        :disabled="pending"
        @click="confirmResult"
      >
        确认登记
      </button>
      <button
        v-else
        data-test="second-instance-confirm-revoke"
        type="button"
        :disabled="pending"
        @click="confirmRevoke"
      >
        确认撤销
      </button>
      <button type="button" :disabled="pending" @click="confirmation = ''">
        返回修改
      </button>
    </div>
  </section>
</template>
