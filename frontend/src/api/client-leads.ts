import { ApiError, getJson, requestJson, type RequestOptions } from './http';

export type ClientLeadView = 'PENDING' | 'PROCESSED';

export type ClientLeadReviewDecision =
  | {
      result: 'INFRINGEMENT';
      reviewerDisplayName: string;
      decidedAt: string;
    }
  | {
      result: 'NO_INFRINGEMENT';
      reason: string;
      reviewerDisplayName: string;
      decidedAt: string;
      archiveType: 'NO_INFRINGEMENT';
      archivedAt: string;
    };
export type ClientLeadEvidenceDecision = {
  result: 'NO_EVIDENCE';
  reason: string;
  decidedAt: string;
  decidedByDisplayName: string;
  archiveType: 'NO_EVIDENCE';
  archivedAt: string;
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
  status: 'WAITING_REVIEW' | 'WAITING_EVIDENCE_DECISION' | 'ARCHIVED';
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
  evidenceDecision: ClientLeadEvidenceDecision | null;
  pendingWithdrawalApplication: ClientLeadPendingWithdrawal | null;
  history: ClientLeadHistory[];
  capabilities: { review: boolean; confirmWithdrawal: boolean };
};
export type ClientLeadPendingWithdrawal = {
  id: string;
  reason: string;
  applicantDisplayName: string;
  appliedAt: string;
};
export type ClientLeadHistory = {
  kind:
    | 'REVIEW_DECISION'
    | 'WITHDRAWAL_APPLICATION'
    | 'WITHDRAWAL_CONFIRMATION'
    | 'EVIDENCE_DECISION';
  id: string;
  fromVersion: number;
  toVersion: number;
  occurredAt: string;
  result?: string;
  reason?: string | null;
  reviewerDisplayName?: string;
  decidedByDisplayName?: string;
  applicantDisplayName?: string;
  applicationId?: string;
  archiveType?: string | null;
  archivedAt?: string | null;
};

export type ClientLeadReviewResult =
  | (Pick<ClientLead, 'id' | 'businessNo' | 'version'> & {
      status: 'WAITING_EVIDENCE_DECISION';
      reviewDecision: Extract<
        ClientLeadReviewDecision,
        { result: 'INFRINGEMENT' }
      >;
    })
  | (Pick<ClientLead, 'id' | 'businessNo' | 'version'> & {
      status: 'ARCHIVED';
      reviewDecision: Extract<
        ClientLeadReviewDecision,
        { result: 'NO_INFRINGEMENT' }
      >;
    });

export type ClientLeadList = {
  items: ClientLead[];
  total: number;
  page: number;
  pageSize: number;
};
export type ClientLeadWithdrawalConfirmationResult = {
  id: string;
  applicationId: string;
  leadId: string;
  status: 'WAITING_REVIEW';
  version: number;
  confirmedByDisplayName: string;
  confirmedAt: string;
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
  'evidenceDecision',
  'pendingWithdrawalApplication',
  'history',
  'capabilities',
] as const;

const infringementDecisionKeys = [
  'result',
  'reviewerDisplayName',
  'decidedAt',
] as const;
const noInfringementDecisionKeys = [
  'result',
  'reason',
  'reviewerDisplayName',
  'decidedAt',
  'archiveType',
  'archivedAt',
] as const;
const evidenceDecisionKeys = [
  'result',
  'reason',
  'decidedAt',
  'decidedByDisplayName',
  'archiveType',
  'archivedAt',
] as const;
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
  if (!isRecord(value)) return false;
  if (
    isRecord(value) &&
    hasExactKeys(value, infringementDecisionKeys) &&
    value.result === 'INFRINGEMENT' &&
    typeof value.reviewerDisplayName === 'string' &&
    isDateTime(value.decidedAt)
  )
    return true;
  return (
    hasExactKeys(value, noInfringementDecisionKeys) &&
    value.result === 'NO_INFRINGEMENT' &&
    typeof value.reason === 'string' &&
    value.reason.trim().length > 0 &&
    [...value.reason].length <= 5000 &&
    typeof value.reviewerDisplayName === 'string' &&
    isDateTime(value.decidedAt) &&
    value.archiveType === 'NO_INFRINGEMENT' &&
    isDateTime(value.archivedAt)
  );
}

function isClientEvidenceDecision(
  value: unknown,
): value is ClientLeadEvidenceDecision {
  return (
    isRecord(value) &&
    hasExactKeys(value, evidenceDecisionKeys) &&
    value.result === 'NO_EVIDENCE' &&
    typeof value.reason === 'string' &&
    value.reason.trim().length > 0 &&
    [...value.reason].length <= 5000 &&
    typeof value.decidedByDisplayName === 'string' &&
    isDateTime(value.decidedAt) &&
    value.archiveType === 'NO_EVIDENCE' &&
    isDateTime(value.archivedAt)
  );
}

function isPendingWithdrawal(
  value: unknown,
): value is ClientLeadPendingWithdrawal | null {
  return (
    value === null ||
    (isRecord(value) &&
      typeof value.id === 'string' &&
      typeof value.reason === 'string' &&
      [...value.reason].length >= 1 &&
      [...value.reason].length <= 5000 &&
      typeof value.applicantDisplayName === 'string' &&
      isDateTime(value.appliedAt))
  );
}

function isClientHistory(value: unknown): value is ClientLeadHistory[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        isRecord(item) &&
        (item.kind === 'REVIEW_DECISION' ||
          item.kind === 'WITHDRAWAL_APPLICATION' ||
          item.kind === 'WITHDRAWAL_CONFIRMATION' ||
          item.kind === 'EVIDENCE_DECISION') &&
        typeof item.id === 'string' &&
        Number.isInteger(item.fromVersion) &&
        Number.isInteger(item.toVersion) &&
        (item.toVersion as number) > (item.fromVersion as number) &&
        isDateTime(item.occurredAt) &&
        (item.reason === undefined ||
          item.reason === null ||
          typeof item.reason === 'string') &&
        (item.applicantDisplayName === undefined ||
          typeof item.applicantDisplayName === 'string') &&
        (item.reviewerDisplayName === undefined ||
          typeof item.reviewerDisplayName === 'string') &&
        (item.decidedByDisplayName === undefined ||
          typeof item.decidedByDisplayName === 'string') &&
        (item.kind !== 'EVIDENCE_DECISION' ||
          (item.result === 'NO_EVIDENCE' &&
            typeof item.reason === 'string' &&
            item.reason.trim().length > 0 &&
            [...item.reason].length <= 5000 &&
            typeof item.decidedByDisplayName === 'string' &&
            item.archiveType === 'NO_EVIDENCE' &&
            isDateTime(item.archivedAt))) &&
        (item.applicationId === undefined ||
          typeof item.applicationId === 'string'),
    )
  );
}

function isClientLead(value: unknown): value is ClientLead {
  if (!isRecord(value)) return false;
  return (
    hasExactKeys(value, clientLeadKeys) &&
    typeof value.id === 'string' &&
    typeof value.businessNo === 'string' &&
    (value.status === 'WAITING_REVIEW' ||
      value.status === 'WAITING_EVIDENCE_DECISION' ||
      value.status === 'ARCHIVED') &&
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
    (value.evidenceDecision === null ||
      isClientEvidenceDecision(value.evidenceDecision)) &&
    isPendingWithdrawal(value.pendingWithdrawalApplication) &&
    isClientHistory(value.history) &&
    ((value.status === 'WAITING_REVIEW' &&
      value.reviewDecision === null &&
      value.pendingWithdrawalApplication === null &&
      isRecord(value.capabilities) &&
      hasExactKeys(value.capabilities, ['review', 'confirmWithdrawal']) &&
      value.capabilities.review === true &&
      value.capabilities.confirmWithdrawal === false) ||
      (value.status === 'WAITING_EVIDENCE_DECISION' &&
        isClientReviewDecision(value.reviewDecision) &&
        value.reviewDecision.result === 'INFRINGEMENT' &&
        value.pendingWithdrawalApplication === null &&
        isRecord(value.capabilities) &&
        hasExactKeys(value.capabilities, ['review', 'confirmWithdrawal']) &&
        value.capabilities.review === false &&
        value.capabilities.confirmWithdrawal === false) ||
      (value.status === 'ARCHIVED' &&
        isRecord(value.capabilities) &&
        hasExactKeys(value.capabilities, ['review', 'confirmWithdrawal']) &&
        isClientReviewDecision(value.reviewDecision) &&
        (value.evidenceDecision === null
          ? value.reviewDecision.result === 'NO_INFRINGEMENT'
          : value.reviewDecision.result === 'INFRINGEMENT') &&
        (value.pendingWithdrawalApplication === null ||
          (value.pendingWithdrawalApplication !== null &&
            value.capabilities.confirmWithdrawal === true)) &&
        value.capabilities.review === false &&
        value.capabilities.confirmWithdrawal ===
          (value.pendingWithdrawalApplication !== null) &&
        (value.evidenceDecision === null ||
          (value.evidenceDecision !== null &&
            value.reviewDecision.result === 'INFRINGEMENT'))))
  );
}

function isClientLeadReviewResult(
  value: unknown,
  expectedVersion: number,
  result: ClientLeadReviewDecision['result'],
): value is ClientLeadReviewResult {
  if (!(
    isRecord(value) &&
    hasExactKeys(value, reviewResultKeys) &&
    typeof value.id === 'string' &&
    typeof value.businessNo === 'string' &&
    Number.isInteger(value.version) &&
    value.version === expectedVersion + 1 &&
    isClientReviewDecision(value.reviewDecision)
  ))
    return false;
  return result === 'INFRINGEMENT'
    ? value.status === 'WAITING_EVIDENCE_DECISION' &&
        value.reviewDecision.result === result
    : value.status === 'ARCHIVED' && value.reviewDecision.result === result;
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
    !value.items.every(
      (item) =>
        isClientLead(item) &&
        (view === 'PENDING'
          ? item.status === 'WAITING_REVIEW' ||
            (item.status === 'ARCHIVED' &&
              item.pendingWithdrawalApplication !== null)
          : item.status === 'WAITING_EVIDENCE_DECISION' ||
            (item.status === 'ARCHIVED' &&
              item.pendingWithdrawalApplication === null)),
    ) ||
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
  if (!isClientLeadReviewResult(value, expectedVersion, 'INFRINGEMENT'))
    throw invalidResponse();
  return value;
}

export async function reviewClientLeadNoInfringement(
  id: string,
  expectedVersion: number,
  reason: string,
  idempotencyKey: string,
  options: RequestOptions = {},
): Promise<ClientLeadReviewResult> {
  const value = await requestJson(
    `/client/leads/${encodeURIComponent(id)}/reviews`,
    {
      ...options,
      method: 'POST',
      headers: { ...options.headers, 'Idempotency-Key': idempotencyKey },
      body: {
        result: 'NO_INFRINGEMENT',
        reason: reason.trim(),
        expectedVersion,
      },
    },
  );
  if (!isClientLeadReviewResult(value, expectedVersion, 'NO_INFRINGEMENT'))
    throw invalidResponse();
  return value;
}

export async function confirmClientLeadWithdrawal(
  id: string,
  applicationId: string,
  expectedVersion: number,
  idempotencyKey: string,
  options: RequestOptions = {},
): Promise<ClientLeadWithdrawalConfirmationResult> {
  const value = await requestJson(
    `/client/leads/${encodeURIComponent(id)}/withdrawal-confirmations`,
    {
      ...options,
      method: 'POST',
      headers: { ...options.headers, 'Idempotency-Key': idempotencyKey },
      body: { applicationId, expectedVersion },
    },
  );
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    value.applicationId !== applicationId ||
    value.leadId !== id ||
    value.status !== 'WAITING_REVIEW' ||
    value.version !== expectedVersion + 1 ||
    typeof value.confirmedByDisplayName !== 'string' ||
    !isDateTime(value.confirmedAt)
  )
    throw invalidResponse();
  return value as ClientLeadWithdrawalConfirmationResult;
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
