import { LeadService } from './lead.service';

const actor = {
  userId: '11111111-1111-4111-8111-111111111111',
  departmentId: '22222222-2222-4222-8222-222222222222',
  authorizationRevision: 3,
};
const leadId = '33333333-3333-4333-8333-333333333333';
const reviewId = '44444444-4444-4444-8444-444444444444';
const customerId = '55555555-5555-4555-8555-555555555555';
const command = {
  result: 'NO_EVIDENCE' as const,
  reason: ' 不再取证 ',
  expectedVersion: 3,
};

function setup() {
  const tx = {
    $queryRawUnsafe: jest.fn().mockResolvedValue([{ id: leadId }]),
    lead: {
      findFirst: jest
        .fn()
        .mockResolvedValue({
          id: leadId,
          customerId,
          departmentId: actor.departmentId,
          responsibleUserId: actor.userId,
          teamId: null,
          status: 'WAITING_EVIDENCE_DECISION',
          version: 3,
          activeReviewDecisionId: reviewId,
          reviewDecision: { id: reviewId, result: 'INFRINGEMENT' },
        }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    userAccount: {
      findUnique: jest
        .fn()
        .mockResolvedValue({
          displayName: '运营甲',
          accountType: 'INTERNAL',
          active: true,
        }),
    },
    leadCommandReceipt: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
    },
    leadProxyEvidenceConfirmation: { create: jest.fn().mockResolvedValue({}) },
    leadEvidenceDecision: { create: jest.fn().mockResolvedValue({}) },
    auditEvent: { create: jest.fn().mockResolvedValue({}) },
  };
  const database = {
    $transaction: jest.fn(async (cb: (tx: unknown) => unknown) => cb(tx)),
  };
  const access = { authorizeLead: jest.fn().mockResolvedValue(undefined) };
  return {
    tx,
    access,
    service: new LeadService(database as never, access as never, {} as never),
  };
}

describe('proxy customer evidence confirmation', () => {
  it('archives NO_EVIDENCE with proxy fact, legacy archive fact, audit and receipt in one transaction', async () => {
    const { service, tx, access } = setup();
    const result = await service.confirmProxyEvidence(
      actor,
      leadId,
      'key',
      command,
    );
    expect(result).toMatchObject({
      result: 'NO_EVIDENCE',
      status: 'ARCHIVED',
      version: 4,
      actorKind: 'INTERNAL_PROXY',
      reason: '不再取证',
    });
    expect(access.authorizeLead).toHaveBeenCalledWith(
      actor,
      'lead.evidence.confirm.proxy',
      expect.objectContaining({ departmentId: actor.departmentId }),
      tx,
    );
    expect(tx.leadProxyEvidenceConfirmation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        originalReviewDecisionId: reviewId,
        customerId,
        actorKind: 'INTERNAL_PROXY',
        fromVersion: 3,
        toVersion: 4,
      }),
    });
    expect(tx.leadEvidenceDecision.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        originalReviewDecisionId: reviewId,
        result: 'NO_EVIDENCE',
        archiveType: 'NO_EVIDENCE',
        reason: '不再取证',
      }),
    });
    expect(tx.auditEvent.create).toHaveBeenCalled();
    expect(tx.leadCommandReceipt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ resultSnapshot: result }),
    });
  });
  it('records EVIDENCE without archive fact or notary batch', async () => {
    const { service, tx } = setup();
    await expect(
      service.confirmProxyEvidence(actor, leadId, 'key', {
        result: 'EVIDENCE',
        expectedVersion: 3,
      }),
    ).resolves.toMatchObject({
      status: 'WAITING_EVIDENCE_DECISION',
      version: 4,
      reason: null,
    });
    expect(tx.leadEvidenceDecision.create).not.toHaveBeenCalled();
    expect(tx.lead.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { version: { increment: 1 } } }),
    );
  });
  it('replays same key/body, rejects changed body and stale new key', async () => {
    const { service, tx } = setup();
    const original = await service.confirmProxyEvidence(
      actor,
      leadId,
      'key',
      command,
    );
    tx.leadCommandReceipt.findUnique.mockResolvedValue(
      tx.leadCommandReceipt.create.mock.calls[0]?.[0]?.data,
    );
    tx.lead.updateMany.mockClear();
    await expect(
      service.confirmProxyEvidence(actor, leadId, 'key', command),
    ).resolves.toEqual(original);
    await expect(
      service.confirmProxyEvidence(actor, leadId, 'key', {
        ...command,
        reason: '其他',
      }),
    ).rejects.toMatchObject({ response: { code: 'IDEMPOTENCY_CONFLICT' } });
    expect(tx.lead.updateMany).not.toHaveBeenCalled();
    tx.leadCommandReceipt.findUnique.mockResolvedValue(null);
    tx.lead.findFirst.mockResolvedValue({
      ...(await tx.lead.findFirst()),
      version: 4,
    });
    await expect(
      service.confirmProxyEvidence(actor, leadId, 'new-key', command),
    ).rejects.toMatchObject({ response: { code: 'VERSION_CONFLICT' } });
  });
  it.each([
    'leadProxyEvidenceConfirmation',
    'leadEvidenceDecision',
    'auditEvent',
    'leadCommandReceipt',
  ] as const)(
    'propagates late %s failure for transaction rollback',
    async (name) => {
      const { service, tx } = setup();
      tx[name].create.mockRejectedValue(new Error('injected failure'));
      await expect(
        service.confirmProxyEvidence(actor, leadId, 'key', command),
      ).rejects.toThrow('injected failure');
    },
  );
  it('does not grant the action to client account and denies cross-scope', async () => {
    const fixture = setup();
    fixture.tx.userAccount.findUnique.mockResolvedValue({
      displayName: '客户',
      accountType: 'CLIENT',
      active: true,
    });
    await expect(
      fixture.service.confirmProxyEvidence(actor, leadId, 'key', command),
    ).rejects.toMatchObject({ response: { code: 'ACTION_FORBIDDEN' } });
    expect(fixture.tx.lead.updateMany).not.toHaveBeenCalled();
    const hidden = setup();
    hidden.tx.$queryRawUnsafe.mockResolvedValue([]);
    await expect(
      hidden.service.confirmProxyEvidence(actor, leadId, 'key', command),
    ).rejects.toMatchObject({ response: { code: 'RESOURCE_NOT_FOUND' } });
  });
});
