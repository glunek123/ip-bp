import type { LeadCaseType } from '../../api/leads';

export const caseListCaseTypes = [
  'CIVIL',
  'CRIMINAL',
  'ADMINISTRATIVE',
  'INVESTIGATION',
  'NOTARIZATION',
  'HEARING_REPRESENTATION',
] as const satisfies readonly LeadCaseType[];

export const caseListSortFields = [
  'createdAt',
  'businessNo',
  'rightsHolderName',
] as const;

export type CaseListSortField = (typeof caseListSortFields)[number];
export type CaseListSortDirection = 'asc' | 'desc';

export interface CaseListQuery {
  shopName?: string;
  defendantName?: string;
  courtName?: string;
  lawyerName?: string;
  caseType?: LeadCaseType;
  q?: string;
  customerName?: string;
  rightsHolderName?: string;
  courtCaseNo?: string;
  sortBy?: CaseListSortField;
  sortDirection?: CaseListSortDirection;
}

export type CaseListRouteQuery = Record<string, unknown>;

export type ParsedCaseListQuery =
  { ok: true; value: CaseListQuery } | { ok: false; message: string };

const textKeys = ['q'] as const;
export const caseListQueryKeys = [...textKeys, 'caseType'] as const;

function scalar(value: unknown): value is string {
  return typeof value === 'string';
}

function backendStringLength(value: string): number {
  return (
    value.length -
    (value.match(/[^\uFE0F\uFE0E][\uFE0F\uFE0E]/g) ?? []).length -
    (value.match(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g) ?? []).length
  );
}

export function parseCaseListQuery(
  query: CaseListRouteQuery,
): ParsedCaseListQuery {
  const parsed: CaseListQuery = {};
  for (const key of caseListQueryKeys) {
    const value = query[key];
    if (value === undefined) continue;
    if (!scalar(value))
      return { ok: false, message: `查询参数 ${key} 必须且只能出现一次。` };
    if (key === 'caseType') {
      if (!caseListCaseTypes.includes(value as LeadCaseType))
        return { ok: false, message: '案件类型无效，请调整后重试。' };
      parsed.caseType = value as LeadCaseType;
    } else {
      const normalized = value.trim();
      if (backendStringLength(normalized) > 200)
        return { ok: false, message: `查询条件 ${key} 不能超过200个字符。` };
      if (normalized) parsed[key] = normalized;
    }
  }
  return { ok: true, value: parsed };
}

export function serializeCaseListQuery(
  query: CaseListQuery,
): Record<string, string> {
  const serialized: Record<string, string> = {};
  for (const key of textKeys) {
    const value = query[key]?.trim();
    if (value) serialized[key] = value;
  }
  if (query.caseType) serialized.caseType = query.caseType;
  return serialized;
}

export function caseListQueryKey(query: CaseListQuery): string {
  const serialized = serializeCaseListQuery(query);
  return caseListQueryKeys
    .filter((key) => serialized[key] !== undefined)
    .map((key) => `${key}=${encodeURIComponent(serialized[key]!)}`)
    .join('&');
}
