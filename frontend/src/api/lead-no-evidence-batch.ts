import { ApiError, requestJson, type RequestOptions } from './http';
import type { LeadEvidenceDecisionResult } from './leads';

export type LeadNoEvidenceBatchInput = {
  items: Array<{ leadId: string; expectedVersion: number; reason: string }>;
};
export type LeadNoEvidenceBatchResult = { items: LeadEvidenceDecisionResult[] };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function exact(value: Record<string, unknown>, keys: string[]): boolean {
  return (
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}
export function isLeadNoEvidenceBatchInput(
  value: unknown,
): value is LeadNoEvidenceBatchInput {
  if (
    !record(value) ||
    !exact(value, ['items']) ||
    !Array.isArray(value.items) ||
    value.items.length < 1 ||
    value.items.length > 20
  )
    return false;
  const seen = new Set<string>();
  return value.items.every((item) => {
    if (
      !record(item) ||
      !exact(item, ['leadId', 'expectedVersion', 'reason']) ||
      typeof item.leadId !== 'string' ||
      !uuid.test(item.leadId) ||
      !Number.isInteger(item.expectedVersion) ||
      (item.expectedVersion as number) < 1 ||
      (item.expectedVersion as number) > 2_147_483_646 ||
      typeof item.reason !== 'string'
    )
      return false;
    const length = Array.from(item.reason.trim()).length;
    const id = item.leadId.toLowerCase();
    if (length < 1 || length > 5000 || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}
function timestamp(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T/u.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}
export async function decideLeadNoEvidenceBatch(
  input: LeadNoEvidenceBatchInput,
  options: RequestOptions = {},
): Promise<LeadNoEvidenceBatchResult> {
  const keyEntries = Object.entries(options.headers ?? {}).filter(
    ([name]) => name.toLowerCase() === 'idempotency-key',
  );
  const key = keyEntries[0]?.[1];
  if (
    !isLeadNoEvidenceBatchInput(input) ||
    keyEntries.length !== 1 ||
    typeof key !== 'string' ||
    !key.trim() ||
    key.trim().length > 128 ||
    /[\r\n]/u.test(key)
  )
    throw new ApiError('批量不取证归档请求无效', 400, 'VALIDATION_ERROR');
  const captured = input.items.map((item) => ({ ...item }));
  const headers = Object.fromEntries(
    Object.entries(options.headers ?? {}).filter(
      ([name]) => name.toLowerCase() !== 'idempotency-key',
    ),
  );
  const data = await requestJson('/leads/batch-no-evidence', {
    ...options,
    method: 'POST',
    headers: { ...headers, 'Idempotency-Key': key },
    retryOnCsrfInvalid: false,
    body: { items: captured.map((item) => ({ ...item })) },
  });
  const invalid = () =>
    new ApiError(
      '服务返回了无效的批量归档结果，原请求待核对',
      502,
      'INVALID_RESPONSE',
    );
  if (
    !record(data) ||
    !exact(data, ['items']) ||
    !Array.isArray(data.items) ||
    data.items.length !== captured.length
  )
    throw invalid();
  const decisionIds = new Set<string>();
  const items = data.items.map((value, index) => {
    const submitted = captured[index]!;
    if (
      !record(value) ||
      !exact(value, [
        'id',
        'leadId',
        'status',
        'version',
        'result',
        'reason',
        'decidedByDisplayName',
        'decidedAt',
        'archiveType',
        'archivedAt',
      ]) ||
      typeof value.id !== 'string' ||
      !uuid.test(value.id) ||
      decisionIds.has(value.id.toLowerCase()) ||
      typeof value.leadId !== 'string' ||
      value.leadId.toLowerCase() !== submitted.leadId.toLowerCase() ||
      value.status !== 'ARCHIVED' ||
      value.version !== submitted.expectedVersion + 1 ||
      value.result !== 'NO_EVIDENCE' ||
      value.reason !== submitted.reason.trim() ||
      typeof value.decidedByDisplayName !== 'string' ||
      !value.decidedByDisplayName.trim() ||
      !timestamp(value.decidedAt) ||
      value.archiveType !== 'NO_EVIDENCE' ||
      !timestamp(value.archivedAt)
    )
      throw invalid();
    decisionIds.add(value.id.toLowerCase());
    return value as LeadEvidenceDecisionResult;
  });
  return { items };
}
