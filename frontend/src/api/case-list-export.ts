import {
  ApiError,
  getJson,
  postBlob,
  type JsonValue,
  type RequestOptions,
} from './http';
import type { CaseStage, CaseStageGroup, CaseView } from './cases';
import type { LeadCaseType } from './leads';

export type CaseListExportInput = {
  shopName?: string;
  defendantName?: string;
  courtName?: string;
  lawyerName?: string;
  caseType?: LeadCaseType;
  view?: CaseView;
  stage?: CaseStage;
  stageGroup?: CaseStageGroup;
  q?: string;
  customerName?: string;
  rightsHolderName?: string;
  courtCaseNo?: string;
  sortBy?: 'createdAt' | 'businessNo' | 'rightsHolderName';
  sortDirection?: 'asc' | 'desc';
};

export type CaseListExportFile = {
  blob: Blob;
  filename: string;
  mimeType: string;
};

export type CaseListExportCapability = { canExport: boolean };

const exportPath = '/cases/exports/csv';
const capabilityPath = '/cases/exports/capability';
const allowedKeys = new Set([
  'shopName',
  'defendantName',
  'courtName',
  'lawyerName',
  'caseType',
  'view',
  'stage',
  'stageGroup',
  'q',
  'customerName',
  'rightsHolderName',
  'courtCaseNo',
  'sortBy',
  'sortDirection',
]);
const caseStages = new Set<CaseStage>([
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
const stageGroups = new Set<CaseStageGroup>([
  'COMPLAINT_PREPARATION',
  'EXECUTION_PREPARATION',
]);
const queryFields = [
  'shopName',
  'defendantName',
  'courtName',
  'lawyerName',
  'q',
  'customerName',
  'rightsHolderName',
  'courtCaseNo',
] as const;

function invalidInput(): ApiError {
  return new ApiError('案件导出筛选条件无效', 400, 'VALIDATION_ERROR');
}

function invalidResponse(): ApiError {
  return new ApiError('服务返回了无效的案件CSV文件', 502, 'INVALID_RESPONSE');
}

function invalidCapabilityResponse(): ApiError {
  return new ApiError(
    '服务返回了无效的案件导出权限数据',
    502,
    'INVALID_RESPONSE',
  );
}

function decodeCapability(value: unknown): CaseListExportCapability {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== 1 ||
    !Object.hasOwn(value, 'canExport') ||
    typeof (value as Record<string, unknown>).canExport !== 'boolean'
  )
    throw invalidCapabilityResponse();
  return { canExport: (value as { canExport: boolean }).canExport };
}

function backendStringLength(value: string): number {
  return (
    value.length -
    (value.match(/[^\uFE0F\uFE0E][\uFE0F\uFE0E]/gu) ?? []).length -
    (value.match(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g) ?? []).length
  );
}

function encodeInput(input: CaseListExportInput): JsonValue {
  if (
    input === null ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).some((key) => !allowedKeys.has(key))
  )
    throw invalidInput();

  const candidate = input as Record<string, unknown>;
  if (
    (candidate.view !== undefined &&
      candidate.view !== 'mine' &&
      candidate.view !== 'department') ||
    (candidate.stage !== undefined &&
      (typeof candidate.stage !== 'string' ||
        !caseStages.has(candidate.stage as CaseStage))) ||
    (candidate.stageGroup !== undefined &&
      (typeof candidate.stageGroup !== 'string' ||
        !stageGroups.has(candidate.stageGroup as CaseStageGroup))) ||
    (candidate.stage !== undefined && candidate.stageGroup !== undefined)
  )
    throw invalidInput();

  const body: Record<string, JsonValue> = {};
  if (candidate.caseType !== undefined) {
    if (
      typeof candidate.caseType !== 'string' ||
      ![
        'CIVIL',
        'CRIMINAL',
        'ADMINISTRATIVE',
        'INVESTIGATION',
        'NOTARIZATION',
        'HEARING_REPRESENTATION',
      ].includes(candidate.caseType)
    )
      throw invalidInput();
    body.caseType = candidate.caseType;
  }
  if (candidate.view !== undefined) body.view = candidate.view;
  if (candidate.stage !== undefined) body.stage = candidate.stage;
  if (candidate.stageGroup !== undefined)
    body.stageGroup = candidate.stageGroup;

  for (const key of queryFields) {
    const value = candidate[key];
    if (value === undefined) continue;
    if (typeof value !== 'string') throw invalidInput();
    const normalized = value.trim();
    if (backendStringLength(normalized) > 200) throw invalidInput();
    if (normalized) body[key] = normalized;
  }

  if (
    candidate.sortBy !== undefined &&
    candidate.sortBy !== 'createdAt' &&
    candidate.sortBy !== 'businessNo' &&
    candidate.sortBy !== 'rightsHolderName'
  )
    throw invalidInput();
  if (
    candidate.sortDirection !== undefined &&
    candidate.sortDirection !== 'asc' &&
    candidate.sortDirection !== 'desc'
  )
    throw invalidInput();
  if (candidate.sortBy !== undefined) body.sortBy = candidate.sortBy;
  if (candidate.sortDirection !== undefined)
    body.sortDirection = candidate.sortDirection;
  return body;
}

export async function exportCaseListCsv(
  input: CaseListExportInput,
  options: RequestOptions = {},
): Promise<CaseListExportFile> {
  const result = await postBlob(exportPath, encodeInput(input), {
    ...options,
    retryOnCsrfInvalid: false,
  });
  if (
    !(result.blob instanceof globalThis.Blob) ||
    result.blob.size === 0 ||
    result.filename !== 'case-list.csv' ||
    result.mimeType !== 'text/csv'
  )
    throw invalidResponse();
  return { ...result, mimeType: 'text/csv' };
}

export async function getCaseListExportCapability(
  options: RequestOptions = {},
): Promise<CaseListExportCapability> {
  return decodeCapability(await getJson(capabilityPath, options));
}
