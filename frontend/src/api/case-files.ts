import { ApiError, getJson, postBlob, type RequestOptions } from './http';

export type CatalogFile = {
  materialId: string;
  contentVersionId: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  groupId: string;
  isCurrent: boolean;
  labels: string[];
};
export type FileCatalog = {
  caseId: string;
  businessNo: string;
  groups: Array<{ id: string; name: string; files: CatalogFile[] }>;
  otherFiles: CatalogFile[];
  limits: { maxFiles: number; maxBytes: number };
};
export type FileSelection = Pick<
  CatalogFile,
  'materialId' | 'contentVersionId'
>;
export type FileExportResult = FileSelection & {
  status: 'SUCCESS' | 'FAILED';
  path?: string;
  reason?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function isFile(value: unknown): value is CatalogFile {
  return (
    isRecord(value) &&
    typeof value.materialId === 'string' &&
    typeof value.contentVersionId === 'string' &&
    typeof value.originalFilename === 'string' &&
    typeof value.mimeType === 'string' &&
    typeof value.sizeBytes === 'number' &&
    typeof value.groupId === 'string' &&
    typeof value.isCurrent === 'boolean' &&
    Array.isArray(value.labels) &&
    value.labels.every((label) => typeof label === 'string')
  );
}
function invalid(): never {
  throw new ApiError('文件目录响应无效', 500, 'INVALID_RESPONSE');
}
export async function listCaseFileCatalog(
  caseId: string,
  options?: RequestOptions,
): Promise<FileCatalog> {
  const data = await getJson(
    `/cases/${encodeURIComponent(caseId)}/file-catalog`,
    options,
  );
  if (
    !isRecord(data) ||
    data.caseId !== caseId ||
    typeof data.businessNo !== 'string' ||
    !Array.isArray(data.groups) ||
    data.groups.length !== 16 ||
    !data.groups.every(
      (group) =>
        isRecord(group) &&
        typeof group.id === 'string' &&
        typeof group.name === 'string' &&
        Array.isArray(group.files) &&
        group.files.every(isFile),
    ) ||
    !Array.isArray(data.otherFiles) ||
    !data.otherFiles.every(isFile) ||
    !isRecord(data.limits) ||
    typeof data.limits.maxFiles !== 'number' ||
    typeof data.limits.maxBytes !== 'number'
  )
    invalid();
  return data as FileCatalog;
}
export async function exportCaseFiles(
  caseId: string,
  selections: FileSelection[],
  options?: RequestOptions,
): Promise<{
  blob: Blob;
  filename: string;
  results: FileExportResult[];
}> {
  const downloaded = await postBlob(
    `/cases/${encodeURIComponent(caseId)}/files/export`,
    { selections },
    options,
  );
  const raw = downloaded.responseHeaders.get('X-Case-Export-Result');
  let results: unknown;
  try {
    results = raw ? JSON.parse(raw) : null;
  } catch {
    invalid();
  }
  if (
    downloaded.mimeType !== 'application/zip' ||
    !Array.isArray(results) ||
    results.length !== selections.length ||
    !results.every(
      (item) =>
        isRecord(item) &&
        typeof item.materialId === 'string' &&
        typeof item.contentVersionId === 'string' &&
        (item.status === 'SUCCESS' || item.status === 'FAILED'),
    )
  )
    invalid();
  return {
    blob: downloaded.blob,
    filename: downloaded.filename,
    results: results as FileExportResult[],
  };
}
