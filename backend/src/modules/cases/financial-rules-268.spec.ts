import type { Prisma } from '../../generated/prisma/client';
import {
  allocatedSettlementState,
  readPaymentFinancialReview,
} from './case-closure-payment-financial-prisma-draft';
import { reviewRefundInventoryDraft } from './case-refund-inventory-draft.service';
import { previewCaseArchiveReadiness } from './case-archive-readiness';
const actor = {
  userId: 'operator',
  departmentId: 'department',
  authorizationRevision: 1,
};
const inventory = (
  amount?: string | null,
  status: 'PENDING' | 'RECEIVED' | 'UNKNOWN' = 'PENDING',
) => ({
  id: 'inventory',
  caseId: 'case',
  departmentId: 'department',
  revision: 1,
  declaration: 'COMPLETE' as const,
  items: [
    {
      itemId: 'item',
      party: 'COURT' as const,
      status,
      description: '诉讼退费',
      ...(amount === undefined ? {} : { amount }),
    },
  ],
});
describe('approved268 financial rules', () => {
  it('explicit required zero needs no fake zero receipt/invoice while unknown stays unknown', () => {
    expect(allocatedSettlementState('0.00', [])).toBe('REACHED');
    expect(allocatedSettlementState(null, [])).toBe('UNKNOWN');
    expect(allocatedSettlementState('0.01', [])).toBe('INSUFFICIENT');
  });
  it('zero closure still blocks missing refund inventory', async () => {
    const tx = {
      $queryRaw: jest.fn(async (strings: TemplateStringsArray) =>
        strings.join('').includes('jsonb_build_object')
          ? [
              {
                id: 'closure',
                terms_version: null,
                inputs: { closureAmount: '0.00', closureAmountState: 'KNOWN' },
              },
            ]
          : [],
      ),
    };
    const r = await readPaymentFinancialReview(
      tx as unknown as Prisma.TransactionClient,
      actor,
      'case',
      ['case'],
    );
    expect(r.refund.state).toBe('UNKNOWN');
    expect(r.customer.state).toBe('EXEMPT');
    expect(r.lawyer.state).toBe('EXEMPT');
    expect(r.state).toBe('UNKNOWN');
  });
  it('zero preview requires explicit refund no-involvement instead of all-exempt', () => {
    const base = {
      closureAmount: '0',
      validPayments: [],
      financial: { refunds: [], customer: null, lawyer: null },
    } as const;
    expect(previewCaseArchiveReadiness(base).canArchive).toBe(false);
    expect(
      previewCaseArchiveReadiness({
        ...base,
        financial: { ...base.financial, refundNotApplicable: true },
      }),
    ).toMatchObject({
      canArchive: true,
      refund: 'PASSED',
      customer: 'EXEMPT',
      lawyer: 'EXEMPT',
    });
  });
  it('complete explicit zero refund needs no collection; legacy missing amount cannot pretend zero', () => {
    expect(reviewRefundInventoryDraft(inventory('0.00'))).toBe('PASSED');
    expect(reviewRefundInventoryDraft(inventory(undefined, 'RECEIVED'))).toBe(
      'UNKNOWN',
    );
    expect(reviewRefundInventoryDraft(inventory(null, 'RECEIVED'))).toBe(
      'UNKNOWN',
    );
  });
  it('positive cents require received; unknown remains unknown and negative cannot enter', () => {
    expect(reviewRefundInventoryDraft(inventory('0.01'))).toBe('BLOCKED');
    expect(reviewRefundInventoryDraft(inventory('0.01', 'RECEIVED'))).toBe(
      'PASSED',
    );
    expect(() =>
      reviewRefundInventoryDraft(inventory('-0.01', 'RECEIVED')),
    ).toThrow();
  });
});
