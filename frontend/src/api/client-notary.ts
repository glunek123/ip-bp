import { ApiError, getJson, requestJson, type RequestOptions } from './http';
import type {
  NotaryOpeningReviewDecision,
  OpeningReviewResult,
  ReviewNotaryOpeningInput,
  ReviewNotaryOpeningResponse,
} from './notary';

export type ClientNotaryStage =
  'UNBOX_REVIEW' | 'ISSUANCE_DECISION' | 'ARCHIVED';
export type ClientNotaryListItem = {
  id: string;
  businessNo: string;
  stage: ClientNotaryStage;
  version: number;
  createdAt: string;
  sourceLeadBusinessNo: string;
};
export type ClientNotaryList = {
  items: ClientNotaryListItem[];
  total: number;
  page: number;
  pageSize: number;
};
export type ClientNotaryMatterDetail = {
  id: string;
  businessNo: string;
  stage: ClientNotaryStage;
  version: number;
  createdAt: string;
  sourceLead: { id: string; businessNo: string };
  selectedProducts: Array<{
    id: string;
    position: number;
    title: string | null;
    url: string | null;
    quantity: number;
    unitPrice: string;
    commentCount: number;
    estimatedAmount: string;
  }>;
  opening: {
    recordedAt: string;
    photos: Array<{
      materialId: string;
      contentVersionId: string;
      originalFilename: string;
      mimeType: string;
    }>;
  };
  reviewDecision: NotaryOpeningReviewDecision | null;
  capabilities: { reviewOpening: boolean };
};

type RecordValue = Record<string, unknown>;
function isRecord(value: unknown): value is RecordValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function exactKeys(value: RecordValue, keys: readonly string[]): boolean {
  return (
    Object.keys(value).length === keys.length &&
    keys.every((key) => key in value)
  );
}
function isTime(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}
function isStage(value: unknown): value is ClientNotaryStage {
  return (
    value === 'UNBOX_REVIEW' ||
    value === 'ISSUANCE_DECISION' ||
    value === 'ARCHIVED'
  );
}
function isDecision(value: unknown): value is NotaryOpeningReviewDecision {
  return (
    isRecord(value) &&
    exactKeys(value, [
      'result',
      'reason',
      'actorKind',
      'actorDisplayName',
      'decidedAt',
      'archivedAt',
    ]) &&
    (value.result === 'INFRINGEMENT' || value.result === 'NO_INFRINGEMENT') &&
    (value.reason === null ||
      (typeof value.reason === 'string' && value.reason.trim().length > 0)) &&
    (value.actorKind === 'INTERNAL' || value.actorKind === 'CLIENT') &&
    typeof value.actorDisplayName === 'string' &&
    value.actorDisplayName.trim().length > 0 &&
    isTime(value.decidedAt) &&
    (value.archivedAt === null || isTime(value.archivedAt))
  );
}
function decisionMatchesStage(
  stage: ClientNotaryStage,
  decision: NotaryOpeningReviewDecision | null,
): boolean {
  if (stage === 'UNBOX_REVIEW') return decision === null;
  if (stage === 'ISSUANCE_DECISION')
    return (
      decision?.result === 'INFRINGEMENT' &&
      decision.reason === null &&
      decision.archivedAt === null
    );
  return (
    decision?.result === 'NO_INFRINGEMENT' &&
    decision.reason !== null &&
    decision.archivedAt === decision.decidedAt
  );
}
function invalidResponse(): ApiError {
  return new ApiError('服务返回了无效的公证审核数据', 200, 'INVALID_RESPONSE');
}
function isListItem(value: unknown): value is ClientNotaryListItem {
  return (
    isRecord(value) &&
    exactKeys(value, [
      'id',
      'businessNo',
      'stage',
      'version',
      'createdAt',
      'sourceLeadBusinessNo',
    ]) &&
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    typeof value.businessNo === 'string' &&
    value.businessNo.length > 0 &&
    isStage(value.stage) &&
    Number.isInteger(value.version) &&
    (value.version as number) >= 1 &&
    isTime(value.createdAt) &&
    typeof value.sourceLeadBusinessNo === 'string' &&
    value.sourceLeadBusinessNo.length > 0
  );
}
function isClientDetail(value: unknown): value is ClientNotaryMatterDetail {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      'id',
      'businessNo',
      'stage',
      'version',
      'createdAt',
      'sourceLead',
      'selectedProducts',
      'opening',
      'reviewDecision',
      'capabilities',
    ])
  )
    return false;
  const stage = value.stage;
  const decision = value.reviewDecision;
  if (
    !isStage(stage) ||
    !(decision === null || isDecision(decision)) ||
    !decisionMatchesStage(stage, decision)
  )
    return false;
  return (
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    typeof value.businessNo === 'string' &&
    value.businessNo.length > 0 &&
    Number.isInteger(value.version) &&
    (value.version as number) >= 1 &&
    isTime(value.createdAt) &&
    isRecord(value.sourceLead) &&
    exactKeys(value.sourceLead, ['id', 'businessNo']) &&
    typeof value.sourceLead.id === 'string' &&
    typeof value.sourceLead.businessNo === 'string' &&
    Array.isArray(value.selectedProducts) &&
    value.selectedProducts.every(
      (product) =>
        isRecord(product) &&
        exactKeys(product, [
          'id',
          'position',
          'title',
          'url',
          'quantity',
          'unitPrice',
          'commentCount',
          'estimatedAmount',
        ]) &&
        typeof product.id === 'string' &&
        Number.isInteger(product.position) &&
        (product.title === null || typeof product.title === 'string') &&
        (product.url === null || typeof product.url === 'string') &&
        (product.title !== null || product.url !== null) &&
        Number.isInteger(product.quantity) &&
        (product.quantity as number) >= 1 &&
        typeof product.unitPrice === 'string' &&
        /^(0|[1-9]\d{0,15})\.\d{2}$/u.test(product.unitPrice) &&
        Number.isInteger(product.commentCount) &&
        (product.commentCount as number) >= 0 &&
        typeof product.estimatedAmount === 'string' &&
        /^(0|[1-9]\d{0,15})\.\d{2}$/u.test(product.estimatedAmount),
    ) &&
    isRecord(value.opening) &&
    exactKeys(value.opening, ['recordedAt', 'photos']) &&
    isTime(value.opening.recordedAt) &&
    Array.isArray(value.opening.photos) &&
    value.opening.photos.length > 0 &&
    value.opening.photos.every(
      (photo) =>
        isRecord(photo) &&
        exactKeys(photo, [
          'materialId',
          'contentVersionId',
          'originalFilename',
          'mimeType',
        ]) &&
        typeof photo.materialId === 'string' &&
        photo.materialId.length > 0 &&
        typeof photo.contentVersionId === 'string' &&
        photo.contentVersionId.length > 0 &&
        typeof photo.originalFilename === 'string' &&
        photo.originalFilename.length > 0 &&
        typeof photo.mimeType === 'string' &&
        ['image/jpeg', 'image/png', 'image/webp'].includes(photo.mimeType),
    ) &&
    isRecord(value.capabilities) &&
    exactKeys(value.capabilities, ['reviewOpening']) &&
    typeof value.capabilities.reviewOpening === 'boolean' &&
    value.capabilities.reviewOpening === (stage === 'UNBOX_REVIEW')
  );
}
function isReviewResponse(
  value: unknown,
  id: string,
  input: ReviewNotaryOpeningInput,
): value is ReviewNotaryOpeningResponse {
  return (
    isRecord(value) &&
    exactKeys(value, ['id', 'stage', 'version', 'reviewDecision']) &&
    value.id === id &&
    (value.stage === 'ISSUANCE_DECISION' || value.stage === 'ARCHIVED') &&
    Number.isInteger(value.version) &&
    value.version === input.expectedVersion + 1 &&
    isDecision(value.reviewDecision) &&
    value.reviewDecision.actorKind === 'CLIENT' &&
    value.reviewDecision.result === input.result &&
    value.reviewDecision.reason ===
      (input.result === 'NO_INFRINGEMENT'
        ? (input.reason?.trim() ?? '')
        : null) &&
    (value.stage === 'ARCHIVED'
      ? input.result === 'NO_INFRINGEMENT' &&
        value.reviewDecision.archivedAt === value.reviewDecision.decidedAt
      : input.result === 'INFRINGEMENT' &&
        value.reviewDecision.archivedAt === null)
  );
}

export async function listClientNotaryMatters(
  page = 1,
  pageSize = 20,
  options: RequestOptions = {},
  sourceLeadId?: string,
): Promise<ClientNotaryList> {
  const query = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
  });
  if (sourceLeadId !== undefined) query.set('sourceLeadId', sourceLeadId);
  const data = await getJson(
    `/client/notary-matters?${query.toString()}`,
    options,
  );
  if (
    !isRecord(data) ||
    !exactKeys(data, ['items', 'total', 'page', 'pageSize']) ||
    !Array.isArray(data.items) ||
    !data.items.every(isListItem) ||
    !Number.isInteger(data.total) ||
    (data.total as number) < 0 ||
    !Number.isInteger(data.page) ||
    (data.page as number) < 1 ||
    !Number.isInteger(data.pageSize) ||
    (data.pageSize as number) < 1 ||
    (data.pageSize as number) > 100
  )
    throw invalidResponse();
  return data as ClientNotaryList;
}

export async function getClientNotaryMatter(
  id: string,
  options: RequestOptions = {},
): Promise<ClientNotaryMatterDetail> {
  const data = await getJson(
    `/client/notary-matters/${encodeURIComponent(id)}`,
    options,
  );
  if (!isClientDetail(data)) throw invalidResponse();
  return data;
}

export async function reviewClientNotaryOpening(
  id: string,
  input: ReviewNotaryOpeningInput,
  idempotencyKey: string,
): Promise<ReviewNotaryOpeningResponse> {
  const reason = input.reason?.trim();
  if (
    !Number.isInteger(input.expectedVersion) ||
    input.expectedVersion < 1 ||
    (input.result !== 'INFRINGEMENT' && input.result !== 'NO_INFRINGEMENT') ||
    (input.result === 'NO_INFRINGEMENT' && (!reason || reason.length > 2000)) ||
    idempotencyKey.trim().length === 0
  )
    throw new ApiError('开箱审核信息无效', 400, 'VALIDATION_ERROR');
  const body = {
    result: input.result as OpeningReviewResult,
    ...(input.result === 'NO_INFRINGEMENT' ? { reason } : {}),
    expectedVersion: input.expectedVersion,
  };
  const data = await requestJson(
    `/client/notary-matters/${encodeURIComponent(id)}/opening-review`,
    { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey }, body },
  );
  if (!isReviewResponse(data, id, { ...input, ...(reason ? { reason } : {}) }))
    throw invalidResponse();
  return data;
}
