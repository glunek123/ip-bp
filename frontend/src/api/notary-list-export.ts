import {
  ApiError,
  postBlob,
  requestJson,
  type JsonValue,
  type RequestOptions,
} from './http';
import type { NotaryListStage } from './notary';

export type NotaryListExportScope =
  | { mode: 'SELECTED'; matterIds: string[] }
  | { mode: 'FILTERED'; stage?: NotaryListStage };
export type NotaryListExportPreview = { count: number; maxRows: 1000 };
export type NotaryListExportFile = {
  blob: Blob;
  filename: string;
  mimeType: 'text/csv';
};

function invalidResponse(): ApiError {
  return new ApiError(
    '服务返回了无效的公证事项导出数据',
    200,
    'INVALID_RESPONSE',
  );
}

function decodePreview(value: unknown): NotaryListExportPreview {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== 2 ||
    !Object.hasOwn(value, 'count') ||
    !Object.hasOwn(value, 'maxRows')
  )
    throw invalidResponse();
  const preview = value as Record<string, unknown>;
  if (
    !Number.isInteger(preview.count) ||
    (preview.count as number) < 1 ||
    (preview.count as number) > 1000 ||
    preview.maxRows !== 1000
  )
    throw invalidResponse();
  return { count: preview.count as number, maxRows: 1000 };
}

function scopeJson(scope: NotaryListExportScope): JsonValue {
  return scope.mode === 'SELECTED'
    ? { mode: scope.mode, matterIds: scope.matterIds }
    : { mode: scope.mode, ...(scope.stage ? { stage: scope.stage } : {}) };
}

export async function previewNotaryListExport(
  scope: NotaryListExportScope,
  options: RequestOptions = {},
): Promise<NotaryListExportPreview> {
  return decodePreview(
    await requestJson('/notary-matters/exports/preview', {
      ...options,
      method: 'POST',
      body: scopeJson(scope),
    }),
  );
}

export async function exportNotaryList(
  scope: NotaryListExportScope,
  expectedCount: number,
  options: RequestOptions = {},
): Promise<NotaryListExportFile> {
  const body: JsonValue =
    scope.mode === 'SELECTED'
      ? { mode: 'SELECTED', matterIds: scope.matterIds, expectedCount }
      : {
          mode: 'FILTERED',
          ...(scope.stage ? { stage: scope.stage } : {}),
          expectedCount,
        };
  const result = await postBlob('/notary-matters/exports', body, options);
  if (result.mimeType !== 'text/csv') throw invalidResponse();
  return { ...result, mimeType: 'text/csv' };
}
