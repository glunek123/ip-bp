import {
  ApiError,
  getJson,
  postFormData,
  requestJson,
  type RequestOptions,
} from './http';

export type OpeningImportPhoto = {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
};
export type OpeningImportItem = {
  id: string;
  folderName: string;
  revision: number;
  status: 'READY' | 'CONFLICT' | 'COMMITTED';
  trackingCandidate: string | null;
  trackingNo: string | null;
  recognitionStatus: 'DISABLED' | 'SUCCEEDED' | 'FAILED';
  senderCandidate: {
    name: string | null;
    phone: string | null;
    address: string | null;
  } | null;
  matchStatus: 'UNMATCHED' | 'SUGGESTED' | 'AMBIGUOUS' | 'CONFLICT';
  suggestedMatterId: string | null;
  selectedMatterId: string | null;
  photos: OpeningImportPhoto[];
};
export type OpeningImportBatch = {
  id: string;
  status: 'READY' | 'CANCELLED' | 'EXPIRED';
  expiresAt: string;
  recognitionMode: 'DISABLED' | 'MOCK';
  items: OpeningImportItem[];
};
export type OpeningImportEligibleMatter = {
  id: string;
  businessNo: string;
  version: number;
  trackingNo: string | null;
};
export type OpeningImportEligiblePage = {
  items: OpeningImportEligibleMatter[];
  total: number;
  page: number;
  pageSize: number;
};
export type OpeningImportConfirmInput = {
  matterId: string;
  expectedVersion: number;
  expectedRevision: number;
  senderName?: string;
  senderPhone?: string;
  senderAddress?: string;
};
export type OpeningImportPatchInput = {
  trackingNo: string | null;
  selectedMatterId: string | null;
  expectedRevision: number;
};
export type OpeningImportConfirmResult = {
  itemId: string;
  opening: {
    id: string;
    stage: 'UNBOX_REVIEW';
    version: number;
    opening: {
      senderName: string | null;
      senderPhone: string | null;
      senderAddress: string | null;
      recordedAt: string;
      recordedByUserId: string;
      photos: { materialId: string; contentVersionId: string }[];
    };
  };
};

const bad = () => new ApiError('开箱导入响应无效', 200, 'INVALID_RESPONSE');
const object = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const textOrNull = (v: unknown): v is string | null =>
  v === null || typeof v === 'string';
const integer = (v: unknown): v is number =>
  Number.isSafeInteger(v) && (v as number) >= 0;
const oneOf = (v: unknown, choices: readonly string[]) =>
  typeof v === 'string' && choices.includes(v);

export function decodeOpeningImportItem(value: unknown): OpeningImportItem {
  if (
    !object(value) ||
    typeof value.id !== 'string' ||
    typeof value.folderName !== 'string' ||
    !integer(value.revision) ||
    value.revision < 1 ||
    !oneOf(value.status, ['READY', 'CONFLICT', 'COMMITTED']) ||
    !textOrNull(value.trackingCandidate) ||
    !textOrNull(value.trackingNo) ||
    !oneOf(value.recognitionStatus, ['DISABLED', 'SUCCEEDED', 'FAILED']) ||
    !oneOf(value.matchStatus, [
      'UNMATCHED',
      'SUGGESTED',
      'AMBIGUOUS',
      'CONFLICT',
    ]) ||
    !textOrNull(value.suggestedMatterId) ||
    !textOrNull(value.selectedMatterId) ||
    !Array.isArray(value.photos) ||
    value.photos.length < 1 ||
    value.photos.length > 50
  )
    throw bad();
  if (
    value.senderCandidate !== null &&
    (!object(value.senderCandidate) ||
      !textOrNull(value.senderCandidate.name) ||
      !textOrNull(value.senderCandidate.phone) ||
      !textOrNull(value.senderCandidate.address))
  )
    throw bad();
  if (
    !value.photos.every(
      (p: unknown) =>
        object(p) &&
        typeof p.id === 'string' &&
        typeof p.filename === 'string' &&
        oneOf(p.mimeType, ['image/jpeg', 'image/png', 'image/webp']) &&
        integer(p.sizeBytes) &&
        p.sizeBytes > 0,
    )
  )
    throw bad();
  return value as OpeningImportItem;
}

export function decodeOpeningImportBatch(value: unknown): OpeningImportBatch {
  if (
    !object(value) ||
    typeof value.id !== 'string' ||
    !oneOf(value.status, ['READY', 'CANCELLED', 'EXPIRED']) ||
    typeof value.expiresAt !== 'string' ||
    !Number.isFinite(Date.parse(value.expiresAt)) ||
    !oneOf(value.recognitionMode, ['DISABLED', 'MOCK']) ||
    !Array.isArray(value.items) ||
    value.items.length < 1 ||
    value.items.length > 20
  )
    throw bad();
  value.items.forEach(decodeOpeningImportItem);
  return value as OpeningImportBatch;
}

export async function uploadNotaryOpeningImport(
  file: File,
  key: string,
  options: RequestOptions = {},
): Promise<OpeningImportBatch> {
  if (!key || key.length > 128 || file.size < 1 || file.size > 20 * 1024 * 1024)
    throw new ApiError('ZIP 文件或请求键无效', 400, 'VALIDATION_ERROR');
  const body = new FormData();
  body.append('file', file);
  return decodeOpeningImportBatch(
    await postFormData('/notary-opening-imports', body, {
      ...options,
      headers: { ...options.headers, 'Idempotency-Key': key },
    }),
  );
}
export async function getNotaryOpeningImport(
  batchId: string,
  options: RequestOptions = {},
): Promise<OpeningImportBatch> {
  return decodeOpeningImportBatch(
    await getJson(
      `/notary-opening-imports/${encodeURIComponent(batchId)}`,
      options,
    ),
  );
}
export async function getNotaryOpeningImportByKey(
  key: string,
  options: RequestOptions = {},
): Promise<OpeningImportBatch> {
  return decodeOpeningImportBatch(
    await getJson(
      `/notary-opening-imports/by-key/${encodeURIComponent(key)}`,
      options,
    ),
  );
}

export async function cancelNotaryOpeningImport(
  batchId: string,
  options: RequestOptions = {},
): Promise<OpeningImportBatch> {
  return decodeOpeningImportBatch(
    await requestJson(
      `/notary-opening-imports/${encodeURIComponent(batchId)}/cancel`,
      { ...options, method: 'POST' },
    ),
  );
}
export async function listNotaryOpeningImportEligibleMatters(
  batchId: string,
  q: string,
  page: number,
  pageSize: number,
  options: RequestOptions = {},
): Promise<OpeningImportEligiblePage> {
  const query = new URLSearchParams({
    q,
    page: String(page),
    pageSize: String(pageSize),
  });
  const value = await getJson(
    `/notary-opening-imports/${encodeURIComponent(batchId)}/eligible-matters?${query}`,
    options,
  );
  if (
    !object(value) ||
    !Array.isArray(value.items) ||
    !integer(value.total) ||
    value.page !== page ||
    value.pageSize !== pageSize ||
    !value.items.every(
      (item: unknown) =>
        object(item) &&
        typeof item.id === 'string' &&
        typeof item.businessNo === 'string' &&
        integer(item.version) &&
        textOrNull(item.trackingNo),
    )
  )
    throw bad();
  return value as OpeningImportEligiblePage;
}
export async function patchNotaryOpeningImportItem(
  batchId: string,
  itemId: string,
  input: OpeningImportPatchInput,
  options: RequestOptions = {},
): Promise<OpeningImportItem> {
  return decodeOpeningImportItem(
    await requestJson(
      `/notary-opening-imports/${encodeURIComponent(batchId)}/items/${encodeURIComponent(itemId)}`,
      { ...options, method: 'PATCH', body: input },
    ),
  );
}
export async function confirmNotaryOpeningImportItem(
  batchId: string,
  itemId: string,
  key: string,
  input: OpeningImportConfirmInput,
  options: RequestOptions = {},
): Promise<OpeningImportConfirmResult> {
  const value = await requestJson(
    `/notary-opening-imports/${encodeURIComponent(batchId)}/items/${encodeURIComponent(itemId)}/confirm`,
    {
      ...options,
      method: 'POST',
      headers: { ...options.headers, 'Idempotency-Key': key },
      body: input,
    },
  );
  if (
    !object(value) ||
    value.itemId !== itemId ||
    !object(value.opening) ||
    value.opening.id !== input.matterId ||
    value.opening.stage !== 'UNBOX_REVIEW' ||
    value.opening.version !== input.expectedVersion + 1 ||
    !object(value.opening.opening)
  )
    throw bad();
  const record = value.opening.opening;
  if (
    !textOrNull(record.senderName) ||
    !textOrNull(record.senderPhone) ||
    !textOrNull(record.senderAddress) ||
    typeof record.recordedAt !== 'string' ||
    !Number.isFinite(Date.parse(record.recordedAt)) ||
    typeof record.recordedByUserId !== 'string' ||
    !Array.isArray(record.photos) ||
    record.photos.length < 1 ||
    record.photos.length > 50 ||
    !record.photos.every(
      (photo: unknown) =>
        object(photo) &&
        typeof photo.materialId === 'string' &&
        typeof photo.contentVersionId === 'string',
    )
  )
    throw bad();
  if (
    record.senderName !== (input.senderName?.trim() ?? null) ||
    record.senderPhone !== (input.senderPhone?.trim() ?? null) ||
    record.senderAddress !== (input.senderAddress?.trim() ?? null)
  )
    throw bad();
  return value as OpeningImportConfirmResult;
}
export function notaryOpeningImportPhotoUrl(
  batchId: string,
  photoId: string,
): string {
  return `/api/v1/notary-opening-imports/${encodeURIComponent(batchId)}/photos/${encodeURIComponent(photoId)}`;
}
