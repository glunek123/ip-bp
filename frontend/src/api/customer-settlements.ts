import { ApiError, getJson, requestJson, type RequestOptions } from './http';

export type CustomerSettlementCapabilities = {
  read: boolean;
  register: boolean;
  correct: boolean;
};

export type CustomerSettlementVersion = {
  id: string;
  recordId: string;
  customerId: string;
  departmentId: string;
  version: number;
  action: 'REGISTER' | 'CORRECT';
  settlementDate: string;
  settlementAmount: string;
  invoiceAmount: string | null;
  receivedAmount: string | null;
  receivedDate: string | null;
  correctionReason: string | null;
  recordedByUserId: string;
  recordedAt: string;
  auditEventId: string;
};

export type CustomerSettlementRecord = {
  id: string;
  version: number;
  currentVersion: CustomerSettlementVersion;
};

export type CustomerSettlementStats = {
  recordCount: number;
  totalSettlement: string;
  invoiceKnownSubtotal: string;
  invoiceUnknownCount: number;
  receivedKnownSubtotal: string;
  receivedUnknownCount: number;
  pendingAmount: string | null;
  recoveryRate: string | null;
};

export type CustomerSettlementPage = {
  items: CustomerSettlementRecord[];
  total: number;
  page: number;
  pageSize: number;
  stats: CustomerSettlementStats;
  capabilities: CustomerSettlementCapabilities;
  customerVersion: number;
};

export type CustomerSettlementDetail = {
  record: CustomerSettlementRecord;
  capabilities: CustomerSettlementCapabilities;
  customerVersion: number;
};

export type CustomerSettlementVersionPage = {
  items: CustomerSettlementVersion[];
  total: number;
  page: number;
  pageSize: number;
};

export type CustomerSettlementFacts = {
  settlementDate: string;
  settlementAmount: string;
  invoiceAmount?: string | null;
  receivedAmount?: string | null;
  receivedDate?: string | null;
};

export type RegisterCustomerSettlementInput = CustomerSettlementFacts & {
  expectedCustomerVersion: number;
};

export type CorrectCustomerSettlementInput = {
  expectedCustomerVersion: number;
  expectedRecordVersion: number;
  settlementDate: string;
  settlementAmount: string;
  invoiceAmount: string | null;
  receivedAmount: string | null;
  receivedDate: string | null;
  reason: string;
};

export type CustomerSettlementCommandResult = {
  recordId: string;
  version: number;
  customerVersion: number;
  snapshot: CustomerSettlementVersion;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, i) => key === expected[i])
  );
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function count(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function dateOnly(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value))
    return false;
  const [year, month, day] = value.split('-').map(Number);
  if (year === 0) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthLengths = [
    31,
    leap ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  return (
    month >= 1 && month <= 12 && day >= 1 && day <= monthLengths[month - 1]
  );
}

function dateTime(value: unknown): value is string {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(
      value,
    ) ||
    !dateOnly(value.slice(0, 10))
  )
    return false;
  const hour = Number(value.slice(11, 13));
  const minute = Number(value.slice(14, 16));
  const second = Number(value.slice(17, 19));
  return (
    hour <= 23 &&
    minute <= 59 &&
    second <= 59 &&
    Number.isFinite(Date.parse(value))
  );
}

function factAmount(value: unknown): value is string {
  return (
    typeof value === 'string' && /^(?:0|[1-9]\d{0,15})\.\d{2}$/u.test(value)
  );
}

function aggregateAmount(value: unknown): value is string {
  return typeof value === 'string' && /^(?:0|[1-9]\d*)\.\d{2}$/u.test(value);
}

function signedAggregate(value: unknown): value is string {
  return (
    aggregateAmount(value) ||
    (typeof value === 'string' && /^-(?:0|[1-9]\d*)\.\d{2}$/u.test(value))
  );
}

function capabilitySet(
  value: unknown,
): value is CustomerSettlementCapabilities {
  return (
    isRecord(value) &&
    exactKeys(value, ['read', 'register', 'correct']) &&
    typeof value.read === 'boolean' &&
    typeof value.register === 'boolean' &&
    typeof value.correct === 'boolean'
  );
}

function version(
  value: unknown,
  customerId: string,
  recordId?: string,
): value is CustomerSettlementVersion {
  return (
    isRecord(value) &&
    exactKeys(value, [
      'id',
      'recordId',
      'customerId',
      'departmentId',
      'version',
      'action',
      'settlementDate',
      'settlementAmount',
      'invoiceAmount',
      'receivedAmount',
      'receivedDate',
      'correctionReason',
      'recordedByUserId',
      'recordedAt',
      'auditEventId',
    ]) &&
    nonEmpty(value.id) &&
    nonEmpty(value.recordId) &&
    (recordId === undefined || value.recordId === recordId) &&
    value.customerId === customerId &&
    nonEmpty(value.departmentId) &&
    positiveInteger(value.version) &&
    (value.action === 'REGISTER' || value.action === 'CORRECT') &&
    dateOnly(value.settlementDate) &&
    factAmount(value.settlementAmount) &&
    (value.invoiceAmount === null || factAmount(value.invoiceAmount)) &&
    (value.receivedAmount === null || factAmount(value.receivedAmount)) &&
    (value.receivedDate === null || dateOnly(value.receivedDate)) &&
    (value.correctionReason === null ||
      (typeof value.correctionReason === 'string' &&
        value.correctionReason.length > 0)) &&
    nonEmpty(value.recordedByUserId) &&
    dateTime(value.recordedAt) &&
    nonEmpty(value.auditEventId) &&
    (value.action === 'REGISTER'
      ? value.version === 1 && value.correctionReason === null
      : value.correctionReason !== null)
  );
}

function settlementRecord(
  value: unknown,
  customerId: string,
): value is CustomerSettlementRecord {
  return (
    isRecord(value) &&
    exactKeys(value, ['id', 'version', 'currentVersion']) &&
    nonEmpty(value.id) &&
    positiveInteger(value.version) &&
    version(value.currentVersion, customerId, value.id) &&
    value.currentVersion.version === value.version
  );
}

function stats(value: unknown): value is CustomerSettlementStats {
  return (
    isRecord(value) &&
    exactKeys(value, [
      'recordCount',
      'totalSettlement',
      'invoiceKnownSubtotal',
      'invoiceUnknownCount',
      'receivedKnownSubtotal',
      'receivedUnknownCount',
      'pendingAmount',
      'recoveryRate',
    ]) &&
    count(value.recordCount) &&
    aggregateAmount(value.totalSettlement) &&
    aggregateAmount(value.invoiceKnownSubtotal) &&
    count(value.invoiceUnknownCount) &&
    aggregateAmount(value.receivedKnownSubtotal) &&
    count(value.receivedUnknownCount) &&
    (value.pendingAmount === null || signedAggregate(value.pendingAmount)) &&
    (value.recoveryRate === null || aggregateAmount(value.recoveryRate)) &&
    value.pendingAmount !== '-0.00' &&
    value.recordCount >= value.invoiceUnknownCount &&
    value.recordCount >= value.receivedUnknownCount
  );
}

function invalidResponse(): ApiError {
  return new ApiError('服务返回了无效的客户结算数据', 200, 'INVALID_RESPONSE');
}

function validatePage(page: number, pageSize: number): void {
  if (
    !Number.isInteger(page) ||
    page < 1 ||
    !Number.isInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > 100
  )
    throw new RangeError('客户结算分页参数无效');
}

function validateKey(key: string): void {
  if (key.length < 1 || key.length > 200)
    throw new ApiError('Idempotency-Key 无效', 400, 'VALIDATION_ERROR');
}

function decodePage(
  value: unknown,
  customerId: string,
  page: number,
  pageSize: number,
): CustomerSettlementPage {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      'items',
      'total',
      'page',
      'pageSize',
      'stats',
      'capabilities',
      'customerVersion',
    ]) ||
    !Array.isArray(value.items) ||
    !value.items.every((item) => settlementRecord(item, customerId)) ||
    !count(value.total) ||
    value.page !== page ||
    value.pageSize !== pageSize ||
    !stats(value.stats) ||
    !capabilitySet(value.capabilities) ||
    !positiveInteger(value.customerVersion)
  )
    throw invalidResponse();
  return value as unknown as CustomerSettlementPage;
}

function decodeDetail(
  value: unknown,
  customerId: string,
  recordId: string,
): CustomerSettlementDetail {
  if (
    !isRecord(value) ||
    !exactKeys(value, ['record', 'capabilities', 'customerVersion']) ||
    !settlementRecord(value.record, customerId) ||
    value.record.id !== recordId ||
    !capabilitySet(value.capabilities) ||
    !positiveInteger(value.customerVersion)
  )
    throw invalidResponse();
  return value as unknown as CustomerSettlementDetail;
}

function decodeVersionPage(
  value: unknown,
  customerId: string,
  recordId: string,
  page: number,
  pageSize: number,
): CustomerSettlementVersionPage {
  if (
    !isRecord(value) ||
    !exactKeys(value, ['items', 'total', 'page', 'pageSize']) ||
    !Array.isArray(value.items) ||
    !value.items.every((item) => version(item, customerId, recordId)) ||
    !count(value.total) ||
    value.page !== page ||
    value.pageSize !== pageSize
  )
    throw invalidResponse();
  return value as unknown as CustomerSettlementVersionPage;
}

function decodeCommand(
  value: unknown,
  customerId: string,
): CustomerSettlementCommandResult {
  if (
    !isRecord(value) ||
    !exactKeys(value, ['recordId', 'version', 'customerVersion', 'snapshot']) ||
    !nonEmpty(value.recordId) ||
    !positiveInteger(value.version) ||
    !positiveInteger(value.customerVersion) ||
    !version(value.snapshot, customerId, value.recordId) ||
    value.snapshot.version !== value.version
  )
    throw invalidResponse();
  return value as unknown as CustomerSettlementCommandResult;
}

export async function listCustomerSettlements(
  customerId: string,
  page = 1,
  pageSize = 20,
  options: RequestOptions = {},
): Promise<CustomerSettlementPage> {
  validatePage(page, pageSize);
  return decodePage(
    await getJson(
      `/customers/${encodeURIComponent(customerId)}/settlements?page=${page}&pageSize=${pageSize}`,
      options,
    ),
    customerId,
    page,
    pageSize,
  );
}

export async function getCustomerSettlement(
  customerId: string,
  recordId: string,
  options: RequestOptions = {},
): Promise<CustomerSettlementDetail> {
  return decodeDetail(
    await getJson(
      `/customers/${encodeURIComponent(customerId)}/settlements/${encodeURIComponent(recordId)}`,
      options,
    ),
    customerId,
    recordId,
  );
}

export async function listCustomerSettlementVersions(
  customerId: string,
  recordId: string,
  page = 1,
  pageSize = 20,
  options: RequestOptions = {},
): Promise<CustomerSettlementVersionPage> {
  validatePage(page, pageSize);
  return decodeVersionPage(
    await getJson(
      `/customers/${encodeURIComponent(customerId)}/settlements/${encodeURIComponent(recordId)}/versions?page=${page}&pageSize=${pageSize}`,
      options,
    ),
    customerId,
    recordId,
    page,
    pageSize,
  );
}

export async function registerCustomerSettlement(
  customerId: string,
  body: RegisterCustomerSettlementInput,
  key: string,
  options: RequestOptions = {},
): Promise<CustomerSettlementCommandResult> {
  validateKey(key);
  return decodeCommand(
    await requestJson(
      `/customers/${encodeURIComponent(customerId)}/settlements`,
      {
        ...options,
        method: 'POST',
        body,
        headers: { ...options.headers, 'Idempotency-Key': key },
      },
    ),
    customerId,
  );
}

export async function correctCustomerSettlement(
  customerId: string,
  recordId: string,
  body: CorrectCustomerSettlementInput,
  key: string,
  options: RequestOptions = {},
): Promise<CustomerSettlementCommandResult> {
  validateKey(key);
  return decodeCommand(
    await requestJson(
      `/customers/${encodeURIComponent(customerId)}/settlements/${encodeURIComponent(recordId)}/corrections`,
      {
        ...options,
        method: 'POST',
        body,
        headers: { ...options.headers, 'Idempotency-Key': key },
      },
    ),
    customerId,
  );
}
