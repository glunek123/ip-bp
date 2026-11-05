import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getCaseFeeStatistics } from './case-fee-statistics';
const http = vi.hoisted(() => ({ getJson: vi.fn() }));
vi.mock('./http', async (original) => ({
  ...(await original<typeof import('./http')>()),
  getJson: http.getJson,
}));
const caseId = 'f7245b91-cdd0-46e8-903c-30b136be5a24';
const value = {
  caseId,
  scope: 'CASE_ACTIVE_SOURCE_RECORDS',
  recordCount: 24,
  proofRecordCount: 5,
  proofVersionCount: 3,
  noteRecordCount: 7,
};
beforeEach(() => vi.resetAllMocks());

describe('case fee statistics', () => {
  it('reads global source counts independently of the displayed page and filters', async () => {
    http.getJson.mockResolvedValue(value);
    await expect(getCaseFeeStatistics(caseId)).resolves.toEqual(value);
    expect(http.getJson).toHaveBeenCalledWith(
      `/fees/statistics?caseId=${caseId}`,
      undefined,
    );
  });
  it.each([
    { ...value, caseId: 'another-case' },
    { ...value, scope: 'CURRENT_PAGE' },
    { ...value, recordCount: -1 },
    { ...value, proofVersionCount: 1.5 },
    { ...value, noteRecordCount: '7' },
  ])('rejects a wrong object, scope or invalid count', async (body) => {
    http.getJson.mockResolvedValue(body);
    await expect(getCaseFeeStatistics(caseId)).rejects.toMatchObject({
      code: 'INVALID_FEE_STATISTICS',
    });
  });
});
