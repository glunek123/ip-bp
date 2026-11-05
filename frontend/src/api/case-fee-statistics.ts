import { ApiError, getJson, type RequestOptions } from './http';

export type CaseFeeStatistics = {
  caseId: string;
  scope: 'CASE_ACTIVE_SOURCE_RECORDS';
  recordCount: number;
  proofRecordCount: number;
  proofVersionCount: number;
  noteRecordCount: number;
};

export async function getCaseFeeStatistics(
  caseId: string,
  options?: RequestOptions,
): Promise<CaseFeeStatistics> {
  const value = await getJson(
    `/fees/statistics?${new URLSearchParams({ caseId })}`,
    options,
  );
  const invalid = () =>
    new ApiError('费用统计返回的数据无效', 502, 'INVALID_FEE_STATISTICS');
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw invalid();
  const row = value as Record<string, unknown>;
  const fields = [
    'recordCount',
    'proofRecordCount',
    'proofVersionCount',
    'noteRecordCount',
  ] as const;
  if (
    row.caseId !== caseId ||
    row.scope !== 'CASE_ACTIVE_SOURCE_RECORDS' ||
    fields.some(
      (key) =>
        typeof row[key] !== 'number' ||
        !Number.isSafeInteger(row[key]) ||
        row[key] < 0,
    )
  )
    throw invalid();
  return {
    caseId,
    scope: 'CASE_ACTIVE_SOURCE_RECORDS',
    recordCount: row.recordCount as number,
    proofRecordCount: row.proofRecordCount as number,
    proofVersionCount: row.proofVersionCount as number,
    noteRecordCount: row.noteRecordCount as number,
  };
}
