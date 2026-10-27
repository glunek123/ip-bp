import { ApiError, requestJson, type RequestOptions } from './http';
import type { EarlyArchiveCaseResult, EarlyArchiveCaseInput } from './cases';

export type CaseBatchArchiveItem = {
  id: string;
  expectedVersion: number;
};
export type CaseBatchArchiveInput = Omit<
  EarlyArchiveCaseInput,
  'expectedVersion'
> & { items: CaseBatchArchiveItem[] };
export type CaseBatchArchiveResultItem = {
  id: string;
  status: 'SUCCEEDED' | 'FAILED' | 'UNKNOWN';
  code?: string;
  result?: EarlyArchiveCaseResult;
};
export type CaseBatchArchiveResult = {
  items: CaseBatchArchiveResultItem[];
};

const path = '/cases/early-archive-batches';
const uuidV4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function invalidInput(): ApiError {
  return new ApiError('批量提前归档信息无效', 400, 'VALIDATION_ERROR');
}
function invalidResponse(): ApiError {
  return new ApiError('服务返回了无效的批量归档结果', 502, 'INVALID_RESPONSE');
}
function validInput(value: CaseBatchArchiveInput): boolean {
  return (
    record(value) &&
    Object.keys(value).sort().join(',') ===
      'archiveAt,idempotencyKey,items,reason' &&
    typeof value.idempotencyKey === 'string' &&
    value.idempotencyKey.length >= 1 &&
    value.idempotencyKey.length <= 128 &&
    value.idempotencyKey.trim() === value.idempotencyKey &&
    /^\d{4}-\d{2}-\d{2}$/u.test(value.archiveAt) &&
    typeof value.reason === 'string' &&
    value.reason.trim().length > 0 &&
    value.reason.length <= 2000 &&
    Array.isArray(value.items) &&
    value.items.length >= 1 &&
    value.items.length <= 20 &&
    new Set(value.items.map((item) => item?.id)).size === value.items.length &&
    value.items.every(
      (item) =>
        record(item) &&
        Object.keys(item).sort().join(',') === 'expectedVersion,id' &&
        typeof item.id === 'string' &&
        uuidV4.test(item.id) &&
        Number.isSafeInteger(item.expectedVersion) &&
        item.expectedVersion >= 1 &&
        item.expectedVersion < Number.MAX_SAFE_INTEGER,
    )
  );
}
function decodeResult(
  value: unknown,
  inputIds: string[],
): CaseBatchArchiveResult {
  if (
    !record(value) ||
    Object.keys(value).join(',') !== 'items' ||
    !Array.isArray(value.items) ||
    value.items.length !== inputIds.length
  )
    throw invalidResponse();
  const items = value.items.map((item, index) => {
    if (
      !record(item) ||
      item.id !== inputIds[index] ||
      !['SUCCEEDED', 'FAILED', 'UNKNOWN'].includes(String(item.status)) ||
      Object.keys(item).some(
        (key) => !['id', 'status', 'code', 'result'].includes(key),
      ) ||
      (item.code !== undefined && typeof item.code !== 'string')
    )
      throw invalidResponse();
    if (item.status === 'SUCCEEDED') {
      if (
        !record(item.result) ||
        item.result.id !== item.id ||
        item.result.stage !== 'ARCHIVED' ||
        !Number.isSafeInteger(item.result.version)
      )
        throw invalidResponse();
    } else if (item.result !== undefined) throw invalidResponse();
    return item as unknown as CaseBatchArchiveResultItem;
  });
  return { items };
}

export async function archiveCaseBatch(
  input: CaseBatchArchiveInput,
  options: RequestOptions = {},
): Promise<CaseBatchArchiveResult> {
  if (!validInput(input)) throw invalidInput();
  const response = await requestJson(path, {
    ...options,
    method: 'POST',
    retryOnCsrfInvalid: false,
    body: input,
  });
  return decodeResult(
    response,
    input.items.map((item) => item.id),
  );
}
