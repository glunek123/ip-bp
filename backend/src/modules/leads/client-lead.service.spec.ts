import { createHash } from 'node:crypto';
import { ActorContext } from '../../access-control/actor-context';
import { MaterialService } from '../materials';
import { ClientLeadService } from './client-lead.service';

const customerId = '33333333-3333-4333-8333-333333333333';
const actor: ActorContext = {
  userId: '11111111-1111-4111-8111-111111111111',
  departmentId: '22222222-2222-4222-8222-222222222222',
  authorizationRevision: 3,
  clientCustomerId: customerId,
};

const lead = {
  id: '44444444-4444-4444-8444-444444444444',
  businessNo: 'LD-20260922-001',
  customerId,
  departmentId: actor.departmentId,
  responsibleUserId: 'operator-secret',
  teamId: 'team-secret',
  remark: 'internal-secret',
  creationChannel: 'MANUAL',
  externalSourceRef: null,
  status: 'WAITING_REVIEW',
  version: 2,
  activeReviewDecisionId: null,
  caseType: 'CIVIL',
  source: 'ONLINE',
  platform: 'TAOBAO',
  foundAt: new Date('2026-09-22T01:00:00.000Z'),
  shopName: '店铺',
  shopExternalId: 'shop-1',
  needDisclose: false,
  pushedAt: new Date('2026-09-22T02:00:00.000Z'),
  pushedByUserId: 'operator-secret',
  products: [
    {
      id: 'product-1',
      position: 1,
      url: 'https://example.test/product',
      title: '商品',
      quantity: 1,
      unitPrice: { toFixed: () => '10.00' },
      commentCount: 0,
      estimatedAmount: { toFixed: () => '10.00' },
    },
  ],
  infringements: [{ type: 'TRADEMARK' }],
  rightsHolder: { name: '权利主体甲' },
  reviewDecision: null,
};

const processedLead = {
  ...lead,
  status: 'WAITING_EVIDENCE_DECISION',
  version: 3,
  reviewDecision: {
    id: 'decision-secret',
    departmentId: actor.departmentId,
    leadId: lead.id,
    customerId,
    reviewerUserId: 'reviewer-secret',
    customerAccountBindingId: 'binding-secret',
    reviewerDisplayNameSnapshot: '企业审核员',
    result: 'INFRINGEMENT',
    decidedAt: new Date('2026-09-22T03:00:00.000Z'),
    fromVersion: 2,
    toVersion: 3,
  },
};
const archivedLead = {
  ...processedLead,
  id: '55555555-5555-4555-8555-555555555555',
  status: 'ARCHIVED',
  reviewDecision: {
    ...processedLead.reviewDecision,
    result: 'NO_INFRINGEMENT',
    reason: '不构成侵权',
    archiveType: 'NO_INFRINGEMENT',
    archivedAt: new Date('2026-09-22T03:00:00.000Z'),
  },
};

function setup() {
  const database = {
    customerAccountBinding: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'binding-1',
        customerId,
        user: { displayName: '企业审核员' },
      }),
    },
    lead: {
      findMany: jest.fn().mockResolvedValue([lead]),
      count: jest.fn().mockResolvedValue(1),
      findFirst: jest.fn().mockResolvedValue(lead),
    },
  };
  const materials = {
    listCurrentReferenceVersionIds: jest.fn().mockResolvedValue(['version-1']),
  };
  return {
    service: new ClientLeadService(database as never, materials as never),
    database,
    materials,
  };
}

describe('ClientLeadService', () => {
  it('puts this enterprise pending withdrawal in pending, excludes it from processed, and exposes safe detail history', async () => {
    const { service, database } = setup();
    const application = {
      id: 'application-1',
      originalDecisionId: 'decision-1',
      reason: '纠错原因',
      appliedAt: new Date('2026-09-22T04:00:00.000Z'),
      fromVersion: 3,
      toVersion: 4,
      resultSnapshot: {
        applicantDisplayName: '运营甲',
        secret: 'internal-secret',
      },
      confirmation: null,
    };
    const record = {
      ...archivedLead,
      activeReviewDecisionId: 'decision-1',
      version: 4,
      withdrawalApplications: [application],
      reviewDecisions: [
        {
          ...archivedLead.reviewDecision,
          id: 'decision-1',
          fromVersion: 2,
          toVersion: 3,
        },
      ],
    };
    database.lead.findMany.mockResolvedValue([record]);
    database.lead.findFirst.mockResolvedValue(record);
    const pending = await service.list(actor, 'PENDING', 1, 20);
    expect(database.lead.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            expect.objectContaining({
              withdrawalApplications: { some: { confirmation: { is: null } } },
            }),
          ]),
        }),
      }),
    );
    expect(pending.items[0].capabilities).toEqual({
      review: false,
      confirmWithdrawal: true,
    });
    expect(pending.items[0].pendingWithdrawalApplication).toEqual({
      id: application.id,
      reason: application.reason,
      applicantDisplayName: '运营甲',
      appliedAt: application.appliedAt.toISOString(),
    });
    await service.list(actor, 'PROCESSED', 1, 20);
    expect(database.lead.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            expect.objectContaining({
              withdrawalApplications: { none: { confirmation: { is: null } } },
            }),
          ]),
        }),
      }),
    );
    const detail = await service.get(actor, record.id);
    expect(detail.history.map((entry) => entry.kind)).toEqual([
      'REVIEW_DECISION',
      'WITHDRAWAL_APPLICATION',
    ]);
    expect(JSON.stringify(detail)).not.toContain('internal-secret');
    expect(JSON.stringify(detail)).not.toContain('reviewer-secret');
  });

  it('shows reopened lead as current waiting review while retaining ordered historical facts', async () => {
    const { service, database } = setup();
    database.lead.findFirst.mockResolvedValue({
      ...lead,
      version: 5,
      activeReviewDecisionId: null,
      reviewDecisions: [
        {
          ...archivedLead.reviewDecision,
          id: 'decision-1',
          fromVersion: 2,
          toVersion: 3,
        },
      ],
      withdrawalApplications: [
        {
          id: 'application-1',
          originalDecisionId: 'decision-1',
          reason: '纠错原因',
          appliedAt: new Date('2026-09-22T04:00:00.000Z'),
          fromVersion: 3,
          toVersion: 4,
          resultSnapshot: { applicantDisplayName: '运营甲' },
          confirmation: {
            id: 'confirmation-1',
            confirmedAt: new Date('2026-09-22T05:00:00.000Z'),
            fromVersion: 4,
            toVersion: 5,
          },
        },
      ],
    });
    const detail = await service.get(actor, lead.id);
    expect(detail.reviewDecision).toBeNull();
    expect(detail.capabilities).toEqual({
      review: true,
      confirmWithdrawal: false,
    });
    expect(detail.history.map((entry) => entry.kind)).toEqual([
      'REVIEW_DECISION',
      'WITHDRAWAL_APPLICATION',
      'WITHDRAWAL_CONFIRMATION',
    ]);
  });
  it('lists only pushed pending leads for the actor enterprise with a redacted projection', async () => {
    const { service, database } = setup();
    const result = await service.list(actor, 'PENDING', 1, 20);

    expect(database.lead.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          departmentId: actor.departmentId,
          customerId: actor.clientCustomerId,
          OR: [
            { status: 'WAITING_REVIEW', activeReviewDecisionId: null },
            {
              status: 'ARCHIVED',
              reviewDecision: {
                is: {
                  result: 'NO_INFRINGEMENT',
                  archiveType: 'NO_INFRINGEMENT',
                  archivedAt: { not: null },
                },
              },
              withdrawalApplications: { some: { confirmation: { is: null } } },
            },
          ],
          pushedAt: { not: null },
          pushedByUserId: { not: null },
        },
        orderBy: [{ pushedAt: 'desc' }, { id: 'asc' }],
      }),
    );
    expect(result.items[0]).toMatchObject({
      id: lead.id,
      status: 'WAITING_REVIEW',
      version: 2,
      rightsHolderName: '权利主体甲',
      reviewDecision: null,
      capabilities: { review: true },
    });
    expect(result.items[0]).not.toHaveProperty('departmentId');
    expect(result.items[0]).not.toHaveProperty('responsibleUserId');
    expect(result.items[0]).not.toHaveProperty('teamId');
    expect(result.items[0]).not.toHaveProperty('remark');
    expect(result.items[0]).not.toHaveProperty('creationChannel');
    expect(result.items[0]).not.toHaveProperty('externalSourceRef');
  });

  it('lists only processed leads with a formal decision and redacts decision internals', async () => {
    const { service, database } = setup();
    database.lead.findMany.mockResolvedValue([processedLead]);

    const result = await service.list(actor, 'PROCESSED', 2, 10);

    expect(database.lead.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          departmentId: actor.departmentId,
          customerId: actor.clientCustomerId,
          pushedAt: { not: null },
          pushedByUserId: { not: null },
          OR: [
            {
              status: 'WAITING_EVIDENCE_DECISION',
              reviewDecision: { is: { result: 'INFRINGEMENT' } },
            },
            {
              status: 'ARCHIVED',
              withdrawalApplications: { none: { confirmation: { is: null } } },
              reviewDecision: {
                is: {
                  result: 'NO_INFRINGEMENT',
                  archiveType: 'NO_INFRINGEMENT',
                  archivedAt: { not: null },
                },
              },
            },
          ],
        },
        skip: 10,
        take: 10,
        include: expect.objectContaining({
          reviewDecision: {
            select: {
              result: true,
              reason: true,
              archiveType: true,
              archivedAt: true,
              reviewerDisplayNameSnapshot: true,
              decidedAt: true,
            },
          },
        }),
      }),
    );
    expect(result.items[0]).toMatchObject({
      status: 'WAITING_EVIDENCE_DECISION',
      version: 3,
      reviewDecision: {
        result: 'INFRINGEMENT',
        reviewerDisplayName: '企业审核员',
        decidedAt: '2026-09-22T03:00:00.000Z',
      },
      capabilities: { review: false },
    });
    expect(result.items[0].reviewDecision).not.toHaveProperty('id');
    expect(result.items[0].reviewDecision).not.toHaveProperty('reviewerUserId');
    expect(result.items[0].reviewDecision).not.toHaveProperty('fromVersion');
    expect(result.items[0].reviewDecision).not.toHaveProperty('toVersion');
  });

  it('lists only both valid processed decisions for the bound enterprise and redacts archived internals', async () => {
    const { service, database } = setup();
    const records = [
      archivedLead,
      processedLead,
      { ...archivedLead, id: 'bad-archive', reviewDecision: null },
      { ...archivedLead, id: 'foreign', customerId: 'foreign' },
      { ...archivedLead, id: 'not-pushed', pushedAt: null },
    ];
    database.lead.findMany.mockImplementation(
      ({ where }: { where: ClientLeadWhere }) =>
        records.filter((record) => matchesClientLeadWhere(record, where)),
    );
    database.lead.count.mockImplementation(
      ({ where }: { where: ClientLeadWhere }) =>
        records.filter((record) => matchesClientLeadWhere(record, where))
          .length,
    );
    const result = await service.list(actor, 'PROCESSED', 1, 20);
    expect(result.items.map((item) => item.status)).toEqual([
      'ARCHIVED',
      'WAITING_EVIDENCE_DECISION',
    ]);
    expect(result.total).toBe(2);
    expect(result.items[0].reviewDecision).toEqual({
      result: 'NO_INFRINGEMENT',
      reason: '不构成侵权',
      reviewerDisplayName: '企业审核员',
      decidedAt: '2026-09-22T03:00:00.000Z',
      archiveType: 'NO_INFRINGEMENT',
      archivedAt: '2026-09-22T03:00:00.000Z',
    });
    expect(JSON.stringify(result.items[0])).not.toContain('operator-secret');
    expect(JSON.stringify(result.items[0])).not.toContain('reviewer-secret');
    expect(Object.keys(result.items[1].reviewDecision ?? {})).toEqual([
      'result',
      'reviewerDisplayName',
      'decidedAt',
    ]);
  });

  it('returns not found for another enterprise or a waiting-push lead', async () => {
    const { service, database } = setup();
    database.lead.findFirst.mockResolvedValue(null);
    await expect(service.get(actor, lead.id)).rejects.toMatchObject({
      response: { code: 'RESOURCE_NOT_FOUND' },
    });
    expect(database.lead.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: lead.id,
          departmentId: actor.departmentId,
          customerId: actor.clientCustomerId,
          pushedAt: { not: null },
          pushedByUserId: { not: null },
          OR: [
            { status: 'WAITING_REVIEW', activeReviewDecisionId: null },
            {
              status: 'WAITING_EVIDENCE_DECISION',
              reviewDecision: { is: { result: 'INFRINGEMENT' } },
            },
            {
              status: 'ARCHIVED',
              reviewDecision: {
                is: {
                  result: 'NO_INFRINGEMENT',
                  archiveType: 'NO_INFRINGEMENT',
                  archivedAt: { not: null },
                },
              },
            },
          ],
        },
      }),
    );
  });

  it('reads archived detail and screenshots only for the bound enterprise and matching archive facts', async () => {
    const { service, database } = setupWithRealMaterials(archivedLead);
    const result = await service.get(actor, archivedLead.id);
    expect(result.status).toBe('ARCHIVED');
    expect(result.reviewDecision).toMatchObject({
      result: 'NO_INFRINGEMENT',
      reason: '不构成侵权',
      archiveType: 'NO_INFRINGEMENT',
    });
    expect(result.leadScreenshotContentVersionIds).toEqual([
      'version-a',
      'version-b',
    ]);
    expect(result.capabilities).toEqual({
      review: false,
      confirmWithdrawal: false,
    });
    expect(database.lead.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          customerId,
          departmentId: actor.departmentId,
          pushedAt: { not: null },
          pushedByUserId: { not: null },
        }),
      }),
    );
  });

  it.each([
    ['another enterprise', { customerId: 'foreign' }],
    ['not pushed', { pushedAt: null }],
    ['no decision', { reviewDecision: null }],
    [
      'wrong archive type',
      {
        reviewDecision: {
          ...archivedLead.reviewDecision,
          archiveType: 'OTHER',
        },
      },
    ],
    [
      'no archive time',
      { reviewDecision: { ...archivedLead.reviewDecision, archivedAt: null } },
    ],
  ])(
    'hides archived detail for %s before listing screenshots',
    async (_case, overrides) => {
      const { service, database } = setupWithRealMaterials({
        ...archivedLead,
        ...overrides,
      });
      await expect(service.get(actor, archivedLead.id)).rejects.toMatchObject({
        response: { code: 'RESOURCE_NOT_FOUND' },
      });
      expect(database.materialReference.findMany).not.toHaveBeenCalled();
    },
  );

  it('rejects an internal actor instead of deriving an internal scope', async () => {
    const { service, database } = setup();
    const internal: ActorContext = {
      userId: actor.userId,
      departmentId: actor.departmentId,
      authorizationRevision: actor.authorizationRevision,
    };
    await expect(
      service.list(internal, 'PENDING', 1, 20),
    ).rejects.toMatchObject({
      response: { code: 'ACTION_FORBIDDEN' },
    });
    expect(database.lead.findMany).not.toHaveBeenCalled();
  });

  it('includes only current allowed screenshot version ids in detail', async () => {
    const { service, materials } = setup();
    const result = await service.get(actor, lead.id);
    expect(materials.listCurrentReferenceVersionIds).toHaveBeenCalledWith(
      expect.anything(),
      actor,
      {
        resourceType: 'lead',
        resourceId: lead.id,
        purpose: 'LEAD_SCREENSHOT',
      },
    );
    expect(result.leadScreenshotContentVersionIds).toEqual(['version-1']);
  });

  it('projects a processed decision in detail after revalidating the client binding', async () => {
    const { service, database } = setup();
    database.lead.findFirst.mockResolvedValue(processedLead);

    const result = await service.get(actor, lead.id);

    expect(database.customerAccountBinding.findFirst).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      status: 'WAITING_EVIDENCE_DECISION',
      reviewDecision: {
        result: 'INFRINGEMENT',
        reviewerDisplayName: '企业审核员',
        decidedAt: '2026-09-22T03:00:00.000Z',
      },
      capabilities: { review: false },
    });
  });

  it('returns allowed screenshot version ids through the real material service for a processed lead', async () => {
    const { service, database } = setupWithRealMaterials(processedLead);

    const result = await service.get(actor, processedLead.id);

    expect(result).toMatchObject({
      status: 'WAITING_EVIDENCE_DECISION',
      reviewDecision: { result: 'INFRINGEMENT' },
      leadScreenshotContentVersionIds: ['version-a', 'version-b'],
    });
    expect(database.lead.findFirst).toHaveBeenCalledTimes(2);
    expect(database.materialReference.findMany).toHaveBeenCalledWith({
      where: {
        departmentId: actor.departmentId,
        resourceType: 'lead',
        resourceId: processedLead.id,
        purpose: 'LEAD_SCREENSHOT',
        actionEventId: null,
      },
      orderBy: { contentVersionId: 'asc' },
      select: { contentVersionId: true },
    });
  });

  it('hides a processed lead without a formal decision before querying screenshot versions', async () => {
    const { service, database } = setupWithRealMaterials({
      ...processedLead,
      reviewDecision: null,
    });

    await expect(service.get(actor, processedLead.id)).rejects.toMatchObject({
      response: { code: 'RESOURCE_NOT_FOUND' },
    });
    expect(database.lead.findFirst).toHaveBeenCalledTimes(1);
    expect(database.materialReference.findMany).not.toHaveBeenCalled();
  });
});

function setupReview() {
  const transaction = {
    customerAccountBinding: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'binding-1',
        customerId,
        user: { displayName: '企业审核员' },
      }),
    },
    clientLeadReviewReceipt: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
    },
    $queryRawUnsafe: jest.fn().mockResolvedValue([{ id: lead.id }]),
    lead: {
      findFirst: jest.fn().mockResolvedValue(lead),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest.fn().mockResolvedValue({}),
    },
    leadReviewDecision: {
      create: jest.fn().mockImplementation(({ data }: { data: object }) =>
        Promise.resolve({
          id: 'decision-1',
          decidedAt: new Date('2026-09-22T03:00:00.000Z'),
          ...data,
        }),
      ),
    },
  };
  const database = {
    $transaction: jest
      .fn()
      .mockImplementation(
        (fn: (client: typeof transaction) => Promise<unknown>) =>
          fn(transaction),
      ),
    customerAccountBinding: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'binding-1',
        customerId,
        user: { displayName: '企业审核员' },
      }),
    },
    clientLeadReviewReceipt: { findUnique: jest.fn().mockResolvedValue(null) },
    lead: { findFirst: jest.fn().mockResolvedValue(lead) },
  };
  const service = new ClientLeadService(database as never, {} as never);
  const review = () =>
    service.review(actor, lead.id, 'review-key', {
      result: 'INFRINGEMENT',
      expectedVersion: 2,
    });
  return { transaction, database, service, review };
}

describe('ClientLeadService.review', () => {
  it('creates a new decision only after the active pointer was cleared, and preserves the old receipt', async () => {
    const { service, transaction } = setupReview();
    transaction.lead.findFirst.mockResolvedValue({
      ...lead,
      version: 5,
      activeReviewDecisionId: null,
    });
    const first = await service.review(actor, lead.id, 'second-key', {
      result: 'INFRINGEMENT',
      expectedVersion: 5,
    });
    expect(first.version).toBe(6);
    expect(transaction.lead.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ activeReviewDecisionId: null }),
      }),
    );
    expect(transaction.lead.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { activeReviewDecisionId: 'decision-1' },
      }),
    );
    transaction.clientLeadReviewReceipt.findUnique.mockResolvedValue({
      ...transaction.clientLeadReviewReceipt.create.mock.calls[0][0].data,
      resultSnapshot: first,
    });
    await expect(
      service.review(actor, lead.id, 'second-key', {
        result: 'INFRINGEMENT',
        expectedVersion: 5,
      }),
    ).resolves.toEqual(first);
    expect(transaction.leadReviewDecision.create).toHaveBeenCalledTimes(1);
  });

  it('rejects a pending review with a non-null active pointer', async () => {
    const { service, transaction } = setupReview();
    transaction.lead.findFirst.mockResolvedValue({
      ...lead,
      activeReviewDecisionId: 'old-decision',
    });
    await expect(
      service.review(actor, lead.id, 'new-key', {
        result: 'INFRINGEMENT',
        expectedVersion: 2,
      }),
    ).rejects.toMatchObject({ response: { code: 'INVALID_STATE' } });
    expect(transaction.leadReviewDecision.create).not.toHaveBeenCalled();
  });
  it.each([2501, 5000])(
    'accepts a no-infringement reason of %i Unicode code points',
    async (count) => {
      const { service, transaction } = setupReview();
      const reason = '😀'.repeat(count);
      const result = await service.review(actor, lead.id, 'emoji-key', {
        result: 'NO_INFRINGEMENT',
        reason,
        expectedVersion: 2,
      });
      expect(result.reviewDecision).toMatchObject({ reason });
      expect(transaction.leadReviewDecision.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ reason }),
      });
    },
  );

  it('rejects a no-infringement reason above 5000 Unicode code points', async () => {
    const { service, transaction } = setupReview();
    await expect(
      service.review(actor, lead.id, 'emoji-key', {
        result: 'NO_INFRINGEMENT',
        reason: '😀'.repeat(5001),
        expectedVersion: 2,
      }),
    ).rejects.toMatchObject({ response: { code: 'VALIDATION_ERROR' } });
    expect(transaction.lead.updateMany).not.toHaveBeenCalled();
  });

  it.each([2501, 5000])(
    'replays an archive receipt with %i Unicode code points in its reason',
    async (count) => {
      const { service, transaction } = setupReview();
      const input = {
        result: 'NO_INFRINGEMENT',
        reason: '😀'.repeat(count),
        expectedVersion: 2,
      } as const;
      const first = await service.review(actor, lead.id, 'emoji-key', input);
      const receiptData =
        transaction.clientLeadReviewReceipt.create.mock.calls[0][0].data;
      transaction.clientLeadReviewReceipt.findUnique.mockResolvedValue(
        receiptData,
      );
      transaction.lead.updateMany.mockClear();
      await expect(
        service.review(actor, lead.id, 'emoji-key', input),
      ).resolves.toEqual(first);
      expect(transaction.lead.updateMany).not.toHaveBeenCalled();
    },
  );

  it('uses a neutral invalid-state message for either review outcome', async () => {
    const { service, transaction } = setupReview();
    transaction.lead.findFirst.mockResolvedValue({
      ...lead,
      status: 'ARCHIVED',
      version: 3,
    });
    await expect(
      service.review(actor, lead.id, 'archive-key', {
        result: 'NO_INFRINGEMENT',
        reason: '不构成侵权',
        expectedVersion: 2,
      }),
    ).rejects.toMatchObject({
      response: { code: 'INVALID_STATE', message: '仅待审核线索可以提交审核' },
    });
  });

  it('archives a no-infringement decision and writes one matching receipt', async () => {
    const { service, transaction } = setupReview();
    const result = await service.review(actor, lead.id, 'archive-key', {
      result: 'NO_INFRINGEMENT',
      reason: '不构成侵权',
      expectedVersion: 2,
    });
    expect(result).toMatchObject({
      status: 'ARCHIVED',
      version: 3,
      reviewDecision: {
        result: 'NO_INFRINGEMENT',
        reason: '不构成侵权',
        archiveType: 'NO_INFRINGEMENT',
      },
    });
    expect(transaction.lead.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'WAITING_REVIEW',
          version: 2,
        }),
        data: { status: 'ARCHIVED', version: { increment: 1 } },
      }),
    );
    expect(transaction.leadReviewDecision.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        result: 'NO_INFRINGEMENT',
        reason: '不构成侵权',
        archiveType: 'NO_INFRINGEMENT',
        archivedAt: expect.any(Date),
        decidedAt: expect.any(Date),
      }),
    });
    const decisionData =
      transaction.leadReviewDecision.create.mock.calls[0][0].data;
    expect(decisionData.archivedAt).toBe(decisionData.decidedAt);
    expect(transaction.clientLeadReviewReceipt.create).toHaveBeenCalledTimes(1);
    expect(transaction.clientLeadReviewReceipt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ resultSnapshot: result }),
    });
  });

  it.each([undefined, '', '  ', 123, 'x'.repeat(5001)])(
    'rejects invalid no-infringement reason %p before writing',
    async (reason) => {
      const { service, transaction } = setupReview();
      await expect(
        service.review(actor, lead.id, 'archive-key', {
          result: 'NO_INFRINGEMENT',
          reason,
          expectedVersion: 2,
        } as never),
      ).rejects.toMatchObject({ response: { code: 'VALIDATION_ERROR' } });
      expect(transaction.lead.updateMany).not.toHaveBeenCalled();
    },
  );

  it('rejects an infringement reason before writing', async () => {
    const { service, transaction } = setupReview();
    await expect(
      service.review(actor, lead.id, 'review-key', {
        result: 'INFRINGEMENT',
        reason: 'unexpected',
        expectedVersion: 2,
      } as never),
    ).rejects.toMatchObject({ response: { code: 'VALIDATION_ERROR' } });
    expect(transaction.lead.updateMany).not.toHaveBeenCalled();
  });

  it('replays the exact archive snapshot and conflicts on changed reason or result', async () => {
    const { service, transaction } = setupReview();
    const input = {
      result: 'NO_INFRINGEMENT',
      reason: '不构成侵权',
      expectedVersion: 2,
    } as const;
    const first = await service.review(actor, lead.id, 'archive-key', input);
    const receiptData =
      transaction.clientLeadReviewReceipt.create.mock.calls[0][0].data;
    transaction.clientLeadReviewReceipt.findUnique.mockResolvedValue(
      receiptData,
    );
    transaction.lead.updateMany.mockClear();
    await expect(
      service.review(actor, lead.id, 'archive-key', input),
    ).resolves.toEqual(first);
    expect(transaction.lead.updateMany).not.toHaveBeenCalled();
    await expect(
      service.review(actor, lead.id, 'archive-key', {
        ...input,
        reason: '另一原因',
      }),
    ).rejects.toMatchObject({ response: { code: 'IDEMPOTENCY_CONFLICT' } });
    await expect(
      service.review(actor, lead.id, 'archive-key', {
        result: 'INFRINGEMENT',
        expectedVersion: 2,
      }),
    ).rejects.toMatchObject({ response: { code: 'IDEMPOTENCY_CONFLICT' } });
  });

  it('preserves the historical infringement fingerprint and five-key receipt snapshot', async () => {
    const { review, transaction } = setupReview();
    const first = await review();
    const receiptData =
      transaction.clientLeadReviewReceipt.create.mock.calls[0][0].data;
    expect(receiptData.requestFingerprint).toBe(
      createHash('sha256')
        .update(
          JSON.stringify({
            leadId: lead.id,
            result: 'INFRINGEMENT',
            expectedVersion: 2,
          }),
        )
        .digest('hex'),
    );
    expect(Object.keys(first)).toEqual([
      'id',
      'businessNo',
      'status',
      'version',
      'reviewDecision',
    ]);
    expect(Object.keys(first.reviewDecision)).toEqual([
      'result',
      'reviewerDisplayName',
      'decidedAt',
    ]);
    transaction.clientLeadReviewReceipt.findUnique.mockResolvedValue(
      receiptData,
    );
    await expect(review()).resolves.toEqual(first);
  });

  it.each(['decision', 'receipt'])(
    'does not return an archived result when the %s write fails',
    async (failure) => {
      const { service, transaction } = setupReview();
      const error = new Error('write failed');
      if (failure === 'decision')
        transaction.leadReviewDecision.create.mockRejectedValue(error);
      else transaction.clientLeadReviewReceipt.create.mockRejectedValue(error);
      await expect(
        service.review(actor, lead.id, 'archive-key', {
          result: 'NO_INFRINGEMENT',
          reason: '不构成侵权',
          expectedVersion: 2,
        }),
      ).rejects.toBe(error);
      expect(transaction.lead.updateMany).toHaveBeenCalledTimes(1);
      expect(transaction.clientLeadReviewReceipt.create).toHaveBeenCalledTimes(
        failure === 'decision' ? 0 : 1,
      );
    },
  );

  it('atomically advances a pushed lead and records one decision and receipt', async () => {
    const { review, transaction, database } = setupReview();
    await expect(review()).resolves.toEqual({
      id: lead.id,
      businessNo: lead.businessNo,
      status: 'WAITING_EVIDENCE_DECISION',
      version: 3,
      reviewDecision: {
        result: 'INFRINGEMENT',
        reviewerDisplayName: '企业审核员',
        decidedAt: expect.any(String),
      },
    });
    expect(database.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
    });
    expect(transaction.customerAccountBinding.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: actor.userId,
          customerId,
          departmentId: actor.departmentId,
          active: true,
          user: { active: true, accountType: 'CLIENT' },
          customer: { profileStatus: 'ADMITTED' },
        }),
      }),
    );
    expect(transaction.lead.updateMany).toHaveBeenCalledWith({
      where: {
        id: lead.id,
        departmentId: actor.departmentId,
        customerId,
        status: 'WAITING_REVIEW',
        activeReviewDecisionId: null,
        version: 2,
        pushedAt: { not: null },
        pushedByUserId: { not: null },
      },
      data: { status: 'WAITING_EVIDENCE_DECISION', version: { increment: 1 } },
    });
    expect(transaction.leadReviewDecision.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        leadId: lead.id,
        customerId,
        reviewerUserId: actor.userId,
        result: 'INFRINGEMENT',
        fromVersion: 2,
        toVersion: 3,
      }),
    });
    expect(transaction.clientLeadReviewReceipt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'client.lead.review',
        idempotencyKey: 'review-key',
        resultLeadVersion: 3,
      }),
    });
  });

  it.each(['inactive', 'unbound', 'not-admitted'])(
    'rejects %s client before mutation',
    async () => {
      const { review, transaction } = setupReview();
      transaction.customerAccountBinding.findFirst.mockResolvedValue(null);
      await expect(review()).rejects.toMatchObject({
        response: { code: 'ACTION_FORBIDDEN' },
      });
      expect(transaction.lead.updateMany).not.toHaveBeenCalled();
    },
  );

  it('rejects an internal actor before mutation', async () => {
    const { service, transaction } = setupReview();
    await expect(
      service.review(
        {
          userId: actor.userId,
          departmentId: actor.departmentId,
          authorizationRevision: 1,
        },
        lead.id,
        'review-key',
        { result: 'INFRINGEMENT', expectedVersion: 2 },
      ),
    ).rejects.toMatchObject({ response: { code: 'ACTION_FORBIDDEN' } });
    expect(transaction.lead.updateMany).not.toHaveBeenCalled();
  });

  it.each(['other enterprise', 'unpushed'])(
    'hides %s lead',
    async (scenario) => {
      const { review, transaction } = setupReview();
      if (scenario === 'other enterprise')
        transaction.$queryRawUnsafe.mockResolvedValue([]);
      else
        transaction.lead.findFirst.mockResolvedValue({
          ...lead,
          pushedAt: null,
        });
      await expect(review()).rejects.toMatchObject({
        response: { code: 'RESOURCE_NOT_FOUND' },
      });
      expect(transaction.lead.updateMany).not.toHaveBeenCalled();
    },
  );

  it('rejects wrong state and stale version distinctly', async () => {
    const { review, transaction } = setupReview();
    transaction.lead.findFirst.mockResolvedValueOnce({
      ...lead,
      status: 'WAITING_EVIDENCE_DECISION',
    });
    await expect(review()).rejects.toMatchObject({
      response: { code: 'INVALID_STATE' },
    });
    transaction.lead.findFirst.mockResolvedValueOnce({ ...lead, version: 3 });
    await expect(review()).rejects.toMatchObject({
      response: { code: 'VERSION_CONFLICT' },
    });
  });

  it('replays the exact first snapshot before checking current state', async () => {
    const { review, transaction } = setupReview();
    const snapshot = {
      id: lead.id,
      businessNo: lead.businessNo,
      status: 'WAITING_EVIDENCE_DECISION',
      version: 3,
      reviewDecision: {
        result: 'INFRINGEMENT',
        reviewerDisplayName: '企业审核员',
        decidedAt: '2026-09-22T03:00:00.000Z',
      },
    };
    await review();
    const receiptData =
      transaction.clientLeadReviewReceipt.create.mock.calls[0][0].data;
    transaction.clientLeadReviewReceipt.findUnique.mockResolvedValue({
      ...receiptData,
      resultSnapshot: snapshot,
    });
    transaction.lead.findFirst.mockResolvedValue({
      ...lead,
      status: 'WAITING_EVIDENCE_DECISION',
    });
    transaction.lead.updateMany.mockClear();
    transaction.leadReviewDecision.create.mockClear();
    await expect(review()).resolves.toEqual(snapshot);
    expect(transaction.lead.updateMany).not.toHaveBeenCalled();
    expect(transaction.leadReviewDecision.create).not.toHaveBeenCalled();
  });

  it('does not replay an old review receipt after the actor is bound to another enterprise', async () => {
    const { review, transaction } = setupReview();
    await review();
    transaction.clientLeadReviewReceipt.findUnique.mockResolvedValue(
      transaction.clientLeadReviewReceipt.create.mock.calls[0][0].data,
    );
    transaction.customerAccountBinding.findFirst.mockResolvedValue({
      id: 'binding-foreign',
      customerId: 'foreign-customer',
      user: { displayName: '审核员' },
    });
    transaction.lead.findFirst.mockResolvedValue(null);
    await expect(review()).rejects.toMatchObject({
      response: { code: 'RESOURCE_NOT_FOUND' },
    });
    expect(transaction.lead.updateMany).toHaveBeenCalledTimes(1);
  });

  it('rejects a reused key with another request', async () => {
    const { review, transaction, service } = setupReview();
    await review();
    transaction.clientLeadReviewReceipt.findUnique.mockResolvedValue(
      transaction.clientLeadReviewReceipt.create.mock.calls[0][0].data,
    );
    await expect(
      service.review(actor, lead.id, 'review-key', {
        result: 'INFRINGEMENT',
        expectedVersion: 3,
      }),
    ).rejects.toMatchObject({ response: { code: 'IDEMPOTENCY_CONFLICT' } });
  });

  it.each(['decision', 'receipt'])(
    'rejects failed %s creation inside the transaction',
    async (failure) => {
      const { review, transaction } = setupReview();
      const error = new Error('write failed');
      if (failure === 'decision')
        transaction.leadReviewDecision.create.mockRejectedValue(error);
      else transaction.clientLeadReviewReceipt.create.mockRejectedValue(error);
      await expect(review()).rejects.toBe(error);
      expect(transaction.lead.updateMany).toHaveBeenCalledTimes(1);
    },
  );

  it('caps serialization retries at three and returns version conflict', async () => {
    const { review, database } = setupReview();
    database.$transaction.mockRejectedValue({ code: 'P2034' });
    await expect(review()).rejects.toMatchObject({
      response: { code: 'VERSION_CONFLICT' },
    });
    expect(database.$transaction).toHaveBeenCalledTimes(3);
  });

  it('revalidates binding before replaying a winning receipt after a unique conflict', async () => {
    const { review, transaction, database } = setupReview();
    await review();
    const receiptData =
      transaction.clientLeadReviewReceipt.create.mock.calls[0][0].data;
    database.$transaction.mockRejectedValueOnce({ code: 'P2002' });
    database.clientLeadReviewReceipt.findUnique.mockResolvedValue({
      ...receiptData,
    });
    database.customerAccountBinding.findFirst.mockResolvedValue(null);
    await expect(review()).rejects.toMatchObject({
      response: { code: 'ACTION_FORBIDDEN' },
    });
  });

  it('replays a winning receipt after a unique-key race', async () => {
    const { review, transaction, database } = setupReview();
    const first = await review();
    const receiptData =
      transaction.clientLeadReviewReceipt.create.mock.calls[0][0].data;
    database.$transaction.mockRejectedValueOnce({ code: 'P2002' });
    database.clientLeadReviewReceipt.findUnique.mockResolvedValue(receiptData);
    await expect(review()).resolves.toEqual(first);
    expect(database.customerAccountBinding.findFirst).toHaveBeenCalledTimes(1);
  });

  it('allows only one decision when a distinct key follows a completed review', async () => {
    const { service, transaction } = setupReview();
    let current = { ...lead };
    transaction.lead.findFirst.mockImplementation(() =>
      Promise.resolve(current),
    );
    transaction.lead.updateMany.mockImplementation(() => {
      current = { ...current, status: 'WAITING_EVIDENCE_DECISION', version: 3 };
      return Promise.resolve({ count: 1 });
    });
    const input = { result: 'INFRINGEMENT', expectedVersion: 2 } as const;
    await service.review(actor, lead.id, 'key-a', input);
    await expect(
      service.review(actor, lead.id, 'key-b', input),
    ).rejects.toMatchObject({ response: { code: 'INVALID_STATE' } });
    expect(transaction.leadReviewDecision.create).toHaveBeenCalledTimes(1);
    expect(transaction.clientLeadReviewReceipt.create).toHaveBeenCalledTimes(1);
  });

  it('does not create a second decision when a concurrent attempt retries after serialization failure', async () => {
    const { service, transaction, database } = setupReview();
    let current = { ...lead };
    transaction.lead.findFirst.mockImplementation(() =>
      Promise.resolve(current),
    );
    transaction.lead.updateMany.mockImplementation(() => {
      current = { ...current, status: 'WAITING_EVIDENCE_DECISION', version: 3 };
      return Promise.resolve({ count: 1 });
    });
    const runTransaction = database.$transaction.getMockImplementation() as (
      fn: (client: typeof transaction) => Promise<unknown>,
    ) => Promise<unknown>;
    let releaseFirst!: () => void;
    const firstFinished = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let calls = 0;
    database.$transaction.mockImplementation(
      async (fn: (client: typeof transaction) => Promise<unknown>) => {
        const call = ++calls;
        if (call === 2) {
          await firstFinished;
          throw { code: 'P2034' };
        }
        const result = await runTransaction(fn);
        if (call === 1) releaseFirst();
        return result;
      },
    );
    const input = { result: 'INFRINGEMENT', expectedVersion: 2 } as const;
    const results = await Promise.allSettled([
      service.review(actor, lead.id, 'key-a', input),
      service.review(actor, lead.id, 'key-b', input),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === 'rejected'),
    ).toHaveLength(1);
    expect(transaction.leadReviewDecision.create).toHaveBeenCalledTimes(1);
    expect(transaction.clientLeadReviewReceipt.create).toHaveBeenCalledTimes(1);
  });
});

const applicationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const originalDecisionId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function setupConfirmation() {
  const application = {
    id: applicationId,
    originalDecisionId,
    leadId: lead.id,
    customerId,
    departmentId: actor.departmentId,
    reason: '申请原因',
    appliedAt: new Date('2026-09-22T04:00:00.000Z'),
    fromVersion: 3,
    toVersion: 4,
    confirmation: null,
    resultSnapshot: { applicantDisplayName: '运营甲' },
  };
  const current = {
    ...archivedLead,
    id: lead.id,
    version: 4,
    activeReviewDecisionId: originalDecisionId,
    reviewDecision: { ...archivedLead.reviewDecision, id: originalDecisionId },
    withdrawalApplications: [application],
  };
  const transaction = {
    customerAccountBinding: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'binding-other-account',
        customerId,
        user: { displayName: '另一位企业审核员' },
      }),
    },
    leadWithdrawalConfirmation: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(({ data }: { data: object }) =>
        Promise.resolve({
          id: 'confirmation-1',
          confirmedAt: new Date('2026-09-22T05:00:00.000Z'),
          ...data,
        }),
      ),
    },
    $queryRawUnsafe: jest.fn().mockResolvedValue([{ id: lead.id }]),
    lead: {
      findFirst: jest.fn().mockResolvedValue(current),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const database = {
    $transaction: jest
      .fn()
      .mockImplementation(
        (fn: (client: typeof transaction) => Promise<unknown>) =>
          fn(transaction),
      ),
    customerAccountBinding: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'binding-other-account',
        customerId,
        user: { displayName: '另一位企业审核员' },
      }),
    },
    leadWithdrawalConfirmation: {
      findUnique: jest.fn().mockResolvedValue(null),
    },
  };
  return {
    service: new ClientLeadService(database as never, {} as never),
    database,
    transaction,
    current,
    application,
  };
}

describe('ClientLeadService.confirmWithdrawal', () => {
  const input = { applicationId, expectedVersion: 4 };
  const confirm = (
    fixture: ReturnType<typeof setupConfirmation>,
    key = 'confirm-key',
  ) => fixture.service.confirmWithdrawal(actor, lead.id, key, input);

  it('lets another effective account of the original enterprise confirm atomically', async () => {
    const fixture = setupConfirmation();
    const result = await confirm(fixture);
    expect(result).toMatchObject({
      leadId: lead.id,
      applicationId,
      status: 'WAITING_REVIEW',
      version: 5,
      confirmedByDisplayName: '另一位企业审核员',
    });
    expect(fixture.database.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: 'Serializable' },
    );
    expect(fixture.transaction.lead.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          activeReviewDecisionId: originalDecisionId,
          version: 4,
        }),
        data: {
          status: 'WAITING_REVIEW',
          activeReviewDecisionId: null,
          version: { increment: 1 },
        },
      }),
    );
    expect(
      fixture.transaction.leadWithdrawalConfirmation.create,
    ).toHaveBeenCalledWith({
      data: expect.objectContaining({
        applicationId,
        originalDecisionId,
        customerAccountBindingId: 'binding-other-account',
        resultSnapshot: result,
      }),
    });
  });

  it('replays the original snapshot after current identity validation and rejects changed payload', async () => {
    const fixture = setupConfirmation();
    const first = await confirm(fixture);
    const receipt =
      fixture.transaction.leadWithdrawalConfirmation.create.mock.calls[0][0]
        .data;
    fixture.transaction.leadWithdrawalConfirmation.findUnique.mockResolvedValue(
      receipt,
    );
    fixture.transaction.lead.updateMany.mockClear();
    await expect(confirm(fixture)).resolves.toEqual(first);
    expect(fixture.transaction.lead.updateMany).not.toHaveBeenCalled();
    await expect(
      fixture.service.confirmWithdrawal(actor, lead.id, 'confirm-key', {
        ...input,
        expectedVersion: 5,
      }),
    ).rejects.toMatchObject({ response: { code: 'IDEMPOTENCY_CONFLICT' } });
    fixture.transaction.customerAccountBinding.findFirst.mockResolvedValue(
      null,
    );
    await expect(confirm(fixture)).rejects.toMatchObject({
      response: { code: 'ACTION_FORBIDDEN' },
    });
  });

  it.each([
    'wrong enterprise',
    'unpushed',
    'missing application',
    'different decision',
    'already confirmed',
    'wrong state',
    'stale version',
    'application version mismatch',
  ])('rejects %s without a confirmation fact', async (scenario) => {
    const fixture = setupConfirmation();
    if (scenario === 'wrong enterprise')
      fixture.transaction.$queryRawUnsafe.mockResolvedValue([]);
    if (scenario === 'unpushed')
      fixture.transaction.lead.findFirst.mockResolvedValue({
        ...fixture.current,
        pushedAt: null,
      });
    if (scenario === 'missing application')
      fixture.transaction.lead.findFirst.mockResolvedValue({
        ...fixture.current,
        withdrawalApplications: [],
      });
    if (scenario === 'different decision')
      fixture.transaction.lead.findFirst.mockResolvedValue({
        ...fixture.current,
        activeReviewDecisionId: 'other-decision',
      });
    if (scenario === 'already confirmed')
      fixture.transaction.lead.findFirst.mockResolvedValue({
        ...fixture.current,
        withdrawalApplications: [
          { ...fixture.application, confirmation: { id: 'done' } },
        ],
      });
    if (scenario === 'wrong state')
      fixture.transaction.lead.findFirst.mockResolvedValue({
        ...fixture.current,
        status: 'WAITING_REVIEW',
      });
    if (scenario === 'stale version')
      fixture.transaction.lead.findFirst.mockResolvedValue({
        ...fixture.current,
        version: 5,
      });
    if (scenario === 'application version mismatch')
      fixture.transaction.lead.findFirst.mockResolvedValue({
        ...fixture.current,
        withdrawalApplications: [{ ...fixture.application, toVersion: 3 }],
      });
    await expect(confirm(fixture)).rejects.toMatchObject({
      response: {
        code:
          scenario === 'wrong enterprise' || scenario === 'unpushed'
            ? 'RESOURCE_NOT_FOUND'
            : scenario === 'stale version'
              ? 'VERSION_CONFLICT'
              : 'INVALID_STATE',
      },
    });
    expect(
      fixture.transaction.leadWithdrawalConfirmation.create,
    ).not.toHaveBeenCalled();
  });

  it('rejects revoked account, binding or non-admitted customer before replay and mutation', async () => {
    const fixture = setupConfirmation();
    fixture.transaction.customerAccountBinding.findFirst.mockResolvedValue(
      null,
    );
    await expect(confirm(fixture)).rejects.toMatchObject({
      response: { code: 'ACTION_FORBIDDEN' },
    });
    expect(
      fixture.transaction.leadWithdrawalConfirmation.findUnique,
    ).not.toHaveBeenCalled();
  });

  it('does not return success when the immutable confirmation write fails', async () => {
    const fixture = setupConfirmation();
    const error = new Error('confirmation failed');
    fixture.transaction.leadWithdrawalConfirmation.create.mockRejectedValue(
      error,
    );
    await expect(confirm(fixture)).rejects.toBe(error);
    expect(fixture.transaction.lead.updateMany).toHaveBeenCalledTimes(1);
  });

  it('allows only one winner for distinct keys', async () => {
    const fixture = setupConfirmation();
    await confirm(fixture, 'key-a');
    fixture.transaction.lead.findFirst.mockResolvedValue({
      ...fixture.current,
      status: 'WAITING_REVIEW',
      activeReviewDecisionId: null,
      version: 5,
    });
    await expect(confirm(fixture, 'key-b')).rejects.toMatchObject({
      response: { code: 'INVALID_STATE' },
    });
    expect(
      fixture.transaction.leadWithdrawalConfirmation.create,
    ).toHaveBeenCalledTimes(1);
  });

  it('replays the winning confirmation after a unique-key race only for a still valid account', async () => {
    const fixture = setupConfirmation();
    const first = await confirm(fixture);
    const receipt =
      fixture.transaction.leadWithdrawalConfirmation.create.mock.calls[0][0]
        .data;
    fixture.database.$transaction.mockRejectedValueOnce({ code: 'P2002' });
    fixture.database.leadWithdrawalConfirmation.findUnique.mockResolvedValue(
      receipt,
    );
    await expect(confirm(fixture)).resolves.toEqual(first);
    fixture.database.$transaction.mockRejectedValueOnce({ code: 'P2002' });
    fixture.database.customerAccountBinding.findFirst.mockResolvedValue(null);
    await expect(confirm(fixture)).rejects.toMatchObject({
      response: { code: 'ACTION_FORBIDDEN' },
    });
  });

  it('returns a version conflict when another confirmation wins with a different key', async () => {
    const fixture = setupConfirmation();
    fixture.database.$transaction.mockRejectedValueOnce({ code: 'P2002' });
    await expect(confirm(fixture, 'losing-key')).rejects.toMatchObject({
      response: { code: 'VERSION_CONFLICT' },
    });
    expect(
      fixture.database.customerAccountBinding.findFirst,
    ).toHaveBeenCalledTimes(1);
  });

  it('retries serialization failures and caps a persistent race at version conflict', async () => {
    const fixture = setupConfirmation();
    fixture.database.$transaction.mockRejectedValue({ code: 'P2034' });
    await expect(confirm(fixture)).rejects.toMatchObject({
      response: { code: 'VERSION_CONFLICT' },
    });
    expect(fixture.database.$transaction).toHaveBeenCalledTimes(3);
  });
});

type ClientLeadWhere = {
  id?: string;
  departmentId?: string;
  customerId?: string;
  status?: string;
  pushedAt?: { not: null };
  pushedByUserId?: { not: null };
  reviewDecision?: {
    isNot?: null;
    is?: { result?: string; archiveType?: string; archivedAt?: { not: null } };
  };
  OR?: ClientLeadWhere[];
};

function setupWithRealMaterials(record: {
  id: string;
  departmentId: string;
  customerId: string;
  status: string;
  pushedAt: Date | null;
  pushedByUserId: string | null;
  reviewDecision: object | null;
}) {
  const database = {
    customerAccountBinding: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'binding-1',
        customerId,
        user: { displayName: '企业审核员' },
      }),
    },
    lead: {
      findFirst: jest
        .fn()
        .mockImplementation(({ where }: { where: ClientLeadWhere }) =>
          matchesClientLeadWhere(record, where) ? record : null,
        ),
    },
    materialReference: {
      findMany: jest
        .fn()
        .mockResolvedValue([
          { contentVersionId: 'version-b' },
          { contentVersionId: 'version-a' },
          { contentVersionId: 'version-a' },
        ]),
    },
  };
  const materials = new MaterialService(
    database as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return {
    database,
    service: new ClientLeadService(database as never, materials),
  };
}

function matchesClientLeadWhere(
  lead: {
    id: string;
    departmentId: string;
    customerId: string;
    status: string;
    pushedAt: Date | null;
    pushedByUserId: string | null;
    reviewDecision: object | null;
  },
  where: ClientLeadWhere,
): boolean {
  return (
    (where.id === undefined || where.id === lead.id) &&
    (where.departmentId === undefined ||
      where.departmentId === lead.departmentId) &&
    (where.customerId === undefined || where.customerId === lead.customerId) &&
    (where.status === undefined || where.status === lead.status) &&
    (where.pushedAt === undefined || lead.pushedAt !== null) &&
    (where.pushedByUserId === undefined || lead.pushedByUserId !== null) &&
    (where.reviewDecision === undefined ||
      (lead.reviewDecision !== null &&
        (where.reviewDecision.is === undefined ||
          Object.entries(where.reviewDecision.is).every(([key, value]) =>
            key === 'archivedAt'
              ? (lead.reviewDecision as { archivedAt?: Date }).archivedAt !=
                null
              : (lead.reviewDecision as Record<string, unknown>)[key] === value,
          )))) &&
    (where.OR === undefined ||
      where.OR.some((branch) => matchesClientLeadWhere(lead, branch)))
  );
}
