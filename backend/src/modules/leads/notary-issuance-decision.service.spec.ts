import { ForbiddenException } from '@nestjs/common';
import { NotaryIssuanceDecisionService } from './notary-issuance-decision.service';

const actor = {
  userId: '11111111-1111-4111-8111-111111111111',
  departmentId: '22222222-2222-4222-8222-222222222222',
  authorizationRevision: 1,
};
const matterId = '33333333-3333-4333-8333-333333333333';
const reviewId = '44444444-4444-4444-8444-444444444444';

function fixture() {
  const matter = {
    id: matterId,
    departmentId: actor.departmentId,
    customerId: '55555555-5555-4555-8555-555555555555',
    stage: 'ISSUANCE_DECISION',
    version: 4,
    sourceLead: { responsibleUserId: actor.userId, teamId: null },
    openingReviewDecision: {
      id: reviewId,
      result: 'INFRINGEMENT',
      reason: null,
      archivedAt: null,
      decidedAt: new Date('2026-09-28T00:00:00.000Z'),
    },
  };
  const tx = {
    $queryRawUnsafe: jest.fn().mockResolvedValue([{ id: matterId }]),
    notaryMatter: {
      findFirst: jest.fn().mockResolvedValue(matter),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    userAccount: {
      findUnique: jest.fn().mockResolvedValue({
        accountType: 'INTERNAL',
        active: true,
        displayName: '运营',
      }),
    },
    notaryMatterCommandReceipt: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
    },
    notaryIssuanceDecision: {
      findUnique: jest.fn(),
      create: jest.fn().mockImplementation(async ({ data }) => ({
        ...data,
        id: 'decision-1',
      })),
    },
    notaryIssuanceDecisionAuditEvent: {
      create: jest.fn().mockResolvedValue({}),
    },
  };
  const database = {
    $transaction: jest.fn(async (fn: (tx: unknown) => unknown) => fn(tx)),
  };
  const access = { authorizeLead: jest.fn().mockResolvedValue(undefined) };
  return {
    service: new NotaryIssuanceDecisionService(
      database as never,
      access as never,
    ),
    database,
    access,
    tx,
    matter,
  };
}

describe('NotaryIssuanceDecisionService', () => {
  it.each([
    ['ISSUE', 'WAITING_CERTIFICATE'],
    ['NO_ISSUE', 'WAITING_RETURN'],
  ] as const)(
    'commits %s as %s with fact, audit and receipt',
    async (decision, stage) => {
      const f = fixture();
      const result = await f.service.decide(actor, matterId, 'key', {
        decision,
        expectedVersion: 4,
      });
      expect(result).toMatchObject({
        id: matterId,
        stage,
        version: 5,
        issuanceDecision: { decision, actorDisplayName: '运营' },
      });
      expect(f.access.authorizeLead).toHaveBeenCalledWith(
        actor,
        'notary.issuance.decide',
        expect.anything(),
        f.tx,
      );
      expect(f.tx.notaryMatter.updateMany).toHaveBeenCalledWith({
        where: {
          id: matterId,
          departmentId: actor.departmentId,
          stage: 'ISSUANCE_DECISION',
          version: 4,
        },
        data: { stage, version: 5 },
      });
      expect(f.tx.notaryIssuanceDecision.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          matterId,
          openingReviewDecisionId: reviewId,
          decision,
          fromVersion: 4,
          toVersion: 5,
          actorUserId: actor.userId,
        }),
      });
      expect(f.tx.notaryIssuanceDecisionAuditEvent.create).toHaveBeenCalled();
      expect(f.tx.notaryMatterCommandReceipt.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'notary.issuance.decide',
          resultMatterVersion: 5,
        }),
      });
      expect(f.database.$transaction).toHaveBeenCalledWith(
        expect.any(Function),
        { isolationLevel: 'Serializable' },
      );
    },
  );

  it('checks live authorization before replay', async () => {
    const f = fixture();
    f.access.authorizeLead.mockRejectedValue(new ForbiddenException());
    await expect(
      f.service.decide(actor, matterId, 'key', {
        decision: 'ISSUE',
        expectedVersion: 4,
      }),
    ).rejects.toMatchObject({ response: { code: 'ACTION_FORBIDDEN' } });
    expect(f.tx.notaryMatterCommandReceipt.findUnique).not.toHaveBeenCalled();
  });

  it('rejects external actor, wrong stage or review, and stale version', async () => {
    const external = fixture();
    await expect(
      external.service.decide(
        { ...actor, notaryOfficeId: 'office' },
        matterId,
        'key',
        { decision: 'ISSUE', expectedVersion: 4 },
      ),
    ).rejects.toMatchObject({ response: { code: 'ACTION_FORBIDDEN' } });
    const state = fixture();
    state.tx.notaryMatter.findFirst.mockResolvedValue({
      ...state.matter,
      stage: 'WAITING_RETURN',
    });
    await expect(
      state.service.decide(actor, matterId, 'key', {
        decision: 'ISSUE',
        expectedVersion: 4,
      }),
    ).rejects.toMatchObject({ response: { code: 'INVALID_STATE' } });
    const review = fixture();
    review.tx.notaryMatter.findFirst.mockResolvedValue({
      ...review.matter,
      openingReviewDecision: {
        ...review.matter.openingReviewDecision,
        result: 'NO_INFRINGEMENT',
      },
    });
    await expect(
      review.service.decide(actor, matterId, 'key', {
        decision: 'ISSUE',
        expectedVersion: 4,
      }),
    ).rejects.toMatchObject({ response: { code: 'INVALID_STATE' } });
    const stale = fixture();
    await expect(
      stale.service.decide(actor, matterId, 'key', {
        decision: 'ISSUE',
        expectedVersion: 3,
      }),
    ).rejects.toMatchObject({ response: { code: 'VERSION_CONFLICT' } });
  });

  it('replays same key and rejects changed request', async () => {
    const f = fixture();
    const result = await f.service.decide(actor, matterId, 'key', {
      decision: 'ISSUE',
      expectedVersion: 4,
    });
    const receipt =
      f.tx.notaryMatterCommandReceipt.create.mock.calls[0][0].data;
    f.tx.notaryMatterCommandReceipt.findUnique.mockResolvedValue(receipt);
    f.tx.notaryIssuanceDecision.findUnique.mockResolvedValue({
      ...f.tx.notaryIssuanceDecision.create.mock.calls[0][0].data,
      id: 'decision-1',
    });
    expect(
      await f.service.decide(actor, matterId, 'key', {
        decision: 'ISSUE',
        expectedVersion: 4,
      }),
    ).toEqual(result);
    await expect(
      f.service.decide(actor, matterId, 'key', {
        decision: 'NO_ISSUE',
        expectedVersion: 4,
      }),
    ).rejects.toMatchObject({ response: { code: 'IDEMPOTENCY_CONFLICT' } });
    expect(f.tx.notaryIssuanceDecision.create).toHaveBeenCalledTimes(1);
  });

  it('fails the transaction when audit or receipt fails', async () => {
    for (const failing of [
      'notaryIssuanceDecisionAuditEvent',
      'notaryMatterCommandReceipt',
    ] as const) {
      const f = fixture();
      f.tx[failing].create.mockRejectedValue(new Error('write failed'));
      await expect(
        f.service.decide(actor, matterId, 'key', {
          decision: 'ISSUE',
          expectedVersion: 4,
        }),
      ).rejects.toThrow('write failed');
    }
  });

  it('maps a losing version update to a conflict', async () => {
    const f = fixture();
    f.tx.notaryMatter.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      f.service.decide(actor, matterId, 'key', {
        decision: 'ISSUE',
        expectedVersion: 4,
      }),
    ).rejects.toMatchObject({ response: { code: 'VERSION_CONFLICT' } });
    expect(f.tx.notaryIssuanceDecision.create).not.toHaveBeenCalled();
  });

  it('rejects a different department before authorization or replay', async () => {
    const f = fixture();
    f.tx.$queryRawUnsafe.mockResolvedValue([]);
    await expect(
      f.service.decide(actor, matterId, 'key', {
        decision: 'ISSUE',
        expectedVersion: 4,
      }),
    ).rejects.toMatchObject({ response: { code: 'RESOURCE_NOT_FOUND' } });
    expect(f.access.authorizeLead).not.toHaveBeenCalled();
    expect(f.tx.notaryMatterCommandReceipt.findUnique).not.toHaveBeenCalled();
  });
});
