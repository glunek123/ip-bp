import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type RequestOptions } from './http';
import {
  createReportsExportController,
  exportReportsCsv,
  type ReportsExportContext,
  type ReportsExportInput,
} from './reports-export';
const http = vi.hoisted(() => ({ postBlob: vi.fn() }));
vi.mock('./http', async (original) => ({
  ...(await original<typeof import('./http')>()),
  postBlob: http.postBlob,
}));
const nativeURL = globalThis.URL;
const createURL = vi.fn(() => 'blob:synthetic-report'),
  revokeURL = vi.fn();
const clicks: HTMLAnchorElement[] = [];
const file = () => ({
  blob: new Blob(['维度,项目,数值\r\n汇总,案件总数,5\r\n'], {
    type: 'text/csv;charset=utf-8',
  }),
  filename: '案件报表_2026-10-21.csv',
  mimeType: 'text/csv',
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
beforeEach(() => {
  vi.resetAllMocks();
  clicks.length = 0;
  createURL.mockReturnValue('blob:synthetic-report');
  vi.stubGlobal(
    'URL',
    class extends nativeURL {
      static createObjectURL = createURL;
      static revokeObjectURL = revokeURL;
    },
  );
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    clicks.push(this);
  });
  http.postBlob.mockResolvedValue(file());
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('reports CSV API', () => {
  it.each(['mine', 'department'] as const)(
    'posts only explicit %s view with options snapshot and no CSRF retry',
    async (view) => {
      const response = file();
      http.postBlob.mockResolvedValue(response);
      const headers = { 'X-Synthetic': 'first' };
      const input = { view };
      const options: RequestOptions = {
        headers,
        timeoutMs: 1000,
        retryOnCsrfInvalid: true,
      };
      const pending = exportReportsCsv(input, options);
      headers['X-Synthetic'] = 'later';
      options.timeoutMs = 1;
      input.view = view === 'mine' ? 'department' : 'mine';
      const result = await pending;
      expect(http.postBlob).toHaveBeenCalledExactlyOnceWith(
        '/reports/export',
        { view },
        {
          headers: { 'X-Synthetic': 'first' },
          timeoutMs: 1000,
          retryOnCsrfInvalid: false,
        },
      );
      expect(result.filename).toBe('案件报表_2026-10-21.csv');
      expect(result.mimeType).toBe('text/csv');
      expect(result.blob).toBe(response.blob);
    },
  );
  it.each([
    null,
    {},
    [],
    { view: 'all' },
    { view: 'mine', departmentId: 'foreign' },
    { view: 'mine', fields: ['amount'] },
    { view: 'mine', page: 1 },
  ])('rejects non-contract body %j before HTTP', async (input) => {
    await expect(
      exportReportsCsv(input as ReportsExportInput),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(http.postBlob).not.toHaveBeenCalled();
  });
  it.each([
    { filename: 'other.csv' },
    { filename: '../案件报表_2026-10-21.csv' },
    { filename: '案件报表_2026-02-30.csv' },
    { mimeType: 'application/json' },
    { blob: new Blob([], { type: 'text/csv;charset=utf-8' }) },
    { blob: new Blob(['x'], { type: 'application/json' }) },
    { blob: new Blob(['x'], { type: 'text/csv' }) },
    { blob: new Blob(['x'], { type: 'text/csv;charset=gbk' }) },
  ])(
    'rejects invalid CSV metadata %# without reading or reconstructing CSV',
    async (patch) => {
      http.postBlob.mockResolvedValue({ ...file(), ...patch });
      await expect(exportReportsCsv({ view: 'mine' })).rejects.toMatchObject({
        status: 502,
        code: 'INVALID_RESPONSE',
      });
      expect(createURL).not.toHaveBeenCalled();
    },
  );
  it('keeps server CSV opaque and accepts a real leap-day filename', async () => {
    const result = { ...file(), filename: '案件报表_2028-02-29.csv' };
    Object.defineProperty(result.blob, 'text', {
      value: () => {
        throw new Error('CSV must remain opaque');
      },
    });
    http.postBlob.mockResolvedValue(result);
    await expect(exportReportsCsv({ view: 'mine' })).resolves.toMatchObject({
      blob: result.blob,
    });
  });
  it('does not dispatch an already aborted request or return a late result', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      exportReportsCsv({ view: 'mine' }, { signal: controller.signal }),
    ).rejects.toBe(controller.signal.reason);
    expect(http.postBlob).not.toHaveBeenCalled();
    const later = new AbortController(),
      pending = deferred<ReturnType<typeof file>>();
    http.postBlob.mockReturnValueOnce(pending.promise);
    const result = exportReportsCsv({ view: 'mine' }, { signal: later.signal });
    later.abort();
    pending.resolve(file());
    await expect(result).rejects.toBe(later.signal.reason);
  });
  it.each([400, 401, 403, 500])(
    'preserves HTTP%i error with exactly one attempt',
    async (status) => {
      const failure = new ApiError('private', status, 'ACTION_FORBIDDEN');
      http.postBlob.mockRejectedValue(failure);
      await expect(exportReportsCsv({ view: 'mine' })).rejects.toBe(failure);
      expect(http.postBlob).toHaveBeenCalledTimes(1);
    },
  );
  it('runs the actual controlled POST helper with exact body and RFC5987 filename', async () => {
    const actual = await vi.importActual<typeof import('./http')>('./http');
    http.postBlob.mockImplementation(actual.postBlob);
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({
        'Content-Type': 'text/csv;charset=utf-8',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file().filename)}`,
      }),
      blob: async () => file().blob,
    });
    vi.stubGlobal('fetch', fetch);
    await expect(exportReportsCsv({ view: 'mine' })).resolves.toMatchObject({
      filename: file().filename,
    });
    expect(fetch).toHaveBeenCalledExactlyOnceWith(
      '/api/v1/reports/export',
      expect.objectContaining({
        method: 'POST',
        credentials: 'same-origin',
        body: '{"view":"mine"}',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
        }),
      }),
    );
  });
  it('does not refresh CSRF or retry a failed POST through the actual helper', async () => {
    const actual = await vi.importActual<typeof import('./http')>('./http');
    http.postBlob.mockImplementation(actual.postBlob);
    const fetch = vi
      .fn()
      .mockImplementation(
        async () =>
          new Response(
            JSON.stringify({ code: 'CSRF_INVALID', message: 'private' }),
            { status: 403, headers: { 'Content-Type': 'application/json' } },
          ),
      );
    vi.stubGlobal('fetch', fetch);
    await expect(
      exportReportsCsv({ view: 'mine' }, { retryOnCsrfInvalid: true }),
    ).rejects.toMatchObject({ code: 'CSRF_INVALID' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe('reports export download lifecycle', () => {
  const context = (): ReportsExportContext => ({
    actorKey: 'actor-1',
    contextKey: 'session-1:auth-1',
    view: 'mine',
    canExport: true,
  });
  it('blocks double clicks, downloads the returned filename, then revokes the object URL', async () => {
    const pending = deferred<ReturnType<typeof file>>();
    http.postBlob.mockReturnValueOnce(pending.promise);
    const controller = createReportsExportController(context);
    const first = controller.download();
    expect(controller.busy).toBe(true);
    await expect(controller.download()).resolves.toBe(false);
    expect(http.postBlob).toHaveBeenCalledTimes(1);
    pending.resolve(file());
    await expect(first).resolves.toBe(true);
    expect(controller.busy).toBe(false);
    expect(createURL).toHaveBeenCalledTimes(1);
    expect(clicks).toHaveLength(1);
    expect(clicks[0]?.download).toBe(file().filename);
    expect(revokeURL).toHaveBeenCalledExactlyOnceWith('blob:synthetic-report');
  });
  it.each(['actor', 'context', 'view', 'capability'] as const)(
    'discards a late CSV after %s changes without allocating an object URL',
    async (kind) => {
      const current = context(),
        pending = deferred<ReturnType<typeof file>>();
      http.postBlob.mockReturnValueOnce(pending.promise);
      const controller = createReportsExportController(() => current);
      const result = controller.download();
      if (kind === 'actor') current.actorKey = 'actor-2';
      if (kind === 'context') current.contextKey = 'session-2';
      if (kind === 'view') current.view = 'department';
      if (kind === 'capability') current.canExport = false;
      pending.resolve(file());
      await expect(result).resolves.toBe(false);
      expect(createURL).not.toHaveBeenCalled();
      expect(clicks).toHaveLength(0);
    },
  );
  it('aborts on cancel and an older finally cannot clear a newer export', async () => {
    const old = deferred<ReturnType<typeof file>>(),
      fresh = deferred<ReturnType<typeof file>>();
    http.postBlob
      .mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(fresh.promise);
    const controller = createReportsExportController(context);
    const first = controller.download();
    const signal = http.postBlob.mock.calls[0]?.[2].signal as AbortSignal;
    controller.cancel();
    expect(signal.aborted).toBe(true);
    const second = controller.download();
    old.resolve(file());
    await expect(first).resolves.toBe(false);
    expect(controller.busy).toBe(true);
    expect(createURL).not.toHaveBeenCalled();
    fresh.resolve(file());
    await expect(second).resolves.toBe(true);
    expect(controller.busy).toBe(false);
    expect(createURL).toHaveBeenCalledTimes(1);
  });
  it('honors an external abort even when the mocked transport resolves', async () => {
    const abort = new AbortController(),
      pending = deferred<ReturnType<typeof file>>();
    http.postBlob.mockReturnValueOnce(pending.promise);
    const controller = createReportsExportController(context);
    const result = controller.download({ signal: abort.signal });
    abort.abort();
    pending.resolve(file());
    await expect(result).resolves.toBe(false);
    expect(createURL).not.toHaveBeenCalled();
  });
  it('does not infer export authority from a view or actor name', async () => {
    const controller = createReportsExportController(() => ({
      ...context(),
      actorKey: 'INTERNAL:运营',
      canExport: false,
    }));
    await expect(controller.download()).resolves.toBe(false);
    expect(http.postBlob).not.toHaveBeenCalled();
    expect(createURL).not.toHaveBeenCalled();
  });
  it('clears busy after an actual error and never initiates download', async () => {
    const error = new ApiError('private', 403, 'ACTION_FORBIDDEN');
    http.postBlob.mockRejectedValue(error);
    const controller = createReportsExportController(context);
    await expect(controller.download()).rejects.toBe(error);
    expect(controller.busy).toBe(false);
    expect(createURL).not.toHaveBeenCalled();
  });
  it('releases the URL even if the download click fails', async () => {
    vi.mocked(HTMLAnchorElement.prototype.click).mockImplementation(() => {
      throw new Error('synthetic click failure');
    });
    const controller = createReportsExportController(context);
    await expect(controller.download()).rejects.toThrow(
      'synthetic click failure',
    );
    expect(revokeURL).toHaveBeenCalledExactlyOnceWith('blob:synthetic-report');
    expect(controller.busy).toBe(false);
  });
});
