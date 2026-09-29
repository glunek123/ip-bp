import { ForbiddenException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { ArchiveNotaryReturnDto } from './notary-return-archive.dto';
import { NotaryReturnArchiveService } from './notary-return-archive.service';

const actor = {
  userId: '11111111-1111-4111-8111-111111111111',
  departmentId: '22222222-2222-4222-8222-222222222222',
  authorizationRevision: 1,
};
const matterId = '33333333-3333-4333-8333-333333333333';
const archivedAt = new Date('2026-09-29T03:00:00.000Z');
const keep: ArchiveNotaryReturnDto = {
  returnChoice: 'KEEP',
  archiveReason: '不申请退款',
  expectedVersion: 5,
};
const pending = { state: 'PENDING' as const };
const known = {
  state: 'KNOWN' as const,
  amount: '25.50',
  partyKind: 'CUSTOMER' as const,
};

function fixture() {
  const matter = {
    id: matterId,
    departmentId: actor.departmentId,
    stage: 'WAITING_RETURN',
    version: 5,
    sourceLead: { responsibleUserId: actor.userId, teamId: null },
    openingReviewDecision: {
      id: '44444444-4444-4444-8444-444444444444',
      result: 'INFRINGEMENT',
      reason: null,
      archivedAt: null,
    },
    issuanceDecision: {
      id: '55555555-5555-4555-8555-555555555555',
      decision: 'NO_ISSUE',
    },
    evidence: {
      matterId,
      sampleFeeState: 'KNOWN',
      sampleFeeAmount: new Prisma.Decimal('100.00'),
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
    notaryReturnArchive: {
      findUnique: jest.fn(),
      create: jest.fn().mockImplementation(async ({ data }) => ({
        ...data,
        id: '66666666-6666-4666-8666-666666666666',
        archivedAt,
      })),
    },
    notaryReturnAmount: {
      create: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
    },
    auditEvent: { create: jest.fn().mockResolvedValue({}) },
  };
  const database = {
    $transaction: jest.fn(async (fn: (arg: unknown) => unknown) => fn(tx)),
  };
  const access = { authorizeLead: jest.fn().mockResolvedValue(undefined) };
  return {
    service: new NotaryReturnArchiveService(database as never, access as never),
    tx,
    database,
    access,
    matter,
  };
}

describe('NotaryReturnArchiveService', () => {
  it.each([
    [keep, 0],
    [
      {
        returnChoice: 'REFUND_ONLY',
        refund: pending,
        archiveReason: '仅退款',
        expectedVersion: 5,
      },
      1,
    ],
    [
      {
        returnChoice: 'RETURN',
        refund: known,
        freight: { state: 'KNOWN', amount: '0.00' },
        archiveReason: '退货',
        expectedVersion: 5,
      },
      2,
    ],
  ] as const)(
    'commits %s with exactly %i amount facts, audit and receipt',
    async (input, count) => {
      const f = fixture();
      const result = await f.service.archive(actor, matterId, 'key', input);
      expect(result).toMatchObject({
        id: matterId,
        stage: 'ARCHIVED',
        version: 6,
        returnArchive: {
          returnChoice: input.returnChoice,
          archiveReason: input.archiveReason,
          archivedAt: archivedAt.toISOString(),
          actorDisplayName: '运营',
        },
      });
      expect(f.tx.notaryReturnAmount.create).toHaveBeenCalledTimes(count);
      expect(f.tx.notaryReturnArchive.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          issuanceDecisionId: f.matter.issuanceDecision.id,
          fromVersion: 5,
          toVersion: 6,
        }),
      });
      expect(f.tx.auditEvent.create).toHaveBeenCalledTimes(1);
      expect(f.tx.notaryMatterCommandReceipt.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'notary.return.archive',
          resultMatterVersion: 6,
          resultSnapshot: result,
        }),
      });
      expect(f.access.authorizeLead).toHaveBeenCalledWith(
        actor,
        'notary.return.archive',
        { departmentId: actor.departmentId, responsibleUserId: actor.userId },
        f.tx,
      );
      expect(f.database.$transaction).toHaveBeenCalledWith(
        expect.any(Function),
        { isolationLevel: 'Serializable' },
      );
    },
  );

  it.each([
    { ...keep, refund: pending },
    { returnChoice: 'REFUND_ONLY', archiveReason: 'x', expectedVersion: 5 },
    {
      returnChoice: 'RETURN',
      refund: pending,
      archiveReason: 'x',
      expectedVersion: 5,
    },
    { ...keep, unexpected: true },
    { ...keep, archiveReason: '  ' },
    {
      returnChoice: 'REFUND_ONLY',
      refund: { state: 'KNOWN' },
      archiveReason: 'x',
      expectedVersion: 5,
    },
    {
      returnChoice: 'REFUND_ONLY',
      refund: { state: 'KNOWN', amount: '-1.00' },
      archiveReason: 'x',
      expectedVersion: 5,
    },
    {
      returnChoice: 'REFUND_ONLY',
      refund: { state: 'KNOWN', amount: '1.001' },
      archiveReason: 'x',
      expectedVersion: 5,
    },
    {
      returnChoice: 'REFUND_ONLY',
      refund: { state: 'PENDING', amount: '0.00' },
      archiveReason: 'x',
      expectedVersion: 5,
    },
    {
      returnChoice: 'REFUND_ONLY',
      refund: { state: 'KNOWN', amount: '0.00', partyKind: 'FIRM' },
      archiveReason: 'x',
      expectedVersion: 5,
    },
    {
      returnChoice: 'REFUND_ONLY',
      refund: { state: 'KNOWN', amount: '1.00' },
      archiveReason: 'x',
      expectedVersion: 5,
    },
    {
      returnChoice: 'REFUND_ONLY',
      refund: {
        state: 'KNOWN',
        amount: '1.00',
        partyKind: 'OTHER',
        partyName: ' ',
      },
      archiveReason: 'x',
      expectedVersion: 5,
    },
    {
      returnChoice: 'REFUND_ONLY',
      refund: {
        state: 'KNOWN',
        amount: '1.00',
        partyKind: 'CUSTOMER',
        partyName: 'bad',
      },
      archiveReason: 'x',
      expectedVersion: 5,
    },
    {
      returnChoice: 'REFUND_ONLY',
      refund: { ...pending, unknown: 1 },
      archiveReason: 'x',
      expectedVersion: 5,
    },
  ])('rejects invalid branch or amount input %#', async (input) => {
    const f = fixture();
    await expect(
      f.service.archive(
        actor,
        matterId,
        'key',
        input as ArchiveNotaryReturnDto,
      ),
    ).rejects.toMatchObject({ response: { code: 'VALIDATION_ERROR' } });
    expect(f.database.$transaction).not.toHaveBeenCalled();
  });

  it('checks original amount and cumulative refunds with Decimal precision', async () => {
    const input: ArchiveNotaryReturnDto = {
      returnChoice: 'REFUND_ONLY',
      refund: known,
      archiveReason: '退款',
      expectedVersion: 5,
    };
    const unknown = fixture();
    unknown.tx.notaryMatter.findFirst.mockResolvedValue({
      ...unknown.matter,
      evidence: {
        ...unknown.matter.evidence,
        sampleFeeState: 'PENDING',
        sampleFeeAmount: null,
      },
    });
    await expect(
      unknown.service.archive(actor, matterId, 'key', input),
    ).rejects.toMatchObject({ response: { code: 'ORIGINAL_AMOUNT_UNKNOWN' } });
    const excess = fixture();
    excess.tx.notaryReturnAmount.findMany.mockResolvedValue([
      { amount: new Prisma.Decimal('74.51') },
    ]);
    await expect(
      excess.service.archive(actor, matterId, 'key', input),
    ).rejects.toMatchObject({ response: { code: 'REFUND_EXCEEDS_ORIGINAL' } });
    const exact = fixture();
    exact.tx.notaryReturnAmount.findMany.mockResolvedValue([
      { amount: new Prisma.Decimal('74.50') },
    ]);
    await expect(
      exact.service.archive(actor, matterId, 'key', input),
    ).resolves.toMatchObject({ stage: 'ARCHIVED' });
    expect(exact.tx.notaryReturnAmount.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        sourceEvidenceMatterId: matterId,
        amount: '25.50',
      }),
    });
  });

  it('normalizes surrounding whitespace in reason and OTHER party name', async () => {
    const f = fixture();
    const result = await f.service.archive(actor, matterId, 'key', {
      returnChoice: 'REFUND_ONLY',
      refund: {
        state: 'KNOWN',
        amount: '1.00',
        partyKind: 'OTHER',
        partyName: '  平台  ',
      },
      archiveReason: '  客户要求退货归档  ',
      expectedVersion: 5,
    });
    expect(result.returnArchive.archiveReason).toBe('客户要求退货归档');
    expect(result.returnArchive.refund?.partyName).toBe('平台');
  });

  it('accepts a reason within the database 5000-character bound', async () => {
    const f = fixture();
    const archiveReason = '归'.repeat(501);
    await expect(
      f.service.archive(actor, matterId, 'key', { ...keep, archiveReason }),
    ).resolves.toMatchObject({ returnArchive: { archiveReason } });
  });

  it('denies external, revoked, cross-department, and out-of-scope actors before receipt replay', async () => {
    for (const external of [
      { ...actor, clientCustomerId: 'customer' },
      { ...actor, notaryOfficeId: 'office' },
    ]) {
      const f = fixture();
      await expect(
        f.service.archive(external, matterId, 'key', keep),
      ).rejects.toMatchObject({ response: { code: 'ACTION_FORBIDDEN' } });
      expect(f.database.$transaction).not.toHaveBeenCalled();
    }
    const revoked = fixture();
    revoked.tx.userAccount.findUnique.mockResolvedValue({
      accountType: 'INTERNAL',
      active: false,
      displayName: '运营',
    });
    await expect(
      revoked.service.archive(actor, matterId, 'key', keep),
    ).rejects.toMatchObject({ response: { code: 'ACTION_FORBIDDEN' } });
    expect(
      revoked.tx.notaryMatterCommandReceipt.findUnique,
    ).not.toHaveBeenCalled();
    const scope = fixture();
    scope.access.authorizeLead.mockRejectedValue(new ForbiddenException());
    await expect(
      scope.service.archive(actor, matterId, 'key', keep),
    ).rejects.toMatchObject({ response: { code: 'ACTION_FORBIDDEN' } });
    expect(
      scope.tx.notaryMatterCommandReceipt.findUnique,
    ).not.toHaveBeenCalled();
    const department = fixture();
    department.tx.$queryRawUnsafe.mockResolvedValue([]);
    await expect(
      department.service.archive(actor, matterId, 'key', keep),
    ).rejects.toMatchObject({ response: { code: 'RESOURCE_NOT_FOUND' } });
    expect(
      department.tx.notaryMatterCommandReceipt.findUnique,
    ).not.toHaveBeenCalled();
  });

  it('rejects wrong stage, decision, review, missing evidence, and stale version', async () => {
    for (const change of [
      { stage: 'ARCHIVED' },
      {
        issuanceDecision: {
          ...fixture().matter.issuanceDecision,
          decision: 'ISSUE',
        },
      },
      {
        openingReviewDecision: {
          ...fixture().matter.openingReviewDecision,
          result: 'NO_INFRINGEMENT',
        },
      },
      { evidence: null },
    ]) {
      const f = fixture();
      f.tx.notaryMatter.findFirst.mockResolvedValue({ ...f.matter, ...change });
      await expect(
        f.service.archive(actor, matterId, 'key', keep),
      ).rejects.toMatchObject({ response: { code: 'INVALID_STATE' } });
    }
    const stale = fixture();
    await expect(
      stale.service.archive(actor, matterId, 'key', {
        ...keep,
        expectedVersion: 4,
      }),
    ).rejects.toMatchObject({ response: { code: 'VERSION_CONFLICT' } });
  });

  it('replays only a matching request and persisted archive plus amount facts', async () => {
    const f = fixture();
    const input: ArchiveNotaryReturnDto = {
      returnChoice: 'REFUND_ONLY',
      refund: known,
      archiveReason: '退款',
      expectedVersion: 5,
    };
    const result = await f.service.archive(actor, matterId, 'key', input);
    const receipt =
      f.tx.notaryMatterCommandReceipt.create.mock.calls[0][0].data;
    f.tx.notaryMatterCommandReceipt.findUnique.mockResolvedValue(receipt);
    receipt.resultSnapshot = {
      version: result.version,
      returnArchive: {
        freight: result.returnArchive.freight,
        refund: {
          partyName: null,
          partyKind: 'CUSTOMER',
          amount: '25.50',
          state: 'KNOWN',
        },
        actorDisplayName: result.returnArchive.actorDisplayName,
        archivedAt: result.returnArchive.archivedAt,
        archiveReason: result.returnArchive.archiveReason,
        returnChoice: result.returnArchive.returnChoice,
      },
      stage: result.stage,
      id: result.id,
    };
    f.tx.notaryReturnArchive.findUnique.mockResolvedValue({
      ...f.tx.notaryReturnArchive.create.mock.calls[0][0].data,
      archivedAt,
      amounts: [
        {
          kind: 'REFUND',
          state: 'KNOWN',
          amount: new Prisma.Decimal('25.50'),
          partyKind: 'CUSTOMER',
          partyName: null,
          sourceEvidenceMatterId: matterId,
        },
      ],
    });
    await expect(
      f.service.archive(actor, matterId, 'key', input),
    ).resolves.toEqual(result);
    await expect(
      f.service.archive(actor, matterId, 'key', {
        ...input,
        archiveReason: 'different',
      }),
    ).rejects.toMatchObject({ response: { code: 'IDEMPOTENCY_CONFLICT' } });
    expect(f.tx.auditEvent.create).toHaveBeenCalledTimes(1);
    f.tx.notaryReturnArchive.findUnique.mockResolvedValue({
      ...f.tx.notaryReturnArchive.findUnique.mock.results[0].value,
      amounts: [],
    });
    await expect(
      f.service.archive(actor, matterId, 'key', input),
    ).rejects.toMatchObject({ response: { code: 'RECEIPT_CORRUPT' } });
  });

  it('maps the different-key loser and receipt-key race to stable conflicts', async () => {
    const loser = fixture();
    loser.tx.notaryMatter.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      loser.service.archive(actor, matterId, 'new-key', keep),
    ).rejects.toMatchObject({ response: { code: 'VERSION_CONFLICT' } });
    const race = fixture();
    race.tx.notaryMatterCommandReceipt.create.mockRejectedValueOnce({
      code: 'P2002',
    });
    race.tx.notaryMatterCommandReceipt.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        requestFingerprint: 'other',
        resultMatterId: matterId,
      });
    await expect(
      race.service.archive(actor, matterId, 'key', keep),
    ).rejects.toMatchObject({ response: { code: 'IDEMPOTENCY_CONFLICT' } });
    expect(race.database.$transaction).toHaveBeenCalledTimes(2);
  });

  it.each([
    'notaryMatter',
    'notaryReturnArchive',
    'notaryReturnAmount',
    'auditEvent',
    'notaryMatterCommandReceipt',
  ] as const)('does not report success when %s write fails', async (table) => {
    const f = fixture();
    if (table === 'notaryMatter')
      f.tx.notaryMatter.updateMany.mockRejectedValue(new Error('write failed'));
    else if (table === 'notaryReturnAmount')
      f.tx.notaryReturnAmount.create.mockRejectedValue(
        new Error('write failed'),
      );
    else f.tx[table].create.mockRejectedValue(new Error('write failed'));
    const input: ArchiveNotaryReturnDto = {
      returnChoice: 'REFUND_ONLY',
      refund: pending,
      archiveReason: '退款',
      expectedVersion: 5,
    };
    await expect(
      f.service.archive(actor, matterId, 'key', input),
    ).rejects.toThrow('write failed');
  });
});
