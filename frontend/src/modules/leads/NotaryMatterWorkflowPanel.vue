<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { ElButton } from 'element-plus/es/components/button/index.mjs';
import { ApiError } from '../../api/http';
import RequiredFieldMark from '../../app/RequiredFieldMark.vue';
import MaterialPreviewDialog from '../../app/MaterialPreviewDialog.vue';
import NotaryOpeningPhotoGallery from './NotaryOpeningPhotoGallery.vue';
import { NotaryPortalWorkflowPanel } from '../notary';
import { notifyWorkflowChanged } from '../../app/workflow-events';
import type { ListWorkflowSession } from '../../app/list-workflow-context';
import {
  deleteMaterial,
  downloadMaterialVersion,
  listOwnerMaterials,
  uploadMaterialFile,
  type OwnerMaterial,
} from '../../api/materials';
import {
  recordNotaryEvidence,
  recordNotaryOpening,
  reviewNotaryOpening,
  decideNotaryIssuance,
  archiveNotaryReturn,
  saveNotaryEvidenceDraft,
  type NotaryMatterDetail,
  type NotaryReturnAmountInput,
  type NotaryReturnChoice,
  type RecordNotaryEvidenceInput,
  type RecordNotaryOpeningInput,
} from '../../api/notary';
const props = defineProps<{
  detail: NotaryMatterDetail;
  session: ListWorkflowSession;
  disabled?: boolean;
}>();
const emit = defineEmits<{ failed: [message: string] }>();
const matter = computed(() => props.detail);
let contextGeneration = 0;
let openingPostController: AbortController | undefined;
const downloadError = ref('');
const openingDownloads = new Set<AbortController>();
async function downloadOpeningPhoto(photo: {
  materialId: string;
  contentVersionId: string;
}): Promise<void> {
  downloadError.value = '';
  const controller = new AbortController();
  openingDownloads.add(controller);
  try {
    await downloadMaterialVersion(
      photo.materialId,
      photo.contentVersionId,
      controller.signal,
    );
  } catch {
    if (!controller.signal.aborted)
      downloadError.value = '附件下载失败，请稍后重试';
  } finally {
    openingDownloads.delete(controller);
  }
}
const previewPhoto = ref<{
  materialId: string;
  contentVersionId: string;
  filename: string;
} | null>(null);
let openingMaterialsRequest: AbortController | undefined;
let nextOpeningPhotoLocalId = 1;
const initialEvidenceDraft = props.detail.evidenceDraft;
const evidenceDate = ref(initialEvidenceDraft?.evidenceAt ?? '');
const evidenceShopName = ref(
  initialEvidenceDraft?.shopName ?? props.detail.sourceSummary.shopName,
);
const sampleFeeAmount = ref(initialEvidenceDraft?.sampleFeeAmount ?? '');
const logisticsRows = ref(
  initialEvidenceDraft?.logistics.length
    ? initialEvidenceDraft.logistics.map((row) => ({
        companyValue: row.companyValue ?? '',
        trackingValue: row.trackingValue ?? '',
      }))
    : [{ companyValue: '', trackingValue: '' }],
);
const savedEvidenceDraft = ref({
  shopName: evidenceShopName.value,
  evidenceAt: evidenceDate.value,
  sampleFeeAmount: sampleFeeAmount.value,
  logistics: logisticsRows.value.map((row) => ({ ...row })),
});
const evidenceErrors = ref<string[]>([]);
const evidenceError = ref('');
const evidenceSuccess = ref('');
const submittingEvidence = computed(() => busy.value);
const openingSenderName = ref('');
const openingSenderPhone = ref('');
const openingSenderAddress = ref('');
type OpeningPhotoDraft = {
  localId: number;
  materialId?: string;
  contentVersionId?: string;
  originalFilename: string;
  mimeType: string;
  version: number | null;
  selected: boolean;
  file?: InstanceType<typeof globalThis.File>;
  uploading: boolean;
  error?: string;
};
const openingPhotos = ref<OpeningPhotoDraft[]>([]);
const openingUploadError = ref('');
const openingMaterialsError = ref('');
const openingError = ref('');
const openingSuccess = ref('');
const uploadingOpeningPhotos = ref(false);
const submittingOpening = computed(() => busy.value);
const reviewResult = ref<'' | 'INFRINGEMENT' | 'NO_INFRINGEMENT'>('');
const reviewReason = ref('');
const reviewError = ref('');
const reviewSuccess = ref('');
const submittingReview = computed(() => busy.value);
const issuanceChoice = ref<'' | 'ISSUE' | 'NO_ISSUE'>('');
const issuanceError = ref('');
const issuanceSuccess = ref('');
const submittingIssuance = computed(() => busy.value);
const returnChoice = ref<'' | NotaryReturnChoice>('');
const returnReason = ref('');
const refundState = ref<'' | 'KNOWN' | 'PENDING'>('');
const refundAmount = ref('');
const refundPartyKind = ref('');
const refundPartyName = ref('');
const freightState = ref<'' | 'KNOWN' | 'PENDING'>('');
const freightAmount = ref('');
const freightPartyKind = ref('');
const freightPartyName = ref('');
const returnArchiveError = ref('');
const returnArchiveSuccess = ref('');
const savingEvidenceDraft = ref(false);
const evidenceDraftSaved = ref('');
const submittingReturnArchive = computed(() => busy.value);
const deletingOpeningMaterialId = ref<string | null>(null);
const refreshingOpeningPhotos = ref(false);
const allowedOpeningPhotoTypes = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);
const maxOpeningPhotoSize = 20 * 1024 * 1024;

function normalizeKnownSampleFee(): void {
  const match = /^(0|[1-9]\d{0,15})(?:\.(\d{0,2}))?$/u.exec(
    sampleFeeAmount.value,
  );
  if (!match) return;
  sampleFeeAmount.value = `${match[1]}.${(match[2] ?? '').padEnd(2, '0')}`;
}

function normalizeNotaryFee(): void {
  const match = /^(0|[1-9]\d{0,15})(?:\.(\d{0,2}))?$/u.exec(
    notaryFeeAmount.value,
  );
  if (!match) return;
  notaryFeeAmount.value = `${match[1]}.${(match[2] ?? '').padEnd(2, '0')}`;
}

function openingPhotoDraftsFromMaterials(
  items: OwnerMaterial[],
  selectedContentVersionIds: ReadonlySet<string>,
): OpeningPhotoDraft[] {
  return items.flatMap((material) => {
    if (
      material.ownerType !== 'NOTARY_MATTER' ||
      material.ownerId !== matter.value?.id ||
      material.category !== 'NOTARY_OPENING_PHOTO' ||
      material.purpose !== 'NOTARY_OPENING_PHOTO' ||
      material.status !== 'ACTIVE' ||
      material.currentVersionId === null
    ) {
      return [];
    }
    const content = material.contentVersions.find(
      (version) => version.id === material.currentVersionId,
    );
    if (!content) return [];
    return [
      {
        localId: nextOpeningPhotoLocalId++,
        materialId: material.id,
        contentVersionId: content.id,
        originalFilename: content.originalFilename,
        mimeType: content.mimeType,
        version: material.version,
        selected: selectedContentVersionIds.has(content.id),
        uploading: false,
      },
    ];
  });
}

async function refreshOpeningPhotos(matterId: string): Promise<void> {
  const generation = contextGeneration;
  if (refreshingOpeningPhotos.value) return;
  const controller = new AbortController();
  openingMaterialsRequest = controller;
  refreshingOpeningPhotos.value = true;
  openingMaterialsError.value = '';
  const selectedIds = new Set(
    openingPhotos.value
      .filter((photo) => photo.selected && photo.contentVersionId)
      .map((photo) => photo.contentVersionId as string),
  );
  try {
    const result = await listOwnerMaterials('NOTARY_MATTER', matterId, {
      signal: controller.signal,
    });
    if (controller.signal.aborted || generation !== contextGeneration) return;
    const serverPhotos = openingPhotoDraftsFromMaterials(
      result.items,
      selectedIds,
    );
    const localPhotos = openingPhotos.value.filter(
      (photo) => !photo.materialId,
    );
    openingPhotos.value = [...serverPhotos, ...localPhotos];
  } catch {
    if (generation !== contextGeneration || !props.session.isCurrent()) return;
    openingMaterialsError.value = '开箱照片列表读取失败，请刷新重试';
  } finally {
    if (generation === contextGeneration) refreshingOpeningPhotos.value = false;
  }
}

async function uploadOpeningFiles(
  event: InstanceType<typeof globalThis.Event>,
): Promise<void> {
  const generation = contextGeneration;
  if (
    uploadingOpeningPhotos.value ||
    deletingOpeningMaterialId.value !== null ||
    refreshingOpeningPhotos.value
  ) {
    return;
  }
  const input = event.target;
  if (!(input instanceof globalThis.HTMLInputElement)) return;
  const files = Array.from(input.files ?? []);
  input.value = '';
  openingUploadError.value = '';
  if (openingPhotos.value.length + files.length > 50) {
    openingUploadError.value = '开箱照片最多上传 50 张';
    return;
  }
  const accepted: OpeningPhotoDraft[] = [];
  for (const file of files) {
    if (!allowedOpeningPhotoTypes.has(file.type)) {
      openingUploadError.value = '仅支持 JPEG、PNG 或 WEBP 格式的开箱照片';
      continue;
    }
    if (file.size > maxOpeningPhotoSize) {
      openingUploadError.value = '单张开箱照片不能超过 20 MB';
      continue;
    }
    accepted.push({
      localId: nextOpeningPhotoLocalId++,
      originalFilename: file.name,
      mimeType: file.type,
      version: null,
      selected: false,
      file,
      uploading: false,
    });
  }
  openingPhotos.value.push(...accepted);
  if (accepted.length === 0) return;
  uploadingOpeningPhotos.value = true;
  try {
    for (const photo of accepted) {
      if (generation !== contextGeneration) return;
      await uploadOpeningPhoto(photo);
    }
  } finally {
    if (generation === contextGeneration) uploadingOpeningPhotos.value = false;
  }
}

async function uploadOpeningPhoto(photo: OpeningPhotoDraft): Promise<void> {
  const generation = contextGeneration;
  if (!photo.file) return;
  photo.error = undefined;
  photo.uploading = true;
  try {
    const uploaded = await uploadMaterialFile({
      ownerType: 'NOTARY_MATTER',
      ownerId: matter.value?.id ?? props.detail.id,
      category: 'NOTARY_OPENING_PHOTO',
      purpose: 'NOTARY_OPENING_PHOTO',
      file: photo.file,
    });
    if (generation !== contextGeneration) return;
    photo.materialId = uploaded.materialId;
    photo.contentVersionId = uploaded.contentVersionId;
    photo.originalFilename = uploaded.originalFilename;
    photo.mimeType = uploaded.mimeType;
    photo.selected = true;
    await refreshOpeningPhotos(matter.value?.id ?? props.detail.id);
  } catch {
    if (generation !== contextGeneration) return;
    photo.error = '上传失败，可移除后重试';
  } finally {
    if (generation === contextGeneration) photo.uploading = false;
  }
}

async function retryOpeningPhoto(photo: OpeningPhotoDraft): Promise<void> {
  const generation = contextGeneration;
  if (!photo.file) return;
  uploadingOpeningPhotos.value = true;
  try {
    await uploadOpeningPhoto(photo);
  } finally {
    if (generation === contextGeneration) uploadingOpeningPhotos.value = false;
  }
}

function removeLocalOpeningPhoto(localId: number): void {
  if (
    uploadingOpeningPhotos.value ||
    deletingOpeningMaterialId.value !== null ||
    refreshingOpeningPhotos.value
  ) {
    return;
  }
  openingPhotos.value = openingPhotos.value.filter(
    (photo) => photo.localId !== localId,
  );
}

async function deleteOpeningPhoto(photo: OpeningPhotoDraft): Promise<void> {
  const generation = contextGeneration;
  if (
    !photo.materialId ||
    photo.version === null ||
    uploadingOpeningPhotos.value ||
    deletingOpeningMaterialId.value !== null ||
    refreshingOpeningPhotos.value ||
    matter.value?.stage !== 'WAITING_UNBOX' ||
    !matter.value.capabilities.recordOpening
  ) {
    return;
  }
  deletingOpeningMaterialId.value = photo.materialId;
  photo.error = undefined;
  try {
    await deleteMaterial(photo.materialId, photo.version);
    if (generation !== contextGeneration) return;
    openingPhotos.value = openingPhotos.value.filter(
      (candidate) => candidate.materialId !== photo.materialId,
    );
  } catch {
    if (generation !== contextGeneration) return;
    photo.error = '删除失败，材料仍保留在待提交列表中';
  } finally {
    if (generation === contextGeneration)
      deletingOpeningMaterialId.value = null;
  }
}

function readReturnAmount(
  label: string,
  state: '' | 'KNOWN' | 'PENDING',
  amount: string,
  partyKind: string,
  partyName: string,
): NotaryReturnAmountInput | null {
  if (!state) {
    returnArchiveError.value = `请选择${label}状态`;
    return null;
  }
  if (state === 'PENDING') return { state: 'PENDING' };
  if (!/^(0|[1-9]\d{0,15})\.\d{2}$/u.test(amount)) {
    returnArchiveError.value = `${label}金额请输入非负且保留两位小数的金额`;
    return null;
  }
  if (Number(amount) > 0) {
    if (!partyKind) {
      returnArchiveError.value = `请选择${label}${label === '退款' ? '收款方' : '承担方'}`;
      return null;
    }
    if (partyKind === 'OTHER' && !partyName.trim()) {
      returnArchiveError.value = `请填写${label}${label === '退款' ? '收款方' : '承担方'}名称`;
      return null;
    }
    return {
      state: 'KNOWN',
      amount,
      partyKind: partyKind as 'CUSTOMER' | 'FIRM' | 'MERCHANT' | 'OTHER',
      ...(partyKind === 'OTHER' ? { partyName: partyName.trim() } : {}),
    };
  }
  return { state: 'KNOWN', amount };
}
function addLogisticsRow(): void {
  logisticsRows.value.push({ companyValue: '', trackingValue: '' });
}
function removeLogisticsRow(index: number): void {
  if (logisticsRows.value.length > 1) logisticsRows.value.splice(index, 1);
}
async function submitOpening(): Promise<void> {
  openingError.value = '';
  openingSuccess.value = '';
  openingUploadError.value = '';
  const current = matter.value;
  if (
    !current?.capabilities.recordOpening ||
    current.stage !== 'WAITING_UNBOX' ||
    !openingPhotos.value.some((photo) => photo.selected) ||
    openingPhotos.value.some(
      (photo) => photo.selected && (photo.uploading || !photo.contentVersionId),
    ) ||
    uploadingOpeningPhotos.value ||
    deletingOpeningMaterialId.value !== null ||
    submittingOpening.value
  ) {
    if (!openingPhotos.value.some((photo) => photo.selected))
      openingUploadError.value = '至少上传一张开箱照片';
    else if (
      openingPhotos.value.some(
        (photo) => photo.selected && !photo.contentVersionId,
      )
    )
      openingUploadError.value = '请先完成所选照片上传';
    return;
  }
  const input: RecordNotaryOpeningInput = {
    expectedVersion: current.version,
    contentVersionIds: openingPhotos.value
      .filter((photo) => photo.selected && photo.contentVersionId)
      .map((photo) => photo.contentVersionId as string),
    ...(openingSenderName.value.trim()
      ? { senderName: openingSenderName.value.trim() }
      : {}),
    ...(openingSenderPhone.value.trim()
      ? { senderPhone: openingSenderPhone.value.trim() }
      : {}),
    ...(openingSenderAddress.value.trim()
      ? { senderAddress: openingSenderAddress.value.trim() }
      : {}),
  };
  await execute({ kind: 'opening', input });
}

async function submitOpeningReview(): Promise<void> {
  reviewError.value = '';
  reviewSuccess.value = '';
  const current = matter.value;
  const reason = reviewReason.value.trim();
  if (
    !current?.capabilities.reviewOpening ||
    current.stage !== 'UNBOX_REVIEW' ||
    submittingReview.value
  )
    return;
  if (!reviewResult.value) {
    reviewError.value = '请选择审核结论';
    return;
  }
  if (reason.length > 2000) {
    reviewError.value = '开箱备注不能超过 2000 字';
    return;
  }
  const input = {
    result: reviewResult.value,
    ...(reason ? { reason } : {}),
    expectedVersion: current.version,
  } as const;
  await execute({ kind: 'review', input });
}

async function submitIssuanceDecision(): Promise<void> {
  issuanceError.value = '';
  issuanceSuccess.value = '';
  const current = matter.value;
  if (
    !current?.capabilities.decideIssuance ||
    current.stage !== 'ISSUANCE_DECISION' ||
    submittingIssuance.value
  )
    return;
  if (!issuanceChoice.value) {
    issuanceError.value = '请选择是否出证';
    return;
  }
  const input = {
    decision: issuanceChoice.value,
    openingRemark: openingRemark.value.trim() || null,
    expectedVersion: current.version,
  } as const;
  await execute({ kind: 'issuance', input });
}

async function submitReturnArchive(): Promise<void> {
  returnArchiveError.value = '';
  returnArchiveSuccess.value = '';
  const current = matter.value;
  if (
    !(
      current &&
      ((current.stage === 'WAITING_RETURN' &&
        current.capabilities.archiveReturn) ||
        (current.stage !== 'WAITING_RETURN' &&
          current.capabilities.archiveMatter))
    ) ||
    submittingReturnArchive.value
  )
    return;
  const type = archiveType.value;
  if (!type) {
    returnArchiveError.value = '请选择归档类型';
    return;
  }
  if (current.stage === 'WAITING_RETURN' && !returnRequired.value) {
    returnArchiveError.value = '请选择是否需要退货';
    return;
  }
  if (
    current.stage === 'WAITING_RETURN' &&
    (returnRequired.value === 'YES') !== (type === 'RECEIVED_RETURN_REFUND')
  ) {
    returnArchiveError.value = '归档类型与是否需要退货不匹配';
    return;
  }
  const normalizedReason = returnReason.value.trim();
  if (!normalizedReason) {
    returnArchiveError.value = '请填写归档原因';
    return;
  }
  if ([...normalizedReason].length > 5000) {
    returnArchiveError.value = '归档原因不能超过 5000 字';
    return;
  }
  let refund: NotaryReturnAmountInput | undefined;
  let freight: NotaryReturnAmountInput | undefined;
  const returnChoice: NotaryReturnChoice | undefined =
    type === 'NOT_SHIPPED_REFUND_ONLY'
      ? 'REFUND_ONLY'
      : type === 'RECEIVED_RETURN_REFUND'
        ? 'RETURN'
        : type === 'RECEIVED_KEEP'
          ? 'KEEP'
          : current.stage === 'WAITING_RETURN'
            ? 'KEEP'
            : undefined;
  if (!/^(0|[1-9]\d{0,15})\.\d{2}$/u.test(notaryFeeAmount.value)) {
    returnArchiveError.value = '请输入有效公证费';
    return;
  }
  if (
    current.stage !== 'WAITING_RETURN' &&
    (!/^\d{4}-\d{2}-\d{2}$/u.test(archiveDate.value) ||
      !/^(0|[1-9]\d{0,15})\.\d{2}$/u.test(archiveSampleFeeAmount.value))
  ) {
    returnArchiveError.value = '提前归档请填写有效归档日期和样品费';
    return;
  }
  if (type === 'RECEIVED_RETURN_REFUND' || type === 'NOT_SHIPPED_REFUND_ONLY') {
    const parsed = readReturnAmount(
      '退款',
      'KNOWN',
      refundAmount.value,
      refundPartyKind.value,
      refundPartyName.value,
    );
    if (!parsed) return;
    refund = parsed;
  }
  if (type === 'RECEIVED_RETURN_REFUND') {
    const parsed = readReturnAmount(
      '退货运费',
      'KNOWN',
      freightAmount.value,
      freightPartyKind.value,
      freightPartyName.value,
    );
    if (!parsed) return;
    freight = parsed;
  }
  const input = {
    ...(returnChoice ? { returnChoice } : {}),
    ...(refund ? { refund } : {}),
    ...(freight ? { freight } : {}),
    notaryFeeAmount: notaryFeeAmount.value,
    ...(current.stage !== 'WAITING_RETURN'
      ? {
          archiveDate: archiveDate.value,
          sampleFeeAmount: archiveSampleFeeAmount.value,
        }
      : {}),
    archiveType: type,
    archiveReason: normalizedReason,
    expectedVersion: current.version,
  } as const;
  await execute({ kind: 'return', input });
}

async function submitEvidence(): Promise<void> {
  // A recovered request is immutable. Only normalize fresh form input before
  // its first validation and before its idempotency key/body are created.
  if (!pending) normalizeKnownSampleFee();
  evidenceErrors.value = [];
  evidenceError.value = '';
  evidenceSuccess.value = '';
  const errors: string[] = [];
  if (!evidenceDate.value) errors.push('请选择取证日期');
  if (!/^(0|[1-9]\d{0,15})\.\d{2}$/u.test(sampleFeeAmount.value))
    errors.push('请输入样品费，最多保留两位小数');
  evidenceErrors.value = errors;
  if (
    errors.length ||
    !matter.value?.capabilities.recordEvidence ||
    matter.value.stage !== 'PENDING_EVIDENCE'
  )
    return;

  const current = matter.value;
  const feeInput = {
    sampleFeeState: 'KNOWN' as const,
    sampleFeeAmount: sampleFeeAmount.value,
  };
  const input: RecordNotaryEvidenceInput = {
    ...(evidenceShopName.value.trim() !== current.sourceSummary.shopName
      ? {
          shopName: evidenceShopName.value.trim(),
          expectedRoutineRevision: current.routineRevision ?? 0,
        }
      : {}),
    evidenceAt: evidenceDate.value,
    ...feeInput,
    logistics: (logisticsRows.value.length
      ? logisticsRows.value
      : [{ companyValue: '', trackingValue: '' }]
    ).map((row) => ({
      companyState: row.companyValue.trim()
        ? ('PRESENT' as const)
        : ('NONE' as const),
      companyValue: row.companyValue.trim() || null,
      trackingState: row.trackingValue.trim()
        ? ('PRESENT' as const)
        : ('NONE' as const),
      trackingValue: row.trackingValue.trim() || null,
    })),
    expectedVersion: current.version,
  };
  await execute({ kind: 'evidence', input });
}

async function saveEvidenceDraft(): Promise<void> {
  const current = matter.value;
  if (
    !current?.capabilities.recordEvidence ||
    current.stage !== 'PENDING_EVIDENCE' ||
    savingEvidenceDraft.value
  )
    return;
  savingEvidenceDraft.value = true;
  evidenceError.value = '';
  evidenceDraftSaved.value = '';
  try {
    const saved = await saveNotaryEvidenceDraft(current.id, {
      shopName: evidenceShopName.value.trim() || null,
      evidenceAt: evidenceDate.value || null,
      sampleFeeAmount: sampleFeeAmount.value.trim() || null,
      logistics: logisticsRows.value
        .filter((row) => row.companyValue.trim() || row.trackingValue.trim())
        .map((row) => ({
          companyState: row.companyValue.trim() ? 'PRESENT' : 'NONE',
          companyValue: row.companyValue.trim() || null,
          trackingState: row.trackingValue.trim() ? 'PRESENT' : 'NONE',
          trackingValue: row.trackingValue.trim() || null,
        })),
      expectedVersion: current.version,
    });
    savedEvidenceDraft.value = {
      shopName: saved.evidenceDraft.shopName ?? current.sourceSummary.shopName,
      evidenceAt: saved.evidenceDraft.evidenceAt ?? '',
      sampleFeeAmount: saved.evidenceDraft.sampleFeeAmount ?? '',
      logistics: saved.evidenceDraft.logistics.map((row) => ({
        companyValue: row.companyValue ?? '',
        trackingValue: row.trackingValue ?? '',
      })),
    };
    evidenceDraftSaved.value = '草稿已保存';
    notifyWorkflowChanged();
  } catch (error) {
    evidenceError.value =
      error instanceof ApiError ? error.message : '草稿保存失败，请刷新后重试';
  } finally {
    savingEvidenceDraft.value = false;
  }
}

function cancelEvidenceEdits(): void {
  evidenceShopName.value = savedEvidenceDraft.value.shopName;
  evidenceDate.value = savedEvidenceDraft.value.evidenceAt;
  sampleFeeAmount.value = savedEvidenceDraft.value.sampleFeeAmount;
  logisticsRows.value = savedEvidenceDraft.value.logistics.map((row) => ({
    ...row,
  }));
  if (!logisticsRows.value.length)
    logisticsRows.value = [{ companyValue: '', trackingValue: '' }];
  evidenceErrors.value = [];
  evidenceError.value = '';
  evidenceDraftSaved.value = '';
}

const openingRemark = ref(
  props.detail.issuanceDecision?.openingRemark ??
    props.detail.reviewDecision?.reason ??
    '',
);
const archiveType = ref<'' | import('../../api/notary').NotaryArchiveType>('');
const returnRequired = ref<'' | 'YES' | 'NO'>('');
const notaryFeeAmount = ref(
  props.detail.fees.notary.state === 'KNOWN'
    ? props.detail.fees.notary.amount
    : '',
);
const archiveDate = ref(new Date().toLocaleDateString('en-CA'));
const archiveSampleFeeAmount = ref(
  props.detail.evidence?.sampleFeeState === 'KNOWN'
    ? (props.detail.evidence.sampleFeeAmount ?? '')
    : '',
);

type Command =
  | { kind: 'opening'; input: RecordNotaryOpeningInput }
  | { kind: 'review'; input: Parameters<typeof reviewNotaryOpening>[1] }
  | { kind: 'issuance'; input: Parameters<typeof decideNotaryIssuance>[1] }
  | { kind: 'return'; input: Parameters<typeof archiveNotaryReturn>[1] }
  | { kind: 'evidence'; input: RecordNotaryEvidenceInput };
type Pending = { command: Command; key: string };
function actorIdentityKey(actorKey: string): string {
  return actorKey.split(':').slice(0, 3).join(':');
}
const busy = ref(false);
const unknown = ref(false);
const message = ref('');
const blocked = ref(false);
const locked = computed(() => busy.value || unknown.value || blocked.value);
const storageKey = `notary-list-request:${JSON.stringify([actorIdentityKey(props.session.context.actorKey), props.detail.id, props.session.context.actionKey])}`;
let pendingStorageKey: string | null = null;
let pending: Pending | null = null;
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function stringIds(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((id) => typeof id === 'string' && id.length > 0)
  );
}
function amount(value: unknown): boolean {
  return (
    record(value) &&
    (value.state === 'PENDING' ||
      (value.state === 'KNOWN' &&
        typeof value.amount === 'string' &&
        /^\d+\.\d{2}$/u.test(value.amount) &&
        (Number(value.amount) === 0 ||
          ['CUSTOMER', 'FIRM', 'MERCHANT'].includes(String(value.partyKind)) ||
          (value.partyKind === 'OTHER' &&
            typeof value.partyName === 'string' &&
            value.partyName.trim().length > 0))))
  );
}
function validPending(value: unknown): value is Pending {
  if (
    !record(value) ||
    typeof value.key !== 'string' ||
    !value.key ||
    !record(value.command)
  )
    return false;
  const { kind, input } = value.command;
  if (
    !record(input) ||
    !Number.isSafeInteger(input.expectedVersion) ||
    Number(input.expectedVersion) < 1
  )
    return false;
  switch (kind) {
    case 'opening':
      return (
        stringIds(input.contentVersionIds) &&
        ['senderName', 'senderPhone', 'senderAddress'].every(
          (key) => input[key] === undefined || typeof input[key] === 'string',
        )
      );
    case 'review':
      return (
        input.result === 'INFRINGEMENT' ||
        (input.result === 'NO_INFRINGEMENT' &&
          (input.reason === undefined || typeof input.reason === 'string'))
      );
    case 'issuance':
      return (
        (input.decision === 'ISSUE' || input.decision === 'NO_ISSUE') &&
        (input.openingRemark === undefined ||
          input.openingRemark === null ||
          typeof input.openingRemark === 'string')
      );
    case 'return':
      return (
        typeof input.archiveReason === 'string' &&
        input.archiveReason.trim().length > 0 &&
        ((input.archiveType !== undefined &&
          input.returnChoice === undefined &&
          input.notaryFeeAmount !== undefined) ||
          (input.returnChoice === 'KEEP' &&
            input.refund === undefined &&
            input.freight === undefined) ||
          (input.returnChoice === 'REFUND_ONLY' &&
            amount(input.refund) &&
            input.freight === undefined) ||
          (input.returnChoice === 'RETURN' &&
            amount(input.refund) &&
            amount(input.freight)))
      );
    case 'evidence':
      return (
        typeof input.evidenceAt === 'string' &&
        /^\d{4}-\d{2}-\d{2}$/u.test(input.evidenceAt) &&
        (input.sampleFeeState === 'PENDING' ||
          (input.sampleFeeState === 'KNOWN' &&
            typeof input.sampleFeeAmount === 'string' &&
            /^\d+\.\d{2}$/u.test(input.sampleFeeAmount))) &&
        Array.isArray(input.logistics) &&
        input.logistics.length > 0 &&
        input.logistics.every(
          (row) =>
            record(row) &&
            ['company', 'tracking'].every(
              (key) =>
                (row[`${key}State`] === 'NONE' &&
                  row[`${key}Value`] === null) ||
                (row[`${key}State`] === 'PRESENT' &&
                  typeof row[`${key}Value`] === 'string'),
            ),
        )
      );
    default:
      return false;
  }
}
const requestedAction = computed<Command['kind'] | undefined>(
  () =>
    Object.entries({
      'opening-form': 'opening',
      'review-form': 'review',
      'issuance-form': 'issuance',
      'return-archive-form': 'return',
      'evidence-form': 'evidence',
    }).find(([action]) => action === props.session.context.actionKey)?.[1] as
      Command['kind'] | undefined,
);
// 一个阶段可能同时允许多个动作（例如待取证时既登记取证，也可提前归档）。
// 用"当前阶段允许的动作集合"判断，而不是只认单一 currentAction，
// 否则从列表点「提前归档」时表单会整体不渲染，表现为按钮点了没反应。
const availableActions = computed(() => {
  const allowedKinds = new Set<Command['kind']>();
  const current = props.detail;
  if (current.stage === 'WAITING_UNBOX' && current.capabilities.recordOpening)
    allowedKinds.add('opening');
  if (current.stage === 'UNBOX_REVIEW' && current.capabilities.reviewOpening)
    allowedKinds.add('review');
  if (
    current.stage === 'ISSUANCE_DECISION' &&
    current.capabilities.decideIssuance
  )
    allowedKinds.add('issuance');
  if (
    current.stage === 'PENDING_EVIDENCE' &&
    current.capabilities.recordEvidence
  )
    allowedKinds.add('evidence');
  if (current.stage === 'WAITING_RETURN' && current.capabilities.archiveReturn)
    allowedKinds.add('return');
  if (
    current.stage !== 'ARCHIVED' &&
    current.stage !== 'WAITING_RETURN' &&
    current.capabilities.archiveMatter
  )
    allowedKinds.add('return');
  return allowedKinds;
});
const formAvailable = computed(() => {
  const requested = requestedAction.value;
  return requested !== undefined && availableActions.value.has(requested);
});
function allowed(command: Command, recovery = false): boolean {
  if (requestedAction.value !== command.kind) return false;
  // 恢复路径只核对会话归属：原请求可能属于旧阶段，不能再按当前阶段能力判断。
  if (recovery) return props.session.isCurrent();
  return availableActions.value.has(command.kind);
}

function post(
  request: Pending,
  openingSignal?: NonNullable<typeof openingPostController>['signal'],
) {
  const { command, key } = request;
  switch (command.kind) {
    case 'opening':
      return openingSignal
        ? recordNotaryOpening(props.detail.id, command.input, key, {
            signal: openingSignal,
          })
        : recordNotaryOpening(props.detail.id, command.input, key);
    case 'review':
      return reviewNotaryOpening(props.detail.id, command.input, key);
    case 'issuance':
      return decideNotaryIssuance(props.detail.id, command.input, key);
    case 'return':
      return archiveNotaryReturn(props.detail.id, command.input, key);
    case 'evidence':
      return recordNotaryEvidence(props.detail.id, command.input, key);
  }
}
async function execute(command: Command, recovery = false): Promise<void> {
  const session = props.session;
  if (
    busy.value ||
    props.disabled ||
    blocked.value ||
    (!recovery && unknown.value) ||
    !allowed(command, recovery) ||
    !session.isCurrent()
  )
    return;
  if (!recovery) {
    const request = { command, key: globalThis.crypto.randomUUID() };
    try {
      // Persist before dispatch. A reload while POST is in flight must recover
      // this exact body/key rather than silently opening a new command.
      globalThis.sessionStorage.setItem(storageKey, JSON.stringify(request));
      pendingStorageKey = storageKey;
      const frozen: unknown = JSON.parse(JSON.stringify(request));
      if (!validPending(frozen)) throw new Error('Invalid request');
      pending = frozen;
    } catch {
      message.value = '无法保留原请求，请检查浏览器存储后重试；尚未提交。';
      return;
    }
  }
  if (!pending || !session.beginSubmit({ recovery })) return;
  const request = pending;
  const executionGeneration = contextGeneration;
  const openingController =
    request.command.kind === 'opening' ? new AbortController() : undefined;
  if (openingController) openingPostController = openingController;
  busy.value = true;
  message.value = '';
  try {
    await post(request, openingController?.signal);
    // The pending slot belongs to the original actor/record, even if its panel
    // was invalidated. Never refresh or notify the next session for a late POST.
    if (
      contextGeneration !== executionGeneration ||
      openingController?.signal.aborted ||
      !session.isCurrent()
    )
      return;
    if (
      pendingStorageKey &&
      globalThis.sessionStorage.getItem(pendingStorageKey) ===
        JSON.stringify(request)
    )
      globalThis.sessionStorage.removeItem(pendingStorageKey);
    pendingStorageKey = null;
    if (!session.isCurrent()) return;
    pending = null;
    unknown.value = false;
    notifyWorkflowChanged();
    session.endSubmit('success');
  } catch (error) {
    if (
      contextGeneration !== executionGeneration ||
      openingController?.signal.aborted ||
      !session.isCurrent()
    )
      return;
    const uncertain =
      !(error instanceof ApiError) ||
      error.status === 0 ||
      error.status >= 500 ||
      ['INVALID_RESPONSE', 'TIMEOUT', 'NETWORK_ERROR'].includes(error.code);
    unknown.value = uncertain;
    if (uncertain) {
      session.endSubmit('unknown');
      message.value =
        '提交结果暂时未知，原内容与请求键已保留；请使用相同请求键重试。';
    } else {
      if (!(recovery && [401, 403, 404].includes(error.status))) {
        if (pendingStorageKey)
          globalThis.sessionStorage.removeItem(pendingStorageKey);
        pendingStorageKey = null;
        pending = null;
      }
      // Let an enclosing batch inspect the slot after classification: a
      // missing slot is a definite first rejection; a recovery denial keeps
      // the original body/key and remains unknown.
      session.endSubmit('failed');
      blocked.value = [401, 403, 404, 409].includes(error.status);
      const feedback =
        error.code === 'VERSION_CONFLICT' || error.code === 'INVALID_STATE'
          ? '事项状态或版本已变化，请刷新后再试。'
          : error.code === 'IDEMPOTENCY_CONFLICT'
            ? '本次审核请求与已提交内容冲突，请刷新后再试。'
            : error.message;
      message.value =
        feedback +
        (blocked.value
          ? '请返回列表核对最新资料或权限后重新打开。'
          : '。输入已保留，请修正后重试。');
      emit('failed', message.value);
      if ([401, 403, 404].includes(error.status)) session.deny();
    }
  } finally {
    if (openingPostController === openingController)
      openingPostController = undefined;
    if (contextGeneration === executionGeneration) busy.value = false;
  }
}
async function retry() {
  if (pending) await execute(pending.command, true);
}
try {
  const matches: string[] = [];
  for (let index = 0; index < globalThis.sessionStorage.length; index += 1) {
    const key = globalThis.sessionStorage.key(index);
    if (!key?.startsWith('notary-list-request:')) continue;
    let tuple: unknown;
    try {
      tuple = JSON.parse(key.slice('notary-list-request:'.length));
    } catch {
      continue;
    }
    if (
      Array.isArray(tuple) &&
      tuple.length === 3 &&
      typeof tuple[0] === 'string' &&
      actorIdentityKey(tuple[0]) ===
        actorIdentityKey(props.session.context.actorKey) &&
      tuple[1] === props.detail.id &&
      tuple[2] === props.session.context.actionKey
    )
      matches.push(key);
  }
  if (matches.length > 1) throw new Error('Ambiguous pending request');
  const savedKey = matches[0] ?? storageKey;
  const saved = globalThis.sessionStorage.getItem(savedKey);
  if (saved) {
    const decoded: unknown = JSON.parse(saved);
    if (!validPending(decoded) || !allowed(decoded.command, true))
      throw new Error('Invalid pending request');
    pending = decoded;
    pendingStorageKey = savedKey;
    switch (decoded.command.kind) {
      case 'issuance':
        issuanceChoice.value = decoded.command.input.decision;
        break;
      case 'review':
        reviewResult.value = decoded.command.input.result;
        reviewReason.value = decoded.command.input.reason ?? '';
        break;
      case 'opening':
        openingSenderName.value = decoded.command.input.senderName ?? '';
        openingSenderPhone.value = decoded.command.input.senderPhone ?? '';
        openingSenderAddress.value = decoded.command.input.senderAddress ?? '';
        break;
      case 'evidence':
        evidenceDate.value = decoded.command.input.evidenceAt;
        sampleFeeAmount.value = decoded.command.input.sampleFeeAmount ?? '';
        evidenceShopName.value =
          decoded.command.input.shopName ?? evidenceShopName.value;
        logisticsRows.value = decoded.command.input.logistics.map((row) => ({
          ...row,
          companyValue: row.companyValue ?? '',
          trackingValue: row.trackingValue ?? '',
        }));
        break;
      case 'return': {
        const input = decoded.command.input;
        returnChoice.value = input.returnChoice ?? '';
        returnReason.value = input.archiveReason;
        if (input.refund) {
          refundState.value = input.refund.state;
          if (input.refund.state === 'KNOWN') {
            refundAmount.value = input.refund.amount;
            refundPartyKind.value = input.refund.partyKind ?? '';
            refundPartyName.value = input.refund.partyName ?? '';
          }
        }
        if (input.freight) {
          freightState.value = input.freight.state;
          if (input.freight.state === 'KNOWN') {
            freightAmount.value = input.freight.amount;
            freightPartyKind.value = input.freight.partyKind ?? '';
            freightPartyName.value = input.freight.partyName ?? '';
          }
        }
        break;
      }
    }
    unknown.value = true;
    if (!props.session.restoreUnknown()) blocked.value = true;
    message.value = '检测到尚未确认的原请求，请使用原请求重试核对。';
  }
} catch {
  blocked.value = true;
  message.value = '原请求无法安全恢复，已停止提交，请联系管理员核对。';
}
watch(
  () => props.session.contextKey,
  () => {
    contextGeneration += 1;
    openingPostController?.abort();
    openingPostController = undefined;
    busy.value = false;
    openingMaterialsRequest?.abort();
  },
  { flush: 'sync' },
);
watch(
  () => [props.detail.version, props.detail.stage],
  () => {
    if (!unknown.value) blocked.value = false;
  },
);
if (
  props.detail.capabilities.recordOpening &&
  props.detail.stage === 'WAITING_UNBOX'
)
  void refreshOpeningPhotos(props.detail.id);
onBeforeUnmount(() => {
  for (const controller of openingDownloads) controller.abort();
  contextGeneration += 1;
  openingPostController?.abort();
  openingPostController = undefined;
  openingMaterialsRequest?.abort();
});
</script>
<template>
  <section
    v-if="session.context.actionKey === 'certificate'"
    id="certificate"
    tabindex="-1"
  >
    <NotaryPortalWorkflowPanel :detail="detail" :session="session" proxy />
  </section>
  <section
    v-if="
      matter.opening &&
      matter.stage !== 'UNBOX_REVIEW' &&
      matter.stage !== 'ISSUANCE_DECISION'
    "
    class="workflow-card"
    aria-label="本事项已提交开箱资料"
    data-test="workflow-saved-opening"
  >
    <h2>开箱照片</h2>
    <p>店铺名：{{ matter.sourceSummary.shopName }}</p>
    <NotaryOpeningPhotoGallery
      :photos="matter.opening.photos"
      :scope-key="`${session.context.actorKey}:${matter.id}`"
      @download="downloadOpeningPhoto"
      @preview="
        (photo) =>
          (previewPhoto = {
            materialId: photo.materialId,
            contentVersionId: photo.contentVersionId,
            filename: photo.originalFilename,
          })
      "
    />
  </section>
  <p v-if="message" role="alert">{{ message }}</p>
  <p v-if="downloadError" role="alert">{{ downloadError }}</p>
  <MaterialPreviewDialog
    v-if="previewPhoto"
    :material-id="previewPhoto.materialId"
    :content-version-id="previewPhoto.contentVersionId"
    :filename="previewPhoto.filename"
    :scope-key="`${session.context.actorKey}:${matter.id}`"
    @close="previewPhoto = null"
  />
  <ElButton
    v-if="unknown"
    data-test="notary-workflow-retry"
    :disabled="busy || props.disabled"
    @click="retry"
    >使用相同请求键重试</ElButton
  >
  <p
    v-if="session.context.actionKey !== 'certificate' && !formAvailable"
    role="alert"
  >
    {{
      unknown
        ? '当前事项可能已经推进；恢复只会核对原冻结请求。'
        : '当前步骤或办理权限已变化，请返回列表刷新后重新打开。'
    }}
  </p>
  <fieldset
    v-if="formAvailable"
    class="workflow-form-scope"
    :disabled="locked || props.disabled"
  >
    <section
      id="opening-form"
      tabindex="-1"
      v-if="
        matter.stage === 'WAITING_UNBOX' && matter.capabilities.recordOpening
      "
      class="demo-card demo-card--pad workflow-card"
      data-test="opening-form"
    >
      <h2 class="form-section-title">登记开箱材料</h2>
      <p>提交后事项将进入开箱审核。</p>
      <form data-test="record-opening" @submit.prevent="submitOpening">
        <label v-if="matter.capabilities.recordOpening"
          >开箱照片（JPEG、PNG、WEBP；单张不超过 20 MB，最多 50
          张）<RequiredFieldMark />
          <input
            v-if="matter.capabilities.recordOpening"
            data-test="opening-photo-files"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            :disabled="
              uploadingOpeningPhotos ||
              deletingOpeningMaterialId !== null ||
              refreshingOpeningPhotos
            "
            @change="uploadOpeningFiles"
          />
        </label>
        <p v-if="matter.capabilities.recordOpening" class="muted-copy">
          删除会释放材料配额，并从本次待提交选择中移除。
        </p>
        <p v-if="openingMaterialsError" class="field-error" role="alert">
          {{ openingMaterialsError }}
        </p>
        <div data-test="opening-staged-materials">
          <p v-if="openingPhotos.length === 0">暂无待提交开箱照片。</p>
          <ul v-else>
            <li
              v-for="photo in openingPhotos"
              :key="photo.contentVersionId || `local-${photo.localId}`"
              :data-test="
                photo.contentVersionId
                  ? `opening-staged-row-${photo.contentVersionId}`
                  : undefined
              "
            >
              <label v-if="photo.contentVersionId">
                <input
                  v-if="matter.capabilities.recordOpening"
                  v-model="photo.selected"
                  type="checkbox"
                  :data-test="`select-opening-photo-${photo.contentVersionId}`"
                  :disabled="
                    uploadingOpeningPhotos ||
                    deletingOpeningMaterialId !== null ||
                    refreshingOpeningPhotos
                  "
                />
                {{ photo.originalFilename }}（{{ photo.mimeType }}）
              </label>
              <span v-else>
                {{ photo.originalFilename }} —
                {{ photo.uploading ? '正在上传' : photo.error || '待上传' }}
              </span>
              <ElButton
                v-if="
                  photo.materialId &&
                  photo.version !== null &&
                  matter.capabilities.recordOpening
                "
                text
                :data-test="`delete-opening-photo-${photo.materialId}`"
                :disabled="
                  deletingOpeningMaterialId !== null ||
                  uploadingOpeningPhotos ||
                  refreshingOpeningPhotos
                "
                @click="deleteOpeningPhoto(photo)"
                >删除并释放配额</ElButton
              >
              <p
                v-if="photo.error && photo.materialId"
                :data-test="`opening-delete-error-${photo.materialId}`"
                class="field-error"
                role="alert"
              >
                {{ photo.error }}
              </p>
              <button
                v-if="photo.error && !photo.materialId && photo.file"
                type="button"
                :disabled="
                  uploadingOpeningPhotos ||
                  deletingOpeningMaterialId !== null ||
                  refreshingOpeningPhotos
                "
                @click="retryOpeningPhoto(photo)"
              >
                重试上传
              </button>
              <button
                v-if="!photo.materialId && !photo.uploading"
                type="button"
                :disabled="
                  uploadingOpeningPhotos ||
                  deletingOpeningMaterialId !== null ||
                  refreshingOpeningPhotos
                "
                :data-test="`remove-local-opening-photo-${photo.localId}`"
                @click="removeLocalOpeningPhoto(photo.localId)"
              >
                移除此照片
              </button>
            </li>
          </ul>
        </div>
        <label v-if="matter.capabilities.recordOpening"
          >寄件人姓名<input
            v-model="openingSenderName"
            data-test="opening-sender-name"
            maxlength="120"
        /></label>
        <label v-if="matter.capabilities.recordOpening"
          >寄件人电话<input
            v-model="openingSenderPhone"
            data-test="opening-sender-phone"
            maxlength="50"
        /></label>
        <label v-if="matter.capabilities.recordOpening"
          >寄件人地址<input
            v-model="openingSenderAddress"
            data-test="opening-sender-address"
            maxlength="500"
        /></label>
        <p v-if="openingUploadError" class="field-error" role="alert">
          {{ openingUploadError }}
        </p>
        <p v-if="openingError" class="field-error" role="alert">
          {{ openingError }}
        </p>
        <p v-if="openingSuccess" role="status">{{ openingSuccess }}</p>
        <div class="workflow-actions">
          <ElButton
            v-if="matter.capabilities.recordOpening"
            type="primary"
            data-test="record-opening-submit"
            native-type="submit"
            :loading="submittingOpening"
            :disabled="
              submittingOpening ||
              uploadingOpeningPhotos ||
              deletingOpeningMaterialId !== null ||
              refreshingOpeningPhotos
            "
            >登记开箱并进入审核</ElButton
          >
        </div>
      </form>
    </section>

    <section
      v-if="
        (matter.capabilities.archiveReturn &&
          matter.stage === 'WAITING_RETURN') ||
        (matter.capabilities.archiveMatter &&
          matter.stage !== 'ARCHIVED' &&
          requestedAction === 'return')
      "
      class="demo-card demo-card--pad workflow-card"
      data-test="return-archive-form"
      id="return-archive-form"
      tabindex="-1"
    >
      <h2 class="form-section-title">
        {{ matter.stage === 'WAITING_RETURN' ? '退货处理' : '提前归档' }}
      </h2>
      <p>店铺名：{{ matter.sourceSummary.shopName }}</p>
      <p>
        样品费：{{
          matter.evidence?.sampleFeeState === 'KNOWN'
            ? `${matter.evidence.sampleFeeAmount} 元`
            : '待定'
        }}
      </p>
      <form @submit.prevent="submitReturnArchive">
        <label
          v-if="matter.stage === 'WAITING_RETURN'"
          class="field-label"
          for="notary-return-required"
          >是否需要退货 <RequiredFieldMark
        /></label>
        <select
          v-if="matter.stage === 'WAITING_RETURN'"
          v-model="returnRequired"
          id="notary-return-required"
          data-test="return-required"
          required
          :disabled="submittingReturnArchive || locked"
          @change="archiveType = ''"
        >
          <option value="">请选择</option>
          <option value="YES">是</option>
          <option value="NO">否</option>
        </select>
        <label
          >公证费（元）<RequiredFieldMark />
          <input
            v-model="notaryFeeAmount"
            data-test="return-notary-fee"
            inputmode="decimal"
            required
            :disabled="submittingReturnArchive || locked"
            @blur="!locked && !submittingReturnArchive && normalizeNotaryFee()"
          />
        </label>
        <label
          >归档类型<RequiredFieldMark />
          <select
            v-model="archiveType"
            data-test="return-archive-type"
            required
            :disabled="submittingReturnArchive || locked"
          >
            <option value="">请选择</option>
            <option
              v-if="
                matter.stage !== 'WAITING_RETURN' || returnRequired === 'NO'
              "
              value="LINK_REMOVED"
            >
              链接下架
            </option>
            <option
              v-if="
                matter.stage !== 'WAITING_RETURN' || returnRequired === 'NO'
              "
              value="NO_INFRINGEMENT_INFORMATION"
            >
              无侵权信息
            </option>
            <option
              v-if="
                matter.stage !== 'WAITING_RETURN' || returnRequired === 'NO'
              "
              value="NO_EVIDENCE"
            >
              不取证
            </option>
            <option
              v-if="
                matter.stage === 'WAITING_RETURN' && returnRequired === 'NO'
              "
              value="NOT_SHIPPED_REFUND_ONLY"
            >
              不发货-仅退款
            </option>
            <option
              v-if="
                matter.stage === 'WAITING_RETURN' && returnRequired === 'NO'
              "
              value="RECEIVED_KEEP"
            >
              收到货-不退货
            </option>
            <option
              v-if="
                matter.stage === 'WAITING_RETURN' && returnRequired === 'YES'
              "
              value="RECEIVED_RETURN_REFUND"
            >
              收到货-退货退款
            </option>
          </select>
        </label>
        <template v-if="matter.stage !== 'WAITING_RETURN'">
          <label
            >归档日期<RequiredFieldMark /><input
              v-model="archiveDate"
              type="date"
              data-test="single-archive-date"
              required
              :disabled="submittingReturnArchive || locked"
          /></label>
          <label
            >样品费（元）<RequiredFieldMark /><input
              v-model="archiveSampleFeeAmount"
              inputmode="decimal"
              data-test="single-archive-sample-fee"
              required
              :disabled="submittingReturnArchive || locked"
          /></label>
        </template>
        <template
          v-if="
            archiveType === 'RECEIVED_RETURN_REFUND' ||
            archiveType === 'NOT_SHIPPED_REFUND_ONLY'
          "
        >
          <fieldset data-test="return-refund-fields">
            <legend>样品费退款（元）<RequiredFieldMark /></legend>
            <label
              >退款金额（元）
              <input
                v-model="refundAmount"
                data-test="return-refund-amount"
                inputmode="decimal"
                placeholder="0.00"
                required
                :disabled="submittingReturnArchive || locked"
              />
            </label>
            <p>金额为 0.00 时无需选择收款方。</p>
            <template v-if="Number(refundAmount) > 0">
              <label
                >退款收款方<RequiredFieldMark />
                <select
                  v-model="refundPartyKind"
                  data-test="return-refund-party"
                  required
                  :disabled="submittingReturnArchive || locked"
                >
                  <option value="">请选择</option>
                  <option value="CUSTOMER">客户企业</option>
                  <option value="FIRM">我方</option>
                  <option value="MERCHANT">商家／平台</option>
                  <option value="OTHER">其他</option>
                </select>
              </label>
              <label v-if="refundPartyKind === 'OTHER'"
                >收款方名称<RequiredFieldMark />
                <input
                  v-model="refundPartyName"
                  data-test="return-refund-party-name"
                  required
                  :disabled="submittingReturnArchive || locked"
                />
              </label>
            </template>
          </fieldset>
        </template>
        <fieldset
          v-if="archiveType === 'RECEIVED_RETURN_REFUND'"
          data-test="return-freight-fields"
        >
          <legend>退货运费<RequiredFieldMark /></legend>
          <label
            >运费金额（元）<RequiredFieldMark />
            <input
              v-model="freightAmount"
              data-test="return-freight-amount"
              inputmode="decimal"
              placeholder="0.00"
              required
              :disabled="submittingReturnArchive || locked"
            />
          </label>
          <p>金额为 0.00 时无需选择承担方。</p>
          <template v-if="Number(freightAmount) > 0">
            <label
              >运费承担方<RequiredFieldMark />
              <select
                v-model="freightPartyKind"
                data-test="return-freight-party"
                required
                :disabled="submittingReturnArchive || locked"
              >
                <option value="">请选择</option>
                <option value="CUSTOMER">客户企业</option>
                <option value="FIRM">我方</option>
                <option value="MERCHANT">商家／平台</option>
                <option value="OTHER">其他</option>
              </select>
            </label>
            <label v-if="freightPartyKind === 'OTHER'"
              >承担方名称<RequiredFieldMark />
              <input
                v-model="freightPartyName"
                data-test="return-freight-party-name"
                required
                :disabled="submittingReturnArchive || locked"
              />
            </label>
          </template>
        </fieldset>
        <label
          >归档原因<RequiredFieldMark />
          <textarea
            v-model="returnReason"
            data-test="return-archive-reason"
            required
            :disabled="submittingReturnArchive || locked"
          />
        </label>
        <p
          v-if="returnArchiveError"
          class="field-error"
          role="alert"
          data-test="return-archive-error"
        >
          {{ returnArchiveError }}
        </p>
        <p v-if="returnArchiveSuccess" role="status">
          {{ returnArchiveSuccess }}
        </p>
        <div class="workflow-actions">
          <ElButton
            type="primary"
            data-test="return-archive-submit"
            native-type="submit"
            :loading="submittingReturnArchive"
            :disabled="submittingReturnArchive || (locked && !unknown)"
            >提交归档</ElButton
          >
        </div>
      </form>
    </section>
    <section
      v-if="
        matter.stage === 'PENDING_EVIDENCE' &&
        matter.capabilities.recordEvidence
      "
      class="demo-card demo-card--pad workflow-card"
      data-test="evidence-form"
      id="evidence-form"
      tabindex="-1"
    >
      <h2 class="form-section-title">填写取证信息</h2>
      <form data-test="record-evidence" @submit.prevent="submitEvidence">
        <label
          >店铺名
          <input
            v-model="evidenceShopName"
            data-test="evidence-shop-name"
            required
          />
        </label>
        <label
          >取证日期<RequiredFieldMark />
          <input
            v-model="evidenceDate"
            data-test="evidence-date"
            type="date"
            required
        /></label>
        <label
          >样品费（元）<RequiredFieldMark />
          <input
            v-model="sampleFeeAmount"
            data-test="sample-fee-amount"
            @blur="!pending && normalizeKnownSampleFee()"
            inputmode="decimal"
            placeholder="0.00"
            required
        /></label>
        <fieldset
          v-for="(row, index) in logisticsRows"
          :key="index"
          class="workflow-logistics-entry"
        >
          <legend>物流 {{ index + 1 }}</legend>
          <label
            >快递公司
            <input
              v-model="row.companyValue"
              :data-test="`logistics-company-value-${index}`"
          /></label>
          <label
            >快递单号
            <input
              v-model="row.trackingValue"
              :data-test="`logistics-tracking-value-${index}`"
          /></label>
          <button
            v-if="logisticsRows.length > 1"
            type="button"
            @click="removeLogisticsRow(index)"
          >
            删除此条
          </button>
        </fieldset>
        <button type="button" @click="addLogisticsRow">添加物流</button>
        <ul v-if="evidenceErrors.length" class="field-error" role="alert">
          <li v-for="error in evidenceErrors" :key="error">{{ error }}</li>
        </ul>
        <p v-if="evidenceError" class="field-error" role="alert">
          {{ evidenceError }}
        </p>
        <p v-if="evidenceSuccess" role="status">{{ evidenceSuccess }}</p>
        <div class="workflow-actions">
          <ElButton
            data-test="evidence-cancel"
            :disabled="savingEvidenceDraft || submittingEvidence"
            @click="cancelEvidenceEdits"
            >取消</ElButton
          >
          <ElButton
            data-test="evidence-save-draft"
            :loading="savingEvidenceDraft"
            :disabled="savingEvidenceDraft || submittingEvidence"
            @click="saveEvidenceDraft"
            >保存</ElButton
          >
          <ElButton
            type="primary"
            data-test="record-evidence-submit"
            native-type="submit"
            :loading="submittingEvidence"
            :disabled="submittingEvidence"
            >提交</ElButton
          >
        </div>
        <p v-if="evidenceDraftSaved" role="status">{{ evidenceDraftSaved }}</p>
      </form>
    </section>
    <section
      v-if="
        matter.capabilities.reviewOpening && matter.stage === 'UNBOX_REVIEW'
      "
      class="demo-card demo-card--pad workflow-card"
      data-test="opening-review-section"
      id="review-form"
      tabindex="-1"
    >
      <h2 class="form-section-title">开箱审核</h2>
      <p>店铺名：{{ matter.sourceSummary.shopName }}</p>
      <NotaryOpeningPhotoGallery
        :photos="matter.opening?.photos ?? []"
        :scope-key="`${session.context.actorKey}:${matter.id}`"
        @download="downloadOpeningPhoto"
        @preview="
          (photo) =>
            (previewPhoto = {
              materialId: photo.materialId,
              contentVersionId: photo.contentVersionId,
              filename: photo.originalFilename,
            })
        "
      />
      <form
        data-test="opening-review-form"
        @submit.prevent="submitOpeningReview"
      >
        <label class="field-label">审核结果 <RequiredFieldMark /></label>
        <fieldset class="workflow-choices">
          <legend class="sr-only">审核结论</legend>
          <label class="workflow-choice">
            <input
              v-model="reviewResult"
              data-test="opening-review-result"
              type="radio"
              name="opening-review-result"
              value="INFRINGEMENT"
              :disabled="submittingReview || locked"
            />
            <span><strong>侵权</strong></span>
          </label>
          <label class="workflow-choice">
            <input
              v-model="reviewResult"
              data-test="opening-review-result-no-infringement"
              type="radio"
              name="opening-review-result"
              value="NO_INFRINGEMENT"
              :disabled="submittingReview || locked"
            />
            <span><strong>不侵权</strong></span>
          </label>
        </fieldset>
        <label v-if="reviewResult === 'NO_INFRINGEMENT'">
          开箱备注
          <textarea
            v-model="reviewReason"
            data-test="opening-review-reason"
            maxlength="2000"
            :disabled="submittingReview || locked"
          />
        </label>
        <p
          v-if="reviewError"
          class="field-error"
          role="alert"
          data-test="opening-review-reason-error"
        >
          {{ reviewError }}
        </p>
        <p v-if="reviewSuccess" role="status">{{ reviewSuccess }}</p>
        <div class="workflow-actions">
          <ElButton
            type="primary"
            data-test="opening-review-submit"
            native-type="submit"
            :loading="submittingReview"
            :disabled="submittingReview || (locked && !unknown)"
            >提交</ElButton
          >
        </div>
      </form>
    </section>
    <section
      v-if="
        matter.capabilities.decideIssuance &&
        matter.stage === 'ISSUANCE_DECISION'
      "
      class="demo-card demo-card--pad workflow-card"
      data-test="issuance-decision-section"
      id="issuance-form"
      tabindex="-1"
    >
      <h2 class="form-section-title">确认</h2>
      <dl class="workflow-facts">
        <div>
          <dt>审核结果</dt>
          <dd>
            {{
              matter.reviewDecision?.result === 'INFRINGEMENT'
                ? '侵权'
                : '不侵权'
            }}
          </dd>
        </div>
        <div>
          <dt>审核日期</dt>
          <dd>{{ matter.reviewDecision?.decidedAt?.slice(0, 10) ?? '—' }}</dd>
        </div>
      </dl>
      <NotaryOpeningPhotoGallery
        :photos="matter.opening?.photos ?? []"
        :scope-key="`${session.context.actorKey}:${matter.id}`"
        @download="downloadOpeningPhoto"
        @preview="
          (photo) =>
            (previewPhoto = {
              materialId: photo.materialId,
              contentVersionId: photo.contentVersionId,
              filename: photo.originalFilename,
            })
        "
      />
      <label
        >开箱备注<textarea
          v-model="openingRemark"
          data-test="opening-decision-remark"
          maxlength="2000"
        />
      </label>
      <form @submit.prevent="submitIssuanceDecision">
        <fieldset class="workflow-choices">
          <legend class="form-section-title">确认结果</legend>
          <label class="workflow-choice"
            ><input
              v-model="issuanceChoice"
              data-test="issuance-decision-issue"
              type="radio"
              name="issuance-decision"
              value="ISSUE"
              :disabled="submittingIssuance || locked"
            />出证（流转至待出证）</label
          >
          <label class="workflow-choice"
            ><input
              v-model="issuanceChoice"
              data-test="issuance-decision-no-issue"
              type="radio"
              name="issuance-decision"
              value="NO_ISSUE"
              :disabled="submittingIssuance || locked"
            />不出证（流转至待退货）</label
          >
        </fieldset>
        <p v-if="issuanceError" class="field-error" role="alert">
          {{ issuanceError }}
        </p>
        <p v-if="issuanceSuccess" role="status">{{ issuanceSuccess }}</p>
        <div class="workflow-actions">
          <ElButton
            type="primary"
            data-test="issuance-decision-submit"
            native-type="submit"
            :loading="submittingIssuance"
            :disabled="submittingIssuance || (locked && !unknown)"
            >提交确认</ElButton
          >
        </div>
      </form>
    </section>
  </fieldset>
</template>

<style scoped>
.workflow-choices {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
}
.workflow-choice {
  align-items: center;
  display: inline-flex;
  gap: 8px;
}
.workflow-logistics-entry {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
@media (max-width: 640px) {
  .workflow-logistics-entry {
    grid-template-columns: 1fr;
  }
}
</style>
