import { ApiError, getJson, type RequestOptions } from './http';
import type { LeadCaseType, LeadPlatform } from './leads';

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

export type ReportsView = 'mine' | 'department';
export type ReportsCenter = Omit<
  ReportsMetadata,
  'scope' | 'definitionVersion'
> & {
  scope: 'SELF' | 'DEPARTMENT';
  definitionVersion: 'RP001-2';
  view: ReportsView;
  availableViews: ReportsView[];
  exportViews: ReportsView[];
  distributions: {
    types: Array<{ value: LeadCaseType | null; count: number }>;
    platforms: Array<{ value: LeadPlatform | null; count: number }>;
    courts: Array<{ id: string; name: string; count: number }>;
    unrecordedCourtCases: number;
  };
  money: {
    total:
      | { status: 'VALUE'; amount: string }
      | { status: 'NO_RECORDS' | 'NO_KNOWN_AMOUNT'; amount: null };
    knownCases: number;
    unknownCases: number;
    buckets: Array<{
      lowerInclusive: string;
      upperExclusive: string | null;
      count: number;
    }>;
  };
  closureRate:
    | { status: 'VALUE'; percent: string }
    | { status: 'NO_RECORDS'; percent: null };
} & (
    | { status: 'VALUE'; amount: string; reason: null }
    | { status: 'NO_RECORDS'; amount: null; reason: 'NO_ARCHIVED_CASES' }
    | { status: 'UNAVAILABLE'; amount: null; reason: 'NO_KNOWN_AMOUNT' }
  );
const decimal = (value: unknown): value is string =>
  typeof value === 'string' && /^(?:0|[1-9]\d*)\.\d{2}$/u.test(value);
const views = (value: unknown): value is ReportsView[] =>
  Array.isArray(value) &&
  value.every((view) => view === 'mine' || view === 'department') &&
  new Set(value).size === value.length;
const caseTypes = new Set<LeadCaseType>([
  'CIVIL',
  'CRIMINAL',
  'ADMINISTRATIVE',
  'INVESTIGATION',
  'NOTARIZATION',
  'HEARING_REPRESENTATION',
]);
const leadPlatforms = new Set<LeadPlatform>([
  'TAOBAO',
  'TMALL',
  'PINDUODUO',
  'JD',
  'DOUYIN',
  'ALIBABA_1688',
  'XIAOHONGSHU',
  'KUAISHOU',
  'XIANYU',
  'WECHAT',
  'MEITUAN',
  'DIANPING',
  'MAP',
  'OTHER',
]);
const courtUuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
function safeSum(values: number[]): number | null {
  let total = 0;
  for (const value of values) {
    total += value;
    if (!Number.isSafeInteger(total)) return null;
  }
  return total;
}
function distributionRows(
  value: unknown,
  total: number,
  types: boolean,
): boolean {
  const allowed: ReadonlySet<string> = types ? caseTypes : leadPlatforms;
  if (!Array.isArray(value)) return false;
  const keys = new Set<unknown>(),
    counts: number[] = [];
  for (const row of value) {
    if (
      !record(row) ||
      !exact(row, ['value', 'count']) ||
      !count(row.count) ||
      row.count === 0 ||
      keys.has(row.value)
    )
      return false;
    if (
      row.value !== null &&
      (typeof row.value !== 'string' ||
        !row.value.trim() ||
        !allowed.has(row.value))
    )
      return false;
    keys.add(row.value);
    counts.push(row.count);
  }
  return safeSum(counts) === total;
}
export async function getReportsCenter(
  view?: ReportsView,
  options: RequestOptions = {},
): Promise<ReportsCenter> {
  if (view !== undefined && view !== 'mine' && view !== 'department')
    throw new ApiError('报表视图无效', 400, 'VALIDATION_ERROR');
  const value: unknown = await getJson(
    view === undefined ? '/reports/center' : `/reports/center?view=${view}`,
    options,
  );
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
      'view',
      'availableViews',
      'exportViews',
      'distributions',
      'money',
      'closureRate',
    ]) ||
    value.metric !== 'ARCHIVED_CASE_AVERAGE_CLAIM_AMOUNT' ||
    value.currency !== 'CNY' ||
    value.period !== 'ALL_TIME' ||
    value.definitionVersion !== 'RP001-2' ||
    !isoDateTime(value.generatedAt) ||
    !count(value.totalCases) ||
    !count(value.inProgressCases) ||
    !count(value.archivedCases) ||
    safeSum([value.inProgressCases, value.archivedCases]) !==
      value.totalCases ||
    (value.view !== 'mine' && value.view !== 'department') ||
    (view !== undefined && value.view !== view) ||
    value.scope !== (value.view === 'mine' ? 'SELF' : 'DEPARTMENT') ||
    !views(value.availableViews) ||
    !['["mine"]', '["mine","department"]'].includes(
      JSON.stringify(value.availableViews),
    ) ||
    !value.availableViews.includes(value.view) ||
    !views(value.exportViews) ||
    (value.exportViews.length === 2 && value.exportViews[0] !== 'mine')
  )
    throw invalidResponse();
  const availableViews = value.availableViews;
  if (value.exportViews.some((item) => !availableViews.includes(item)))
    throw invalidResponse();
  const averageValid =
    value.status === 'VALUE'
      ? value.archivedCases > 0 &&
        decimal(value.amount) &&
        value.reason === null
      : value.status === 'NO_RECORDS'
        ? value.archivedCases === 0 &&
          value.amount === null &&
          value.reason === 'NO_ARCHIVED_CASES'
        : value.status === 'UNAVAILABLE' &&
          value.archivedCases > 0 &&
          value.amount === null &&
          value.reason === 'NO_KNOWN_AMOUNT';
  if (!averageValid) throw invalidResponse();
  const d = value.distributions;
  if (
    !record(d) ||
    !exact(d, ['types', 'platforms', 'courts', 'unrecordedCourtCases']) ||
    !distributionRows(d.types, value.totalCases, true) ||
    !distributionRows(d.platforms, value.totalCases, false) ||
    !count(d.unrecordedCourtCases) ||
    !Array.isArray(d.courts) ||
    d.courts.length > 5
  )
    throw invalidResponse();
  const courtIds = new Set<string>(),
    courtCounts: number[] = [];
  for (const row of d.courts) {
    if (
      !record(row) ||
      !exact(row, ['id', 'name', 'count']) ||
      typeof row.id !== 'string' ||
      !courtUuid.test(row.id) ||
      typeof row.name !== 'string' ||
      !row.name.trim() ||
      !count(row.count) ||
      row.count === 0 ||
      courtIds.has(row.id)
    )
      throw invalidResponse();
    courtIds.add(row.id);
    courtCounts.push(row.count);
  }
  const courtCoverage = safeSum([...courtCounts, d.unrecordedCourtCases]);
  if (
    courtCoverage === null ||
    courtCoverage > value.totalCases ||
    (d.courts.length < 5 && courtCoverage !== value.totalCases)
  )
    throw invalidResponse();
  const m = value.money;
  if (
    !record(m) ||
    !exact(m, ['total', 'knownCases', 'unknownCases', 'buckets']) ||
    !count(m.knownCases) ||
    !count(m.unknownCases) ||
    safeSum([m.knownCases, m.unknownCases]) !== value.totalCases ||
    !record(m.total) ||
    !exact(m.total, ['status', 'amount']) ||
    !Array.isArray(m.buckets) ||
    m.buckets.length !== 4
  )
    throw invalidResponse();
  if (
    value.totalCases === 0
      ? m.total.status !== 'NO_RECORDS' || m.total.amount !== null
      : m.knownCases === 0
        ? m.total.status !== 'NO_KNOWN_AMOUNT' || m.total.amount !== null
        : m.total.status !== 'VALUE' || !decimal(m.total.amount)
  )
    throw invalidResponse();
  const bounds = [
    ['0.00', '100000.00'],
    ['100000.00', '300000.00'],
    ['300000.00', '500000.00'],
    ['500000.00', null],
  ];
  const bucketCounts: number[] = [];
  for (const [index, bucket] of m.buckets.entries()) {
    if (
      !record(bucket) ||
      !exact(bucket, ['lowerInclusive', 'upperExclusive', 'count']) ||
      bucket.lowerInclusive !== bounds[index]?.[0] ||
      bucket.upperExclusive !== bounds[index]?.[1] ||
      !count(bucket.count)
    )
      throw invalidResponse();
    bucketCounts.push(bucket.count);
  }
  if (
    safeSum(bucketCounts) !== m.knownCases ||
    (value.status === 'VALUE' && m.knownCases === 0) ||
    (value.status === 'UNAVAILABLE' && m.unknownCases < value.archivedCases)
  )
    throw invalidResponse();
  const rate = value.closureRate;
  if (!record(rate) || !exact(rate, ['status', 'percent']))
    throw invalidResponse();
  if (
    value.totalCases === 0
      ? rate.status !== 'NO_RECORDS' || rate.percent !== null
      : rate.status !== 'VALUE' ||
        typeof rate.percent !== 'string' ||
        !/^(?:100|[1-9]?\d)$/u.test(rate.percent)
  )
    throw invalidResponse();
  if (
    value.totalCases > 0 &&
    rate.percent !==
      (
        (BigInt(value.archivedCases) * 200n + BigInt(value.totalCases)) /
        (BigInt(value.totalCases) * 2n)
      ).toString()
  )
    throw invalidResponse();
  return value as ReportsCenter;
}
