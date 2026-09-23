import { ApiError, getJson, requestJson, type RequestOptions } from './http';

export type ClientLeadView = 'PENDING' | 'PROCESSED';

export type ClientLeadReviewDecision = {
  result: 'INFRINGEMENT';
  reviewerDisplayName: string;
  decidedAt: string;
};

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
  status: 'WAITING_REVIEW' | 'WAITING_EVIDENCE_DECISION';
  version: number;
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
  reviewDecision: ClientLeadReviewDecision | null;
  capabilities: { review: boolean };
};

export type ClientLeadReviewResult = Pick<
  ClientLead,
  'id' | 'businessNo' | 'status' | 'version' | 'reviewDecision'
> & {
  status: 'WAITING_EVIDENCE_DECISION';
  reviewDecision: ClientLeadReviewDecision;
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
  'version',
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
  'reviewDecision',
  'capabilities',
] as const;

const decisionKeys = ['result', 'reviewerDisplayName', 'decidedAt'] as const;
const reviewResultKeys = [
  'id',
  'businessNo',
  'status',
  'version',
  'reviewDecision',
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

function isClientReviewDecision(
  value: unknown,
): value is ClientLeadReviewDecision {
  return (
    isRecord(value) &&
    hasExactKeys(value, decisionKeys) &&
    value.result === 'INFRINGEMENT' &&
    typeof value.reviewerDisplayName === 'string' &&
    isDateTime(value.decidedAt)
  );
}

function isClientLead(value: unknown): value is ClientLead {
  if (!isRecord(value)) return false;
  return (
    hasExactKeys(value, clientLeadKeys) &&
    typeof value.id === 'string' &&
    typeof value.businessNo === 'string' &&
    (value.status === 'WAITING_REVIEW' ||
      value.status === 'WAITING_EVIDENCE_DECISION') &&
    Number.isInteger(value.version) &&
    (value.version as number) >= 1 &&
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
    isDateTime(value.pushedAt) &&
    ((value.status === 'WAITING_REVIEW' &&
      value.reviewDecision === null &&
      isRecord(value.capabilities) &&
      hasExactKeys(value.capabilities, ['review']) &&
      value.capabilities.review === true) ||
      (value.status === 'WAITING_EVIDENCE_DECISION' &&
        isClientReviewDecision(value.reviewDecision) &&
        isRecord(value.capabilities) &&
        hasExactKeys(value.capabilities, ['review']) &&
        value.capabilities.review === false))
  );
}

function isClientLeadReviewResult(
  value: unknown,
  expectedVersion: number,
): value is ClientLeadReviewResult {
  return (
    isRecord(value) &&
    hasExactKeys(value, reviewResultKeys) &&
    typeof value.id === 'string' &&
    typeof value.businessNo === 'string' &&
    value.status === 'WAITING_EVIDENCE_DECISION' &&
    Number.isInteger(value.version) &&
    value.version === expectedVersion + 1 &&
    isClientReviewDecision(value.reviewDecision)
  );
}

function invalidResponse(): ApiError {
  return new ApiError('服务返回了无效的客户线索数据', 200, 'INVALID_RESPONSE');
}

export async function listClientLeads(
  view: ClientLeadView = 'PENDING',
  page = 1,
  pageSize = 20,
  options: RequestOptions = {},
): Promise<ClientLeadList> {
  const query = new URLSearchParams({
    view,
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

export async function reviewClientLead(
  id: string,
  expectedVersion: number,
  idempotencyKey: string,
  options: RequestOptions = {},
): Promise<ClientLeadReviewResult> {
  const value = await requestJson(
    `/client/leads/${encodeURIComponent(id)}/reviews`,
    {
      ...options,
      method: 'POST',
      headers: { ...options.headers, 'Idempotency-Key': idempotencyKey },
      body: { result: 'INFRINGEMENT', expectedVersion },
    },
  );
  if (!isClientLeadReviewResult(value, expectedVersion))
    throw invalidResponse();
  return value;
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
