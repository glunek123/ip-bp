import { ApiError, postBlob, requestJson } from './http';
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
export type ComplaintExportCandidate = {
  materialId: string;
  contentVersionId: string;
  filename: string;
  sizeBytes: number;
  tags: Array<'UPLOADED' | 'SUBMITTED' | 'CONFIRMED'>;
};
export type ComplaintExportPreviewItem = {
  caseId: string;
  businessNo?: string;
  status: 'READY' | 'MISSING' | 'UNAVAILABLE';
  candidates: ComplaintExportCandidate[];
  reason?: string;
};
export type ComplaintExportPreview = {
  items: ComplaintExportPreviewItem[];
  limits: { maxCases: number; maxFiles: number; maxBytes: number };
};
export type ComplaintExportSelection = {
  caseId: string;
  materialId: string;
  contentVersionId: string;
};
export type ComplaintExportResultItem = {
  caseId: string;
  successCount: number;
  failCount: number;
  errorCode?: string;
};
export type ComplaintExportFailure = ComplaintExportSelection & {
  filename: string | null;
  reason:
    | 'CASE_UNAVAILABLE'
    | 'VERSION_UNAVAILABLE'
    | 'SIZE_LIMIT'
    | 'FILE_UNAVAILABLE';
};
const invalid = () =>
  new ApiError('服务返回了无效的诉状导出数据', 200, 'INVALID_RESPONSE');
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
function validCandidate(value: unknown): value is ComplaintExportCandidate {
  return (
    record(value) &&
    typeof value.materialId === 'string' &&
    uuid.test(value.materialId) &&
    typeof value.contentVersionId === 'string' &&
    uuid.test(value.contentVersionId) &&
    typeof value.filename === 'string' &&
    typeof value.sizeBytes === 'number' &&
    Number.isSafeInteger(value.sizeBytes) &&
    value.sizeBytes >= 0 &&
    Array.isArray(value.tags) &&
    value.tags.length >= 1 &&
    value.tags.every((tag) =>
      ['UPLOADED', 'SUBMITTED', 'CONFIRMED'].includes(String(tag)),
    )
  );
}
function validItem(value: unknown): value is ComplaintExportPreviewItem {
  return (
    record(value) &&
    typeof value.caseId === 'string' &&
    uuid.test(value.caseId) &&
    ['READY', 'MISSING', 'UNAVAILABLE'].includes(String(value.status)) &&
    (value.businessNo === undefined || typeof value.businessNo === 'string') &&
    (value.reason === undefined || typeof value.reason === 'string') &&
    Array.isArray(value.candidates) &&
    value.candidates.every(validCandidate)
  );
}
function validResult(value: unknown): value is ComplaintExportResultItem {
  return (
    record(value) &&
    typeof value.caseId === 'string' &&
    uuid.test(value.caseId) &&
    Number.isSafeInteger(value.successCount) &&
    Number.isSafeInteger(value.failCount) &&
    (value.successCount as number) >= 0 &&
    (value.failCount as number) >= 0 &&
    (value.errorCode === undefined || typeof value.errorCode === 'string')
  );
}
export function complaintExportFailures(
  error: unknown,
): ComplaintExportFailure[] | null {
  if (
    !(error instanceof ApiError) ||
    error.code !== 'CASE_EXPORT_EMPTY' ||
    !record(error.details) ||
    Object.keys(error.details).length !== 1 ||
    !Array.isArray(error.details.files) ||
    error.details.files.length < 1 ||
    error.details.files.length > 100
  )
    return null;
  const files: unknown[] = error.details.files;
  if (
    !files.every(
      (value) =>
        record(value) &&
        Object.keys(value).length === 5 &&
        typeof value.caseId === 'string' &&
        uuid.test(value.caseId) &&
        typeof value.materialId === 'string' &&
        uuid.test(value.materialId) &&
        typeof value.contentVersionId === 'string' &&
        uuid.test(value.contentVersionId) &&
        (value.filename === null ||
          (typeof value.filename === 'string' &&
            value.filename.length > 0 &&
            value.filename.length <= 512)) &&
        [
          'CASE_UNAVAILABLE',
          'VERSION_UNAVAILABLE',
          'SIZE_LIMIT',
          'FILE_UNAVAILABLE',
        ].includes(String(value.reason)),
    )
  )
    return null;
  return files as ComplaintExportFailure[];
}
export async function previewComplaintExport(
  caseIds: string[],
): Promise<ComplaintExportPreview> {
  if (
    caseIds.length < 1 ||
    caseIds.length > 20 ||
    caseIds.some((id) => !uuid.test(id)) ||
    new Set(caseIds).size !== caseIds.length
  )
    throw new ApiError('请选择1至20件不同案件', 400, 'VALIDATION_ERROR');
  const value = await requestJson('/cases/complaint-export/preview', {
    method: 'POST',
    body: { caseIds },
  });
  if (
    !record(value) ||
    !Array.isArray(value.items) ||
    value.items.length !== caseIds.length ||
    !value.items.every(validItem) ||
    !record(value.limits) ||
    value.limits.maxCases !== 20 ||
    value.limits.maxFiles !== 100 ||
    value.limits.maxBytes !== 100 * 1024 * 1024
  )
    throw invalid();
  return value as ComplaintExportPreview;
}
export async function downloadComplaintZip(
  selections: ComplaintExportSelection[],
): Promise<{
  blob: Blob;
  filename: string;
  results: ComplaintExportResultItem[];
}> {
  if (
    selections.length < 1 ||
    selections.length > 100 ||
    selections.some(
      (item) =>
        !uuid.test(item.caseId) ||
        !uuid.test(item.materialId) ||
        !uuid.test(item.contentVersionId),
    ) ||
    new Set(selections.map((item) => item.caseId)).size > 20 ||
    new Set(
      selections.map(
        (item) => `${item.caseId}:${item.materialId}:${item.contentVersionId}`,
      ),
    ).size !== selections.length
  )
    throw new ApiError('请逐案明确选择诉状版本', 400, 'VALIDATION_ERROR');
  let downloaded: Awaited<ReturnType<typeof postBlob>>;
  try {
    downloaded = await postBlob('/cases/complaint-export/download', {
      selections,
    });
  } catch (error) {
    if (error instanceof ApiError && error.code === 'CASE_EXPORT_EMPTY') {
      const failures = complaintExportFailures(error);
      const expected = new Set(
        selections.map(
          (item) =>
            `${item.caseId}:${item.materialId}:${item.contentVersionId}`,
        ),
      );
      if (
        !failures ||
        failures.length !== selections.length ||
        failures.some(
          (item) =>
            !expected.delete(
              `${item.caseId}:${item.materialId}:${item.contentVersionId}`,
            ),
        ) ||
        expected.size !== 0
      )
        throw invalid();
    }
    throw error;
  }
  const raw = downloaded.responseHeaders.get('X-Case-Export-Result');
  let parsed: unknown;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    throw invalid();
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length !== new Set(selections.map((item) => item.caseId)).size ||
    !parsed.every(validResult) ||
    downloaded.mimeType !== 'application/zip'
  )
    throw invalid();
  return {
    blob: downloaded.blob,
    filename: downloaded.filename,
    results: parsed,
  };
}
