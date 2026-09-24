import { ForbiddenException } from '@nestjs/common';
import { LeadService } from './lead.service';

const actor = {
  userId: '11111111-1111-4111-8111-111111111111',
  departmentId: '22222222-2222-4222-8222-222222222222',
  authorizationRevision: 3,
};
const leadId = '33333333-3333-4333-8333-333333333333';
const customerId = '44444444-4444-4444-8444-444444444444';
const decisionId = '55555555-5555-4555-8555-555555555555';

function setup(overrides: Record<string, unknown> = {}) {
  const current = {
    id: leadId,
    businessNo: 'LD-20260924-001',
    departmentId: actor.departmentId,
    customerId,
    responsibleUserId: actor.userId,
    teamId: null,
    status: 'WAITING_EVIDENCE_DECISION',
    version: 3,
    activeReviewDecisionId: decisionId,
    reviewDecision: { id: decisionId, result: 'INFRINGEMENT' },
    ...overrides,
  };
  const tx = {
    $queryRawUnsafe: jest.fn().mockResolvedValue([{ id: leadId }]),
    lead: {
      findFirst: jest.fn().mockResolvedValue(current),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    userAccount: {
      findUnique: jest.fn().mockResolvedValue({
        displayName: '运营原名',
        accountType: 'INTERNAL',
      }),
    },
    leadCommandReceipt: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
    },
    leadEvidenceDecision: {
      create: jest.fn().mockResolvedValue({}),
    },
    auditEvent: { create: jest.fn().mockResolvedValue({}) },
  };
  const database = {
    $transaction: jest.fn(async (callback: (value: unknown) => unknown) =>
      callback(tx),
    ),
    leadCommandReceipt: tx.leadCommandReceipt,
  };
  const access = { authorizeLead: jest.fn().mockResolvedValue(undefined) };
  return {
    service: new LeadService(database as never, access as never, {} as never),
    tx,
    access,
    current,
  };
}

describe('LeadService evidence decision', () => {
  const command = {
    result: 'NO_EVIDENCE' as const,
    reason: '  不再取证  ',
    expectedVersion: 3,
  };

  it('rejects a grant-bearing client account before a new decision or receipt replay', async () => {
    const fixture = setup();
    const original = await fixture.service.decideEvidence(
      actor,
      leadId,
      'same',
      command,
    );
    const receipt =
      fixture.tx.leadCommandReceipt.create.mock.calls[0]?.[0]?.data;
    fixture.tx.leadCommandReceipt.findUnique.mockImplementation(({ where }) =>
      where.departmentId_actorUserId_action_idempotencyKey.idempotencyKey ===
      'same'
        ? receipt
        : null,
    );
    fixture.tx.userAccount.findUnique.mockResolvedValue({
      displayName: '企业客户',
      accountType: 'CLIENT',
    });
    fixture.tx.lead.updateMany.mockClear();
    fixture.tx.leadEvidenceDecision.create.mockClear();
    fixture.tx.auditEvent.create.mockClear();
    fixture.tx.leadCommandReceipt.create.mockClear();
    await expect(
      fixture.service.decideEvidence(actor, leadId, 'same', command),
    ).rejects.toMatchObject({ response: { code: 'ACTION_FORBIDDEN' } });
    await expect(
      fixture.service.decideEvidence(actor, leadId, 'fresh', command),
    ).rejects.toMatchObject({ response: { code: 'ACTION_FORBIDDEN' } });
    expect(fixture.access.authorizeLead).toHaveBeenCalled();
    expect(fixture.tx.lead.updateMany).not.toHaveBeenCalled();
    expect(fixture.tx.leadEvidenceDecision.create).not.toHaveBeenCalled();
    expect(fixture.tx.auditEvent.create).not.toHaveBeenCalled();
    expect(fixture.tx.leadCommandReceipt.create).not.toHaveBeenCalled();
    expect(original.result).toBe('NO_EVIDENCE');
  });

  it('archives a confirmed infringement with immutable decision, audit, and snapshot receipt', async () => {
    const { service, tx, access } = setup();
    const result = await service.decideEvidence(
      actor,
      leadId,
      'key-1',
      command,
    );
    expect(result).toMatchObject({
      leadId,
      status: 'ARCHIVED',
      version: 4,
      result: 'NO_EVIDENCE',
      reason: '不再取证',
      decidedByDisplayName: '运营原名',
      archiveType: 'NO_EVIDENCE',
    });
    expect(access.authorizeLead).toHaveBeenCalledWith(
      actor,
      'lead.evidence.decide',
      expect.objectContaining({ departmentId: actor.departmentId }),
      tx,
    );
    expect(tx.leadEvidenceDecision.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        originalReviewDecisionId: decisionId,
        reason: '不再取证',
        fromVersion: 3,
        toVersion: 4,
        actorDisplayNameSnapshot: '运营原名',
      }),
    });
    expect(tx.leadCommandReceipt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ resultSnapshot: result }),
    });
    expect(tx.auditEvent.create).toHaveBeenCalled();
  });

  it('replays the original receipt and rejects a different intent', async () => {
    const { service, tx } = setup();
    const original = await service.decideEvidence(
      actor,
      leadId,
      'same',
      command,
    );
    tx.leadCommandReceipt.findUnique.mockResolvedValue(
      tx.leadCommandReceipt.create.mock.calls[0]?.[0]?.data,
    );
    tx.lead.updateMany.mockClear();
    await expect(
      service.decideEvidence(actor, leadId, 'same', command),
    ).resolves.toEqual(original);
    await expect(
      service.decideEvidence(actor, leadId, 'same', {
        ...command,
        reason: '别的原因',
      }),
    ).rejects.toMatchObject({ response: { code: 'IDEMPOTENCY_CONFLICT' } });
    expect(tx.lead.updateMany).not.toHaveBeenCalled();
  });

  it.each([
    [{ status: 'WAITING_REVIEW' }, 'INVALID_STATE'],
    [
      { reviewDecision: { id: decisionId, result: 'NO_INFRINGEMENT' } },
      'INVALID_STATE',
    ],
    [{ version: 4 }, 'VERSION_CONFLICT'],
  ])('rejects invalid state or version', async (override, code) => {
    const { service, tx } = setup(override);
    await expect(
      service.decideEvidence(actor, leadId, 'key', command),
    ).rejects.toMatchObject({ response: { code } });
    expect(tx.lead.updateMany).not.toHaveBeenCalled();
  });

  it.each(['', ' ', '😀'.repeat(5001)])(
    'rejects invalid reason before a transaction',
    async (reason) => {
      const { service, tx } = setup();
      await expect(
        service.decideEvidence(actor, leadId, 'key', { ...command, reason }),
      ).rejects.toMatchObject({ response: { code: 'VALIDATION_ERROR' } });
      expect(tx.lead.updateMany).not.toHaveBeenCalled();
    },
  );

  it('rejects unscoped actor and cross-department target', async () => {
    const denied = setup();
    denied.access.authorizeLead.mockRejectedValue(new ForbiddenException());
    await expect(
      denied.service.decideEvidence(actor, leadId, 'key', command),
    ).rejects.toMatchObject({ response: { code: 'ACTION_FORBIDDEN' } });
    const hidden = setup();
    hidden.tx.$queryRawUnsafe.mockResolvedValue([]);
    await expect(
      hidden.service.decideEvidence(actor, leadId, 'key', command),
    ).rejects.toMatchObject({ response: { code: 'RESOURCE_NOT_FOUND' } });
  });

  it.each([
    'leadEvidenceDecision',
    'auditEvent',
    'leadCommandReceipt',
  ] as const)(
    'propagates %s failure so the transaction rolls back',
    async (table) => {
      const { service, tx } = setup();
      tx[table].create.mockRejectedValue(new Error('injected failure'));
      await expect(
        service.decideEvidence(actor, leadId, 'key', command),
      ).rejects.toThrow('injected failure');
    },
  );
});
