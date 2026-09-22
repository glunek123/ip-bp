import { ApiError, getJson, type RequestOptions } from './http';

export type ClientLeadProduct = {
  id: string;
  position: number;
  url: string | null;
  title: string | null;
  quantity: number;
  unitPrice: string;
  commentCount: number;
  estimatedAmount: string;
};

export type ClientLead = {
  id: string;
  businessNo: string;
  status: 'WAITING_REVIEW';
  caseType: string;
  infringementTypes: string[];
  source: string;
  platform: string;
  foundAt: string;
  shopName: string;
  shopExternalId: string | null;
  rightsHolderName: string;
  products: ClientLeadProduct[];
  leadScreenshotContentVersionIds: string[];
  pushedAt: string;
};

export type ClientLeadList = {
  items: ClientLead[];
  total: number;
  page: number;
  pageSize: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value);
  return (
    actual.length === expected.length &&
    actual.every((key) => expected.includes(key))
  );
}

const productKeys = [
  'id',
  'position',
  'url',
  'title',
  'quantity',
  'unitPrice',
  'commentCount',
  'estimatedAmount',
] as const;

const clientLeadKeys = [
  'id',
  'businessNo',
  'status',
  'caseType',
  'infringementTypes',
  'source',
  'platform',
  'foundAt',
  'shopName',
  'shopExternalId',
  'rightsHolderName',
  'products',
  'leadScreenshotContentVersionIds',
  'pushedAt',
] as const;

const clientLeadListKeys = ['items', 'total', 'page', 'pageSize'] as const;

function isDateTime(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isMoney(value: unknown): value is string {
  return (
    typeof value === 'string' && /^(0|[1-9]\d{0,15})(\.\d{1,2})?$/u.test(value)
  );
}

function isProduct(value: unknown, index: number): value is ClientLeadProduct {
  return (
    isRecord(value) &&
    hasExactKeys(value, productKeys) &&
    typeof value.id === 'string' &&
    value.position === index + 1 &&
    isNullableString(value.url) &&
    isNullableString(value.title) &&
    Number.isInteger(value.quantity) &&
    (value.quantity as number) >= 0 &&
    isMoney(value.unitPrice) &&
    Number.isInteger(value.commentCount) &&
    (value.commentCount as number) >= 0 &&
    isMoney(value.estimatedAmount)
  );
}

function isClientLead(value: unknown): value is ClientLead {
  if (!isRecord(value)) return false;
  return (
    hasExactKeys(value, clientLeadKeys) &&
    typeof value.id === 'string' &&
    typeof value.businessNo === 'string' &&
    value.status === 'WAITING_REVIEW' &&
    typeof value.caseType === 'string' &&
    Array.isArray(value.infringementTypes) &&
    value.infringementTypes.length >= 1 &&
    value.infringementTypes.every((item) => typeof item === 'string') &&
    typeof value.source === 'string' &&
    typeof value.platform === 'string' &&
    isDateTime(value.foundAt) &&
    typeof value.shopName === 'string' &&
    isNullableString(value.shopExternalId) &&
    typeof value.rightsHolderName === 'string' &&
    Array.isArray(value.products) &&
    value.products.length >= 1 &&
    value.products.every(isProduct) &&
    Array.isArray(value.leadScreenshotContentVersionIds) &&
    value.leadScreenshotContentVersionIds.every(
      (item) => typeof item === 'string',
    ) &&
    new Set(value.leadScreenshotContentVersionIds).size ===
      value.leadScreenshotContentVersionIds.length &&
    isDateTime(value.pushedAt)
  );
}

function invalidResponse(): ApiError {
  return new ApiError('服务返回了无效的客户线索数据', 200, 'INVALID_RESPONSE');
}

export async function listClientLeads(
  page = 1,
  pageSize = 20,
  options: RequestOptions = {},
): Promise<ClientLeadList> {
  const query = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
  });
  const value = await getJson(`/client/leads?${query.toString()}`, options);
  if (
    !isRecord(value) ||
    !hasExactKeys(value, clientLeadListKeys) ||
    !Array.isArray(value.items) ||
    !value.items.every(isClientLead) ||
    !Number.isInteger(value.total) ||
    (value.total as number) < 0 ||
    !Number.isInteger(value.page) ||
    (value.page as number) < 1 ||
    !Number.isInteger(value.pageSize) ||
    (value.pageSize as number) < 1 ||
    (value.pageSize as number) > 100
  )
    throw invalidResponse();
  return value as ClientLeadList;
}

export async function getClientLead(
  id: string,
  options: RequestOptions = {},
): Promise<ClientLead> {
  const value = await getJson(
    `/client/leads/${encodeURIComponent(id)}`,
    options,
  );
  if (!isClientLead(value)) throw invalidResponse();
  return value;
}
