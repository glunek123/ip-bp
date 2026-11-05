import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  downloadComplaintZip,
  previewComplaintExport,
} from './case-complaint-export';
import { ApiError } from './http';
const http = vi.hoisted(() => ({ requestJson: vi.fn(), postBlob: vi.fn() }));
vi.mock('./http', async (original) => ({
  ...(await original<typeof import('./http')>()),
  requestJson: http.requestJson,
  postBlob: http.postBlob,
}));
const caseId = '11111111-1111-4111-8111-111111111111';
const materialId = '22222222-2222-4222-8222-222222222222';
const contentVersionId = '33333333-3333-4333-8333-333333333333';
beforeEach(() => vi.resetAllMocks());
describe('complaint export API', () => {
  it('requires explicit version selection and validates the preview', async () => {
    http.requestJson.mockResolvedValue({
      items: [
        {
          caseId,
          businessNo: 'A-1',
          status: 'READY',
          candidates: [
            {
              materialId,
              contentVersionId,
              filename: '诉状.pdf',
              sizeBytes: 10,
              tags: ['UPLOADED'],
            },
          ],
        },
      ],
      limits: { maxCases: 20, maxFiles: 100, maxBytes: 100 * 1024 * 1024 },
    });
    const result = await previewComplaintExport([caseId]);
    expect(result.items[0]?.candidates).toHaveLength(1);
    expect(http.requestJson).toHaveBeenCalledWith(
      '/cases/complaint-export/preview',
      { method: 'POST', body: { caseIds: [caseId] } },
    );
  });
  it('parses the narrow result header and rejects an absent one', async () => {
    const selections = [{ caseId, materialId, contentVersionId }];
    http.postBlob
      .mockResolvedValueOnce({
        blob: new Blob(['zip']),
        filename: 'a.zip',
        mimeType: 'application/zip',
        responseHeaders: new Headers({
          'X-Case-Export-Result': JSON.stringify([
            { caseId, successCount: 1, failCount: 0 },
          ]),
        }),
      })
      .mockResolvedValueOnce({
        blob: new Blob(['zip']),
        filename: 'a.zip',
        mimeType: 'application/zip',
        responseHeaders: new Headers(),
      });
    expect((await downloadComplaintZip(selections)).results).toEqual([
      { caseId, successCount: 1, failCount: 0 },
    ]);
    await expect(downloadComplaintZip(selections)).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });
  it('accepts two distinct versions in one case with one aggregated result', async () => {
    const secondVersionId = '44444444-4444-4444-8444-444444444444';
    http.postBlob.mockResolvedValue({
      blob: new Blob(['zip']),
      filename: 'a.zip',
      mimeType: 'application/zip',
      responseHeaders: new Headers({
        'X-Case-Export-Result': JSON.stringify([
          { caseId, successCount: 2, failCount: 0 },
        ]),
      }),
    });
    const selections = [
      { caseId, materialId, contentVersionId },
      { caseId, materialId, contentVersionId: secondVersionId },
    ];
    expect(
      (await downloadComplaintZip(selections)).results[0]?.successCount,
    ).toBe(2);
  });
  it('strictly preserves all selected file failures from a 409', async () => {
    const secondVersionId = '44444444-4444-4444-8444-444444444444';
    const files = [contentVersionId, secondVersionId].map((version, index) => ({
      caseId,
      materialId,
      contentVersionId: version,
      filename: index === 0 ? '诉状.pdf' : null,
      reason: index === 0 ? 'FILE_UNAVAILABLE' : 'VERSION_UNAVAILABLE',
    }));
    http.postBlob.mockRejectedValueOnce(
      new ApiError('failed', 409, 'CASE_EXPORT_EMPTY', 'request-1', { files }),
    );
    const selections = [contentVersionId, secondVersionId].map((version) => ({
      caseId,
      materialId,
      contentVersionId: version,
    }));
    await expect(downloadComplaintZip(selections)).rejects.toMatchObject({
      code: 'CASE_EXPORT_EMPTY',
      details: { files },
    });
    http.postBlob.mockRejectedValueOnce(
      new ApiError('failed', 409, 'CASE_EXPORT_EMPTY', 'request-1', {
        files: [files[0]],
      }),
    );
    await expect(downloadComplaintZip(selections)).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });
});
