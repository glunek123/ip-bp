export const caseListSortFields = [
  'createdAt',
  'businessNo',
  'rightsHolderName',
] as const;

export type CaseListSortField = (typeof caseListSortFields)[number];
export type CaseListSortDirection = 'asc' | 'desc';

export interface CaseListQuery {
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

const textKeys = [
  'q',
  'customerName',
  'rightsHolderName',
  'courtCaseNo',
] as const;
const caseListKeys = [...textKeys, 'sortBy', 'sortDirection'] as const;

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
  for (const key of caseListKeys) {
    const value = query[key];
    if (value === undefined) continue;
    if (!scalar(value))
      return { ok: false, message: `查询参数 ${key} 必须且只能出现一次。` };
    if (key === 'sortBy') {
      if (!caseListSortFields.includes(value as CaseListSortField))
        return { ok: false, message: '排序字段无效，请调整排序后重试。' };
      parsed.sortBy = value as CaseListSortField;
    } else if (key === 'sortDirection') {
      if (value !== 'asc' && value !== 'desc')
        return { ok: false, message: '排序方向无效，请调整排序后重试。' };
      parsed.sortDirection = value;
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
  if (query.sortBy) serialized.sortBy = query.sortBy;
  if (query.sortDirection) serialized.sortDirection = query.sortDirection;
  return serialized;
}

export function caseListQueryKey(query: CaseListQuery): string {
  const serialized = serializeCaseListQuery(query);
  return caseListKeys
    .filter((key) => serialized[key] !== undefined)
    .map((key) => `${key}=${encodeURIComponent(serialized[key]!)}`)
    .join('&');
}
