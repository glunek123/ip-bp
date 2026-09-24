import { ApiError, getJson, requestJson, type RequestOptions } from './http';
import type { LeadProduct } from './leads';

export type NotaryOffice = {
  id: string;
  name: string;
  status: 'ACTIVE';
};

export type NotaryOfficeList = {
  items: NotaryOffice[];
  capabilities: { create: boolean };
};

export type CreateNotaryMatterInput = {
  selectedProductIds: string[];
  selectedContentVersionIds: string[];
  notaryOfficeId: string;
  evidenceMode: 'ONLINE_PURCHASE';
  batchPurpose: string;
  expectedVersion: number;
  createNewBatch?: boolean;
};

export type NotaryMatterResult = {
  id: string;
  businessNo: string;
  leadId: string;
  leadStatus: 'TRANSFERRED_TO_NOTARY';
  leadVersion: number;
  stage: 'PENDING_EVIDENCE';
  notaryOffice: { id: string; name: string };
  selectedProductIds: string[];
  selectedContentVersionIds: string[];
  evidenceMode: 'ONLINE_PURCHASE';
  batchPurpose: string;
  createdAt: string;
};

export type NotaryEvidenceLogistics = {
  id: string;
  companyState: 'PRESENT' | 'NONE';
  companyValue: string | null;
  trackingState: 'PRESENT' | 'NONE';
  trackingValue: string | null;
};

export type NotaryEvidence = {
  evidenceAt: string;
  sampleFeeState: 'KNOWN' | 'PENDING';
  sampleFeeAmount: string | null;
  recordedAt: string;
  recordedByUserId: string;
  logistics: NotaryEvidenceLogistics[];
};

export type NotaryOpeningPhoto = {
  materialId: string;
  contentVersionId: string;
  originalFilename: string;
  mimeType: string;
};

export type NotaryOpening = {
  senderName: string | null;
  senderPhone: string | null;
  senderAddress: string | null;
  recordedAt: string;
  recordedByUserId: string;
  photos: NotaryOpeningPhoto[];
};

export type RecordNotaryOpeningInput = {
  expectedVersion: number;
  contentVersionIds: string[];
  senderName?: string;
  senderPhone?: string;
  senderAddress?: string;
};

export type RecordNotaryOpeningResult = {
  id: string;
  stage: 'UNBOX_REVIEW';
  version: number;
  opening: Pick<
    NotaryOpening,
    | 'senderName'
    | 'senderPhone'
    | 'senderAddress'
    | 'recordedAt'
    | 'recordedByUserId'
  > & {
    photos: Array<Pick<NotaryOpeningPhoto, 'materialId' | 'contentVersionId'>>;
  };
};

type RecordNotaryEvidenceBaseInput = {
  evidenceAt: string;
  logistics: Array<Omit<NotaryEvidenceLogistics, 'id'>>;
  expectedVersion: number;
};

export type RecordNotaryEvidenceInput = RecordNotaryEvidenceBaseInput &
  (
    | { sampleFeeState: 'KNOWN'; sampleFeeAmount: string }
    | { sampleFeeState: 'PENDING'; sampleFeeAmount?: never }
  );

export type RecordNotaryEvidenceResult = {
  id: string;
  stage: 'WAITING_UNBOX';
  version: number;
  evidence: NotaryEvidence;
};

export type NotaryMatterDetail = Omit<NotaryMatterResult, 'stage'> & {
  stage: 'PENDING_EVIDENCE' | 'WAITING_UNBOX' | 'UNBOX_REVIEW';
  version: number;
  capabilities: { recordEvidence: boolean; recordOpening: boolean };
  evidence: NotaryEvidence | null;
  opening: NotaryOpening | null;
  sourceLead: { id: string; businessNo: string };
  selectedProducts: LeadProduct[];
  selectedMaterials: Array<{
    materialId: string;
    contentVersionId: string;
    originalFilename: string;
    mimeType: string;
  }>;
};

function isLogistics(value: unknown): value is NotaryEvidenceLogistics {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    (value.companyState === 'PRESENT' || value.companyState === 'NONE') &&
    (value.trackingState === 'PRESENT' || value.trackingState === 'NONE') &&
    (value.companyState === 'PRESENT'
      ? typeof value.companyValue === 'string' &&
        value.companyValue.trim().length > 0
      : value.companyValue === null) &&
    (value.trackingState === 'PRESENT'
      ? typeof value.trackingValue === 'string' &&
        value.trackingValue.trim().length > 0
      : value.trackingValue === null)
  );
}

function isEvidence(value: unknown): value is NotaryEvidence {
  return (
    isRecord(value) &&
    typeof value.evidenceAt === 'string' &&
    isCalendarDate(value.evidenceAt) &&
    (value.sampleFeeState === 'KNOWN' || value.sampleFeeState === 'PENDING') &&
    (value.sampleFeeState === 'KNOWN'
      ? isMoney(value.sampleFeeAmount)
      : value.sampleFeeAmount === null) &&
    typeof value.recordedAt === 'string' &&
    !Number.isNaN(Date.parse(value.recordedAt)) &&
    typeof value.recordedByUserId === 'string' &&
    value.recordedByUserId.length > 0 &&
    Array.isArray(value.logistics) &&
    value.logistics.length > 0 &&
    value.logistics.every(isLogistics)
  );
}

function isOpeningPhoto(value: unknown): value is NotaryOpeningPhoto {
  return (
    isRecord(value) &&
    typeof value.materialId === 'string' &&
    value.materialId.length > 0 &&
    typeof value.contentVersionId === 'string' &&
    value.contentVersionId.length > 0 &&
    typeof value.originalFilename === 'string' &&
    value.originalFilename.length > 0 &&
    typeof value.mimeType === 'string' &&
    ['image/jpeg', 'image/png', 'image/webp'].includes(value.mimeType)
  );
}

function isOpening(value: unknown): value is NotaryOpening {
  return (
    isRecord(value) &&
    (value.senderName === null || typeof value.senderName === 'string') &&
    (value.senderPhone === null || typeof value.senderPhone === 'string') &&
    (value.senderAddress === null || typeof value.senderAddress === 'string') &&
    typeof value.recordedAt === 'string' &&
    !Number.isNaN(Date.parse(value.recordedAt)) &&
    typeof value.recordedByUserId === 'string' &&
    value.recordedByUserId.length > 0 &&
    Array.isArray(value.photos) &&
    value.photos.length > 0 &&
    value.photos.every(isOpeningPhoto)
  );
}

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalidResponse(): ApiError {
  return new ApiError('服务返回了无效的公证事项数据', 200, 'INVALID_RESPONSE');
}

function isOffice(value: unknown): value is NotaryOffice {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    value.name.trim().length > 0 &&
    value.status === 'ACTIVE'
  );
}

function isMatterResult(value: unknown): value is NotaryMatterResult {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.businessNo === 'string' &&
    typeof value.leadId === 'string' &&
    value.leadStatus === 'TRANSFERRED_TO_NOTARY' &&
    Number.isInteger(value.leadVersion) &&
    (value.leadVersion as number) >= 1 &&
    value.stage === 'PENDING_EVIDENCE' &&
    isRecord(value.notaryOffice) &&
    typeof value.notaryOffice.id === 'string' &&
    typeof value.notaryOffice.name === 'string' &&
    Array.isArray(value.selectedProductIds) &&
    value.selectedProductIds.length >= 1 &&
    value.selectedProductIds.every((id) => typeof id === 'string') &&
    new Set(value.selectedProductIds).size ===
      value.selectedProductIds.length &&
    Array.isArray(value.selectedContentVersionIds) &&
    value.selectedContentVersionIds.every((id) => typeof id === 'string') &&
    new Set(value.selectedContentVersionIds).size ===
      value.selectedContentVersionIds.length &&
    value.evidenceMode === 'ONLINE_PURCHASE' &&
    typeof value.batchPurpose === 'string' &&
    value.batchPurpose.trim().length > 0 &&
    [...value.batchPurpose].length <= 500 &&
    typeof value.createdAt === 'string' &&
    !Number.isNaN(Date.parse(value.createdAt))
  );
}

function isMoney(value: unknown): value is string {
  return typeof value === 'string' && /^(0|[1-9]\d{0,15})\.\d{2}$/u.test(value);
}

function isProductSnapshot(value: unknown): value is LeadProduct {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    Number.isInteger(value.position) &&
    (value.position as number) >= 1 &&
    (value.url === null || typeof value.url === 'string') &&
    (value.title === null || typeof value.title === 'string') &&
    (value.url !== null || value.title !== null) &&
    Number.isInteger(value.quantity) &&
    (value.quantity as number) >= 1 &&
    isMoney(value.unitPrice) &&
    Number.isInteger(value.commentCount) &&
    (value.commentCount as number) >= 0 &&
    isMoney(value.estimatedAmount)
  );
}

function sameIds(left: unknown, right: string[]): boolean {
  return (
    Array.isArray(left) &&
    left.every((id) => typeof id === 'string') &&
    left.length === right.length &&
    new Set(left).size === left.length &&
    right.every((id) => left.includes(id))
  );
}

function isMatterDetail(value: unknown): value is NotaryMatterDetail {
  if (
    !isRecord(value) ||
    !isMatterResult({ ...value, stage: 'PENDING_EVIDENCE' })
  )
    return false;
  const detail = value as Record<string, unknown>;
  const sourceLead = detail.sourceLead;
  const selectedProducts = detail.selectedProducts;
  const selectedMaterials = detail.selectedMaterials;
  const selectedProductIds = detail.selectedProductIds;
  const selectedContentVersionIds = detail.selectedContentVersionIds;
  return (
    Number.isInteger(detail.version) &&
    (detail.version as number) >= 1 &&
    (detail.stage === 'PENDING_EVIDENCE' ||
      detail.stage === 'WAITING_UNBOX' ||
      detail.stage === 'UNBOX_REVIEW') &&
    isRecord(detail.capabilities) &&
    typeof detail.capabilities.recordEvidence === 'boolean' &&
    typeof detail.capabilities.recordOpening === 'boolean' &&
    (detail.evidence === null || isEvidence(detail.evidence)) &&
    (detail.opening === null || isOpening(detail.opening)) &&
    (detail.stage === 'PENDING_EVIDENCE'
      ? detail.evidence === null && detail.opening === null
      : detail.evidence !== null &&
        detail.capabilities.recordEvidence === false) &&
    (detail.stage === 'UNBOX_REVIEW'
      ? detail.opening !== null && detail.capabilities.recordOpening === false
      : detail.opening === null) &&
    (detail.stage !== 'PENDING_EVIDENCE' ||
      detail.capabilities.recordOpening === false) &&
    isRecord(sourceLead) &&
    typeof sourceLead.id === 'string' &&
    typeof sourceLead.businessNo === 'string' &&
    Array.isArray(selectedProducts) &&
    selectedProducts.every(isProductSnapshot) &&
    Array.isArray(selectedProductIds) &&
    selectedProductIds.every((id) => typeof id === 'string') &&
    Array.isArray(selectedMaterials) &&
    selectedMaterials.every(
      (material) =>
        isRecord(material) &&
        typeof material.materialId === 'string' &&
        typeof material.contentVersionId === 'string' &&
        typeof material.originalFilename === 'string' &&
        typeof material.mimeType === 'string',
    ) &&
    Array.isArray(selectedContentVersionIds) &&
    selectedContentVersionIds.every((id) => typeof id === 'string') &&
    (selectedProducts as LeadProduct[]).length === selectedProductIds.length &&
    selectedProductIds.every((id) =>
      (selectedProducts as LeadProduct[]).some((product) => product.id === id),
    ) &&
    (selectedMaterials as Array<Record<string, unknown>>).length ===
      selectedContentVersionIds.length &&
    selectedContentVersionIds.every((id) =>
      (selectedMaterials as Array<Record<string, unknown>>).some(
        (material) => material.contentVersionId === id,
      ),
    )
  );
}

function isRecordOpeningResult(
  value: unknown,
): value is RecordNotaryOpeningResult {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    value.stage === 'UNBOX_REVIEW' &&
    Number.isInteger(value.version) &&
    (value.version as number) >= 2 &&
    isRecord(value.opening) &&
    (value.opening.senderName === null ||
      typeof value.opening.senderName === 'string') &&
    (value.opening.senderPhone === null ||
      typeof value.opening.senderPhone === 'string') &&
    (value.opening.senderAddress === null ||
      typeof value.opening.senderAddress === 'string') &&
    typeof value.opening.recordedAt === 'string' &&
    !Number.isNaN(Date.parse(value.opening.recordedAt)) &&
    typeof value.opening.recordedByUserId === 'string' &&
    value.opening.recordedByUserId.length > 0 &&
    Array.isArray(value.opening.photos) &&
    value.opening.photos.length > 0 &&
    value.opening.photos.every(
      (photo) =>
        isRecord(photo) &&
        typeof photo.materialId === 'string' &&
        photo.materialId.length > 0 &&
        typeof photo.contentVersionId === 'string' &&
        photo.contentVersionId.length > 0,
    )
  );
}

function isRecordEvidenceResult(
  value: unknown,
): value is RecordNotaryEvidenceResult {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    value.stage === 'WAITING_UNBOX' &&
    Number.isInteger(value.version) &&
    (value.version as number) >= 2 &&
    isEvidence(value.evidence)
  );
}

export async function listNotaryOffices(
  options: RequestOptions = {},
): Promise<NotaryOfficeList> {
  const data = await getJson('/notary-offices', options);
  if (
    !isRecord(data) ||
    !Array.isArray(data.items) ||
    !data.items.every(isOffice) ||
    !isRecord(data.capabilities) ||
    typeof data.capabilities.create !== 'boolean'
  )
    throw invalidResponse();
  return data as NotaryOfficeList;
}

export async function getNotaryMatter(
  id: string,
  options: RequestOptions = {},
): Promise<NotaryMatterDetail> {
  const data = await getJson(
    `/notary-matters/${encodeURIComponent(id)}`,
    options,
  );
  if (!isMatterDetail(data)) throw invalidResponse();
  return data;
}

export async function recordNotaryEvidence(
  id: string,
  input: RecordNotaryEvidenceInput,
  idempotencyKey: string,
): Promise<RecordNotaryEvidenceResult> {
  const data = await requestJson(
    `/notary-matters/${encodeURIComponent(id)}/evidence`,
    {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: {
        evidenceAt: input.evidenceAt,
        sampleFeeState: input.sampleFeeState,
        ...(input.sampleFeeState === 'KNOWN'
          ? { sampleFeeAmount: input.sampleFeeAmount }
          : {}),
        logistics: input.logistics.map((row) => ({ ...row })),
        expectedVersion: input.expectedVersion,
      },
    },
  );
  if (
    !isRecordEvidenceResult(data) ||
    data.id !== id ||
    data.version !== input.expectedVersion + 1 ||
    data.evidence.evidenceAt !== input.evidenceAt ||
    data.evidence.sampleFeeState !== input.sampleFeeState ||
    (input.sampleFeeState === 'KNOWN'
      ? data.evidence.sampleFeeAmount !== input.sampleFeeAmount
      : data.evidence.sampleFeeAmount !== null) ||
    data.evidence.logistics.length !== input.logistics.length ||
    data.evidence.logistics.some((row, index) => {
      const submitted = input.logistics[index];
      return (
        row.companyState !== submitted.companyState ||
        row.companyValue !== submitted.companyValue ||
        row.trackingState !== submitted.trackingState ||
        row.trackingValue !== submitted.trackingValue
      );
    })
  )
    throw invalidResponse();
  return data;
}

export async function recordNotaryOpening(
  id: string,
  input: RecordNotaryOpeningInput,
  idempotencyKey: string,
): Promise<RecordNotaryOpeningResult> {
  if (
    !Number.isInteger(input.expectedVersion) ||
    input.expectedVersion < 1 ||
    input.contentVersionIds.length < 1 ||
    input.contentVersionIds.length > 50 ||
    input.contentVersionIds.some(
      (id) => typeof id !== 'string' || id.length === 0,
    ) ||
    new Set(input.contentVersionIds).size !== input.contentVersionIds.length
  )
    throw new ApiError('开箱照片信息无效', 400, 'VALIDATION_ERROR');
  const data = await requestJson(
    `/notary-matters/${encodeURIComponent(id)}/opening`,
    {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: { ...input, contentVersionIds: [...input.contentVersionIds] },
    },
  );
  if (
    !isRecordOpeningResult(data) ||
    data.id !== id ||
    data.version !== input.expectedVersion + 1 ||
    !sameIds(
      data.opening.photos.map((photo) => photo.contentVersionId),
      input.contentVersionIds,
    ) ||
    data.opening.senderName !== (input.senderName?.trim() || null) ||
    data.opening.senderPhone !== (input.senderPhone?.trim() || null) ||
    data.opening.senderAddress !== (input.senderAddress?.trim() || null)
  )
    throw invalidResponse();
  return data;
}

export async function createNotaryOffice(name: string): Promise<NotaryOffice> {
  const data = await requestJson('/notary-offices', {
    method: 'POST',
    body: { name: name.trim() },
  });
  if (!isOffice(data)) throw invalidResponse();
  return data;
}

export async function createNotaryMatter(
  leadId: string,
  input: CreateNotaryMatterInput,
  idempotencyKey: string,
): Promise<NotaryMatterResult> {
  const data = await requestJson(
    `/leads/${encodeURIComponent(leadId)}/notary-matters`,
    {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: {
        ...input,
        selectedProductIds: [...input.selectedProductIds],
        selectedContentVersionIds: [...input.selectedContentVersionIds],
        batchPurpose: input.batchPurpose.trim(),
      },
    },
  );
  if (
    !isMatterResult(data) ||
    data.leadId !== leadId ||
    data.leadVersion !== input.expectedVersion + 1 ||
    !sameIds(data.selectedProductIds, input.selectedProductIds) ||
    !sameIds(data.selectedContentVersionIds, input.selectedContentVersionIds) ||
    data.batchPurpose !== input.batchPurpose.trim()
  )
    throw invalidResponse();
  return data;
}
