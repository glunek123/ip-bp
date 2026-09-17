import { ApiError, getJson, requestJson, type RequestOptions } from './http';

export type CustomerSummary = {
  id: string;
  name: string;
  category: string | null;
  region: string | null;
  profileStatus: 'draft';
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
  history: CustomerHistoryEvent[];
};

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

function isCustomerSummary(value: unknown): value is CustomerSummary {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    isNullableString(value.category) &&
    isNullableString(value.region) &&
    value.profileStatus === 'draft' &&
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
  if (
    !isCustomerSummary(data) ||
    !Array.isArray(history) ||
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
    history: history as CustomerHistoryEvent[],
  };
}

export async function createCustomerDraft(input: {
  name: string;
  category?: string;
  region?: string;
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
