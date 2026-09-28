import { ApiError, getJson, requestJson, type RequestOptions } from './http';
import type {
  RecordNotaryOpeningInput,
  RecordNotaryOpeningResult,
} from './notary';

export type NotaryPortalMatterSummary = {
  id: string;
  businessNo: string;
  stage: 'WAITING_UNBOX';
  version: number;
  createdAt: string;
};
export type NotaryPortalMatterList = {
  items: NotaryPortalMatterSummary[];
  total: number;
  page: number;
  pageSize: number;
};
export type NotaryPortalEvidence = {
  evidenceAt: string;
  logistics: Array<{
    id: string;
    companyState: 'PRESENT' | 'NONE';
    companyValue: string | null;
    trackingState: 'PRESENT' | 'NONE';
    trackingValue: string | null;
  }>;
};
export type NotaryPortalOpening = {
  senderName: string | null;
  senderPhone: string | null;
  senderAddress: string | null;
  recordedAt: string;
  recordedByUserId: string;
  photos: Array<{
    materialId: string;
    contentVersionId: string;
    originalFilename: string;
    mimeType: string;
  }>;
};
export type NotaryPortalMatter = NotaryPortalMatterSummary & {
  stage: 'WAITING_UNBOX' | 'UNBOX_REVIEW';
  evidence: NotaryPortalEvidence | null;
  opening: NotaryPortalOpening | null;
  capabilities: { recordOpening: boolean };
};

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function exact(value: Record<string, unknown>, keys: string[]): boolean {
  return (
    Object.keys(value).length === keys.length &&
    keys.every((key) => key in value)
  );
}
function dateTime(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}
function summary(value: unknown): value is NotaryPortalMatterSummary {
  return (
    record(value) &&
    exact(value, ['id', 'businessNo', 'stage', 'version', 'createdAt']) &&
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    typeof value.businessNo === 'string' &&
    value.businessNo.length > 0 &&
    value.stage === 'WAITING_UNBOX' &&
    Number.isInteger(value.version) &&
    (value.version as number) >= 1 &&
    dateTime(value.createdAt)
  );
}
function validEvidence(value: unknown): value is NotaryPortalEvidence {
  return (
    record(value) &&
    exact(value, ['evidenceAt', 'logistics']) &&
    typeof value.evidenceAt === 'string' &&
    Array.isArray(value.logistics) &&
    value.logistics.every(
      (row) =>
        record(row) &&
        exact(row, [
          'id',
          'companyState',
          'companyValue',
          'trackingState',
          'trackingValue',
        ]) &&
        typeof row.id === 'string' &&
        (row.companyState === 'PRESENT' || row.companyState === 'NONE') &&
        (row.companyValue === null || typeof row.companyValue === 'string') &&
        (row.trackingState === 'PRESENT' || row.trackingState === 'NONE') &&
        (row.trackingValue === null || typeof row.trackingValue === 'string'),
    )
  );
}
function validOpening(value: unknown): value is NotaryPortalOpening {
  return (
    record(value) &&
    exact(value, [
      'senderName',
      'senderPhone',
      'senderAddress',
      'recordedAt',
      'recordedByUserId',
      'photos',
    ]) &&
    (value.senderName === null || typeof value.senderName === 'string') &&
    (value.senderPhone === null || typeof value.senderPhone === 'string') &&
    (value.senderAddress === null || typeof value.senderAddress === 'string') &&
    dateTime(value.recordedAt) &&
    typeof value.recordedByUserId === 'string' &&
    Array.isArray(value.photos) &&
    value.photos.length > 0 &&
    value.photos.every(
      (photo) =>
        record(photo) &&
        exact(photo, [
          'materialId',
          'contentVersionId',
          'originalFilename',
          'mimeType',
        ]) &&
        [
          'materialId',
          'contentVersionId',
          'originalFilename',
          'mimeType',
        ].every(
          (key) =>
            typeof photo[key] === 'string' && (photo[key] as string).length > 0,
        ),
    )
  );
}
function invalidResponse(): ApiError {
  return new ApiError(
    '服务返回了无效的公证处事项数据',
    200,
    'INVALID_RESPONSE',
  );
}
const path = '/notary-portal/matters';

export async function listNotaryPortalMatters(
  page = 1,
  pageSize = 20,
  options: RequestOptions = {},
): Promise<NotaryPortalMatterList> {
  const query = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
  });
  const response = await getJson(`${path}?${query}`, options);
  if (
    !record(response) ||
    !exact(response, ['items', 'total', 'page', 'pageSize']) ||
    !Array.isArray(response.items) ||
    !response.items.every(summary) ||
    !Number.isInteger(response.total) ||
    (response.total as number) < 0 ||
    response.page !== page ||
    response.pageSize !== pageSize
  )
    throw invalidResponse();
  return response as unknown as NotaryPortalMatterList;
}

export async function getNotaryPortalMatter(
  id: string,
  options: RequestOptions = {},
): Promise<NotaryPortalMatter> {
  const response = await getJson(`${path}/${encodeURIComponent(id)}`, options);
  if (
    !record(response) ||
    !exact(response, [
      'id',
      'businessNo',
      'stage',
      'version',
      'createdAt',
      'evidence',
      'opening',
      'capabilities',
    ]) ||
    typeof response.id !== 'string' ||
    response.id !== id ||
    typeof response.businessNo !== 'string' ||
    response.businessNo.length === 0 ||
    (response.stage !== 'WAITING_UNBOX' && response.stage !== 'UNBOX_REVIEW') ||
    !Number.isInteger(response.version) ||
    (response.version as number) < 1 ||
    !dateTime(response.createdAt) ||
    !(response.evidence === null || validEvidence(response.evidence)) ||
    !(response.opening === null || validOpening(response.opening)) ||
    !record(response.capabilities) ||
    !exact(response.capabilities, ['recordOpening']) ||
    typeof response.capabilities.recordOpening !== 'boolean' ||
    (response.stage === 'WAITING_UNBOX'
      ? response.evidence === null ||
        response.opening !== null ||
        !response.capabilities.recordOpening
      : response.evidence === null ||
        response.opening === null ||
        response.capabilities.recordOpening)
  )
    throw invalidResponse();
  return response as unknown as NotaryPortalMatter;
}

export async function recordNotaryPortalOpening(
  id: string,
  input: RecordNotaryOpeningInput,
  idempotencyKey: string,
): Promise<RecordNotaryOpeningResult> {
  if (
    !Number.isInteger(input.expectedVersion) ||
    input.expectedVersion < 1 ||
    input.contentVersionIds.length < 1 ||
    input.contentVersionIds.length > 50 ||
    new Set(input.contentVersionIds).size !== input.contentVersionIds.length ||
    input.contentVersionIds.some((item) => !item) ||
    !idempotencyKey.trim()
  ) {
    throw new ApiError('开箱照片信息无效', 400, 'VALIDATION_ERROR');
  }
  const response = await requestJson(
    `${path}/${encodeURIComponent(id)}/opening`,
    {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: { ...input, contentVersionIds: [...input.contentVersionIds] },
    },
  );
  const responseOpening = record(response) ? response.opening : undefined;
  const responsePhotos = record(responseOpening)
    ? responseOpening.photos
    : undefined;
  if (
    !record(response) ||
    !exact(response, ['id', 'stage', 'version', 'opening']) ||
    response.id !== id ||
    response.stage !== 'UNBOX_REVIEW' ||
    response.version !== input.expectedVersion + 1 ||
    !record(responseOpening) ||
    !exact(responseOpening, [
      'senderName',
      'senderPhone',
      'senderAddress',
      'recordedAt',
      'recordedByUserId',
      'photos',
    ]) ||
    ![
      responseOpening.senderName,
      responseOpening.senderPhone,
      responseOpening.senderAddress,
    ].every((value) => value === null || typeof value === 'string') ||
    !dateTime(responseOpening.recordedAt) ||
    typeof responseOpening.recordedByUserId !== 'string' ||
    responseOpening.recordedByUserId.length === 0 ||
    !Array.isArray(responsePhotos) ||
    responsePhotos.length !== input.contentVersionIds.length ||
    !responsePhotos.every(
      (photo) =>
        record(photo) &&
        exact(photo, ['materialId', 'contentVersionId']) &&
        typeof photo.materialId === 'string' &&
        photo.materialId.length > 0 &&
        typeof photo.contentVersionId === 'string' &&
        photo.contentVersionId.length > 0,
    ) ||
    new Set(
      responsePhotos.map((photo) =>
        record(photo) ? photo.contentVersionId : null,
      ),
    ).size !== input.contentVersionIds.length ||
    !input.contentVersionIds.every(
      (versionId) =>
        Array.isArray(responsePhotos) &&
        responsePhotos.some(
          (photo) => record(photo) && photo.contentVersionId === versionId,
        ),
    )
  )
    throw invalidResponse();
  return response as unknown as RecordNotaryOpeningResult;
}
