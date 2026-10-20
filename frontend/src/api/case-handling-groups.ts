import { ApiError, getJson, requestJson, type RequestOptions } from './http';
import type { CaseStage } from './cases';

export type CaseHandlingGroupMember = {
  caseId: string;
  businessNo: string;
  customerId: string;
  customerName: string;
  stage: CaseStage;
};
export type CaseHandlingGroupCreateInput = {
  groupId: string;
  caseIds: string[];
  idempotencyKey: string;
};
export type CaseHandlingGroupDissolveInput = {
  expectedRevision: number;
  idempotencyKey: string;
};
export type CaseHandlingGroupCommandResult = {
  id: string;
  revision: number;
  status: 'ACTIVE' | 'DISSOLVED';
  recordedAt: string;
};
export type CaseHandlingGroupDetail = {
  id: string;
  revision: number;
  status: 'ACTIVE' | 'DISSOLVED';
  createdAt: string;
  members: CaseHandlingGroupMember[];
  canDissolve: boolean;
};
export type CaseHandlingGroupPageQuery = { page?: number; pageSize?: number };
export type CaseHandlingGroupCandidateQuery = CaseHandlingGroupPageQuery & {
  customerId?: string;
  q?: string;
};
export type CaseHandlingGroupList = {
  items: CaseHandlingGroupDetail[];
  total: number;
  page: number;
  pageSize: number;
};
export type CaseHandlingGroupCandidates = {
  items: CaseHandlingGroupMember[];
  total: number;
  page: number;
  pageSize: number;
};
export type CaseHandlingGroupCapability = { canCreate: boolean };
export type CaseHandlingGroupAttempt =
  | { kind: 'CREATE'; actorKey: string; input: CaseHandlingGroupCreateInput }
  | {
      kind: 'DISSOLVE';
      actorKey: string;
      groupId: string;
      input: CaseHandlingGroupDissolveInput;
    };
export type CaseHandlingGroupCommandContext = {
  actorKey: string;
  contextKey: string;
  signal: AbortSignal;
};
export type CaseHandlingGroupCommandOutcome =
  | { kind: 'confirmed'; result: CaseHandlingGroupCommandResult }
  | { kind: 'unknown' | 'rejected'; message: string };
export type SubmitCaseHandlingGroupAttempt = (
  attempt: CaseHandlingGroupAttempt,
  context: CaseHandlingGroupCommandContext,
) => Promise<CaseHandlingGroupCommandOutcome>;

// This is a component adapter seam, not a server DTO. The production adapter
// must obtain allowed and every member from the frozen current-actor endpoint.
export type PrepareCaseHandlingGroupSelection = (
  caseIds: readonly string[],
  options: RequestOptions,
) => Promise<{ allowed: boolean; members: CaseHandlingGroupMember[] }>;

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
export function isCaseHandlingGroupAttempt(
  value: unknown,
): value is CaseHandlingGroupAttempt {
  if (
    !record(value) ||
    typeof value.actorKey !== 'string' ||
    !/^[^:]+:INTERNAL:[^:]+$/u.test(value.actorKey)
  )
    return false;
  return value.kind === 'CREATE'
    ? exact(value, ['kind', 'actorKey', 'input']) && createInput(value.input)
    : value.kind === 'DISSOLVE' &&
        exact(value, ['kind', 'actorKey', 'groupId', 'input']) &&
        typeof value.groupId === 'string' &&
        uuid.test(value.groupId) &&
        dissolveInput(value.input);
}

type CommandExpectation =
  | { kind: 'CREATE'; input: CaseHandlingGroupCreateInput }
  | {
      kind: 'DISSOLVE';
      groupId: string;
      input: CaseHandlingGroupDissolveInput;
    };
function handlingKey(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value === value.trim() &&
    Array.from(value).length <= 128
  );
}
function createInput(value: unknown): value is CaseHandlingGroupCreateInput {
  return (
    record(value) &&
    exact(value, ['groupId', 'caseIds', 'idempotencyKey']) &&
    typeof value.groupId === 'string' &&
    uuid.test(value.groupId) &&
    handlingKey(value.idempotencyKey) &&
    Array.isArray(value.caseIds) &&
    value.caseIds.length >= 2 &&
    value.caseIds.length <= 20 &&
    value.caseIds.every((id) => typeof id === 'string' && uuid.test(id)) &&
    new Set(value.caseIds.map((id: string) => id.toLowerCase())).size ===
      value.caseIds.length
  );
}
function dissolveInput(
  value: unknown,
): value is CaseHandlingGroupDissolveInput {
  return (
    record(value) &&
    exact(value, ['expectedRevision', 'idempotencyKey']) &&
    handlingKey(value.idempotencyKey) &&
    Number.isSafeInteger(value.expectedRevision) &&
    (value.expectedRevision as number) >= 1 &&
    (value.expectedRevision as number) <= 2_147_483_646
  );
}

export function isCaseHandlingGroupCommandResult(
  value: unknown,
  attempt: CommandExpectation,
): value is CaseHandlingGroupCommandResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const result = value as Record<string, unknown>;
  return (
    Object.keys(result).length === 4 &&
    typeof result.id === 'string' &&
    uuid.test(result.id) &&
    result.id.toLowerCase() ===
      (attempt.kind === 'CREATE'
        ? attempt.input.groupId
        : attempt.groupId
      ).toLowerCase() &&
    result.revision ===
      (attempt.kind === 'CREATE' ? 1 : attempt.input.expectedRevision + 1) &&
    result.status === (attempt.kind === 'CREATE' ? 'ACTIVE' : 'DISSOLVED') &&
    typeof result.recordedAt === 'string' &&
    /^\d{4}-\d{2}-\d{2}T/u.test(result.recordedAt) &&
    Number.isFinite(Date.parse(result.recordedAt))
  );
}

const basePath = '/case-handling-groups';
const stages = new Set<CaseStage>([
  'PENDING_MATCH',
  'WAITING_COMPLAINT',
  'WAITING_COMPLAINT_CONFIRMATION',
  'WAITING_COMPLAINT_STAMP',
  'WAITING_FILING',
  'WAITING_FORMAL_ACCEPTANCE',
  'WAITING_HEARING',
  'WAITING_JUDGMENT',
  'SECOND_INSTANCE',
  'WAITING_EXECUTION_DOCUMENTS',
  'WAITING_EXECUTION_CONFIRMATION',
  'WAITING_EXECUTION_STAMP',
  'WAITING_EXECUTION_FILING',
  'EXECUTING',
  'WAITING_ARCHIVE',
  'ARCHIVED',
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
function invalidInput(): ApiError {
  return new ApiError('案件办理组请求无效', 400, 'VALIDATION_ERROR');
}
function invalidResponse(): ApiError {
  return new ApiError(
    '服务返回了无效的案件办理组数据',
    502,
    'INVALID_RESPONSE',
  );
}
function text(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
function dateTime(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T/u.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}
function member(value: unknown): value is CaseHandlingGroupMember {
  return (
    record(value) &&
    exact(value, [
      'caseId',
      'businessNo',
      'customerId',
      'customerName',
      'stage',
    ]) &&
    typeof value.caseId === 'string' &&
    uuid.test(value.caseId) &&
    text(value.businessNo) &&
    typeof value.customerId === 'string' &&
    uuid.test(value.customerId) &&
    text(value.customerName) &&
    typeof value.stage === 'string' &&
    stages.has(value.stage as CaseStage)
  );
}
function decodeDetail(value: unknown): CaseHandlingGroupDetail {
  if (
    !record(value) ||
    !exact(value, [
      'id',
      'revision',
      'status',
      'createdAt',
      'members',
      'canDissolve',
    ]) ||
    typeof value.id !== 'string' ||
    !uuid.test(value.id) ||
    !Number.isInteger(value.revision) ||
    (value.revision as number) < 1 ||
    (value.revision as number) > 2_147_483_647 ||
    (value.status !== 'ACTIVE' && value.status !== 'DISSOLVED') ||
    !dateTime(value.createdAt) ||
    !Array.isArray(value.members) ||
    !value.members.every(member) ||
    new Set(value.members.map((entry) => entry.caseId.toLowerCase())).size !==
      value.members.length ||
    typeof value.canDissolve !== 'boolean' ||
    (value.status === 'DISSOLVED' && value.canDissolve)
  )
    throw invalidResponse();
  return value as CaseHandlingGroupDetail;
}
function pageQuery(
  input: CaseHandlingGroupCandidateQuery,
  candidate: boolean,
): { query: URLSearchParams; page: number; pageSize: number } {
  if (
    !record(input) ||
    Object.keys(input).some(
      (key) =>
        !(
          candidate
            ? ['page', 'pageSize', 'customerId', 'q']
            : ['page', 'pageSize']
        ).includes(key),
    )
  )
    throw invalidInput();
  const page = input.page ?? 1;
  const pageSize = input.pageSize ?? 20;
  if (
    !Number.isInteger(page) ||
    page < 1 ||
    !Number.isInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > 100 ||
    (page - 1) * pageSize > 2_147_483_647
  )
    throw invalidInput();
  const query = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
  });
  if (input.customerId !== undefined) {
    if (typeof input.customerId !== 'string' || !uuid.test(input.customerId))
      throw invalidInput();
    query.set('customerId', input.customerId);
  }
  if (input.q !== undefined) {
    if (typeof input.q !== 'string') throw invalidInput();
    const normalized = input.q.trim();
    const length =
      normalized.length -
      (normalized.match(/[^\uFE0F\uFE0E][\uFE0F\uFE0E]/g) ?? []).length -
      (normalized.match(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g) ?? []).length;
    if (length > 200) throw invalidInput();
    if (normalized) query.set('q', normalized);
  }
  return { query, page, pageSize };
}
function decodePage(
  value: unknown,
  page: number,
  pageSize: number,
): Record<string, unknown> & { items: unknown[]; total: number } {
  if (
    !record(value) ||
    !exact(value, ['items', 'total', 'page', 'pageSize']) ||
    !Array.isArray(value.items) ||
    value.items.length > pageSize ||
    !Number.isSafeInteger(value.total) ||
    (value.total as number) < value.items.length ||
    value.page !== page ||
    value.pageSize !== pageSize
  )
    throw invalidResponse();
  return value as Record<string, unknown> & { items: unknown[]; total: number };
}
export async function getCaseHandlingGroupCapability(
  options: RequestOptions = {},
): Promise<CaseHandlingGroupCapability> {
  const value = await getJson(`${basePath}/capability`, options);
  if (
    !record(value) ||
    !exact(value, ['canCreate']) ||
    typeof value.canCreate !== 'boolean'
  )
    throw invalidResponse();
  return { canCreate: value.canCreate };
}
export async function listCaseHandlingGroups(
  input: CaseHandlingGroupPageQuery = {},
  options: RequestOptions = {},
): Promise<CaseHandlingGroupList> {
  const { query, page, pageSize } = pageQuery(input, false);
  const value = decodePage(
    await getJson(`${basePath}?${query}`, options),
    page,
    pageSize,
  );
  const items = value.items.map(decodeDetail);
  if (
    new Set(items.map((entry) => entry.id.toLowerCase())).size !== items.length
  )
    throw invalidResponse();
  return { items, total: value.total, page, pageSize };
}
export async function listCaseHandlingGroupCandidates(
  input: CaseHandlingGroupCandidateQuery = {},
  options: RequestOptions = {},
): Promise<CaseHandlingGroupCandidates> {
  const { query, page, pageSize } = pageQuery(input, true);
  const value = decodePage(
    await getJson(`${basePath}/candidates?${query}`, options),
    page,
    pageSize,
  );
  if (
    !value.items.every(member) ||
    new Set(value.items.map((entry) => entry.caseId.toLowerCase())).size !==
      value.items.length
  )
    throw invalidResponse();
  return { items: value.items, total: value.total, page, pageSize };
}
export async function getCaseHandlingGroup(
  id: string,
  options: RequestOptions = {},
): Promise<CaseHandlingGroupDetail> {
  if (!uuid.test(id)) throw invalidInput();
  const detail = decodeDetail(
    await getJson(`${basePath}/${encodeURIComponent(id)}`, options),
  );
  if (detail.id.toLowerCase() !== id.toLowerCase()) throw invalidResponse();
  return detail;
}
export async function createCaseHandlingGroup(
  input: CaseHandlingGroupCreateInput,
  options: RequestOptions = {},
): Promise<CaseHandlingGroupCommandResult> {
  if (!createInput(input)) throw invalidInput();
  const captured = { ...input, caseIds: [...input.caseIds] };
  const result = await requestJson(basePath, {
    ...options,
    method: 'POST',
    body: { ...captured, caseIds: [...captured.caseIds] },
    retryOnCsrfInvalid: false,
  });
  if (
    !isCaseHandlingGroupCommandResult(result, {
      kind: 'CREATE',
      input: captured,
    })
  )
    throw invalidResponse();
  return result;
}
export async function dissolveCaseHandlingGroup(
  groupId: string,
  input: CaseHandlingGroupDissolveInput,
  options: RequestOptions = {},
): Promise<CaseHandlingGroupCommandResult> {
  if (
    typeof groupId !== 'string' ||
    !uuid.test(groupId) ||
    !dissolveInput(input)
  )
    throw invalidInput();
  const captured = { ...input };
  const result = await requestJson(
    `${basePath}/${encodeURIComponent(groupId)}/dissolve`,
    { ...options, method: 'POST', body: captured, retryOnCsrfInvalid: false },
  );
  if (
    !isCaseHandlingGroupCommandResult(result, {
      kind: 'DISSOLVE',
      groupId,
      input: captured,
    })
  )
    throw invalidResponse();
  return result;
}
