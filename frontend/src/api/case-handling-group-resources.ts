import { ApiError, getJson, type RequestOptions } from './http';
import type { MaterialCategory } from './materials';
import type { CaseHandlingGroupPageQuery } from './case-handling-groups';

export type GroupResourceSnapshot = {
  groupId: string;
  revision: number;
  status: 'ACTIVE' | 'DISSOLVED';
};
export type GroupMaterialResource = {
  caseId: string;
  businessNo: string;
  materialId: string;
  contentVersionId: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: string;
  sha256: string;
  category: Exclude<MaterialCategory, 'FEE_PROOF'>;
  purpose: string;
  isCurrent: boolean;
};
export type GroupResourcePage<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
};
export type GroupMaterials = GroupResourceSnapshot &
  GroupResourcePage<GroupMaterialResource>;
export type GroupNotarySummary = {
  caseId: string;
  businessNo: string;
  sourceType: 'NOTARY_CERTIFICATE_FEE' | 'NOTARY_MATTER_EVIDENCE';
  sourceId: string;
  category: 'NOTARY' | 'INVESTIGATION' | 'DISCLOSURE' | 'SAMPLE';
  state: 'KNOWN' | 'PENDING';
  amount: string | null;
};
export type GroupFeeRecord = {
  feeId: string;
  caseId: string;
  businessNo: string;
  type: string;
  direction: '收入' | '支出';
  status: string;
  amount: string;
  feeDate: string;
  source: string;
  sourceKind: string | null;
  sourceId: string | null;
  note: string | null;
  version: number;
  proofMaterialId: string | null;
  proofContentVersionId: string | null;
  proofOriginalFilename: string | null;
};
export type GroupFees = GroupResourceSnapshot & {
  notarySummaries: GroupNotarySummary[];
} & (
    | { canReadLedger: false; ledger: null }
    | { canReadLedger: true; ledger: GroupResourcePage<GroupFeeRecord> }
  );
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const categories = new Set<Exclude<MaterialCategory, 'FEE_PROOF'>>([
  'CUSTOMER_IDENTITY',
  'CUSTOMER_RIGHT_EVIDENCE',
  'CUSTOMER_AGREEMENT',
  'LEAD_SCREENSHOT',
  'NOTARY_OPENING_PHOTO',
  'NOTARY_CERTIFICATE',
  'NOTARY_DISCLOSURE',
  'COMPLAINT',
  'AUTHORIZATION',
  'MAIL_RECEIPT',
  'FILING_EVIDENCE',
  'FILING_SCREENSHOT',
  'ACCEPTANCE_NOTICE',
  'PAYMENT_LIST',
  'SERVICE_DOCUMENT',
  'JUDGMENT',
  'SECOND_INSTANCE_DOCUMENT',
  'SECOND_INSTANCE_SERVICE',
  'SECOND_INSTANCE_JUDGMENT',
  'EXECUTION_APPLICATION',
  'EXECUTION_FILING_PROOF',
  'EXECUTION_SUPPLEMENT',
  'EXECUTION_FINISH_BASIS',
  'CASE_CLOSURE_DOCUMENT',
]);
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function exact(value: Record<string, unknown>, keys: string[]): boolean {
  return (
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}
function uuid(value: unknown): value is string {
  return typeof value === 'string' && uuidPattern.test(value);
}
function text(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
function nullableString(value: unknown): boolean {
  return value === null || typeof value === 'string';
}
function money(value: unknown): value is string {
  return typeof value === 'string' && /^\d+\.\d{2}$/u.test(value);
}
function integer(
  value: unknown,
  min: number,
  max = 2_147_483_647,
): value is number {
  return (
    Number.isInteger(value) &&
    (value as number) >= min &&
    (value as number) <= max
  );
}
function legalSnapshot(value: Record<string, unknown>): boolean {
  return (
    uuid(value.groupId) &&
    ((value.status === 'ACTIVE' && value.revision === 1) ||
      (value.status === 'DISSOLVED' && value.revision === 2))
  );
}
function invalidResponse(): ApiError {
  return new ApiError('服务返回了无效的办理组资料', 502, 'INVALID_RESPONSE');
}
function input(
  snapshot: GroupResourceSnapshot,
  query: CaseHandlingGroupPageQuery,
): { page: number; pageSize: number; suffix: string } {
  const page = query?.page === undefined ? 1 : query.page;
  const pageSize = query?.pageSize === undefined ? 20 : query.pageSize;
  if (
    !record(snapshot) ||
    !exact(snapshot, ['groupId', 'revision', 'status']) ||
    !legalSnapshot(snapshot) ||
    !record(query) ||
    Object.keys(query).some((key) => !['page', 'pageSize'].includes(key)) ||
    !integer(page, 1, 2_147_483_648) ||
    !integer(pageSize, 1, 100) ||
    (page - 1) * pageSize > 2_147_483_647
  )
    throw new ApiError('办理组资料查询无效', 400, 'VALIDATION_ERROR');
  return { page, pageSize, suffix: `?page=${page}&pageSize=${pageSize}` };
}
function snapshotMatches(
  value: Record<string, unknown>,
  expected: GroupResourceSnapshot,
): boolean {
  return (
    legalSnapshot(value) &&
    (value.groupId as string).toLowerCase() ===
      expected.groupId.toLowerCase() &&
    value.revision === expected.revision &&
    value.status === expected.status
  );
}
function material(value: unknown): GroupMaterialResource {
  if (
    !record(value) ||
    !exact(value, [
      'caseId',
      'businessNo',
      'materialId',
      'contentVersionId',
      'originalFilename',
      'mimeType',
      'sizeBytes',
      'sha256',
      'category',
      'purpose',
      'isCurrent',
    ]) ||
    !uuid(value.caseId) ||
    !text(value.businessNo) ||
    !uuid(value.materialId) ||
    !uuid(value.contentVersionId) ||
    !text(value.originalFilename) ||
    !text(value.mimeType) ||
    typeof value.sizeBytes !== 'string' ||
    !/^(0|[1-9][0-9]*)$/u.test(value.sizeBytes) ||
    typeof value.sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(value.sha256) ||
    !categories.has(value.category as Exclude<MaterialCategory, 'FEE_PROOF'>) ||
    !text(value.purpose) ||
    typeof value.isCurrent !== 'boolean'
  )
    throw invalidResponse();
  return value as GroupMaterialResource;
}
function summary(value: unknown): GroupNotarySummary {
  if (
    !record(value) ||
    !exact(value, [
      'caseId',
      'businessNo',
      'sourceType',
      'sourceId',
      'category',
      'state',
      'amount',
    ]) ||
    !uuid(value.caseId) ||
    !text(value.businessNo) ||
    !uuid(value.sourceId) ||
    typeof value.category !== 'string' ||
    !['NOTARY', 'INVESTIGATION', 'DISCLOSURE', 'SAMPLE'].includes(
      String(value.category),
    ) ||
    value.sourceType !==
      (value.category === 'SAMPLE'
        ? 'NOTARY_MATTER_EVIDENCE'
        : 'NOTARY_CERTIFICATE_FEE') ||
    !(value.state === 'PENDING'
      ? value.amount === null
      : value.state === 'KNOWN' && money(value.amount))
  )
    throw invalidResponse();
  return value as GroupNotarySummary;
}
function fee(value: unknown): GroupFeeRecord {
  if (
    !record(value) ||
    !exact(value, [
      'feeId',
      'caseId',
      'businessNo',
      'type',
      'direction',
      'status',
      'amount',
      'feeDate',
      'source',
      'sourceKind',
      'sourceId',
      'note',
      'version',
      'proofMaterialId',
      'proofContentVersionId',
      'proofOriginalFilename',
    ]) ||
    !uuid(value.feeId) ||
    !uuid(value.caseId) ||
    !text(value.businessNo) ||
    !text(value.type) ||
    (value.direction !== '收入' && value.direction !== '支出') ||
    !text(value.status) ||
    !money(value.amount) ||
    typeof value.feeDate !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/u.test(value.feeDate) ||
    !Number.isFinite(Date.parse(value.feeDate)) ||
    new Date(value.feeDate).toISOString().slice(0, 10) !== value.feeDate ||
    !text(value.source) ||
    !nullableString(value.sourceKind) ||
    !nullableString(value.sourceId) ||
    !nullableString(value.note) ||
    !integer(value.version, 1) ||
    !(value.proofMaterialId === null || uuid(value.proofMaterialId)) ||
    !(
      value.proofContentVersionId === null || uuid(value.proofContentVersionId)
    ) ||
    !nullableString(value.proofOriginalFilename) ||
    (value.proofMaterialId === null) !==
      (value.proofContentVersionId === null) ||
    (value.proofContentVersionId === null &&
      value.proofOriginalFilename !== null)
  )
    throw invalidResponse();
  return value as GroupFeeRecord;
}
function page<T>(
  value: Record<string, unknown>,
  query: { page: number; pageSize: number },
  decode: (item: unknown) => T,
  identity: (item: T) => string,
): GroupResourcePage<T> {
  if (
    !Array.isArray(value.items) ||
    !integer(value.total, 0, Number.MAX_SAFE_INTEGER) ||
    value.page !== query.page ||
    value.pageSize !== query.pageSize ||
    value.items.length > query.pageSize ||
    (value.items.length > 0 &&
      (query.page - 1) * query.pageSize + value.items.length > value.total)
  )
    throw invalidResponse();
  const items = value.items.map(decode);
  if (new Set(items.map(identity)).size !== items.length)
    throw invalidResponse();
  return {
    items,
    total: value.total,
    page: query.page,
    pageSize: query.pageSize,
  };
}
export async function getCaseHandlingGroupMaterials(
  snapshot: GroupResourceSnapshot,
  query: CaseHandlingGroupPageQuery = {},
  options: RequestOptions = {},
): Promise<GroupMaterials> {
  const expected = { ...snapshot };
  const parsed = input(expected, query);
  const value: unknown = await getJson(
    `/case-handling-groups/${encodeURIComponent(expected.groupId)}/materials${parsed.suffix}`,
    options,
  );
  if (
    !record(value) ||
    !exact(value, [
      'groupId',
      'revision',
      'status',
      'items',
      'total',
      'page',
      'pageSize',
    ]) ||
    !snapshotMatches(value, expected)
  )
    throw invalidResponse();
  return {
    ...expected,
    ...page(value, parsed, material, (item) =>
      `${item.caseId}:${item.materialId}:${item.contentVersionId}`.toLowerCase(),
    ),
  };
}
export async function getCaseHandlingGroupFees(
  snapshot: GroupResourceSnapshot,
  query: CaseHandlingGroupPageQuery = {},
  options: RequestOptions = {},
): Promise<GroupFees> {
  const expected = { ...snapshot };
  const parsed = input(expected, query);
  const value: unknown = await getJson(
    `/case-handling-groups/${encodeURIComponent(expected.groupId)}/fees${parsed.suffix}`,
    options,
  );
  if (
    !record(value) ||
    !exact(value, [
      'groupId',
      'revision',
      'status',
      'notarySummaries',
      'canReadLedger',
      'ledger',
    ]) ||
    !snapshotMatches(value, expected) ||
    !Array.isArray(value.notarySummaries)
  )
    throw invalidResponse();
  const notarySummaries = value.notarySummaries.map(summary);
  if (
    new Set(
      notarySummaries.map((item) =>
        `${item.caseId}:${item.sourceType}:${item.sourceId}:${item.category}`.toLowerCase(),
      ),
    ).size !== notarySummaries.length
  )
    throw invalidResponse();
  if (value.canReadLedger === false && value.ledger === null)
    return { ...expected, notarySummaries, canReadLedger: false, ledger: null };
  if (
    value.canReadLedger !== true ||
    !record(value.ledger) ||
    !exact(value.ledger, ['items', 'total', 'page', 'pageSize'])
  )
    throw invalidResponse();
  return {
    ...expected,
    notarySummaries,
    canReadLedger: true,
    ledger: page(value.ledger, parsed, fee, (item) => item.feeId.toLowerCase()),
  };
}
