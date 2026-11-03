import { Prisma } from '../../generated/prisma/client';
import { readNotaryDetailFacts } from './notary-detail-read';

const date = new Date('2026-11-03T01:02:03.000Z');
function fixture() {
  return {
    snapshot: {
      sourceLeadId: 'lead-1',
      customerId: 'customer-1',
      responsibleUserId: 'operator-1',
      activeReviewDecisionId: 'review-1',
      caseType: 'CIVIL',
      source: 'ONLINE',
      foundAt: date.toISOString(),
      platform: 'TAOBAO',
      shopName: '原店铺',
    },
    sourceLead: {
      id: 'lead-1',
      businessNo: 'LD-1',
      customerId: 'customer-1',
      departmentId: 'department-1',
      responsibleUserId: 'operator-1',
      pushedAt: date,
      platform: 'TAOBAO',
      shopExternalId: '当前店铺ID',
      needDisclose: false,
      remark: '当前备注',
      infringements: [{ type: 'TRADEMARK' }],
      responsibleMembership: { user: { displayName: '当前运营姓名' } },
    },
    matter: {
      id: 'matter-1',
      sourceLeadId: 'lead-1',
      customerId: 'customer-1',
      departmentId: 'department-1',
      responsibleUserId: 'operator-1',
      stage: 'PENDING_EVIDENCE',
      openingReviewDecision: null,
      issuanceDecision: null,
      returnArchive: null,
      certificate: null as null | {
        issuedAt: Date;
        fees: Array<{
          category: string;
          state: 'KNOWN' | 'PENDING';
          amount: Prisma.Decimal | null;
        }>;
      },
    },
    review: {
      id: 'review-1',
      leadId: 'lead-1',
      customerId: 'customer-1',
      departmentId: 'department-1',
      result: 'INFRINGEMENT',
      actorKind: 'INTERNAL_PROXY',
      reviewerDisplayNameSnapshot: '原客户代表',
      decidedAt: date,
      reason: '原意见',
    },
    products: [
      { estimatedAmount: '9999999999999999.99' },
      { estimatedAmount: '0.02' },
    ],
    routineRevision: 0,
    screenshots: [],
    fees: {
      notary: { state: 'KNOWN' as const, amount: '0.00' },
      investigation: { state: 'PENDING' as const, amount: null },
      sample: { state: 'UNRECORDED' as const, amount: null },
    },
  };
}

describe('notary detail read facts', () => {
  it('uses frozen source facts, current-only lead facts, exact estimates and original proxy review', () => {
    const result = readNotaryDetailFacts(fixture());
    expect(result.source).toMatchObject({
      caseType: 'CIVIL',
      source: 'ONLINE',
      platform: 'TAOBAO',
      shopName: '原店铺',
      shopExternalId: { value: '当前店铺ID', provenance: 'CURRENT_LEAD' },
      snapshotFields: 'TRANSFER_SNAPSHOT',
      leadPushedAt: date.toISOString(),
      infringements: { values: ['TRADEMARK'], provenance: 'CURRENT_LEAD' },
      remark: { value: '当前备注', provenance: 'CURRENT_LEAD' },
    });
    expect(result.leadReview).toMatchObject({
      state: 'KNOWN',
      actorKind: 'INTERNAL_PROXY',
      actorDisplayName: '原客户代表',
    });
    expect(result.productEstimate.amount).toBe('10000000000000000.01');
    expect(result.feeTotals).toEqual({
      disclosure: { state: 'UNRECORDED', amount: null },
      knownSubtotal: '0.00',
      confirmedTotal: null,
    });
  });

  it('marks a legacy missing review as unknown and does not borrow current review', () => {
    const input = fixture();
    const result = readNotaryDetailFacts({
      ...input,
      snapshot: {
        sourceLeadId: 'lead-1',
        customerId: 'customer-1',
        responsibleUserId: 'operator-1',
        activeReviewDecisionId: null,
      },
      review: null,
    });
    expect(result.leadReview).toEqual({ state: 'UNKNOWN_LEGACY' });
    expect(result.source.snapshotState).toBe('UNKNOWN_LEGACY');
  });

  it('rejects a review from a different lead or customer', () => {
    const input = fixture();
    expect(() =>
      readNotaryDetailFacts({
        ...input,
        review: { ...input.review, leadId: 'other' },
      }),
    ).toThrow();
    expect(() =>
      readNotaryDetailFacts({
        ...input,
        review: { ...input.review, customerId: 'other' },
      }),
    ).toThrow();
  });

  it('distinguishes client review, archive type and complete known fees', () => {
    const input = fixture();
    input.review.actorKind = 'CLIENT';
    input.matter.stage = 'ARCHIVED';
    input.matter.certificate = {
      issuedAt: date,
      fees: [
        {
          category: 'DISCLOSURE',
          state: 'KNOWN',
          amount: new Prisma.Decimal('0.00'),
        },
      ],
    };
    const result = readNotaryDetailFacts({
      ...input,
      fees: {
        notary: { state: 'KNOWN', amount: '1000000000000000.00' },
        investigation: { state: 'KNOWN', amount: '0.01' },
        sample: { state: 'KNOWN', amount: '0.00' },
      },
    });
    expect(result.leadReview).toMatchObject({ actorKind: 'CLIENT' });
    expect(result.archive).toEqual({
      kind: 'CERTIFICATE',
      occurredAt: date.toISOString(),
    });
    expect(result.feeTotals.confirmedTotal).toBe('1000000000000000.01');
  });
});
