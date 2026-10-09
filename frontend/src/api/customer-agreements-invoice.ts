import { ApiError, getJson, requestJson, type RequestOptions } from './http';

export type AgreementValidityMode = 'FIXED' | 'LONG_TERM' | 'UNKNOWN';

export type CustomerAgreementFile = {
  materialId: string;
  contentVersionId: string;
  originalFilename: string;
  mimeType: string;
};

export type CustomerAgreementVersion = {
  id: string;
  agreementId: string;
  customerId: string;
  departmentId: string;
  version: number;
  title: string;
  model: string | null;
  settlementMethod: string | null;
  validityMode: AgreementValidityMode;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  contentVersionIds: string[];
  files: CustomerAgreementFile[];
  recordedByUserId: string;
  recordedAt: string;
  auditEventId: string;
};

export type CustomerAgreement = {
  id: string;
  version: number;
  currentVersion: CustomerAgreementVersion;
};

export type CustomerAgreementResponse = {
  agreement: CustomerAgreement | null;
  canEdit: boolean;
  customerVersion: number;
};

export type CustomerInvoiceProfileVersion = {
  id: string;
  profileId: string;
  customerId: string;
  departmentId: string;
  version: number;
  invoiceType: string | null;
  invoiceSubject: string | null;
  taxNo: string | null;
  bank: string | null;
  recordedByUserId: string;
  recordedAt: string;
  auditEventId: string;
};

export type CustomerInvoiceProfile = {
  id: string;
  version: number;
  currentVersion: CustomerInvoiceProfileVersion;
};

export type CustomerInvoiceProfileResponse = {
  profile: CustomerInvoiceProfile | null;
  canEdit: boolean;
  customerVersion: number;
};

export type CustomerAgreementVersionPage = {
  items: CustomerAgreementVersion[];
  total: number;
  page: number;
  pageSize: number;
};

export type CustomerInvoiceVersionPage = {
  items: CustomerInvoiceProfileVersion[];
  total: number;
  page: number;
  pageSize: number;
};

type AgreementFields = {
  title?: string;
  model?: string | null;
  settlementMethod?: string | null;
  validityMode?: AgreementValidityMode;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
  contentVersionIds?: string[];
};

export type CreateCustomerAgreementInput = AgreementFields & {
  expectedCustomerVersion: number;
  title: string;
  validityMode: AgreementValidityMode;
};

export type ReviseCustomerAgreementInput = AgreementFields & {
  expectedCustomerVersion: number;
  expectedAgreementVersion: number;
};

type InvoiceFields = {
  invoiceType?: string | null;
  invoiceSubject?: string | null;
  taxNo?: string | null;
  bank?: string | null;
};

export type CreateCustomerInvoiceProfileInput = InvoiceFields & {
  expectedCustomerVersion: number;
};

export type ReviseCustomerInvoiceProfileInput = InvoiceFields & {
  expectedCustomerVersion: number;
  expectedInvoiceVersion: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 1;
}

function isDateTime(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    Number.isFinite(Date.parse(value)) &&
    value.includes('T')
  );
}

function isDateOnly(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value))
    return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isAgreementFile(value: unknown): value is CustomerAgreementFile {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      'materialId',
      'contentVersionId',
      'originalFilename',
      'mimeType',
    ]) &&
    isNonEmptyString(value.materialId) &&
    isNonEmptyString(value.contentVersionId) &&
    typeof value.originalFilename === 'string' &&
    typeof value.mimeType === 'string'
  );
}

function isAgreementVersion(
  value: unknown,
  customerId: string,
  agreementId?: string,
): value is CustomerAgreementVersion {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'id',
      'agreementId',
      'customerId',
      'departmentId',
      'version',
      'title',
      'model',
      'settlementMethod',
      'validityMode',
      'effectiveFrom',
      'effectiveTo',
      'contentVersionIds',
      'files',
      'recordedByUserId',
      'recordedAt',
      'auditEventId',
    ]) ||
    !isNonEmptyString(value.id) ||
    !isNonEmptyString(value.agreementId) ||
    (agreementId !== undefined && value.agreementId !== agreementId) ||
    value.customerId !== customerId ||
    !isNonEmptyString(value.departmentId) ||
    !isPositiveInteger(value.version) ||
    typeof value.title !== 'string' ||
    value.title.length === 0 ||
    !nullableString(value.model) ||
    !nullableString(value.settlementMethod) ||
    (value.validityMode !== 'FIXED' &&
      value.validityMode !== 'LONG_TERM' &&
      value.validityMode !== 'UNKNOWN') ||
    !(value.effectiveFrom === null || isDateOnly(value.effectiveFrom)) ||
    !(value.effectiveTo === null || isDateOnly(value.effectiveTo)) ||
    (value.validityMode === 'FIXED'
      ? value.effectiveTo === null
      : value.effectiveTo !== null) ||
    !Array.isArray(value.contentVersionIds) ||
    !value.contentVersionIds.every(isNonEmptyString) ||
    new Set(value.contentVersionIds).size !== value.contentVersionIds.length ||
    !Array.isArray(value.files) ||
    !value.files.every(isAgreementFile) ||
    value.files.length !== value.contentVersionIds.length ||
    !value.files.every(
      (file, index) =>
        file.contentVersionId === (value.contentVersionIds as string[])[index],
    ) ||
    !isNonEmptyString(value.recordedByUserId) ||
    !isDateTime(value.recordedAt) ||
    !isNonEmptyString(value.auditEventId)
  ) {
    return false;
  }
  return true;
}

function isAgreementEntity(
  value: unknown,
  customerId: string,
): value is CustomerAgreement {
  return (
    isRecord(value) &&
    hasExactKeys(value, ['id', 'version', 'currentVersion']) &&
    isNonEmptyString(value.id) &&
    isPositiveInteger(value.version) &&
    isAgreementVersion(value.currentVersion, customerId, value.id) &&
    value.currentVersion.version === value.version
  );
}

function isInvoiceVersion(
  value: unknown,
  customerId: string,
  profileId?: string,
): value is CustomerInvoiceProfileVersion {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      'id',
      'profileId',
      'customerId',
      'departmentId',
      'version',
      'invoiceType',
      'invoiceSubject',
      'taxNo',
      'bank',
      'recordedByUserId',
      'recordedAt',
      'auditEventId',
    ]) &&
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.profileId) &&
    (profileId === undefined || value.profileId === profileId) &&
    value.customerId === customerId &&
    isNonEmptyString(value.departmentId) &&
    isPositiveInteger(value.version) &&
    nullableString(value.invoiceType) &&
    nullableString(value.invoiceSubject) &&
    nullableString(value.taxNo) &&
    nullableString(value.bank) &&
    isNonEmptyString(value.recordedByUserId) &&
    isDateTime(value.recordedAt) &&
    isNonEmptyString(value.auditEventId)
  );
}

function isInvoiceEntity(
  value: unknown,
  customerId: string,
): value is CustomerInvoiceProfile {
  return (
    isRecord(value) &&
    hasExactKeys(value, ['id', 'version', 'currentVersion']) &&
    isNonEmptyString(value.id) &&
    isPositiveInteger(value.version) &&
    isInvoiceVersion(value.currentVersion, customerId, value.id) &&
    value.currentVersion.version === value.version
  );
}

function invalidResponse(): ApiError {
  return new ApiError(
    '服务返回了无效的客户协议或开票数据',
    200,
    'INVALID_RESPONSE',
  );
}

function decodeAgreementResponse(
  value: unknown,
  customerId: string,
): CustomerAgreementResponse {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['agreement', 'canEdit', 'customerVersion']) ||
    !(
      value.agreement === null || isAgreementEntity(value.agreement, customerId)
    ) ||
    typeof value.canEdit !== 'boolean' ||
    !isPositiveInteger(value.customerVersion)
  ) {
    throw invalidResponse();
  }
  return value as unknown as CustomerAgreementResponse;
}

function decodeInvoiceResponse(
  value: unknown,
  customerId: string,
): CustomerInvoiceProfileResponse {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['profile', 'canEdit', 'customerVersion']) ||
    !(value.profile === null || isInvoiceEntity(value.profile, customerId)) ||
    typeof value.canEdit !== 'boolean' ||
    !isPositiveInteger(value.customerVersion)
  ) {
    throw invalidResponse();
  }
  return value as unknown as CustomerInvoiceProfileResponse;
}

function decodeAgreementPage(
  value: unknown,
  customerId: string,
  agreementId: string,
  page: number,
  pageSize: number,
): CustomerAgreementVersionPage {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['items', 'total', 'page', 'pageSize']) ||
    !Array.isArray(value.items) ||
    !value.items.every((item) =>
      isAgreementVersion(item, customerId, agreementId),
    ) ||
    !Number.isSafeInteger(value.total) ||
    Number(value.total) < 0 ||
    value.page !== page ||
    value.pageSize !== pageSize
  ) {
    throw invalidResponse();
  }
  return value as unknown as CustomerAgreementVersionPage;
}

function decodeInvoicePage(
  value: unknown,
  customerId: string,
  page: number,
  pageSize: number,
): CustomerInvoiceVersionPage {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['items', 'total', 'page', 'pageSize']) ||
    !Array.isArray(value.items) ||
    !value.items.every((item) => isInvoiceVersion(item, customerId)) ||
    !Number.isSafeInteger(value.total) ||
    Number(value.total) < 0 ||
    value.page !== page ||
    value.pageSize !== pageSize
  ) {
    throw invalidResponse();
  }
  return value as unknown as CustomerInvoiceVersionPage;
}

function validateKey(key: string): void {
  if (key.length < 1 || key.length > 200) {
    throw new ApiError('Idempotency-Key 无效', 400, 'VALIDATION_ERROR');
  }
}

function validatePage(page: number, pageSize: number): void {
  if (
    !Number.isInteger(page) ||
    page < 1 ||
    !Number.isInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > 100
  ) {
    throw new RangeError('客户协议与开票历史分页参数无效');
  }
}

export async function getCustomerAgreement(
  customerId: string,
  options: RequestOptions = {},
): Promise<CustomerAgreementResponse> {
  return decodeAgreementResponse(
    await getJson(
      `/customers/${encodeURIComponent(customerId)}/agreements`,
      options,
    ),
    customerId,
  );
}

export async function createCustomerAgreement(
  customerId: string,
  input: CreateCustomerAgreementInput,
  idempotencyKey: string,
  options: RequestOptions = {},
): Promise<CustomerAgreementResponse> {
  validateKey(idempotencyKey);
  return decodeAgreementResponse(
    await requestJson(
      `/customers/${encodeURIComponent(customerId)}/agreements`,
      {
        ...options,
        method: 'POST',
        body: input,
        headers: { ...options.headers, 'Idempotency-Key': idempotencyKey },
      },
    ),
    customerId,
  );
}

export async function reviseCustomerAgreement(
  customerId: string,
  agreementId: string,
  input: ReviseCustomerAgreementInput,
  idempotencyKey: string,
  options: RequestOptions = {},
): Promise<CustomerAgreementResponse> {
  validateKey(idempotencyKey);
  return decodeAgreementResponse(
    await requestJson(
      `/customers/${encodeURIComponent(customerId)}/agreements/${encodeURIComponent(agreementId)}/revisions`,
      {
        ...options,
        method: 'POST',
        body: input,
        headers: { ...options.headers, 'Idempotency-Key': idempotencyKey },
      },
    ),
    customerId,
  );
}

export async function listCustomerAgreementVersions(
  customerId: string,
  agreementId: string,
  page = 1,
  pageSize = 20,
  options: RequestOptions = {},
): Promise<CustomerAgreementVersionPage> {
  validatePage(page, pageSize);
  const value = await getJson(
    `/customers/${encodeURIComponent(customerId)}/agreements/${encodeURIComponent(agreementId)}/versions?page=${page}&pageSize=${pageSize}`,
    options,
  );
  return decodeAgreementPage(value, customerId, agreementId, page, pageSize);
}

export async function getCustomerInvoiceProfile(
  customerId: string,
  options: RequestOptions = {},
): Promise<CustomerInvoiceProfileResponse> {
  return decodeInvoiceResponse(
    await getJson(
      `/customers/${encodeURIComponent(customerId)}/invoice-profile`,
      options,
    ),
    customerId,
  );
}

export async function createCustomerInvoiceProfile(
  customerId: string,
  input: CreateCustomerInvoiceProfileInput,
  idempotencyKey: string,
  options: RequestOptions = {},
): Promise<CustomerInvoiceProfileResponse> {
  validateKey(idempotencyKey);
  return decodeInvoiceResponse(
    await requestJson(
      `/customers/${encodeURIComponent(customerId)}/invoice-profile`,
      {
        ...options,
        method: 'POST',
        body: input,
        headers: { ...options.headers, 'Idempotency-Key': idempotencyKey },
      },
    ),
    customerId,
  );
}

export async function reviseCustomerInvoiceProfile(
  customerId: string,
  input: ReviseCustomerInvoiceProfileInput,
  idempotencyKey: string,
  options: RequestOptions = {},
): Promise<CustomerInvoiceProfileResponse> {
  validateKey(idempotencyKey);
  return decodeInvoiceResponse(
    await requestJson(
      `/customers/${encodeURIComponent(customerId)}/invoice-profile/revisions`,
      {
        ...options,
        method: 'POST',
        body: input,
        headers: { ...options.headers, 'Idempotency-Key': idempotencyKey },
      },
    ),
    customerId,
  );
}

export async function listCustomerInvoiceVersions(
  customerId: string,
  page = 1,
  pageSize = 20,
  options: RequestOptions = {},
): Promise<CustomerInvoiceVersionPage> {
  validatePage(page, pageSize);
  const value = await getJson(
    `/customers/${encodeURIComponent(customerId)}/invoice-profile/versions?page=${page}&pageSize=${pageSize}`,
    options,
  );
  return decodeInvoicePage(value, customerId, page, pageSize);
}
