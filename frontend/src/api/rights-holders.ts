import { ApiError, getJson, requestJson, type RequestOptions } from './http';

export type RightsHolderSummary = {
  id: string;
  name: string;
  credit: string | null;
  address: string | null;
  legalRepresentative: string | null;
  duty: string | null;
  updatedAt: string;
};

export type RightsHolderList = {
  items: RightsHolderSummary[];
  total: number;
  page: number;
  pageSize: number;
  capabilities: { create: boolean; link: boolean };
};

export type LinkableRightsHolderList = Omit<RightsHolderList, 'capabilities'>;

export type RightsHolderCommandResult = {
  holder: RightsHolderSummary;
  linkId: string;
  customerVersion: number;
};

export type CreateRightsHolderInput = {
  expectedCustomerVersion: number;
  name: string;
  credit?: string;
  address?: string;
  legalRepresentative?: string;
  duty?: string;
};

export type LinkRightsHolderInput = {
  expectedCustomerVersion: number;
  rightsHolderId: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  return (
    actual.length === expected.length &&
    [...expected].sort().every((key, index) => key === actual[index])
  );
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isRightsHolder(value: unknown): value is RightsHolderSummary {
  if (!isRecord(value)) return false;
  return (
    hasExactKeys(value, [
      'id',
      'name',
      'credit',
      'address',
      'legalRepresentative',
      'duty',
      'updatedAt',
    ]) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    isNullableString(value.credit) &&
    isNullableString(value.address) &&
    isNullableString(value.legalRepresentative) &&
    isNullableString(value.duty) &&
    typeof value.updatedAt === 'string'
  );
}

function isPagination(value: Record<string, unknown>): boolean {
  return (
    Number.isInteger(value.total) &&
    (value.total as number) >= 0 &&
    Number.isInteger(value.page) &&
    (value.page as number) >= 1 &&
    Number.isInteger(value.pageSize) &&
    (value.pageSize as number) >= 1 &&
    (value.pageSize as number) <= 100
  );
}

function invalidResponse(): ApiError {
  return new ApiError('服务返回了无效的权利主体数据', 200, 'INVALID_RESPONSE');
}

function decodeLinkableList(data: unknown): LinkableRightsHolderList {
  if (
    !isRecord(data) ||
    !hasExactKeys(data, ['items', 'total', 'page', 'pageSize']) ||
    !Array.isArray(data.items) ||
    !data.items.every(isRightsHolder) ||
    !isPagination(data)
  ) {
    throw invalidResponse();
  }
  return {
    items: data.items,
    total: data.total as number,
    page: data.page as number,
    pageSize: data.pageSize as number,
  };
}

function decodeCommandResult(data: unknown): RightsHolderCommandResult {
  if (
    !isRecord(data) ||
    !hasExactKeys(data, ['holder', 'linkId', 'customerVersion']) ||
    !isRightsHolder(data.holder) ||
    typeof data.linkId !== 'string' ||
    !Number.isInteger(data.customerVersion) ||
    (data.customerVersion as number) < 1
  ) {
    throw invalidResponse();
  }
  return {
    holder: data.holder,
    linkId: data.linkId,
    customerVersion: data.customerVersion as number,
  };
}

export async function listCustomerRightsHolders(
  customerId: string,
  page = 1,
  pageSize = 20,
  options: RequestOptions = {},
): Promise<RightsHolderList> {
  const data = await getJson(
    `/customers/${encodeURIComponent(customerId)}/rights-holders?page=${page}&pageSize=${pageSize}`,
    options,
  );
  if (
    !isRecord(data) ||
    !hasExactKeys(data, [
      'items',
      'total',
      'page',
      'pageSize',
      'capabilities',
    ]) ||
    !Array.isArray(data.items) ||
    !data.items.every(isRightsHolder) ||
    !isPagination(data) ||
    !isRecord(data.capabilities) ||
    !hasExactKeys(data.capabilities, ['create', 'link']) ||
    typeof data.capabilities.create !== 'boolean' ||
    typeof data.capabilities.link !== 'boolean'
  ) {
    throw invalidResponse();
  }
  return {
    items: data.items,
    total: data.total as number,
    page: data.page as number,
    pageSize: data.pageSize as number,
    capabilities: {
      create: data.capabilities.create,
      link: data.capabilities.link,
    },
  };
}

export async function getCustomerRightsHolder(
  customerId: string,
  rightsHolderId: string,
  options: RequestOptions = {},
): Promise<RightsHolderSummary> {
  const data = await getJson(
    `/customers/${encodeURIComponent(customerId)}/rights-holders/${encodeURIComponent(rightsHolderId)}`,
    options,
  );
  if (!isRightsHolder(data)) throw invalidResponse();
  return data;
}

export async function findLinkableRightsHolders(
  customerId: string,
  query: { query?: string; page?: number; pageSize?: number } = {},
  options: RequestOptions = {},
): Promise<LinkableRightsHolderList> {
  const params = new URLSearchParams();
  if (query.query) params.set('query', query.query);
  params.set('page', String(query.page ?? 1));
  params.set('pageSize', String(query.pageSize ?? 20));
  const data = await getJson(
    `/customers/${encodeURIComponent(customerId)}/linkable-rights-holders?${params}`,
    options,
  );
  return decodeLinkableList(data);
}

export async function createCustomerRightsHolder(
  customerId: string,
  input: CreateRightsHolderInput,
  idempotencyKey: string,
): Promise<RightsHolderCommandResult> {
  return decodeCommandResult(
    await requestJson(
      `/customers/${encodeURIComponent(customerId)}/rights-holders`,
      {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey },
        body: input,
      },
    ),
  );
}

export async function linkCustomerRightsHolder(
  customerId: string,
  input: LinkRightsHolderInput,
  idempotencyKey: string,
): Promise<RightsHolderCommandResult> {
  return decodeCommandResult(
    await requestJson(
      `/customers/${encodeURIComponent(customerId)}/rights-holder-links`,
      {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey },
        body: input,
      },
    ),
  );
}
