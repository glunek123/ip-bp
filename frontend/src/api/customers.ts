import { ApiError, getJson, requestJson, type RequestOptions } from './http';
import type {
  CustomerTypeCode,
  IdentityTypeCode,
  IdentityValidityModeCode,
} from '../modules/customers/customer-admission-options';

export type CustomerSummary = {
  id: string;
  name: string;
  customerType: string | null;
  identityType: string | null;
  identityNumber: string | null;
  issuingCountryOrRegion: string | null;
  identityValidFrom: string | null;
  identityValidTo: string | null;
  identityValidityMode: IdentityValidityModeCode | null;
  admittedAt: string | null;
  category: string | null;
  region: string | null;
  admissionContactName: string | null;
  admissionContactPhone: string | null;
  admissionContactEmail: string | null;
  profileStatus: 'draft' | 'admitted';
  departmentId: string;
  responsibleUserId: string;
  version: number;
  updatedAt: string;
};

export type CustomerHistoryEvent = {
  action: string;
  actorUserId: string;
  occurredAt: string;
};

export type CustomerDetail = CustomerSummary & {
  capabilities: { editRoutine: boolean; admit: boolean };
  history: CustomerHistoryEvent[];
};

export type CustomerDraftInput = {
  expectedVersion: number;
  name?: string;
  customerType?: string;
  identityType?: string;
  identityNumber?: string;
  issuingCountryOrRegion?: string;
  category?: string;
  region?: string;
  admissionContactName?: string;
  admissionContactPhone?: string;
  admissionContactEmail?: string;
  duplicateNameReason?: string;
};

export type AdmitCustomerInput = {
  expectedVersion: number;
  customerType: CustomerTypeCode;
  name: string;
  identityType: IdentityTypeCode;
  identityNumber: string;
  issuingCountryOrRegion?: string;
  identityValidFrom?: string;
  identityValidTo?: string;
  identityValidityMode: IdentityValidityModeCode;
  admissionContactName: string;
  admissionContactPhone?: string;
  admissionContactEmail?: string;
  identityDocumentContentVersionIds: string[];
};

export type CustomerDuplicateSummary = Pick<
  CustomerSummary,
  'id' | 'name' | 'category' | 'region'
>;

export type CustomerList = {
  items: CustomerSummary[];
  total: number;
  page: number;
  pageSize: number;
  capabilities: { createDraft: boolean };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isIdentityValidityMode(
  value: unknown,
): value is IdentityValidityModeCode | null {
  return (
    value === null ||
    value === 'FIXED' ||
    value === 'LONG_TERM' ||
    value === 'NOT_STATED'
  );
}

function isCustomerSummary(value: unknown): value is CustomerSummary {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    isNullableString(value.customerType) &&
    isNullableString(value.identityType) &&
    isNullableString(value.identityNumber) &&
    isNullableString(value.issuingCountryOrRegion) &&
    isNullableString(value.identityValidFrom) &&
    isNullableString(value.identityValidTo) &&
    isIdentityValidityMode(value.identityValidityMode) &&
    isNullableString(value.admittedAt) &&
    isNullableString(value.category) &&
    isNullableString(value.region) &&
    isNullableString(value.admissionContactName) &&
    isNullableString(value.admissionContactPhone) &&
    isNullableString(value.admissionContactEmail) &&
    (value.profileStatus === 'draft' || value.profileStatus === 'admitted') &&
    typeof value.departmentId === 'string' &&
    typeof value.responsibleUserId === 'string' &&
    Number.isInteger(value.version) &&
    typeof value.updatedAt === 'string'
  );
}

function invalidResponse(): ApiError {
  return new ApiError('服务返回了无效的客户数据', 200, 'INVALID_RESPONSE');
}

export async function listCustomers(
  page = 1,
  pageSize = 20,
  options: RequestOptions = {},
): Promise<CustomerList> {
  const data = await getJson(
    `/customers?page=${page}&pageSize=${pageSize}`,
    options,
  );
  if (
    !isRecord(data) ||
    !Array.isArray(data.items) ||
    !data.items.every(isCustomerSummary) ||
    !Number.isInteger(data.total) ||
    !Number.isInteger(data.page) ||
    !Number.isInteger(data.pageSize) ||
    !isRecord(data.capabilities) ||
    typeof data.capabilities.createDraft !== 'boolean'
  ) {
    throw invalidResponse();
  }
  return {
    items: data.items,
    total: data.total as number,
    page: data.page as number,
    pageSize: data.pageSize as number,
    capabilities: { createDraft: data.capabilities.createDraft },
  };
}

export async function getCustomer(
  id: string,
  options: RequestOptions = {},
): Promise<CustomerDetail> {
  const data = await getJson(`/customers/${encodeURIComponent(id)}`, options);
  if (!isRecord(data)) {
    throw invalidResponse();
  }
  const history = data.history;
  const capabilities = data.capabilities;
  if (
    !isCustomerSummary(data) ||
    !Array.isArray(history) ||
    !isRecord(capabilities) ||
    typeof capabilities.editRoutine !== 'boolean' ||
    typeof capabilities.admit !== 'boolean' ||
    !history.every(
      (event: unknown) =>
        isRecord(event) &&
        typeof event.action === 'string' &&
        typeof event.actorUserId === 'string' &&
        typeof event.occurredAt === 'string',
    )
  ) {
    throw invalidResponse();
  }
  return {
    ...data,
    capabilities: {
      editRoutine: capabilities.editRoutine,
      admit: capabilities.admit,
    },
    history: history as CustomerHistoryEvent[],
  };
}

export async function createCustomerDraft(input: {
  name: string;
  category?: string;
  region?: string;
  admissionContactName?: string;
  admissionContactPhone?: string;
  admissionContactEmail?: string;
  duplicateNameReason?: string;
}): Promise<CustomerSummary> {
  const data = await requestJson('/customers', {
    method: 'POST',
    body: input,
  });
  if (!isCustomerSummary(data)) {
    throw invalidResponse();
  }
  return data;
}

export async function updateCustomerDraft(
  id: string,
  input: CustomerDraftInput,
): Promise<CustomerSummary> {
  const data = await requestJson(`/customers/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: input,
  });
  if (!isCustomerSummary(data)) throw invalidResponse();
  return data;
}

export async function admitCustomer(
  id: string,
  input: AdmitCustomerInput,
  idempotencyKey: string,
): Promise<CustomerSummary> {
  const data = await requestJson(
    `/customers/${encodeURIComponent(id)}/admission`,
    {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: input,
    },
  );
  if (
    !isCustomerSummary(data) ||
    data.id !== id ||
    data.profileStatus !== 'admitted' ||
    data.admittedAt === null ||
    data.customerType !== input.customerType ||
    data.identityType !== input.identityType ||
    data.identityNumber === null ||
    data.identityValidityMode !== input.identityValidityMode ||
    data.admissionContactName === null ||
    (data.admissionContactPhone === null && data.admissionContactEmail === null)
  ) {
    throw invalidResponse();
  }
  return data;
}

export async function findCustomerDuplicates(
  query: {
    name?: string;
    identityType?: string;
    identityNumber?: string;
    excludeCustomerId?: string;
  },
  options: RequestOptions = {},
): Promise<{
  exactIdentity: CustomerDuplicateSummary[];
  sameName: CustomerDuplicateSummary[];
}> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value) params.set(key, value);
  }
  const data = await getJson(`/customers/duplicates?${params}`, options);
  const validSummary = (value: unknown): value is CustomerDuplicateSummary =>
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    isNullableString(value.category) &&
    isNullableString(value.region);
  if (
    !isRecord(data) ||
    !Array.isArray(data.exactIdentity) ||
    !data.exactIdentity.every(validSummary) ||
    !Array.isArray(data.sameName) ||
    !data.sameName.every(validSummary)
  ) {
    throw invalidResponse();
  }
  return {
    exactIdentity: data.exactIdentity,
    sameName: data.sameName,
  };
}
