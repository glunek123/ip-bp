import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createCaseConsolidation,
  getCaseConsolidation,
  previewCaseConsolidation,
  type ConsolidationPreviewInput,
} from './case-consolidation';
import { getJson, requestJson } from './http';

vi.mock('./http', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./http')>()),
  getJson: vi.fn(),
  requestJson: vi.fn(),
}));

afterEach(() => vi.clearAllMocks());

const main = '046e1324-a2d4-4d4c-87e1-f88979d46e55';
const child = 'bcdcb2a4-bf65-4331-b3d2-d056f66c6e72';
const consolidation = 'f1021723-2369-4fda-8a38-01a840717dee';
const input: ConsolidationPreviewInput = {
  members: [main, child].map((caseId) => ({
    caseId,
    expectedVersion: 1,
    confirmed: true as const,
    defendant: {
      kind: 'PERSON' as const,
      name: '合成被告',
      idNo: '110101200001011234',
    },
  })),
};
const preview = {
  mainCaseId: main,
  mainBusinessNo: '01120261027022',
  caseCount: 2,
  shop: { platform: 'TAOBAO', externalId: 'synthetic-shop', name: '合成店铺' },
  cases: [main, child].map((id, index) => ({
    id,
    businessNo: `0112026102702${index + 2}`,
    version: 1,
    createdAt: '2026-10-27T15:35:31.921Z',
    isMain: index === 0,
  })),
};

describe('case consolidation API identifiers', () => {
  it('accepts standard UUIDs returned by the real preview and creation contracts', async () => {
    vi.mocked(requestJson)
      .mockResolvedValueOnce(preview)
      .mockResolvedValueOnce({
        id: consolidation,
        mainCaseId: main,
        mainBusinessNo: preview.mainBusinessNo,
        caseCount: 2,
        caseIds: [main, child],
        createdAt: '2026-10-27T15:35:32.186Z',
      });
    await expect(previewCaseConsolidation(input)).resolves.toEqual(preview);
    await expect(
      createCaseConsolidation({
        ...input,
        mainCaseId: main,
        idempotencyKey: 'synthetic-consolidation-key',
      }),
    ).resolves.toMatchObject({ id: consolidation, caseIds: [main, child] });
  });

  it('loads a source trace using a standard UUID and rejects a malformed one', async () => {
    vi.mocked(getJson).mockResolvedValue({
      id: consolidation,
      mainCaseId: main,
      createdAt: '2026-10-27T15:35:32.186Z',
      caseCount: 2,
      cases: [main, child].map((caseId, index) => ({
        caseId,
        businessNo: preview.cases[index].businessNo,
        isMain: index === 0,
        materials: [],
        feeRecordIds: [],
        selectedMaterialVersions: [],
      })),
    });
    await expect(getCaseConsolidation(main)).resolves.toMatchObject({
      id: consolidation,
    });
    await expect(
      getCaseConsolidation(main.replace('-87e1-', '-87e1')),
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });

  it('treats JSON null as an ordinary case with no consolidation', async () => {
    vi.mocked(getJson).mockResolvedValue(null);
    await expect(getCaseConsolidation(main)).resolves.toBeNull();
  });
});
