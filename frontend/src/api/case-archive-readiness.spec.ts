import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  decodeCaseArchiveReadiness,
  getCaseArchiveReadiness,
  archiveCheckReason,
} from './case-archive-readiness';
import { getJson } from './http';
vi.mock('./http', async (original) => ({
  ...(await original<typeof import('./http')>()),
  getJson: vi.fn(),
}));
const check = { state: 'PASSED', reason: 'CLOSURE_PAYMENT_REACHED' };
const preview = {
  caseVersion: 11,
  closureVersionId: '80000000-0000-4000-8000-000000000202',
  checkedAt: '2026-10-29T01:00:00Z',
  state: 'PASSED',
  checks: { payment: check, refund: check, customer: check, lawyer: check },
};
beforeEach(() => vi.resetAllMocks());
describe('archive readiness API', () => {
  it('uses separate internal and lawyer routes', async () => {
    vi.mocked(getJson).mockResolvedValue(preview);
    await getCaseArchiveReadiness('case/a');
    expect(getJson).toHaveBeenLastCalledWith(
      '/cases/case%2Fa/archive-readiness',
      {},
    );
    await getCaseArchiveReadiness('case/a', true);
    expect(getJson).toHaveBeenLastCalledWith(
      '/lawyer/cases/case%2Fa/archive-readiness',
      {},
    );
  });
  it('rejects leaked identifiers, amounts, missing checks and contradictory success', () => {
    expect(() =>
      decodeCaseArchiveReadiness({ ...preview, sources: ['private'] }),
    ).toThrow();
    expect(() =>
      decodeCaseArchiveReadiness({
        ...preview,
        checks: { ...preview.checks, payment: { ...check, paidAmount: '10' } },
      }),
    ).toThrow();
    expect(() =>
      decodeCaseArchiveReadiness({ ...preview, checks: { payment: check } }),
    ).toThrow();
    expect(() =>
      decodeCaseArchiveReadiness({
        ...preview,
        checks: { ...preview.checks, customer: { ...check, state: 'UNKNOWN' } },
      }),
    ).toThrow();
  });
  it('keeps unknown reason codes safe and localizes known reasons', () => {
    expect(archiveCheckReason('CUSTOMER_RECEIPTS_INSUFFICIENT')).toBe(
      '实际客户回款不足',
    );
    expect(archiveCheckReason('NEW_CODE')).toContain('暂无法识别');
  });
});

it('explains known zero and unknown refund amounts without claiming fictional collection or invoice', () => {
  expect(archiveCheckReason('CUSTOMER_REQUIRED_AMOUNT_ZERO')).toContain(
    '无需登记回款',
  );
  expect(archiveCheckReason('LAWYER_REQUIRED_AMOUNT_ZERO')).toContain(
    '无需登记发票',
  );
  expect(archiveCheckReason('REFUND_ALL_AMOUNTS_ZERO')).toContain('无需回款');
  expect(archiveCheckReason('REFUND_AMOUNT_UNKNOWN')).toContain('待确认');
  expect(archiveCheckReason('REFUND_EXPLICITLY_NOT_APPLICABLE')).toBe(
    '无诉讼退费（0元）',
  );
});
