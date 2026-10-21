import { ApiError, postBlob, type RequestOptions } from './http';
import type { ReportsView } from './reports';

export type ReportsExportInput = { view: ReportsView };
export type ReportsExportFile = {
  blob: Blob;
  filename: string;
  mimeType: 'text/csv';
};
export type ReportsExportContext = {
  actorKey: string;
  contextKey: string;
  view: ReportsView;
  canExport: boolean;
};

function snapshotOptions(options: RequestOptions): RequestOptions {
  return {
    ...options,
    ...(options.headers ? { headers: { ...options.headers } } : {}),
    retryOnCsrfInvalid: false,
  };
}
function validFilename(filename: unknown): filename is string {
  if (typeof filename !== 'string') return false;
  const date = /^案件报表_(\d{4}-\d{2}-\d{2})\.csv$/u.exec(filename)?.[1];
  if (!date) return false;
  const timestamp = Date.parse(`${date}T00:00:00Z`);
  return (
    Number.isFinite(timestamp) &&
    new Date(timestamp).toISOString().slice(0, 10) === date
  );
}
export async function exportReportsCsv(
  input: ReportsExportInput,
  options: RequestOptions = {},
): Promise<ReportsExportFile> {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).length !== 1 ||
    !Object.hasOwn(input, 'view') ||
    (input.view !== 'mine' && input.view !== 'department')
  )
    throw new ApiError('报表导出视图无效', 400, 'VALIDATION_ERROR');
  const body = { view: input.view };
  const frozenOptions = snapshotOptions(options);
  frozenOptions.signal?.throwIfAborted();
  const result = await postBlob('/reports/export', body, frozenOptions);
  frozenOptions.signal?.throwIfAborted();
  if (
    !result ||
    !(result.blob instanceof globalThis.Blob) ||
    result.blob.size === 0 ||
    !validFilename(result.filename) ||
    result.mimeType !== 'text/csv' ||
    result.blob.type.replace(/\s/gu, '').toLowerCase() !==
      'text/csv;charset=utf-8'
  )
    throw new ApiError('服务返回了无效的报表CSV文件', 502, 'INVALID_RESPONSE');
  // CSV is opaque server output: never parse it or construct rows in the client.
  return { blob: result.blob, filename: result.filename, mimeType: 'text/csv' };
}

/** The host calls cancel on context invalidation/unmount; late completions are
 * fenced again against the live actor/context/view/capability before any URL. */
export function createReportsExportController(
  readContext: () => ReportsExportContext,
) {
  let busy = false,
    generation = 0,
    controller: AbortController | undefined;
  function cancel(): void {
    generation += 1;
    controller?.abort();
    controller = undefined;
    busy = false;
  }
  return {
    get busy() {
      return busy;
    },
    cancel,
    async download(options: RequestOptions = {}): Promise<boolean> {
      const context = { ...readContext() };
      if (
        busy ||
        !context.canExport ||
        !context.actorKey ||
        !context.contextKey ||
        options.signal?.aborted
      )
        return false;
      const frozenOptions = snapshotOptions(options);
      const request = new AbortController();
      controller = request;
      const signal = frozenOptions.signal
        ? AbortSignal.any([request.signal, frozenOptions.signal])
        : request.signal;
      const currentGeneration = ++generation;
      busy = true;
      function current(): boolean {
        const now = readContext();
        return (
          !signal.aborted &&
          generation === currentGeneration &&
          now.canExport &&
          now.actorKey === context.actorKey &&
          now.contextKey === context.contextKey &&
          now.view === context.view
        );
      }
      try {
        const result = await exportReportsCsv(
          { view: context.view },
          { ...frozenOptions, signal },
        );
        if (!current()) return false;
        const objectUrl = globalThis.URL.createObjectURL(result.blob);
        try {
          const link = globalThis.document.createElement('a');
          link.href = objectUrl;
          link.download = result.filename;
          link.click();
        } finally {
          globalThis.URL.revokeObjectURL(objectUrl);
        }
        return true;
      } catch (cause) {
        if (!current()) return false;
        throw cause;
      } finally {
        if (generation === currentGeneration) {
          busy = false;
          controller = undefined;
        }
      }
    },
  };
}
