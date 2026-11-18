import { ApiError, getJson, requestJson, type RequestOptions } from './http';

export type CasePreservation = {
  id: string;
  documentVersionId: string | null;
  documentName: string | null;
  preservedOn: string;
  feeAmount: string | null;
  premiumAmount: string | null;
  recordedAt: string;
};

export type PreservationInput = {
  documentVersionId?: string | null;
  documentName?: string | null;
  preservedOn: string;
  feeAmount?: string | null;
  premiumAmount?: string | null;
};

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export async function getCasePreservation(
  caseId: string,
  options: RequestOptions = {},
): Promise<CasePreservation | null> {
  if (!uuid.test(caseId))
    throw new ApiError('案件编号无效', 400, 'VALIDATION_ERROR');
  const value = await getJson(
    `/cases/${encodeURIComponent(caseId)}/preservation`,
    options,
  );
  if (value === null) return null;
  const row = value as Record<string, unknown>;
  return {
    id: String(row.id ?? ''),
    documentVersionId: row.documentVersionId === null ? null : String(row.documentVersionId ?? ''),
    documentName: row.documentName === null ? null : String(row.documentName ?? ''),
    preservedOn: String(row.preservedOn ?? ''),
    feeAmount: row.feeAmount === null ? null : String(row.feeAmount ?? ''),
    premiumAmount:
      row.premiumAmount === null ? null : String(row.premiumAmount ?? ''),
    recordedAt: String(row.recordedAt ?? ''),
  };
}

export async function saveCasePreservation(
  caseId: string,
  input: PreservationInput,
  options: RequestOptions = {},
): Promise<CasePreservation> {
  if (!uuid.test(caseId))
    throw new ApiError('案件编号无效', 400, 'VALIDATION_ERROR');
  const value = await requestJson(
    `/cases/${encodeURIComponent(caseId)}/preservation`,
    {
      ...options,
      method: 'PUT',
      body: input,
    },
  );
  const row = value as Record<string, unknown>;
  return {
    id: String(row.id ?? ''),
    documentVersionId: row.documentVersionId === null ? null : String(row.documentVersionId ?? ''),
    documentName: row.documentName === null ? null : String(row.documentName ?? ''),
    preservedOn: String(row.preservedOn ?? ''),
    feeAmount: row.feeAmount === null ? null : String(row.feeAmount ?? ''),
    premiumAmount:
      row.premiumAmount === null ? null : String(row.premiumAmount ?? ''),
    recordedAt: String(row.recordedAt ?? ''),
  };
}
