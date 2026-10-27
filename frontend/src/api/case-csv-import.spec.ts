import { beforeEach, describe, expect, it, vi } from 'vitest';
const http = vi.hoisted(() => ({ getBlob: vi.fn(), requestJson: vi.fn() }));
vi.mock('./http', async (original) => ({
  ...(await original<typeof import('./http')>()),
  getBlob: http.getBlob,
  requestJson: http.requestJson,
}));
import {
  commitCaseCsvImport,
  getCaseCsvImportTemplate,
  previewCaseCsvImport,
} from './case-csv-import';
beforeEach(() => vi.resetAllMocks());
describe('case CSV import API', () => {
  it('downloads the UTF-8 CSV template and requests a preview', async () => {
    const template = {
      blob: new Blob(['\uFEFF外录类型,当前阶段']),
      filename: 'case-external-entry-template.csv',
      mimeType: 'text/csv',
    };
    http.getBlob.mockResolvedValue(template);
    await expect(getCaseCsvImportTemplate()).resolves.toBe(template);
    http.requestJson.mockResolvedValue({
      rows: [
        {
          rowNumber: 2,
          valid: true,
          errors: [],
          input: { stage: 'ARCHIVED' },
          duplicateCandidates: {
            cases: [
              {
                id: '11111111-1111-4111-8111-111111111111',
                businessNo: 'CA-2026-001',
              },
            ],
            rowNumbers: [4],
          },
        },
        {
          rowNumber: 3,
          valid: false,
          errors: [{ code: 'REQUIRED', field: '原因', message: '原因必填' }],
        },
      ],
      validCount: 1,
      errorCount: 1,
    });
    const result = await previewCaseCsvImport('Y3N2');
    expect(result).toMatchObject({
      validCount: 1,
      errorCount: 1,
    });
    expect(result.rows[0]?.duplicateCandidates).toEqual({
      cases: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          businessNo: 'CA-2026-001',
        },
      ],
      rowNumbers: [4],
    });
    expect(http.requestJson).toHaveBeenCalledWith(
      '/cases/csv-import/preview',
      expect.objectContaining({ method: 'POST', body: { csvBase64: 'Y3N2' } }),
    );
  });
  it('commits the exact selected rows and retains idempotency semantics', async () => {
    const body = {
      csvBase64: 'Y3N2',
      idempotencyKey: 'commit-1',
      rowNumbers: [2],
      duplicateConfirmations: [
        {
          rowNumber: 2,
          caseIds: ['11111111-1111-4111-8111-111111111111'],
          rowNumbers: [4],
        },
      ],
    };
    http.requestJson.mockResolvedValue({
      items: [
        {
          rowNumber: 2,
          id: '11111111-1111-4111-8111-111111111111',
          businessNo: '00120261026001',
          stage: 'ARCHIVED',
          version: 1,
          entryId: '22222222-2222-4222-8222-222222222222',
          recordedAt: '2026-10-26T00:00:00.000Z',
        },
      ],
    });
    await expect(commitCaseCsvImport(body)).resolves.toMatchObject({
      items: [{ rowNumber: 2, stage: 'ARCHIVED' }],
    });
    expect(http.requestJson).toHaveBeenCalledWith(
      '/cases/csv-import/commit',
      expect.objectContaining({
        method: 'POST',
        retryOnCsrfInvalid: false,
        body,
      }),
    );
  });
  it('rejects invalid selections locally', async () => {
    await expect(
      commitCaseCsvImport({
        csvBase64: 'Y3N2',
        idempotencyKey: 'x',
        rowNumbers: Array.from({ length: 21 }, (_, index) => index + 2),
        duplicateConfirmations: [],
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(http.requestJson).not.toHaveBeenCalled();
  });
});
