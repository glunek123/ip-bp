import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './http';

const http = vi.hoisted(() => ({ postBlob: vi.fn(), getJson: vi.fn() }));
vi.mock('./http', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./http')>()),
  postBlob: http.postBlob,
  getJson: http.getJson,
}));

import {
  exportCaseListCsv,
  getCaseListExportCapability,
} from './case-list-export';

function file(
  overrides: Partial<{
    blob: Blob;
    filename: string;
    mimeType: string;
  }> = {},
) {
  return {
    blob: new Blob(['编号\r\nCA-1\r\n'], { type: 'text/csv' }),
    filename: 'case-list.csv',
    mimeType: 'text/csv',
    ...overrides,
  };
}

describe('case list CSV export API', () => {
  beforeEach(() => vi.resetAllMocks());
  it('exports all five applied specialized filters without losing literal characters', async () => {
    http.postBlob.mockResolvedValue(file());
    await exportCaseListCsv({
      shopName: ' 店铺%_\\甲 ',
      defendantName: ' 被告乙 ',
      courtName: ' 法院丙 ',
      lawyerName: ' 律师丁 ',
      caseType: 'HEARING_REPRESENTATION',
    });
    expect(http.postBlob).toHaveBeenCalledExactlyOnceWith(
      '/cases/exports/csv',
      {
        shopName: '店铺%_\\甲',
        defendantName: '被告乙',
        courtName: '法院丙',
        lawyerName: '律师丁',
        caseType: 'HEARING_REPRESENTATION',
      },
      { retryOnCsrfInvalid: false },
    );
  });

  it.each(['shopName', 'defendantName', 'courtName', 'lawyerName'])(
    'validates specialized export text %s before HTTP',
    async (key) => {
      for (const value of [null, ['a', 'b'], 1, 'x'.repeat(201)]) {
        await expect(
          exportCaseListCsv({ [key]: value } as never),
        ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      }
      expect(http.postBlob).not.toHaveBeenCalled();
      http.postBlob.mockResolvedValue(file());
      await exportCaseListCsv({ [key]: ' ' });
      expect(http.postBlob).toHaveBeenCalledWith(
        '/cases/exports/csv',
        {},
        expect.anything(),
      );
    },
  );

  it.each(['', 'OTHER', ['CIVIL', 'CIVIL'], null, 1])(
    'rejects invalid export case type %j',
    async (caseType) => {
      await expect(
        exportCaseListCsv({ caseType } as never),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      expect(http.postBlob).not.toHaveBeenCalled();
    },
  );

  it('posts only the current view, stage, and normalized applied query', async () => {
    http.postBlob.mockResolvedValue(file());
    const result = await exportCaseListCsv({
      view: 'department',
      stage: 'WAITING_ARCHIVE',
      q: '  被告甲  ',
      customerName: '客户甲',
      rightsHolderName: '权利主体甲',
      courtCaseNo: '（2026）民初1号',
      sortBy: 'rightsHolderName',
      sortDirection: 'asc',
    });

    expect(http.postBlob).toHaveBeenCalledExactlyOnceWith(
      '/cases/exports/csv',
      {
        view: 'department',
        stage: 'WAITING_ARCHIVE',
        q: '被告甲',
        customerName: '客户甲',
        rightsHolderName: '权利主体甲',
        courtCaseNo: '（2026）民初1号',
        sortBy: 'rightsHolderName',
        sortDirection: 'asc',
      },
      { retryOnCsrfInvalid: false },
    );
    expect(result).toEqual(file());
  });

  it.each([true, false])(
    'reads the current actor export capability: %s',
    async (canExport) => {
      http.getJson.mockResolvedValue({ canExport });
      await expect(getCaseListExportCapability()).resolves.toEqual({
        canExport,
      });
      expect(http.getJson).toHaveBeenCalledExactlyOnceWith(
        '/cases/exports/capability',
        {},
      );
    },
  );

  it('passes capability cancellation options and rejects non-exact payloads', async () => {
    const controller = new AbortController();
    http.getJson.mockResolvedValueOnce({ canExport: true });
    await getCaseListExportCapability({ signal: controller.signal });
    expect(http.getJson).toHaveBeenCalledExactlyOnceWith(
      '/cases/exports/capability',
      { signal: controller.signal },
    );

    for (const value of [
      {},
      { canExport: 1 },
      { canExport: true, scope: 'DEPARTMENT' },
      null,
      [],
    ]) {
      http.getJson.mockResolvedValueOnce(value);
      await expect(getCaseListExportCapability()).rejects.toMatchObject({
        code: 'INVALID_RESPONSE',
        status: 502,
      });
    }
  });

  it('preserves capability authorization errors', async () => {
    const forbidden = new ApiError('权限不足', 403, 'FORBIDDEN');
    http.getJson.mockRejectedValue(forbidden);
    await expect(getCaseListExportCapability()).rejects.toBe(forbidden);
  });

  it('supports the stage-group filter without adding pagination', async () => {
    http.postBlob.mockResolvedValue(file());
    await exportCaseListCsv({
      view: 'mine',
      stageGroup: 'COMPLAINT_PREPARATION',
      sortBy: 'createdAt',
      sortDirection: 'desc',
    });

    expect(http.postBlob).toHaveBeenCalledWith(
      '/cases/exports/csv',
      {
        view: 'mine',
        stageGroup: 'COMPLAINT_PREPARATION',
        sortBy: 'createdAt',
        sortDirection: 'desc',
      },
      { retryOnCsrfInvalid: false },
    );
  });

  it('forces CSRF retry off while preserving cancellation and timeout options', async () => {
    http.postBlob.mockResolvedValue(file());
    const controller = new AbortController();
    await exportCaseListCsv(
      { view: 'department' },
      {
        signal: controller.signal,
        timeoutMs: 12_000,
        retryOnCsrfInvalid: true,
      },
    );
    expect(http.postBlob).toHaveBeenCalledWith(
      '/cases/exports/csv',
      { view: 'department' },
      {
        signal: controller.signal,
        timeoutMs: 12_000,
        retryOnCsrfInvalid: false,
      },
    );
  });

  it.each([
    [{ page: 1 }],
    [{ pageSize: 20 }],
    [{ ids: ['case-1'] }],
    [{ departmentId: 'department-1' }],
    [{ stage: 'WAITING_ARCHIVE', stageGroup: 'EXECUTION_PREPARATION' }],
    [{ stage: 'all' }],
    [{ q: 'x'.repeat(201) }],
    [{ sortBy: 'id' }],
    [{ view: 'outside' }],
  ])(
    'rejects invalid or non-contract input %j before requesting',
    async (input) => {
      await expect(exportCaseListCsv(input as never)).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
      });
      expect(http.postBlob).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['101 emoji', '😀'.repeat(101)],
    ['200 emoji', '😀'.repeat(200)],
    ['200 emoji and variation selectors', '😀\uFE0F'.repeat(200)],
    ['200 base characters and variation selectors', 'a\uFE0F'.repeat(200)],
  ])('accepts backend-counted query lengths at 200: %s', async (_label, q) => {
    http.postBlob.mockResolvedValue(file());
    await expect(exportCaseListCsv({ view: 'department', q })).resolves.toEqual(
      file(),
    );
  });

  it.each([
    ['201 emoji', '😀'.repeat(201)],
    ['201 emoji and variation selectors', '😀\uFE0F'.repeat(201)],
    ['201 base characters and variation selectors', 'a\uFE0F'.repeat(201)],
  ])(
    'rejects backend-counted query lengths above 200: %s',
    async (_label, q) => {
      await expect(
        exportCaseListCsv({ view: 'department', q }),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      expect(http.postBlob).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['MIME type', { mimeType: 'application/json' }],
    ['filename', { filename: 'other.csv' }],
    ['empty body', { blob: new Blob([], { type: 'text/csv' }) }],
  ])('rejects an invalid successful response: %s', async (_label, override) => {
    http.postBlob.mockResolvedValue(file(override));
    await expect(
      exportCaseListCsv({ view: 'department' }),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE', status: 502 });
  });

  it('preserves server and abort errors without retrying or masking them', async () => {
    const forbidden = new ApiError('权限不足', 403, 'FORBIDDEN');
    http.postBlob.mockRejectedValueOnce(forbidden);
    await expect(exportCaseListCsv({ view: 'department' })).rejects.toBe(
      forbidden,
    );

    const aborted = new DOMException('The operation was aborted', 'AbortError');
    http.postBlob.mockRejectedValueOnce(aborted);
    await expect(exportCaseListCsv({ view: 'department' })).rejects.toBe(
      aborted,
    );
    expect(http.postBlob).toHaveBeenCalledTimes(2);
  });
});
