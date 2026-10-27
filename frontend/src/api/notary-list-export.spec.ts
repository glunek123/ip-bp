import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './http';

const http = vi.hoisted(() => ({ requestJson: vi.fn(), postBlob: vi.fn() }));
vi.mock('./http', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./http')>()),
  requestJson: http.requestJson,
  postBlob: http.postBlob,
}));

import {
  exportNotaryList,
  previewNotaryListExport,
} from './notary-list-export';

describe('notary list export API', () => {
  beforeEach(() => vi.resetAllMocks());

  it('uses identical combined filters for preview and export', async () => {
    http.requestJson.mockResolvedValue({ count: 1, maxRows: 1000 });
    http.postBlob.mockResolvedValue({
      blob: new Blob(['csv']),
      filename: 'list.csv',
      mimeType: 'text/csv',
    });
    const scope = {
      mode: 'FILTERED' as const,
      stage: 'WAITING_RETURN' as const,
      customerId: 'customer-1',
      rightsHolderId: 'holder-1',
      shopName: '店铺',
    };
    await previewNotaryListExport(scope);
    await exportNotaryList(scope, 1);
    expect(http.requestJson).toHaveBeenCalledWith(
      '/notary-matters/exports/preview',
      {
        method: 'POST',
        body: scope,
      },
    );
    expect(http.postBlob).toHaveBeenCalledWith(
      '/notary-matters/exports',
      {
        ...scope,
        expectedCount: 1,
      },
      {},
    );
  });

  it('previews only the explicitly selected IDs', async () => {
    http.requestJson.mockResolvedValue({ count: 2, maxRows: 1000 });
    await expect(
      previewNotaryListExport({
        mode: 'SELECTED',
        matterIds: ['id-1', 'id-2'],
      }),
    ).resolves.toEqual({ count: 2, maxRows: 1000 });
    expect(http.requestJson).toHaveBeenCalledWith(
      '/notary-matters/exports/preview',
      {
        method: 'POST',
        body: { mode: 'SELECTED', matterIds: ['id-1', 'id-2'] },
      },
    );
  });

  it('requires a valid bounded preview response', async () => {
    http.requestJson.mockResolvedValue({ count: 1001, maxRows: 1000 });
    await expect(
      previewNotaryListExport({ mode: 'FILTERED', stage: 'WAITING_RETURN' }),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('sends the selected scope and expected count without row fields', async () => {
    http.postBlob.mockResolvedValue({
      blob: new Blob(['csv']),
      filename: 'list.csv',
      mimeType: 'text/csv',
    });
    await exportNotaryList({ mode: 'SELECTED', matterIds: ['id-1'] }, 1);
    expect(http.postBlob).toHaveBeenCalledWith(
      '/notary-matters/exports',
      {
        mode: 'SELECTED',
        matterIds: ['id-1'],
        expectedCount: 1,
      },
      {},
    );
  });

  it('rejects a non-CSV success response and preserves backend errors', async () => {
    http.postBlob.mockResolvedValue({
      blob: new Blob(['{}']),
      filename: 'x',
      mimeType: 'application/json',
    });
    await expect(
      exportNotaryList({ mode: 'FILTERED' }, 1),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    http.postBlob.mockRejectedValue(new ApiError('权限不足', 403, 'FORBIDDEN'));
    await expect(
      exportNotaryList({ mode: 'FILTERED' }, 1),
    ).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
  });
});
