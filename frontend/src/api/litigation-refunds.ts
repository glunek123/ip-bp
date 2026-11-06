import { ApiError, getBlob, getJson, requestJson, type RequestOptions } from './http';

export const refundStatuses = [
  'UNKNOWN',
  'PENDING',
  'SUBMITTED',
  'RETURNED_UNSETTLED',
  'SETTLED',
  'RECEIVED',
  'CANCELLED',
] as const;
export type RefundStatus = (typeof refundStatuses)[number];
export type RefundParty = 'COURT' | 'DEFENDANT';
export type RefundSource = {
  type: 'JUDGMENT' | 'SECOND_INSTANCE_RESULT';
  id: string;
  trialRoundId: string;
  label: string;
  valid: boolean;
};
export type RefundRow = {
  caseId: string;
  itemId: string;
  inventoryVersionId: string;
  caseNo: string;
  plaintiff: string;
  defendant: string;
  courtNo: string | null;
  lawyer: string | null;
  party: RefundParty;
  amount: string | null;
  status: RefundStatus;
  description: string;
  remark: string | null;
  archived: boolean;
  archiveStatus: RefundStatus | null;
  canFollow: boolean;
  canRecord: boolean;
  source: RefundSource | null;
};
export type RefundSummary = {
  unrefundedAmount: string;
  unrefundedCount: number;
  pendingSettlementAmount: string;
  filteredAmount: string;
  unknownAmountCount: number;
};
export type RefundListQuery = {
  plaintiff?: string;
  defendant?: string;
  courtNo?: string;
  lawyer?: string;
  status?: RefundStatus | '';
  page?: number;
  pageSize?: number;
};
export type RefundList = {
  items: RefundRow[];
  total: number;
  page: number;
  pageSize: number;
  summary: RefundSummary;
  asOf: string;
};
export type RefundSourceOption = {
  type: RefundSource['type'];
  id: string;
  trialRoundId: string;
  label: string;
  courtNo: string | null;
};
export type RefundWorkspace = {
  caseId: string;
  inventoryVersionId: string | null;
  canRecord: boolean;
  canFollow: boolean;
  sources: RefundSourceOption[];
  items: RefundRow[];
};
export type RefundCapabilities = {
  read: boolean;
  record: boolean;
  follow: boolean;
  export: boolean;
};
export type RefundCommandResult = {
  commandId: string;
  inventoryVersionId: string;
  item: RefundRow;
};
export type RefundFollowUpInput = {
  expectedInventoryVersionId: string;
  status: RefundStatus;
  remark: string | null;
  reason: string | null;
  idempotencyKey: string;
};
export type RefundRecordInput = {
  itemId: string;
  expectedInventoryVersionId: string | null;
  sourceType: RefundSource['type'];
  sourceId: string;
  party: RefundParty;
  amount: string | null;
  description: string;
  reason: string;
  idempotencyKey: string;
};
export type RefundCorrectionInput = Omit<RefundRecordInput, 'itemId'>;

type RecordValue = Record<string, unknown>;
function isRecord(value: unknown): value is RecordValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function exact(value: RecordValue, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, i) => key === expected[i]);
}
function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}
function isStatus(value: unknown): value is RefundStatus {
  return typeof value === 'string' && (refundStatuses as readonly string[]).includes(value);
}
function isSource(value: unknown): value is RefundSource {
  return isRecord(value) && exact(value, ['type', 'id', 'trialRoundId', 'label', 'valid']) &&
    (value.type === 'JUDGMENT' || value.type === 'SECOND_INSTANCE_RESULT') &&
    typeof value.id === 'string' && typeof value.trialRoundId === 'string' &&
    typeof value.label === 'string' && typeof value.valid === 'boolean';
}
function isRow(value: unknown): value is RefundRow {
  return isRecord(value) && exact(value, [
    'caseId', 'itemId', 'inventoryVersionId', 'caseNo', 'plaintiff', 'defendant',
    'courtNo', 'lawyer', 'party', 'amount', 'status', 'description', 'remark',
    'archived', 'archiveStatus', 'canFollow', 'canRecord', 'source',
  ]) && typeof value.caseId === 'string' && typeof value.itemId === 'string' &&
    typeof value.inventoryVersionId === 'string' && typeof value.caseNo === 'string' &&
    typeof value.plaintiff === 'string' && typeof value.defendant === 'string' &&
    nullableString(value.courtNo) && nullableString(value.lawyer) &&
    (value.party === 'COURT' || value.party === 'DEFENDANT') &&
    nullableString(value.amount) && isStatus(value.status) && typeof value.description === 'string' &&
    nullableString(value.remark) && typeof value.archived === 'boolean' &&
    (value.archiveStatus === null || isStatus(value.archiveStatus)) &&
    typeof value.canFollow === 'boolean' && typeof value.canRecord === 'boolean' &&
    (value.source === null || isSource(value.source));
}
function invalidResponse(): ApiError {
  return new ApiError('服务返回了无效的诉讼退费数据', 200, 'INVALID_RESPONSE');
}
function queryString(query: RefundListQuery, paged: boolean): string {
  const params = new URLSearchParams();
  for (const key of ['plaintiff', 'defendant', 'courtNo', 'lawyer'] as const) {
    const value = query[key]?.trim();
    if (value) params.set(key, value);
  }
  if (query.status) params.set('status', query.status);
  if (paged) {
    params.set('page', String(query.page ?? 1));
    params.set('pageSize', String(query.pageSize ?? 20));
  }
  const result = params.toString();
  return result ? `?${result}` : '';
}
function isSummary(value: unknown): value is RefundSummary {
  return isRecord(value) && exact(value, ['unrefundedAmount', 'unrefundedCount', 'pendingSettlementAmount', 'filteredAmount', 'unknownAmountCount']) &&
    typeof value.unrefundedAmount === 'string' && Number.isInteger(value.unrefundedCount) &&
    typeof value.pendingSettlementAmount === 'string' && typeof value.filteredAmount === 'string' &&
    Number.isInteger(value.unknownAmountCount) && Number(value.unknownAmountCount) >= 0;
}
function parseList(value: unknown): RefundList {
  if (!isRecord(value) || !exact(value, ['items', 'total', 'page', 'pageSize', 'summary', 'asOf']) ||
    !Array.isArray(value.items) || !value.items.every(isRow) || !Number.isInteger(value.total) ||
    !Number.isInteger(value.page) || !Number.isInteger(value.pageSize) || !isSummary(value.summary) ||
    typeof value.asOf !== 'string') throw invalidResponse();
  return value as unknown as RefundList;
}

export async function getLitigationRefundCapabilities(options: RequestOptions = {}): Promise<RefundCapabilities> {
  const value = await getJson('/cases/litigation-refunds/context', options);
  if (!isRecord(value) || !exact(value, ['read', 'record', 'follow', 'export']) ||
    !['read', 'record', 'follow', 'export'].every((key) => typeof value[key] === 'boolean')) throw invalidResponse();
  return value as unknown as RefundCapabilities;
}
export async function listLitigationRefunds(query: RefundListQuery = {}, options: RequestOptions = {}): Promise<RefundList> {
  return parseList(await getJson(`/cases/litigation-refunds${queryString(query, true)}`, options));
}
export async function getLitigationRefundWorkspace(caseId: string, options: RequestOptions = {}): Promise<RefundWorkspace> {
  const value = await getJson(`/cases/litigation-refunds/${encodeURIComponent(caseId)}/workspace`, options);
  if (!isRecord(value) || !exact(value, ['caseId', 'inventoryVersionId', 'canRecord', 'canFollow', 'sources', 'items']) ||
    typeof value.caseId !== 'string' || !nullableString(value.inventoryVersionId) ||
    typeof value.canRecord !== 'boolean' || typeof value.canFollow !== 'boolean' ||
    !Array.isArray(value.sources) || !value.sources.every((row) => isRecord(row) && exact(row, ['type', 'id', 'trialRoundId', 'label', 'courtNo']) &&
      (row.type === 'JUDGMENT' || row.type === 'SECOND_INSTANCE_RESULT') && typeof row.id === 'string' &&
      typeof row.trialRoundId === 'string' && typeof row.label === 'string' && nullableString(row.courtNo)) ||
    !Array.isArray(value.items) || !value.items.every(isRow)) throw invalidResponse();
  return value as unknown as RefundWorkspace;
}
export async function getLitigationRefund(caseId: string, itemId: string, options: RequestOptions = {}): Promise<RefundRow> {
  const value = await getJson(`/cases/litigation-refunds/${encodeURIComponent(caseId)}/items/${encodeURIComponent(itemId)}`, options);
  if (!isRow(value)) throw invalidResponse();
  return value;
}
export async function recordLitigationRefund(caseId: string, input: RefundRecordInput): Promise<RefundCommandResult> {
  return parseCommand(await requestJson(`/cases/litigation-refunds/${encodeURIComponent(caseId)}/items`, { method: 'POST', body: input }));
}
export async function correctLitigationRefund(caseId: string, itemId: string, input: RefundCorrectionInput): Promise<RefundCommandResult> {
  return parseCommand(await requestJson(`/cases/litigation-refunds/${encodeURIComponent(caseId)}/items/${encodeURIComponent(itemId)}/corrections`, { method: 'POST', body: input }));
}
export async function followUpLitigationRefund(caseId: string, itemId: string, input: RefundFollowUpInput): Promise<RefundCommandResult> {
  return parseCommand(await requestJson(`/cases/litigation-refunds/${encodeURIComponent(caseId)}/items/${encodeURIComponent(itemId)}/follow-up`, { method: 'PATCH', body: input }));
}
function parseCommand(value: unknown): RefundCommandResult {
  if (!isRecord(value) || !exact(value, ['commandId', 'inventoryVersionId', 'item']) ||
    typeof value.commandId !== 'string' || typeof value.inventoryVersionId !== 'string' || !isRow(value.item)) throw invalidResponse();
  return value as unknown as RefundCommandResult;
}
export async function getLitigationRefundRequest(caseId: string, key: string, options: RequestOptions = {}): Promise<RefundCommandResult> {
  return parseCommand(await getJson(`/cases/litigation-refunds/${encodeURIComponent(caseId)}/requests/${encodeURIComponent(key)}`, options));
}
export function exportLitigationRefunds(query: RefundListQuery = {}, options: RequestOptions = {}) {
  return getBlob(`/cases/litigation-refunds/export${queryString(query, false)}`, options);
}
