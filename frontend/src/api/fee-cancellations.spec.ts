import { afterEach, describe, expect, it, vi } from 'vitest';
import { getFeeHistory, listFeeCancellations } from './fee-cancellations';

const row = {
  id: 'fee-1',
  caseId: 'case-1',
  businessNo: '案件001',
  stage: 'ARCHIVED',
  courtCaseNo: null,
  platform: null,
  shopName: null,
  defendantNames: [],
  type: '诉讼费',
  direction: '支出',
  status: '已支付',
  amount: '100.00',
  feeDate: '2026-10-01',
  source: 'manual',
  note: null,
  version: 2,
  proofMaterialId: null,
  proofContentVersionId: null,
  proofOriginalFilename: null,
};
afterEach(() => vi.unstubAllGlobals());

describe('fee cancellation records', () => {
  it('queries by business number and exposes unknown reconciliation as null', async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          items: [
            {
              ...row,
              deletedAt: null,
              cancellation: {
                id: 'cancel-1',
                outcome: 'VOIDED',
                reason: '撤回',
                actorUserId: 'user-1',
                createdAt: '2026-10-02T00:00:00.000Z',
                refundReconciliationStatus: 'PENDING',
                reconciliationStatus: 'PAYMENT_UNVERIFIED',
                remainingVerifiedPayment: null,
              },
            },
          ],
          total: 1,
          page: 1,
          pageSize: 50,
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetch);
    const result = await listFeeCancellations({
      businessNo: '案件001',
      pageSize: 50,
    });
    expect(fetch.mock.calls[0]?.[0]).toContain(
      'businessNo=%E6%A1%88%E4%BB%B6001',
    );
    expect(result.items[0]?.cancellation?.remainingVerifiedPayment).toBeNull();
    expect(result.items[0]?.cancellation?.reconciliationStatus).toBe(
      'PAYMENT_UNVERIFIED',
    );
  });
  it('decodes actual payment and preserves each refund date', async () => {
    const body = {
      ...row,
      deletedAt: null,
      cancellation: {
        id: 'cancel-1',
        outcome: 'VOIDED',
        originalStatus: '已支付',
        originalAmount: '100.00',
        originalVersion: 1,
        reason: '撤回',
        actorUserId: 'user-1',
        createdAt: '2026-10-02T00:00:00Z',
        refundReconciliationStatus: 'PENDING',
        reconciliationStatus: 'PARTIAL_REFUND',
      },
      paymentVerification: {
        id: 'payment-1',
        amount: '80.00',
        paymentDate: '2026-10-03',
        proofMaterialId: null,
        proofContentVersionId: null,
        actorUserId: 'user-1',
        createdAt: '2026-10-03T00:00:00Z',
      },
      refunds: [
        {
          id: 'refund-1',
          amount: '20.00',
          refundDate: '2026-10-04',
          proofMaterialId: null,
          proofContentVersionId: null,
          actorUserId: 'user-1',
          createdAt: '2026-10-04T00:00:00Z',
        },
      ],
      remainingVerifiedPayment: '60.00',
    };
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify(body), { status: 200 })),
    );
    const result = await getFeeHistory('fee-1');
    expect(result.paymentVerification?.amount).toBe('80.00');
    expect(result.refunds[0]?.refundDate).toBe('2026-10-04');
    expect(result.remainingVerifiedPayment).toBe('60.00');
  });
});
