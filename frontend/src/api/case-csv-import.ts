import {
  ApiError,
  getBlob,
  requestJson,
  type JsonValue,
  type RequestOptions,
} from './http';
import type { CaseStage } from './cases';

export type CaseCsvRowError = { code: string; field: string; message: string };
export type CaseCsvPreviewRow = {
  rowNumber: number;
  valid: boolean;
  errors: CaseCsvRowError[];
  input?: Record<string, unknown>;
  duplicateCandidates?: {
    cases: Array<{ id: string; businessNo: string }>;
    rowNumbers: number[];
  };
};
export type CaseCsvPreviewResult = {
  rows: CaseCsvPreviewRow[];
  validCount: number;
  errorCount: number;
};
export type CaseCsvCommitResult = {
  items: Array<{
    rowNumber: number;
    id: string;
    businessNo: string;
    stage: CaseStage;
    version: number;
    entryId: string;
    recordedAt: string;
  }>;
};
export type CaseCsvDuplicateConfirmation = {
  rowNumber: number;
  caseIds: string[];
  rowNumbers: number[];
};
export type CaseCsvCommitInput = {
  csvBase64: string;
  idempotencyKey: string;
  rowNumbers: number[];
  duplicateConfirmations: CaseCsvDuplicateConfirmation[];
};
const basePath = '/cases/csv-import';
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function invalidInput(): ApiError {
  return new ApiError('案件CSV导入请求无效', 400, 'VALIDATION_ERROR');
}
function invalidResponse(): ApiError {
  return new ApiError(
    '服务返回了无效的案件CSV导入数据',
    502,
    'INVALID_RESPONSE',
  );
}
function decodePreview(value: unknown): CaseCsvPreviewResult {
  if (
    !record(value) ||
    Object.keys(value).sort().join(',') !== 'errorCount,rows,validCount' ||
    !Array.isArray(value.rows) ||
    !Number.isSafeInteger(value.validCount) ||
    !Number.isSafeInteger(value.errorCount)
  )
    throw invalidResponse();
  const rows = value.rows.map((row) => {
    if (
      !record(row) ||
      !Number.isSafeInteger(row.rowNumber) ||
      Number(row.rowNumber) < 2 ||
      typeof row.valid !== 'boolean' ||
      !Array.isArray(row.errors) ||
      (row.input !== undefined && !record(row.input)) ||
      (row.duplicateCandidates !== undefined &&
        (!record(row.duplicateCandidates) ||
          Object.keys(row.duplicateCandidates).sort().join(',') !==
            'cases,rowNumbers' ||
          !Array.isArray(row.duplicateCandidates.cases) ||
          !Array.isArray(row.duplicateCandidates.rowNumbers) ||
          row.duplicateCandidates.cases.some(
            (candidate) =>
              !record(candidate) ||
              typeof candidate.id !== 'string' ||
              !uuid.test(candidate.id) ||
              typeof candidate.businessNo !== 'string' ||
              candidate.businessNo.length === 0,
          ) ||
          new Set(
            row.duplicateCandidates.cases.map((candidate) =>
              record(candidate) ? candidate.id : undefined,
            ),
          ).size !== row.duplicateCandidates.cases.length ||
          row.duplicateCandidates.rowNumbers.some(
            (rowNumber) =>
              !Number.isSafeInteger(rowNumber) || Number(rowNumber) < 2,
          ) ||
          new Set(row.duplicateCandidates.rowNumbers).size !==
            row.duplicateCandidates.rowNumbers.length)) ||
      row.errors.some(
        (error) =>
          !record(error) ||
          typeof error.code !== 'string' ||
          typeof error.field !== 'string' ||
          typeof error.message !== 'string',
      )
    )
      throw invalidResponse();
    return row as unknown as CaseCsvPreviewRow;
  });
  if (
    rows.length !== Number(value.validCount) + Number(value.errorCount) ||
    rows.filter((row) => row.valid).length !== value.validCount ||
    rows.some((row) => row.valid !== (row.errors.length === 0))
  )
    throw invalidResponse();
  return {
    rows,
    validCount: Number(value.validCount),
    errorCount: Number(value.errorCount),
  };
}
function decodeCommit(
  value: unknown,
  requested: number[],
): CaseCsvCommitResult {
  if (
    !record(value) ||
    Object.keys(value).join(',') !== 'items' ||
    !Array.isArray(value.items) ||
    value.items.length !== requested.length
  )
    throw invalidResponse();
  const items = value.items.map((item, index) => {
    if (
      !record(item) ||
      item.rowNumber !== requested[index] ||
      typeof item.id !== 'string' ||
      typeof item.businessNo !== 'string' ||
      typeof item.stage !== 'string' ||
      !Number.isSafeInteger(item.version) ||
      typeof item.entryId !== 'string' ||
      typeof item.recordedAt !== 'string'
    )
      throw invalidResponse();
    return item as unknown as CaseCsvCommitResult['items'][number];
  });
  return { items };
}
export async function getCaseCsvImportTemplate(options: RequestOptions = {}) {
  const result = await getBlob(`${basePath}/template`, options);
  if (
    result.filename !== 'case-external-entry-template.csv' ||
    result.mimeType !== 'text/csv' ||
    result.blob.size === 0
  )
    throw invalidResponse();
  return result;
}
export async function previewCaseCsvImport(
  csvBase64: string,
  options: RequestOptions = {},
): Promise<CaseCsvPreviewResult> {
  if (!csvBase64 || csvBase64.length > 87384) throw invalidInput();
  return decodePreview(
    await requestJson(`${basePath}/preview`, {
      ...options,
      method: 'POST',
      body: { csvBase64 } as JsonValue,
    }),
  );
}
export async function commitCaseCsvImport(
  input: CaseCsvCommitInput,
  options: RequestOptions = {},
): Promise<CaseCsvCommitResult> {
  if (
    !record(input) ||
    Object.keys(input).sort().join(',') !==
      'csvBase64,duplicateConfirmations,idempotencyKey,rowNumbers' ||
    !input.csvBase64 ||
    input.csvBase64.length > 87384 ||
    typeof input.idempotencyKey !== 'string' ||
    input.idempotencyKey.length < 1 ||
    input.idempotencyKey.length > 128 ||
    input.idempotencyKey.trim() !== input.idempotencyKey ||
    !Array.isArray(input.rowNumbers) ||
    input.rowNumbers.length < 1 ||
    input.rowNumbers.length > 20 ||
    new Set(input.rowNumbers).size !== input.rowNumbers.length ||
    input.rowNumbers.some(
      (row) => !Number.isSafeInteger(row) || row < 2 || row > 65537,
    ) ||
    !Array.isArray(input.duplicateConfirmations) ||
    input.duplicateConfirmations.some(
      (confirmation) =>
        !record(confirmation) ||
        Object.keys(confirmation).sort().join(',') !==
          'caseIds,rowNumber,rowNumbers' ||
        !input.rowNumbers.includes(confirmation.rowNumber) ||
        !Array.isArray(confirmation.caseIds) ||
        !Array.isArray(confirmation.rowNumbers) ||
        confirmation.caseIds.some(
          (id) => typeof id !== 'string' || !uuid.test(id),
        ) ||
        new Set(confirmation.caseIds).size !== confirmation.caseIds.length ||
        confirmation.rowNumbers.some(
          (row) => !Number.isSafeInteger(row) || row < 2 || row > 65537,
        ) ||
        new Set(confirmation.rowNumbers).size !==
          confirmation.rowNumbers.length,
    ) ||
    new Set(input.duplicateConfirmations.map((item) => item.rowNumber)).size !==
      input.duplicateConfirmations.length
  )
    throw invalidInput();
  const response = await requestJson(`${basePath}/commit`, {
    ...options,
    method: 'POST',
    retryOnCsrfInvalid: false,
    body: input,
  });
  return decodeCommit(response, input.rowNumbers);
}
