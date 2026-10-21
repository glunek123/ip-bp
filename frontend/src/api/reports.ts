import { ApiError, getJson, type RequestOptions } from './http';

export type ReportsCapability = { canRead: boolean };
type ReportsMetadata = {
  metric: 'ARCHIVED_CASE_AVERAGE_CLAIM_AMOUNT';
  currency: 'CNY';
  scope: 'DEPARTMENT';
  period: 'ALL_TIME';
  definitionVersion: 'RP001-1';
  generatedAt: string;
  totalCases: number;
  inProgressCases: number;
  archivedCases: number;
};
export type ReportsOverview = ReportsMetadata &
  (
    | { status: 'VALUE'; amount: string; reason: null }
    | { status: 'NO_RECORDS'; amount: null; reason: 'NO_ARCHIVED_CASES' }
    | { status: 'UNAVAILABLE'; amount: null; reason: 'NO_KNOWN_AMOUNT' }
  );
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function exact(value: Record<string, unknown>, keys: string[]): boolean {
  return (
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}
function count(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}
function isoDateTime(value: unknown): value is string {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/u.test(
      value,
    ) ||
    !Number.isFinite(Date.parse(value))
  )
    return false;
  return (
    new Date(`${value.slice(0, 10)}T00:00:00Z`).toISOString().slice(0, 10) ===
    value.slice(0, 10)
  );
}
function invalidResponse(): ApiError {
  return new ApiError('服务返回了无效的报表数据', 502, 'INVALID_RESPONSE');
}
export async function getReportsCapability(
  options: RequestOptions = {},
): Promise<ReportsCapability> {
  const value: unknown = await getJson('/reports/capability', options);
  if (
    !record(value) ||
    !exact(value, ['canRead']) ||
    typeof value.canRead !== 'boolean'
  )
    throw invalidResponse();
  return { canRead: value.canRead };
}
export async function getReportsOverview(
  options: RequestOptions = {},
): Promise<ReportsOverview> {
  const value: unknown = await getJson('/reports/overview', options);
  if (
    !record(value) ||
    !exact(value, [
      'metric',
      'currency',
      'scope',
      'period',
      'definitionVersion',
      'generatedAt',
      'totalCases',
      'inProgressCases',
      'archivedCases',
      'status',
      'amount',
      'reason',
    ]) ||
    value.metric !== 'ARCHIVED_CASE_AVERAGE_CLAIM_AMOUNT' ||
    value.currency !== 'CNY' ||
    value.scope !== 'DEPARTMENT' ||
    value.period !== 'ALL_TIME' ||
    value.definitionVersion !== 'RP001-1' ||
    !isoDateTime(value.generatedAt) ||
    !count(value.totalCases) ||
    !count(value.inProgressCases) ||
    !count(value.archivedCases) ||
    value.totalCases !== value.inProgressCases + value.archivedCases
  )
    throw invalidResponse();
  if (
    value.status === 'VALUE' &&
    value.archivedCases > 0 &&
    typeof value.amount === 'string' &&
    /^(?:0|[1-9]\d*)\.\d{2}$/u.test(value.amount) &&
    value.reason === null
  )
    return value as ReportsOverview;
  if (
    value.status === 'NO_RECORDS' &&
    value.archivedCases === 0 &&
    value.amount === null &&
    value.reason === 'NO_ARCHIVED_CASES'
  )
    return value as ReportsOverview;
  if (
    value.status === 'UNAVAILABLE' &&
    value.archivedCases > 0 &&
    value.amount === null &&
    value.reason === 'NO_KNOWN_AMOUNT'
  )
    return value as ReportsOverview;
  throw invalidResponse();
}
