import { ApiError, getJson, requestJson, type RequestOptions } from './http';

export type CaseListColumn =
  | 'businessNo'
  | 'stage'
  | 'customerName'
  | 'rightsHolderName'
  | 'platform'
  | 'shopName'
  | 'shopExternalId'
  | 'defendants'
  | 'lawyers'
  | 'court'
  | 'courtCaseNo'
  | 'claimAmount'
  | 'judgmentAmount'
  | 'closureAmount';
export type CaseListOptionalColumn = Exclude<
  CaseListColumn,
  'businessNo' | 'stage'
>;
export type CaseListPreferenceBucket =
  | 'all'
  | 'PENDING_MATCH'
  | 'WAITING_COMPLAINT'
  | 'WAITING_COMPLAINT_CONFIRMATION'
  | 'WAITING_COMPLAINT_STAMP'
  | 'WAITING_FILING'
  | 'WAITING_FORMAL_ACCEPTANCE'
  | 'WAITING_HEARING'
  | 'WAITING_JUDGMENT'
  | 'SECOND_INSTANCE'
  | 'WAITING_EXECUTION_DOCUMENTS'
  | 'WAITING_EXECUTION_CONFIRMATION'
  | 'WAITING_EXECUTION_STAMP'
  | 'WAITING_EXECUTION_FILING'
  | 'EXECUTING'
  | 'WAITING_ARCHIVE'
  | 'ARCHIVED'
  | 'COMPLAINT_PREPARATION'
  | 'EXECUTION_PREPARATION';
export type CaseListPreference = {
  order: CaseListColumn[];
  hidden: CaseListOptionalColumn[];
};

const fixedColumns = ['businessNo', 'stage'] as const;
const optionalColumns: CaseListOptionalColumn[] = [
  'customerName',
  'rightsHolderName',
  'platform',
  'shopName',
  'shopExternalId',
  'defendants',
  'lawyers',
  'court',
  'courtCaseNo',
  'claimAmount',
  'judgmentAmount',
  'closureAmount',
];
const columns: CaseListColumn[] = [...fixedColumns, ...optionalColumns];
const buckets: CaseListPreferenceBucket[] = [
  'all',
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
  'COMPLAINT_PREPARATION',
  'EXECUTION_PREPARATION',
];
export const defaultCaseListPreference: CaseListPreference = {
  order: [...columns],
  hidden: [],
};

function invalid(): ApiError {
  return new ApiError('案件列表列偏好无效', 400, 'VALIDATION_ERROR');
}

function decodePreference(
  value: unknown,
  errorCode: 'INVALID_RESPONSE' | 'VALIDATION_ERROR' = 'INVALID_RESPONSE',
): CaseListPreference {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).length !== 2 ||
    !('order' in value) ||
    !('hidden' in value)
  )
    throw new ApiError(
      errorCode === 'INVALID_RESPONSE'
        ? '案件列表列偏好响应无效'
        : '案件列表列偏好无效',
      errorCode === 'INVALID_RESPONSE' ? 502 : 400,
      errorCode,
    );
  const candidate = value as Record<string, unknown>;
  if (
    !Array.isArray(candidate.order) ||
    candidate.order.length !== columns.length ||
    !candidate.order.every((column) =>
      columns.includes(column as CaseListColumn),
    ) ||
    new Set(candidate.order).size !== columns.length ||
    candidate.order[0] !== fixedColumns[0] ||
    candidate.order[1] !== fixedColumns[1] ||
    !Array.isArray(candidate.hidden) ||
    !candidate.hidden.every((column) =>
      optionalColumns.includes(column as CaseListOptionalColumn),
    ) ||
    new Set(candidate.hidden).size !== candidate.hidden.length
  )
    throw new ApiError(
      errorCode === 'INVALID_RESPONSE'
        ? '案件列表列偏好响应无效'
        : '案件列表列偏好无效',
      errorCode === 'INVALID_RESPONSE' ? 502 : 400,
      errorCode,
    );
  return {
    order: [...candidate.order] as CaseListColumn[],
    hidden: [...candidate.hidden] as CaseListOptionalColumn[],
  };
}

function preferencePath(bucket: CaseListPreferenceBucket): string {
  if (!buckets.includes(bucket)) throw invalid();
  return `/cases/list-preferences/${encodeURIComponent(bucket)}`;
}

export async function getCaseListPreference(
  bucket: CaseListPreferenceBucket,
  options?: RequestOptions,
): Promise<CaseListPreference> {
  return decodePreference(await getJson(preferencePath(bucket), options));
}

export async function saveCaseListPreference(
  bucket: CaseListPreferenceBucket,
  preference: CaseListPreference,
  options?: RequestOptions,
): Promise<CaseListPreference> {
  const body = decodePreference(preference, 'VALIDATION_ERROR');
  return decodePreference(
    await requestJson(preferencePath(bucket), {
      ...options,
      method: 'PUT',
      body,
    }),
  );
}
