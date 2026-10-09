<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { ApiError } from '../../api/http';
import { getCustomer } from '../../api/customers';
import {
  downloadMaterialVersion,
  listOwnerMaterials,
  uploadMaterialFile,
  type UploadedMaterial,
  type MaterialContentVersion,
} from '../../api/materials';
import {
  listCustomerRightsHolders,
  type RightsHolderSummary,
} from '../../api/rights-holders';
import {
  createRightAsset,
  getRightAsset,
  listRightAssets,
  reviseRightAsset,
  withdrawRightAsset,
  type RightAssetDetail,
  type RightAssetFields,
  type RightAssetSummary,
  type RightAssetType,
  type WriteRightAssetInput,
} from '../../api/right-assets';
import type {
  PendingRightAssetCommand,
  RightAssetRecoverySnapshot,
} from './customer-right-assets-recovery';

const props = defineProps<{
  customerId: string;
  customerVersion: number;
  canEdit: boolean;
  actorUserId: string;
  actorDepartmentId: string;
  actorKey: string;
  blockedByOtherMaintenance: boolean;
  recoverySnapshot?: RightAssetRecoverySnapshot;
}>();
const emit = defineEmits<{
  'version-updated': [customerId: string, version: number];
  'refresh-requested': [customerId: string];
  'customer-not-found': [customerId: string];
  'maintenance-pending': [
    customerId: string,
    actorKey: string,
    pending: boolean,
  ];
  'recovery-snapshot': [
    customerId: string,
    actorKey: string,
    snapshot: RightAssetRecoverySnapshot | null,
  ];
}>();

const state = ref<'loading' | 'ready' | 'failed'>('loading');
const items = ref<RightAssetSummary[]>([]);
const total = ref(0);
const page = ref(1);
const canCreate = ref(false);
const holders = ref<RightsHolderSummary[]>([]);
const holderLoading = ref(false);
const detail = ref<RightAssetDetail>();
const availableEvidence = ref<MaterialContentVersion[]>([]);
const selectedEvidenceIds = ref<string[]>([]);
const uploadFile = ref<globalThis.File>();
const uploading = ref(false);
const uploadMessage = ref('');
type BatchRow = {
  id: string;
  selected: boolean;
  fields: RightAssetFields;
  file?: globalThis.File;
  uploaded?: UploadedMaterial;
  uploadStatus: 'idle' | 'uploading' | 'uploaded' | 'failed' | 'unknown';
  recoveryEvidence?: MaterialContentVersion[];
  recoveryRefreshing?: boolean;
  registrationStatus:
    'draft' | 'registering' | 'registered' | 'failed' | 'unknown' | 'conflict';
  error: string;
  pending?: { body: WriteRightAssetInput; key: string };
};
const batchRegistrationLabels: Record<BatchRow['registrationStatus'], string> =
  {
    draft: '待确认',
    registering: '登记中',
    registered: '已登记',
    failed: '登记失败',
    unknown: '结果未知',
    conflict: '版本冲突',
  };
const batchOpen = ref(false);
const batchRows = ref<BatchRow[]>([]);
const batchSaving = ref(false);
const batchHalt = ref<'none' | 'unknown' | 'conflict' | 'permission'>('none');
const batchCustomerVersion = ref<number>();
const mode = ref<'closed' | 'create' | 'revise'>('closed');
const saving = ref(false);
const errorMessage = ref('');
const conflict = ref(false);
const conflictDetailReady = ref(false);
const withdrawOpen = ref(false);
const withdrawReason = ref('');
const writeDenied = ref(false);
const unknownOutcome = ref(false);
const singleUploadUnknown = ref(false);
const singleRecoveryEvidence = ref<MaterialContentVersion[]>([]);
const verifiedRecoveryIds = ref<string[]>([]);
const recoveryRefreshing = ref(false);
const draftOrigin = ref<{
  customerVersion: number;
  assetVersion: number;
  fields: RightAssetFields;
}>();
const confirmedCustomerVersion = ref<number>();
let request: AbortController | undefined;
let detailRequest: AbortController | undefined;
let customerRefreshRequest: AbortController | undefined;
let holderRequest: AbortController | undefined;
let detailSequence = 0;
let pending: PendingRightAssetCommand | undefined;
let generation = 0;
let publishedRecovery = false;
let recoveryRestored = false;

const hasUnknownWork = computed(
  () =>
    unknownOutcome.value ||
    singleUploadUnknown.value ||
    uploading.value ||
    (saving.value && !!pending) ||
    batchHalt.value === 'unknown' ||
    batchRows.value.some(
      (row) =>
        row.uploadStatus === 'unknown' ||
        row.uploadStatus === 'uploading' ||
        row.registrationStatus === 'unknown' ||
        row.registrationStatus === 'registering',
    ),
);
const ordinaryWritesBlocked = computed(
  () =>
    props.blockedByOtherMaintenance ||
    hasUnknownWork.value ||
    holderLoading.value,
);
watch(
  hasUnknownWork,
  (pending) => {
    emit('maintenance-pending', props.customerId, props.actorKey, pending);
    if (pending) {
      publishedRecovery = true;
      emit(
        'recovery-snapshot',
        props.customerId,
        props.actorKey,
        makeRecoverySnapshot(),
      );
    } else if (publishedRecovery) {
      publishedRecovery = false;
      emit('recovery-snapshot', props.customerId, props.actorKey, null);
    }
  },
  { immediate: true, flush: 'sync' },
);

function emptyFields(): RightAssetFields {
  return {
    type: 'TRADEMARK',
    name: '',
    number: null,
    category: '',
    holderId: '',
    ownerText: null,
    trademarkClass: null,
    validFrom: null,
    validTo: null,
    validityMode: 'UNKNOWN',
  };
}
function addBatchRow(): void {
  if (
    ordinaryWritesBlocked.value ||
    batchSaving.value ||
    batchHalt.value !== 'none' ||
    batchRows.value.filter((row) => row.registrationStatus !== 'registered')
      .length >= 10
  )
    return;
  batchRows.value = batchRows.value.filter(
    (row) => row.registrationStatus !== 'registered',
  );
  batchRows.value.push({
    id: globalThis.crypto.randomUUID(),
    selected: false,
    fields: emptyFields(),
    uploadStatus: 'idle',
    registrationStatus: 'draft',
    error: '',
  });
}
function openBatch(): void {
  if (
    ordinaryWritesBlocked.value ||
    !canCreate.value ||
    !props.canEdit ||
    writeDenied.value
  )
    return;
  batchOpen.value = true;
  if (batchRows.value.length === 0) addBatchRow();
  void refreshHolderOptions();
}
function chooseBatchFile(row: BatchRow, event: globalThis.Event): void {
  if (!canChooseBatchFile(row)) return;
  row.file = (event.target as globalThis.HTMLInputElement).files?.[0];
  row.uploaded = undefined;
  row.uploadStatus = 'idle';
  row.pending = undefined;
  row.registrationStatus = 'draft';
  row.error = '';
}
function canChooseBatchFile(row: BatchRow): boolean {
  return (
    !batchSaving.value &&
    !ordinaryWritesBlocked.value &&
    batchHalt.value === 'none' &&
    !writeDenied.value &&
    !row.uploaded &&
    !row.pending &&
    (row.uploadStatus === 'idle' || row.uploadStatus === 'failed') &&
    (row.registrationStatus === 'draft' || row.registrationStatus === 'failed')
  );
}
function canUploadBatchRow(row: BatchRow): boolean {
  return !!row.file && canChooseBatchFile(row);
}
async function uploadBatchRow(row: BatchRow): Promise<void> {
  const file = row.file;
  if (!file || !canUploadBatchRow(row)) return;
  const ownGeneration = generation;
  row.uploadStatus = 'uploading';
  row.error = '';
  try {
    const uploaded = await uploadMaterialFile({
      ownerType: 'CUSTOMER',
      ownerId: props.customerId,
      category: 'CUSTOMER_RIGHT_EVIDENCE',
      purpose: 'CUSTOMER_RIGHT_EVIDENCE',
      file,
    });
    if (ownGeneration !== generation) return;
    row.uploaded = uploaded;
    row.uploadStatus = 'uploaded';
    row.error = '上传成功，尚未登记';
  } catch (error) {
    if (ownGeneration !== generation) return;
    row.uploadStatus = isUnknownOutcome(error) ? 'unknown' : 'failed';
    row.error =
      row.uploadStatus === 'unknown'
        ? '上传结果未知，可能已占用待登记名额。请刷新证明池、下载核对，并人工选用已存在的证明；不要再次上传。'
        : message(error);
    if (isCode(error, 'ACTION_FORBIDDEN') || isCode(error, 'FORBIDDEN')) {
      writeDenied.value = true;
      batchHalt.value = 'permission';
    }
  }
}
async function refreshBatchEvidence(row: BatchRow): Promise<void> {
  if (
    props.blockedByOtherMaintenance ||
    row.uploadStatus !== 'unknown' ||
    row.pending ||
    row.recoveryRefreshing ||
    batchSaving.value ||
    batchHalt.value !== 'none' ||
    writeDenied.value
  )
    return;
  const ownGeneration = generation;
  row.recoveryRefreshing = true;
  verifiedRecoveryIds.value = [];
  try {
    const customerId = props.customerId;
    const materials = await listOwnerMaterials('CUSTOMER', customerId);
    if (ownGeneration !== generation) return;
    row.recoveryEvidence = materials.items
      .filter(
        (item) =>
          item.ownerType === 'CUSTOMER' &&
          item.ownerId === customerId &&
          item.status === 'ACTIVE' &&
          item.category === 'CUSTOMER_RIGHT_EVIDENCE' &&
          item.purpose === 'CUSTOMER_RIGHT_EVIDENCE',
      )
      .flatMap((item) => item.contentVersions)
      .filter((proof) => proof.status === 'AVAILABLE');
    row.error =
      row.recoveryEvidence.length > 0
        ? '请下载核对文件内容，再明确选用对应的证明版本。'
        : '当前证明池没有可选版本；请联系管理员核对未知上传结果。';
  } catch (error) {
    if (ownGeneration === generation) row.error = message(error);
  } finally {
    if (ownGeneration === generation) row.recoveryRefreshing = false;
  }
}
function adoptBatchEvidence(
  row: BatchRow,
  proof: MaterialContentVersion,
): void {
  if (
    props.blockedByOtherMaintenance ||
    row.uploadStatus !== 'unknown' ||
    !row.recoveryEvidence?.some((candidate) => candidate.id === proof.id) ||
    !verifiedRecoveryIds.value.includes(proof.id) ||
    row.pending ||
    row.registrationStatus === 'registering' ||
    row.registrationStatus === 'unknown' ||
    row.registrationStatus === 'registered' ||
    batchSaving.value ||
    batchHalt.value !== 'none' ||
    writeDenied.value
  )
    return;
  row.uploaded = {
    materialId: proof.materialId,
    contentVersionId: proof.id,
    originalFilename: proof.originalFilename,
    purpose: 'CUSTOMER_RIGHT_EVIDENCE',
    mimeType: proof.mimeType,
    sizeBytes: proof.sizeBytes,
    sha256: proof.sha256,
  };
  row.uploadStatus = 'uploaded';
  row.registrationStatus = 'draft';
  row.error = `已人工选用证明 ${proof.originalFilename}；尚未登记。`;
}
function normalizedBatchFields(row: BatchRow): RightAssetFields {
  return {
    ...row.fields,
    name: row.fields.name.trim(),
    category: row.fields.category.trim(),
    number: row.fields.number?.trim() || null,
    ownerText: row.fields.ownerText?.trim() || null,
    trademarkClass: row.fields.trademarkClass?.trim() || null,
    validFrom: row.fields.validFrom || null,
    validTo:
      row.fields.validityMode === 'FIXED' ? row.fields.validTo || null : null,
  };
}
async function submitBatch(): Promise<void> {
  if (ordinaryWritesBlocked.value) return;
  await executeBatch();
}
async function executeBatch(recoverUnknown = false): Promise<void> {
  if (
    props.blockedByOtherMaintenance ||
    batchSaving.value ||
    batchHalt.value !== 'none' ||
    (!recoverUnknown && hasUnknownWork.value)
  )
    return;
  const selected = batchRows.value
    .filter((row) =>
      recoverUnknown
        ? row.registrationStatus === 'unknown'
        : row.selected && row.registrationStatus !== 'registered',
    )
    .sort(
      (left, right) =>
        Number(right.registrationStatus === 'unknown') -
        Number(left.registrationStatus === 'unknown'),
    );
  if (selected.length === 0) return;
  const ownGeneration = generation;
  batchSaving.value = true;
  let nextVersion = batchCustomerVersion.value ?? effectiveCustomerVersion();
  try {
    for (const row of selected) {
      if (ownGeneration !== generation) return;
      const wasUnknown = row.registrationStatus === 'unknown';
      const fields = normalizedBatchFields(row);
      if (
        !fields.name ||
        !fields.category ||
        !fields.holderId ||
        (fields.validityMode === 'FIXED' && !fields.validTo) ||
        !row.uploaded
      ) {
        row.registrationStatus = 'failed';
        row.error =
          '请上传真实证明并填写类型、名称、类别、关联主体及真实期限。';
        continue;
      }
      if (!row.pending)
        row.pending = {
          body: {
            ...fields,
            expectedCustomerVersion: nextVersion,
            contentVersionIds: [row.uploaded.contentVersionId],
          },
          key: globalThis.crypto.randomUUID(),
        };
      row.registrationStatus = 'registering';
      try {
        const result = await createRightAsset(
          props.customerId,
          row.pending.body,
          row.pending.key,
        );
        if (ownGeneration !== generation) return;
        row.registrationStatus = 'registered';
        row.error = '登记成功';
        row.pending = undefined;
        row.selected = false;
        nextVersion = result.customerVersion;
        batchCustomerVersion.value = nextVersion;
        emit('version-updated', props.customerId, nextVersion);
      } catch (error) {
        if (ownGeneration !== generation) return;
        row.error = message(error);
        if (wasUnknown) {
          row.registrationStatus = 'unknown';
          row.error = `本次重试被拒绝：${message(error)}；原请求结果仍未知。`;
          batchHalt.value = 'unknown';
          break;
        }
        if (isUnknownOutcome(error)) {
          row.registrationStatus = 'unknown';
          row.error = '结果未知；必须用原内容和幂等键先重试此行。';
          batchHalt.value = 'unknown';
          break;
        }
        row.pending = undefined;
        if (error instanceof ApiError && error.status === 409) {
          row.registrationStatus = 'conflict';
          batchHalt.value = 'conflict';
          break;
        }
        row.registrationStatus = 'failed';
        if (error instanceof ApiError && error.status === 403) {
          batchHalt.value = 'permission';
          writeDenied.value = true;
          break;
        }
      }
    }
    if (ownGeneration === generation && batchHalt.value === 'none')
      await load(1);
  } finally {
    if (ownGeneration === generation) batchSaving.value = false;
  }
}
async function retryBatchUnknown(): Promise<void> {
  if (props.blockedByOtherMaintenance || batchHalt.value !== 'unknown') return;
  const row = batchRows.value.find(
    (candidate) => candidate.registrationStatus === 'unknown',
  );
  if (!row?.pending) return;
  row.selected = true;
  batchHalt.value = 'none';
  await executeBatch(true);
}
async function refreshBatchConflict(): Promise<void> {
  if (batchHalt.value !== 'conflict' || batchSaving.value) return;
  const ownGeneration = generation;
  try {
    const customer = await getCustomer(props.customerId);
    if (ownGeneration !== generation) return;
    await load(1);
    if (state.value !== 'ready' || ownGeneration !== generation) return;
    batchCustomerVersion.value = customer.version;
    batchRows.value.forEach((row) => {
      if (row.registrationStatus === 'conflict') {
        row.registrationStatus = 'failed';
        row.pending = undefined;
        row.error = '已刷新版本；请核对草稿，再次确认登记。';
      }
    });
    batchHalt.value = 'none';
    emit('refresh-requested', props.customerId);
  } catch (error) {
    errorMessage.value = message(error);
  }
}
const form = ref<RightAssetFields>(emptyFields());
function clonePendingCommand(
  command: PendingRightAssetCommand,
): PendingRightAssetCommand {
  if (command.action === 'WITHDRAW')
    return { ...command, body: { ...command.body } };
  if (command.action === 'CREATE')
    return {
      ...command,
      body: {
        ...command.body,
        contentVersionIds: command.body.contentVersionIds
          ? [...command.body.contentVersionIds]
          : undefined,
      },
    };
  return {
    ...command,
    body: {
      ...command.body,
      contentVersionIds: command.body.contentVersionIds
        ? [...command.body.contentVersionIds]
        : undefined,
    },
  };
}
function makeRecoverySnapshot(): RightAssetRecoverySnapshot {
  const command = pending ? clonePendingCommand(pending) : undefined;
  const singleUpload =
    singleUploadUnknown.value || uploading.value
      ? {
          mode:
            mode.value === 'revise' ? ('revise' as const) : ('create' as const),
          fields: { ...form.value },
          selectedEvidenceIds: [...selectedEvidenceIds.value],
          detailAssetId: detail.value?.assetId,
          draftOrigin: draftOrigin.value
            ? { ...draftOrigin.value, fields: { ...draftOrigin.value.fields } }
            : undefined,
        }
      : undefined;
  const batch =
    batchHalt.value === 'unknown' ||
    batchRows.value.some(
      (row) =>
        ['unknown', 'uploading'].includes(row.uploadStatus) ||
        ['unknown', 'registering'].includes(row.registrationStatus),
    )
      ? {
          rows: batchRows.value.map((row) => ({
            id: row.id,
            selected: row.selected,
            fields: { ...row.fields },
            uploaded: row.uploaded ? { ...row.uploaded } : undefined,
            uploadStatus:
              row.uploadStatus === 'uploading'
                ? ('unknown' as const)
                : row.uploadStatus,
            registrationStatus:
              row.registrationStatus === 'registering'
                ? ('unknown' as const)
                : row.registrationStatus,
            error: row.error,
            pending: row.pending
              ? {
                  key: row.pending.key,
                  body: {
                    ...row.pending.body,
                    contentVersionIds: row.pending.body.contentVersionIds
                      ? [...row.pending.body.contentVersionIds]
                      : undefined,
                  },
                }
              : undefined,
          })),
          customerVersion: batchCustomerVersion.value,
          halt:
            batchHalt.value === 'unknown' ||
            batchRows.value.some((row) =>
              ['unknown', 'registering'].includes(row.registrationStatus),
            )
              ? ('unknown' as const)
              : ('none' as const),
        }
      : undefined;
  return {
    customerId: props.customerId,
    userId: props.actorUserId,
    departmentId: props.actorDepartmentId,
    command,
    singleUpload,
    batch,
  };
}
async function restoreRecoverySnapshot(
  snapshot: RightAssetRecoverySnapshot,
): Promise<void> {
  if (
    snapshot.customerId !== props.customerId ||
    snapshot.userId !== props.actorUserId ||
    snapshot.departmentId !== props.actorDepartmentId
  )
    return;
  const ownGeneration = generation;
  if (
    snapshot.singleUpload?.mode === 'revise' &&
    snapshot.singleUpload.detailAssetId
  ) {
    const found = await openDetail(snapshot.singleUpload.detailAssetId, true);
    if (!found || ownGeneration !== generation) return;
  }
  pending = snapshot.command;
  unknownOutcome.value = !!snapshot.command;
  if (snapshot.singleUpload) {
    mode.value = snapshot.singleUpload.mode;
    form.value = { ...snapshot.singleUpload.fields };
    selectedEvidenceIds.value = [...snapshot.singleUpload.selectedEvidenceIds];
    draftOrigin.value = snapshot.singleUpload.draftOrigin
      ? {
          ...snapshot.singleUpload.draftOrigin,
          fields: { ...snapshot.singleUpload.draftOrigin.fields },
        }
      : undefined;
    singleUploadUnknown.value = true;
    uploadMessage.value =
      '上传结果未知。请刷新证明池、下载核对精确版本后明确选用。';
  }
  if (snapshot.batch) {
    batchOpen.value = true;
    batchRows.value = snapshot.batch.rows.map((row) => ({
      ...row,
      fields: { ...row.fields },
      uploaded: row.uploaded ? { ...row.uploaded } : undefined,
      pending: row.pending
        ? { key: row.pending.key, body: { ...row.pending.body } }
        : undefined,
    }));
    batchHalt.value = snapshot.batch.halt;
    batchCustomerVersion.value = snapshot.batch.customerVersion;
  }
}
const numberText = computed({
  get: () => form.value.number ?? '',
  set: (value: string) => {
    form.value.number = value;
  },
});
const ownerText = computed({
  get: () => form.value.ownerText ?? '',
  set: (value: string) => {
    form.value.ownerText = value;
  },
});
const trademarkClass = computed({
  get: () => form.value.trademarkClass ?? '',
  set: (value: string) => {
    form.value.trademarkClass = value;
  },
});
const validFrom = computed({
  get: () => form.value.validFrom ?? '',
  set: (value: string) => {
    form.value.validFrom = value;
  },
});
const validTo = computed({
  get: () => form.value.validTo ?? '',
  set: (value: string) => {
    form.value.validTo = value;
  },
});

const typeLabels: Record<RightAssetType, string> = {
  TRADEMARK: '商标',
  PATENT: '专利',
  COPYRIGHT: '著作权',
  REPUTATION: '知名度证据',
  AUTHORIZATION: '授权书',
  OTHER: '其他',
};
function todayShanghai(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}
function termLabel(fields: RightAssetFields): string {
  if (fields.validFrom && fields.validFrom > todayShanghai())
    return `登记起始日未到：${fields.validFrom}`;
  if (fields.validityMode === 'LONG_TERM')
    return '人工登记为长期，未核验法律效力';
  if (fields.validityMode === 'UNKNOWN') return '截止日期未知，未核验法律效力';
  if (fields.validTo && fields.validTo < todayShanghai())
    return `登记截止日已过：${fields.validTo}；未核验法律效力`;
  return `登记截止日：${fields.validTo ?? '未知'}；未核验法律效力`;
}
function message(error: unknown): string {
  return error instanceof ApiError
    ? error.message
    : '请求结果未知。请保留当前内容并用原请求重试。';
}
function isCode(error: unknown, code: string): boolean {
  return error instanceof ApiError && error.code === code;
}
function isUnknownOutcome(error: unknown): boolean {
  return (
    !(error instanceof ApiError) ||
    error.status >= 500 ||
    ['TIMEOUT', 'NETWORK_ERROR', 'INVALID_RESPONSE'].includes(error.code)
  );
}
function effectiveCustomerVersion(): number {
  return Math.max(props.customerVersion, confirmedCustomerVersion.value ?? 0);
}
function invalidateDetailRequest(): void {
  detailRequest?.abort();
  detailSequence += 1;
}
const canReviseDraft = computed(
  () =>
    mode.value !== 'revise' ||
    !!(
      detail.value?.capabilities.revise &&
      !detail.value.withdrawn &&
      !writeDenied.value
    ),
);
const changedFacts = computed(() => {
  if (
    mode.value !== 'revise' ||
    !draftOrigin.value ||
    !detail.value ||
    detail.value.version === draftOrigin.value.assetVersion
  )
    return [];
  const labels: Partial<Record<keyof RightAssetFields, string>> = {
    type: '类型',
    name: '名称',
    number: '号码',
    category: '类别',
    holderId: '权利主体',
    ownerText: '权利人文字',
    trademarkClass: '商标分类',
    validFrom: '起始日期',
    validTo: '截止日期',
    validityMode: '期限模式',
  };
  return (Object.keys(labels) as (keyof RightAssetFields)[])
    .filter(
      (key) => draftOrigin.value!.fields[key] !== detail.value!.fields[key],
    )
    .map(
      (key) =>
        `${labels[key]}：原版 ${draftOrigin.value!.fields[key] ?? '未填写'}；最新版 ${detail.value!.fields[key] ?? '未填写'}；草稿 ${form.value[key] ?? '未填写'}`,
    );
});

async function load(nextPage = page.value): Promise<void> {
  request?.abort();
  const controller = new AbortController();
  request = controller;
  const ownGeneration = generation;
  state.value = 'loading';
  try {
    const [assets, allHolders, materials] = await Promise.all([
      listRightAssets(props.customerId, nextPage, 20, {
        signal: controller.signal,
      }),
      loadHolders(props.customerId, controller.signal),
      listOwnerMaterials('CUSTOMER', props.customerId, {
        signal: controller.signal,
      }),
    ]);
    if (controller.signal.aborted || ownGeneration !== generation) return;
    items.value = assets.items;
    total.value = assets.total;
    page.value = assets.page;
    canCreate.value = assets.capabilities.create;
    holders.value = allHolders;
    availableEvidence.value = materials.items
      .filter((item) => item.category === 'CUSTOMER_RIGHT_EVIDENCE')
      .flatMap((item) => item.contentVersions);
    state.value = 'ready';
    if (!recoveryRestored) {
      recoveryRestored = true;
      if (props.recoverySnapshot)
        await restoreRecoverySnapshot(props.recoverySnapshot);
    }
  } catch (error) {
    if (controller.signal.aborted || ownGeneration !== generation) return;
    if (isCode(error, 'CUSTOMER_NOT_FOUND'))
      emit('customer-not-found', props.customerId);
    state.value = 'failed';
  }
}
async function loadHolders(
  customerId: string,
  signal: AbortController['signal'],
): Promise<RightsHolderSummary[]> {
  const all: RightsHolderSummary[] = [];
  for (let index = 1; index <= 100; index += 1) {
    const result = await listCustomerRightsHolders(customerId, index, 100, {
      signal,
    });
    all.push(...result.items);
    if (all.length >= result.total) break;
  }
  return all;
}
async function refreshHolderOptions(): Promise<void> {
  holderRequest?.abort();
  const controller = new AbortController();
  holderRequest = controller;
  const ownGeneration = generation;
  const customerId = props.customerId;
  const actorKey = props.actorKey;
  holders.value = [];
  holderLoading.value = true;
  try {
    const currentHolders = await loadHolders(customerId, controller.signal);
    if (
      controller.signal.aborted ||
      ownGeneration !== generation ||
      customerId !== props.customerId ||
      actorKey !== props.actorKey
    )
      return;
    holders.value = currentHolders;
  } catch (error) {
    if (
      controller.signal.aborted ||
      ownGeneration !== generation ||
      customerId !== props.customerId ||
      actorKey !== props.actorKey
    )
      return;
    errorMessage.value = `权利主体读取失败：${message(error)}`;
  } finally {
    if (holderRequest === controller) {
      holderRequest = undefined;
      holderLoading.value = false;
    }
  }
}
async function openDetail(
  assetId: string,
  preserveDraft = false,
): Promise<boolean> {
  if (unknownOutcome.value) return false;
  detailRequest?.abort();
  const controller = new AbortController();
  detailRequest = controller;
  const sequence = ++detailSequence;
  const ownGeneration = generation;
  errorMessage.value = '';
  try {
    const result = await getRightAsset(props.customerId, assetId, {
      signal: controller.signal,
    });
    if (
      controller.signal.aborted ||
      ownGeneration !== generation ||
      sequence !== detailSequence
    )
      return false;
    detail.value = result;
    if (!preserveDraft) {
      mode.value = 'closed';
      withdrawOpen.value = false;
      conflict.value = false;
      conflictDetailReady.value = false;
      confirmedCustomerVersion.value = undefined;
      draftOrigin.value = undefined;
    }
    return true;
  } catch (error) {
    if (
      controller.signal.aborted ||
      ownGeneration !== generation ||
      sequence !== detailSequence
    )
      return false;
    errorMessage.value = message(error);
    return false;
  }
}
function openCreate(): void {
  if (ordinaryWritesBlocked.value || saving.value) return;
  invalidateDetailRequest();
  form.value = emptyFields();
  selectedEvidenceIds.value = [];
  uploadFile.value = undefined;
  uploadMessage.value = '';
  mode.value = 'create';
  detail.value = undefined;
  withdrawOpen.value = false;
  errorMessage.value = '';
  conflict.value = false;
  conflictDetailReady.value = false;
  confirmedCustomerVersion.value = undefined;
  draftOrigin.value = undefined;
  void refreshHolderOptions();
}
function openRevise(): void {
  if (
    ordinaryWritesBlocked.value ||
    !detail.value ||
    unknownOutcome.value ||
    saving.value
  )
    return;
  invalidateDetailRequest();
  const fields = detail.value.fields;
  form.value = {
    type: fields.type,
    name: fields.name,
    number: fields.number,
    category: fields.category,
    holderId: fields.holderId,
    ownerText: fields.ownerText,
    trademarkClass: fields.trademarkClass,
    validFrom: fields.validFrom,
    validTo: fields.validTo,
    validityMode: fields.validityMode,
  };
  selectedEvidenceIds.value = fields.evidence.map(
    (item) => item.contentVersionId,
  );
  uploadFile.value = undefined;
  uploadMessage.value = '';
  mode.value = 'revise';
  draftOrigin.value = {
    customerVersion: props.customerVersion,
    assetVersion: detail.value.version,
    fields: { ...form.value },
  };
  errorMessage.value = '';
  conflict.value = false;
  conflictDetailReady.value = false;
  confirmedCustomerVersion.value = undefined;
}
function openWithdraw(): void {
  if (
    !detail.value?.capabilities.withdraw ||
    ordinaryWritesBlocked.value ||
    detail.value.withdrawn ||
    unknownOutcome.value ||
    saving.value ||
    writeDenied.value
  )
    return;
  withdrawOpen.value = true;
  conflict.value = false;
}
function cancelDraft(): void {
  if (ordinaryWritesBlocked.value || saving.value) return;
  invalidateDetailRequest();
  mode.value = 'closed';
  uploadFile.value = undefined;
  pending = undefined;
  conflict.value = false;
  conflictDetailReady.value = false;
  confirmedCustomerVersion.value = undefined;
  draftOrigin.value = undefined;
}
function chooseUpload(event: globalThis.Event): void {
  if (ordinaryWritesBlocked.value || uploading.value || saving.value) return;
  uploadFile.value = (event.target as globalThis.HTMLInputElement).files?.[0];
}
async function uploadEvidence(): Promise<void> {
  const file = uploadFile.value;
  if (
    !file ||
    mode.value === 'closed' ||
    uploading.value ||
    writeDenied.value ||
    ordinaryWritesBlocked.value
  )
    return;
  const ownGeneration = generation;
  uploading.value = true;
  uploadMessage.value = '';
  try {
    const uploaded: UploadedMaterial = await uploadMaterialFile({
      ownerType: 'CUSTOMER',
      ownerId: props.customerId,
      category: 'CUSTOMER_RIGHT_EVIDENCE',
      purpose: 'CUSTOMER_RIGHT_EVIDENCE',
      file,
    });
    if (ownGeneration !== generation) return;
    availableEvidence.value = [
      ...availableEvidence.value,
      {
        id: uploaded.contentVersionId,
        materialId: uploaded.materialId,
        originalFilename: uploaded.originalFilename,
        mimeType: uploaded.mimeType,
        sizeBytes: uploaded.sizeBytes,
        sha256: uploaded.sha256,
        status: 'AVAILABLE',
        createdAt: new Date().toISOString(),
      },
    ];
    selectedEvidenceIds.value = [
      ...new Set([...selectedEvidenceIds.value, uploaded.contentVersionId]),
    ];
    uploadMessage.value = '上传成功，尚未登记';
    singleUploadUnknown.value = false;
    singleRecoveryEvidence.value = [];
    verifiedRecoveryIds.value = [];
    uploadFile.value = undefined;
  } catch (error) {
    if (ownGeneration !== generation) return;
    uploadMessage.value = message(error);
    if (isUnknownOutcome(error)) singleUploadUnknown.value = true;
    if (isCode(error, 'ACTION_FORBIDDEN') || isCode(error, 'FORBIDDEN'))
      writeDenied.value = true;
  } finally {
    if (ownGeneration === generation) uploading.value = false;
  }
}
async function refreshSingleEvidence(): Promise<void> {
  if (
    !singleUploadUnknown.value ||
    props.blockedByOtherMaintenance ||
    recoveryRefreshing.value ||
    writeDenied.value
  )
    return;
  const ownGeneration = generation;
  const customerId = props.customerId;
  recoveryRefreshing.value = true;
  verifiedRecoveryIds.value = [];
  try {
    const materials = await listOwnerMaterials('CUSTOMER', customerId);
    if (ownGeneration !== generation) return;
    singleRecoveryEvidence.value = materials.items
      .filter(
        (item) =>
          item.ownerType === 'CUSTOMER' &&
          item.ownerId === customerId &&
          item.category === 'CUSTOMER_RIGHT_EVIDENCE' &&
          item.purpose === 'CUSTOMER_RIGHT_EVIDENCE' &&
          item.status === 'ACTIVE',
      )
      .flatMap((item) => item.contentVersions)
      .filter((proof) => proof.status === 'AVAILABLE');
    uploadMessage.value = singleRecoveryEvidence.value.length
      ? '请下载核对精确文件版本，再明确选用。'
      : '证明池没有可核对版本；未知结果保留，请联系管理员核查。';
  } catch (error) {
    if (ownGeneration === generation) uploadMessage.value = message(error);
  } finally {
    if (ownGeneration === generation) recoveryRefreshing.value = false;
  }
}
async function verifyRecoveryEvidence(
  proof: MaterialContentVersion,
): Promise<void> {
  const ownGeneration = generation;
  try {
    await downloadMaterialVersion(proof.materialId, proof.id);
    if (ownGeneration === generation)
      verifiedRecoveryIds.value = [
        ...new Set([...verifiedRecoveryIds.value, proof.id]),
      ];
  } catch (error) {
    if (ownGeneration === generation) uploadMessage.value = message(error);
  }
}
function adoptSingleEvidence(proof: MaterialContentVersion): void {
  if (
    !singleUploadUnknown.value ||
    props.blockedByOtherMaintenance ||
    writeDenied.value ||
    recoveryRefreshing.value ||
    !singleRecoveryEvidence.value.some(
      (candidate) => candidate.id === proof.id,
    ) ||
    !verifiedRecoveryIds.value.includes(proof.id) ||
    selectedEvidenceIds.value.length >= 10
  )
    return;
  availableEvidence.value = [
    ...availableEvidence.value.filter((item) => item.id !== proof.id),
    proof,
  ];
  selectedEvidenceIds.value = [
    ...new Set([...selectedEvidenceIds.value, proof.id]),
  ];
  singleUploadUnknown.value = false;
  singleRecoveryEvidence.value = [];
  verifiedRecoveryIds.value = [];
  uploadFile.value = undefined;
  uploadMessage.value = `已人工选用证明 ${proof.originalFilename}；尚未登记。`;
}
async function downloadEvidence(
  materialId: string,
  contentVersionId: string,
): Promise<void> {
  const ownGeneration = generation;
  try {
    await downloadMaterialVersion(materialId, contentVersionId);
  } catch (error) {
    if (ownGeneration === generation) errorMessage.value = message(error);
  }
}
async function refreshAfterConflict(): Promise<void> {
  if (unknownOutcome.value || saving.value) return;
  customerRefreshRequest?.abort();
  const controller = new AbortController();
  customerRefreshRequest = controller;
  const ownGeneration = generation;
  const customerId = props.customerId;
  pending = undefined;
  errorMessage.value = '正在刷新最新版本，草稿保持不变。';
  emit('refresh-requested', props.customerId);
  let currentCustomer;
  try {
    currentCustomer = await getCustomer(customerId, {
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted || ownGeneration !== generation) return;
    if (isCode(error, 'CUSTOMER_NOT_FOUND'))
      emit('customer-not-found', customerId);
    errorMessage.value = message(error);
    return;
  }
  if (
    controller.signal.aborted ||
    ownGeneration !== generation ||
    !conflict.value
  )
    return;
  await load();
  if (
    controller.signal.aborted ||
    ownGeneration !== generation ||
    !conflict.value
  )
    return;
  const refreshed = detail.value
    ? await openDetail(detail.value.assetId, true)
    : state.value === 'ready';
  if (
    !refreshed ||
    controller.signal.aborted ||
    ownGeneration !== generation ||
    !conflict.value
  )
    return;
  if (
    (mode.value === 'create' &&
      (!canCreate.value || !currentCustomer.capabilities.editRoutine)) ||
    (mode.value === 'revise' && !currentCustomer.capabilities.editRoutine) ||
    (mode.value === 'revise' && !canReviseDraft.value) ||
    (withdrawOpen.value && !detail.value?.capabilities.withdraw)
  ) {
    errorMessage.value = '最新资产已撤下或当前权限不足；原草稿保留供核对。';
    return;
  }
  confirmedCustomerVersion.value = currentCustomer.version;
  conflictDetailReady.value = true;
  conflict.value = false;
  errorMessage.value = '请核对最新事实与原草稿，再次明确提交。';
}
function normalizedForm(): RightAssetFields {
  return {
    ...form.value,
    name: form.value.name.trim(),
    category: form.value.category.trim(),
    number: form.value.number?.trim() || null,
    ownerText: form.value.ownerText?.trim() || null,
    trademarkClass: form.value.trademarkClass?.trim() || null,
    validFrom: form.value.validFrom || null,
    validTo:
      form.value.validityMode === 'FIXED' ? form.value.validTo || null : null,
  };
}
async function submit(): Promise<void> {
  if (
    ordinaryWritesBlocked.value ||
    saving.value ||
    conflict.value ||
    unknownOutcome.value ||
    mode.value === 'closed' ||
    !canReviseDraft.value ||
    writeDenied.value
  )
    return;
  const fields = normalizedForm();
  if (
    !fields.name ||
    !fields.category ||
    !fields.holderId ||
    (fields.validityMode === 'FIXED' && !fields.validTo)
  ) {
    errorMessage.value = '请填写名称、类别、权利主体及固定期限的真实截止日期。';
    return;
  }
  const customerId = props.customerId;
  const selected = detail.value;
  if (mode.value === 'revise' && !selected) return;
  pending =
    mode.value === 'create'
      ? {
          action: 'CREATE',
          customerId,
          body: {
            ...fields,
            expectedCustomerVersion: effectiveCustomerVersion(),
            contentVersionIds: [...selectedEvidenceIds.value],
          },
          key: globalThis.crypto.randomUUID(),
        }
      : {
          action: 'REVISE',
          customerId,
          assetId: selected!.assetId,
          body: {
            ...fields,
            expectedCustomerVersion: effectiveCustomerVersion(),
            expectedAssetVersion: selected!.version,
            contentVersionIds: [...selectedEvidenceIds.value],
          },
          key: globalThis.crypto.randomUUID(),
        };
  await runCommand(pending);
}
async function submitWithdraw(): Promise<void> {
  if (
    ordinaryWritesBlocked.value ||
    !detail.value ||
    !detail.value.capabilities.withdraw ||
    detail.value.withdrawn ||
    !withdrawOpen.value ||
    saving.value ||
    conflict.value ||
    unknownOutcome.value ||
    writeDenied.value
  )
    return;
  const reason = withdrawReason.value.trim();
  if (!reason) {
    errorMessage.value = '请填写撤下原因。';
    return;
  }
  const selected = detail.value;
  const customerId = props.customerId;
  pending = {
    action: 'WITHDRAW',
    customerId,
    assetId: selected.assetId,
    body: {
      expectedCustomerVersion: effectiveCustomerVersion(),
      expectedAssetVersion: selected.version,
      reason,
    },
    key: globalThis.crypto.randomUUID(),
  };
  await runCommand(pending);
}
async function retryUnknown(): Promise<void> {
  if (
    props.blockedByOtherMaintenance ||
    !unknownOutcome.value ||
    !pending ||
    saving.value
  )
    return;
  await runCommand(pending);
}
async function runCommand(command: PendingRightAssetCommand): Promise<void> {
  const ownGeneration = generation;
  const wasUnknown = unknownOutcome.value;
  saving.value = true;
  errorMessage.value = '';
  let result;
  try {
    result =
      command.action === 'CREATE'
        ? await createRightAsset(command.customerId, command.body, command.key)
        : command.action === 'REVISE'
          ? await reviseRightAsset(
              command.customerId,
              command.assetId,
              command.body,
              command.key,
            )
          : await withdrawRightAsset(
              command.customerId,
              command.assetId,
              command.body,
              command.key,
            );
  } catch (error) {
    if (ownGeneration !== generation) return;
    if (wasUnknown) {
      unknownOutcome.value = true;
      errorMessage.value = `本次重试被拒绝：${message(error)}；原请求结果仍未知。`;
      return;
    }
    if (isUnknownOutcome(error)) {
      unknownOutcome.value = true;
      errorMessage.value = '请求结果未知。请用原请求重试。';
      return;
    }
    pending = undefined;
    unknownOutcome.value = false;
    errorMessage.value = message(error);
    if (
      isCode(error, 'CUSTOMER_VERSION_CONFLICT') ||
      isCode(error, 'RIGHT_ASSET_VERSION_CONFLICT') ||
      isCode(error, 'IDEMPOTENCY_CONFLICT')
    ) {
      conflict.value = true;
      conflictDetailReady.value = false;
      confirmedCustomerVersion.value = undefined;
    }
    if (isCode(error, 'FORBIDDEN')) writeDenied.value = true;
    return;
  } finally {
    if (ownGeneration === generation) saving.value = false;
  }
  if (ownGeneration !== generation) return;
  pending = undefined;
  unknownOutcome.value = false;
  mode.value = 'closed';
  withdrawOpen.value = false;
  withdrawReason.value = '';
  conflict.value = false;
  conflictDetailReady.value = false;
  confirmedCustomerVersion.value = undefined;
  draftOrigin.value = undefined;
  emit('version-updated', command.customerId, result.customerVersion);
  try {
    await load(command.action === 'CREATE' ? 1 : page.value);
    if (ownGeneration !== generation) return;
    if (state.value !== 'ready') {
      errorMessage.value = '登记已成功，但列表刷新失败；请重试读取。';
      return;
    }
    if (!(await openDetail(result.assetId)) && ownGeneration === generation)
      errorMessage.value = '登记已成功，但详情刷新失败；请重试读取。';
  } catch (error) {
    if (ownGeneration === generation)
      errorMessage.value = `登记已成功，但刷新失败：${message(error)}`;
  }
}
watch(
  () => [
    props.customerId,
    props.actorUserId,
    props.actorDepartmentId,
    props.actorKey,
  ],
  (identity, previousIdentity) => {
    const sameActor =
      previousIdentity &&
      identity[0] === previousIdentity[0] &&
      identity[1] === previousIdentity[1] &&
      identity[2] === previousIdentity[2];
    const keepUnknown = sameActor && hasUnknownWork.value;
    recoveryRestored = !!keepUnknown;
    generation += 1;
    request?.abort();
    invalidateDetailRequest();
    customerRefreshRequest?.abort();
    holderRequest?.abort();
    holderLoading.value = false;
    items.value = [];
    availableEvidence.value = [];
    holders.value = [];
    if (!keepUnknown) {
      batchOpen.value = false;
      batchRows.value = [];
      batchHalt.value = 'none';
      batchCustomerVersion.value = undefined;
      selectedEvidenceIds.value = [];
      uploadFile.value = undefined;
      uploadMessage.value = '';
      singleUploadUnknown.value = false;
      singleRecoveryEvidence.value = [];
      verifiedRecoveryIds.value = [];
      mode.value = 'closed';
      pending = undefined;
      unknownOutcome.value = false;
    }
    recoveryRefreshing.value = false;
    uploading.value = false;
    batchSaving.value = false;
    saving.value = false;
    detail.value = undefined;
    draftOrigin.value = undefined;
    conflict.value = false;
    conflictDetailReady.value = false;
    confirmedCustomerVersion.value = undefined;
    writeDenied.value = false;
    withdrawOpen.value = false;
    emit(
      'maintenance-pending',
      props.customerId,
      props.actorKey,
      !!keepUnknown,
    );
    void load(1);
  },
  { immediate: true, flush: 'sync' },
);
onBeforeUnmount(() => {
  generation += 1;
  request?.abort();
  invalidateDetailRequest();
  customerRefreshRequest?.abort();
  holderRequest?.abort();
});
</script>

<template>
  <div class="right-assets-panel">
    <p
      v-if="blockedByOtherMaintenance"
      role="status"
      data-test="right-assets-frozen"
    >
      客户资料正在核对未确认的维护请求。权利资产保留在页面中，并暂时禁止写入。
    </p>
    <header class="right-assets-panel__header">
      <div>
        <h2>权利资产</h2>
        <p>人工登记事实与历史版本；期限提示不代表法律效力核验。</p>
      </div>
      <button
        v-if="state === 'ready' && canEdit && canCreate && !writeDenied"
        type="button"
        :disabled="ordinaryWritesBlocked || saving"
        @click="openCreate"
      >
        登记权利资产
      </button>
      <button
        v-if="state === 'ready' && canEdit && canCreate && !writeDenied"
        type="button"
        :disabled="ordinaryWritesBlocked || batchSaving"
        @click="openBatch"
      >
        批量上传权属
      </button>
    </header>
    <p v-if="state === 'loading'">正在读取权利资产…</p>
    <div v-else-if="state === 'failed'">
      <p>权利资产读取失败。</p>
      <button type="button" @click="load()">重试读取</button>
    </div>
    <template v-else>
      <p v-if="items.length === 0">暂无人工登记的权利资产。</p>
      <ul v-else class="right-assets-panel__list">
        <li v-for="asset in items" :key="asset.assetId">
          <button
            type="button"
            :disabled="saving || unknownOutcome"
            @click="openDetail(asset.assetId)"
          >
            {{ asset.fields.name }}
          </button>
          <span
            >{{ typeLabels[asset.fields.type] }} ·
            {{ asset.withdrawn ? '已撤下' : termLabel(asset.fields) }}</span
          >
        </li>
      </ul>
      <nav v-if="total > 20" aria-label="权利资产分页">
        <button type="button" :disabled="page <= 1" @click="load(page - 1)">
          上一页
        </button>
        <span>第 {{ page }} 页，共 {{ total }} 条</span>
        <button
          type="button"
          :disabled="page * 20 >= total"
          @click="load(page + 1)"
        >
          下一页
        </button>
      </nav>
    </template>
    <p v-if="errorMessage" role="alert">{{ errorMessage }}</p>
    <div v-if="unknownOutcome" role="group" aria-label="原请求待确认">
      <p>原请求可能已成功。重试将使用完全相同的内容和幂等键。</p>
      <button
        type="button"
        :disabled="blockedByOtherMaintenance || saving"
        @click="retryUnknown"
      >
        用原请求重试
      </button>
    </div>
    <button
      v-if="conflict && !unknownOutcome"
      type="button"
      @click="refreshAfterConflict"
    >
      明确刷新版本并核对草稿
    </button>
    <section
      v-if="detail"
      class="right-assets-panel__detail"
      aria-label="权利资产详情"
    >
      <h3>{{ detail.fields.name }} · 第 {{ detail.version }} 版</h3>
      <dl>
        <div>
          <dt>类别</dt>
          <dd>{{ detail.fields.category }}</dd>
        </div>
        <div>
          <dt>号码</dt>
          <dd>{{ detail.fields.number || '未知' }}</dd>
        </div>
        <div>
          <dt>权利主体</dt>
          <dd>
            {{
              holders.find((holder) => holder.id === detail?.fields.holderId)
                ?.name || detail.fields.holderId
            }}
          </dd>
        </div>
        <div>
          <dt>登记权利人文字</dt>
          <dd>{{ detail.fields.ownerText || '未填写' }}</dd>
        </div>
        <div>
          <dt>商标分类</dt>
          <dd>{{ detail.fields.trademarkClass || '未填写' }}</dd>
        </div>
        <div>
          <dt>期限</dt>
          <dd>{{ termLabel(detail.fields) }}</dd>
        </div>
      </dl>
      <p>识别状态：未识别，请人工填写</p>
      <section aria-label="当前权属证明">
        <h4>当前证明</h4>
        <p v-if="detail.fields.evidence.length === 0">暂无已登记证明</p>
        <ul v-else>
          <li
            v-for="proof in detail.fields.evidence"
            :key="proof.contentVersionId"
          >
            {{ proof.originalFilename }} · {{ proof.createdAt.slice(0, 10) }}
            <button
              type="button"
              @click="
                downloadEvidence(proof.materialId, proof.contentVersionId)
              "
            >
              下载
            </button>
          </li>
        </ul>
      </section>
      <button
        v-if="detail.capabilities.revise && canEdit && !writeDenied"
        type="button"
        :disabled="ordinaryWritesBlocked || saving"
        @click="openRevise"
      >
        修订字段
      </button>
      <button
        v-if="detail.capabilities.withdraw && !writeDenied"
        type="button"
        :disabled="ordinaryWritesBlocked || saving"
        @click="openWithdraw"
      >
        撤下资产
      </button>
      <div v-if="withdrawOpen">
        <label
          >撤下原因
          <input
            v-model="withdrawReason"
            maxlength="500"
            :disabled="ordinaryWritesBlocked || saving"
        /></label>
        <button
          type="button"
          :disabled="
            saving ||
            ordinaryWritesBlocked ||
            conflict ||
            unknownOutcome ||
            !detail.capabilities.withdraw ||
            detail.withdrawn ||
            writeDenied
          "
          @click="submitWithdraw"
        >
          确认撤下
        </button>
      </div>
      <details>
        <summary>历史版本 · {{ detail.history.length }} 条</summary>
        <ol>
          <li v-for="version in detail.history" :key="version.id">
            第 {{ version.version }} 版 ·
            {{
              version.action === 'CREATE'
                ? '登记'
                : version.action === 'REVISE'
                  ? '修订'
                  : '撤下'
            }}
            · {{ version.name }} · {{ version.number || '号码未知' }} ·
            {{ termLabel(version) }}
            <span v-if="version.withdrawReason">
              · 原因：{{ version.withdrawReason }}</span
            >
            <ul v-if="version.evidence.length">
              <li
                v-for="proof in version.evidence"
                :key="proof.contentVersionId"
              >
                {{ proof.originalFilename }} ·
                {{ proof.createdAt.slice(0, 10) }}
                <button
                  type="button"
                  @click="
                    downloadEvidence(proof.materialId, proof.contentVersionId)
                  "
                >
                  下载原版
                </button>
              </li>
            </ul>
          </li>
        </ol>
      </details>
    </section>
    <form
      v-if="mode !== 'closed'"
      class="right-assets-panel__form"
      @submit.prevent="submit"
    >
      <h3>{{ mode === 'create' ? '登记权利资产' : '修订权利资产' }}</h3>
      <p v-if="mode === 'revise' && draftOrigin && detail">
        草稿来源：客户第 {{ draftOrigin.customerVersion }} 版、资产第
        {{ draftOrigin.assetVersion }} 版；最新客户第
        {{ effectiveCustomerVersion() }} 版、最新资产第
        {{ detail.version }} 版。请核对差异后明确提交。
      </p>
      <ul v-if="changedFacts.length">
        <li v-for="fact in changedFacts" :key="fact">{{ fact }}</li>
      </ul>
      <p v-else-if="conflictDetailReady && mode === 'revise'">
        资产登记字段与草稿来源相同；客户版本变化仍需核对。
      </p>
      <fieldset :disabled="ordinaryWritesBlocked || saving">
        <label
          >资产类型
          <select v-model="form.type">
            <option
              v-for="(label, value) in typeLabels"
              :key="value"
              :value="value"
            >
              {{ label }}
            </option>
          </select></label
        >
        <label
          >资产名称 <input v-model="form.name" maxlength="200" required
        /></label>
        <label
          >资产号码
          <input v-model="numberText" maxlength="200" placeholder="未知可留空"
        /></label>
        <label
          >资产类别 <input v-model="form.category" maxlength="200" required
        /></label>
        <label
          >权利主体
          <select v-model="form.holderId" required>
            <option value="">请选择当前客户关联的主体</option>
            <option
              v-for="holder in holders"
              :key="holder.id"
              :value="holder.id"
            >
              {{ holder.name }}
            </option>
          </select></label
        >
        <label
          >登记权利人文字
          <input v-model="ownerText" maxlength="200" placeholder="未确认可留空"
        /></label>
        <label
          >商标分类
          <input
            v-model="trademarkClass"
            maxlength="100"
            placeholder="不适用可留空"
        /></label>
        <label>起始日期 <input v-model="validFrom" type="date" /></label>
        <label
          >期限模式
          <select v-model="form.validityMode">
            <option value="UNKNOWN">未知</option>
            <option value="LONG_TERM">明确长期</option>
            <option value="FIXED">固定截止日期</option>
          </select></label
        >
        <label v-if="form.validityMode === 'FIXED'"
          >截止日期 <input v-model="validTo" type="date" required
        /></label>
        <p>只填写已知事实；不会根据文件名或空白日期推断有效状态。</p>
      </fieldset>
      <section aria-label="权属证明上传与选择">
        <p>未识别，请人工填写。上传文件与确认登记是两个独立步骤。</p>
        <input
          type="file"
          accept=".pdf,.jpg,.jpeg,.png"
          aria-label="选择权属证明文件"
          :disabled="ordinaryWritesBlocked || uploading || saving"
          @change="chooseUpload"
        />
        <button
          type="button"
          :disabled="
            ordinaryWritesBlocked ||
            uploading ||
            saving ||
            unknownOutcome ||
            !uploadFile
          "
          @click="uploadEvidence"
        >
          {{ uploading ? '上传中…' : '上传证明' }}
        </button>
        <p v-if="uploadMessage" role="status">{{ uploadMessage }}</p>
        <section v-if="singleUploadUnknown" aria-label="人工核对单笔证明池">
          <button
            type="button"
            :disabled="
              blockedByOtherMaintenance || recoveryRefreshing || writeDenied
            "
            @click="refreshSingleEvidence"
          >
            {{ recoveryRefreshing ? '刷新中…' : '刷新证明池' }}
          </button>
          <p>请按文件内容人工核对，不会按文件名自动匹配。</p>
          <div v-for="proof in singleRecoveryEvidence" :key="proof.id">
            {{ proof.originalFilename }} · {{ proof.createdAt }} ·
            {{ proof.sizeBytes }} 字节
            <button type="button" @click="verifyRecoveryEvidence(proof)">
              下载核对
            </button>
            <button
              type="button"
              :disabled="
                blockedByOtherMaintenance ||
                !verifiedRecoveryIds.includes(proof.id) ||
                selectedEvidenceIds.length >= 10
              "
              @click="adoptSingleEvidence(proof)"
            >
              选用此证明
            </button>
          </div>
        </section>
        <p>本次最多选择 10 份证明；取消勾选仅影响本版，历史版本保持原文件。</p>
        <label v-for="proof in availableEvidence" :key="proof.id">
          <input
            v-model="selectedEvidenceIds"
            type="checkbox"
            :value="proof.id"
            :disabled="
              saving ||
              ordinaryWritesBlocked ||
              unknownOutcome ||
              (!selectedEvidenceIds.includes(proof.id) &&
                selectedEvidenceIds.length >= 10)
            "
          />
          {{ proof.originalFilename }} · {{ proof.createdAt.slice(0, 10) }}
        </label>
      </section>
      <button
        type="submit"
        :disabled="
          ordinaryWritesBlocked ||
          saving ||
          conflict ||
          unknownOutcome ||
          !canReviseDraft ||
          writeDenied
        "
      >
        {{ saving ? '保存中…' : '确认保存' }}
      </button>
      <button
        type="button"
        :disabled="ordinaryWritesBlocked || saving"
        @click="cancelDraft"
      >
        取消
      </button>
    </form>
    <section
      v-if="batchOpen"
      aria-label="批量上传权属"
      class="right-assets-panel__form"
    >
      <h3>批量上传权属</h3>
      <p>
        最多 10
        条待登记证明。逐条上传并人工填写；勾选后再确认登记。未识别，请人工填写。
      </p>
      <button
        type="button"
        :disabled="
          batchRows.filter((row) => row.registrationStatus !== 'registered')
            .length >= 10 ||
          batchSaving ||
          ordinaryWritesBlocked ||
          batchHalt !== 'none'
        "
        @click="addBatchRow"
      >
        {{
          batchRows.some((row) => row.registrationStatus === 'registered')
            ? '开始下一批（保留未完成行）'
            : '添加一行'
        }}
      </button>
      <div
        v-for="(row, index) in batchRows"
        :key="row.id"
        class="right-assets-panel__batch-row"
      >
        <h4>
          第 {{ index + 1 }} 行 ·
          {{ row.registrationStatus === 'registered' ? '已登记' : '待登记' }}
        </h4>
        <label
          ><input
            v-model="row.selected"
            type="checkbox"
            :disabled="
              row.registrationStatus === 'registered' ||
              batchSaving ||
              ordinaryWritesBlocked
            "
          />选择此行登记</label
        >
        <fieldset
          :disabled="
            row.registrationStatus === 'registered' ||
            batchSaving ||
            ordinaryWritesBlocked
          "
        >
          <label
            >资产类型<select v-model="row.fields.type">
              <option
                v-for="(label, value) in typeLabels"
                :key="value"
                :value="value"
              >
                {{ label }}
              </option>
            </select></label
          >
          <label
            >资产名称<input v-model="row.fields.name" maxlength="200"
          /></label>
          <label
            >资产类别<input v-model="row.fields.category" maxlength="200"
          /></label>
          <label
            >权利主体<select v-model="row.fields.holderId">
              <option value="">请选择当前客户关联的主体</option>
              <option
                v-for="holder in holders"
                :key="holder.id"
                :value="holder.id"
              >
                {{ holder.name }}
              </option>
            </select></label
          >
          <label
            >真实资产号码（可留空）<input
              v-model="row.fields.number"
              maxlength="200"
          /></label>
          <label
            >登记权利人文字（可留空）<input
              v-model="row.fields.ownerText"
              maxlength="200"
          /></label>
          <label
            >起始日期（可留空）<input
              v-model="row.fields.validFrom"
              type="date"
          /></label>
          <label
            >期限模式<select v-model="row.fields.validityMode">
              <option value="UNKNOWN">未知</option>
              <option value="LONG_TERM">明确长期</option>
              <option value="FIXED">固定截止日期</option>
            </select></label
          >
          <label v-if="row.fields.validityMode === 'FIXED'"
            >真实截止日期<input v-model="row.fields.validTo" type="date"
          /></label>
          <input
            type="file"
            accept=".pdf,.jpg,.jpeg,.png"
            :aria-label="`第 ${index + 1} 行证明文件`"
            :disabled="!canChooseBatchFile(row)"
            @change="chooseBatchFile(row, $event)"
          />
          <button
            type="button"
            :disabled="!canUploadBatchRow(row)"
            @click="uploadBatchRow(row)"
          >
            上传此行证明
          </button>
        </fieldset>
        <p>
          文件：{{
            row.uploadStatus === 'uploaded'
              ? '上传成功，尚未登记'
              : row.uploadStatus === 'uploading'
                ? '上传中'
                : row.uploadStatus === 'failed'
                  ? '上传失败'
                  : row.uploadStatus === 'unknown'
                    ? '上传结果未知'
                    : '尚未上传'
          }}；登记：{{ batchRegistrationLabels[row.registrationStatus] }}
        </p>
        <p v-if="row.error" role="status">{{ row.error }}</p>
        <section
          v-if="row.uploadStatus === 'unknown'"
          aria-label="人工核对证明池"
        >
          <button
            type="button"
            :disabled="
              blockedByOtherMaintenance ||
              row.recoveryRefreshing ||
              batchSaving ||
              batchHalt !== 'none' ||
              writeDenied
            "
            @click="refreshBatchEvidence(row)"
          >
            {{ row.recoveryRefreshing ? '刷新中…' : '刷新证明池' }}
          </button>
          <p>请按文件内容人工核对，不会按文件名自动匹配。</p>
          <div v-for="proof in row.recoveryEvidence ?? []" :key="proof.id">
            {{ proof.originalFilename }} · {{ proof.createdAt }} ·
            {{ proof.sizeBytes }} 字节
            <button type="button" @click="verifyRecoveryEvidence(proof)">
              下载核对
            </button>
            <button
              type="button"
              :disabled="
                blockedByOtherMaintenance ||
                !verifiedRecoveryIds.includes(proof.id) ||
                batchSaving ||
                batchHalt !== 'none' ||
                writeDenied ||
                !!row.pending
              "
              @click="adoptBatchEvidence(row, proof)"
            >
              选用此证明
            </button>
          </div>
        </section>
      </div>
      <p v-if="batchHalt === 'unknown'">
        后续行已停止；请先用原请求确认未知结果。
      </p>
      <p v-if="batchHalt === 'conflict'">客户版本冲突；剩余草稿已保留。</p>
      <button
        v-if="batchHalt === 'unknown'"
        type="button"
        :disabled="blockedByOtherMaintenance || batchSaving"
        @click="retryBatchUnknown"
      >
        用原内容和幂等键重试
      </button>
      <button
        v-if="batchHalt === 'conflict'"
        type="button"
        :disabled="batchSaving"
        @click="refreshBatchConflict"
      >
        明确刷新版本并核对批量草稿
      </button>
      <button
        type="button"
        :disabled="
          ordinaryWritesBlocked ||
          batchSaving ||
          batchHalt !== 'none' ||
          !batchRows.some(
            (row) => row.selected && row.registrationStatus !== 'registered',
          )
        "
        @click="submitBatch"
      >
        确认登记
      </button>
    </section>
  </div>
</template>

<style scoped>
.right-assets-panel {
  padding: var(--s-5);
  border: 1px solid var(--color-hairline);
  border-radius: 8px;
  background: var(--color-surface-1);
}
.right-assets-panel__header {
  display: flex;
  justify-content: space-between;
  align-items: start;
  gap: var(--s-4);
}
.right-assets-panel__header h2 {
  margin: 0;
}
.right-assets-panel__header p {
  color: var(--color-ink-muted);
}
.right-assets-panel__list {
  padding-left: var(--s-5);
}
.right-assets-panel__list li {
  margin: var(--s-3) 0;
  display: flex;
  gap: var(--s-3);
  flex-wrap: wrap;
}
.right-assets-panel__detail,
.right-assets-panel__form {
  border-top: 1px solid var(--color-hairline);
  margin-top: var(--s-5);
  padding-top: var(--s-4);
}
.right-assets-panel__form {
  display: grid;
  gap: var(--s-3);
}
.right-assets-panel__form label {
  display: grid;
  gap: var(--s-1);
}
.right-assets-panel__form input,
.right-assets-panel__form select {
  max-width: 32rem;
  padding: var(--s-2);
}
button {
  margin-right: var(--s-2);
}
dt {
  color: var(--color-ink-muted);
}
dd {
  margin: 0 0 var(--s-2);
}
</style>
