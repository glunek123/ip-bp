import { ForbiddenException } from '@nestjs/common';
import { CaseJudgmentService } from './case-judgment.service';
import { readCaseSourceAnchor } from './case-entry-source';

jest.mock('./case-entry-source', () => ({
  ...jest.requireActual('./case-entry-source'),
  readCaseSourceAnchor: jest.fn().mockResolvedValue({ kind: 'NORMAL' }),
}));

const actor = {
  userId: '11111111-1111-4111-8111-111111111111',
  departmentId: '22222222-2222-4222-8222-222222222222',
  authorizationRevision: 1,
};
const caseId = '33333333-3333-4333-8333-333333333333';
const versionId = '44444444-4444-4444-8444-444444444444';
const priorId = '55555555-5555-4555-8555-555555555555';
const entryId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const input = {
  expectedVersion: 9,
  idempotencyKey: 'judgment-1',
  judgmentReceivedAt: '2026-10-08',
  judgmentAmountState: 'KNOWN' as const,
  judgmentAmount: '0',
  paidLitigationFeeState: 'PENDING' as const,
  paidLitigationFee: null,
  judgmentContentVersionIds: [versionId],
};

describe('CaseJudgmentService', () => {
  function fixture() {
    const tx = {
      $queryRawUnsafe: jest.fn().mockResolvedValue([{ id: caseId }]),
      case: {
        findFirst: jest.fn().mockResolvedValue({
          id: caseId,
          departmentId: actor.departmentId,
          stage: 'WAITING_JUDGMENT',
          currentTrialRoundId: '99999999-9999-4999-8999-999999999999',
          version: 9,
          responsibleUserId: actor.userId,
          responsibleMembership: { teamId: null },
          acceptance: {
            acceptedAt: new Date('2026-10-01T00:00:00.000Z'),
            corrections: [],
          },
          currentJudgmentId: null,
          currentJudgmentNextStepId: null,
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      userAccount: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ accountType: 'INTERNAL', active: true }),
      },
      caseJudgmentReceipt: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
      },
      caseJudgmentFact: {
        create: jest.fn().mockResolvedValue({ id: priorId }),
      },
      auditEvent: {
        create: jest
          .fn()
          .mockResolvedValue({ id: '66666666-6666-4666-8666-666666666666' }),
      },
    };
    const database = {
      $transaction: jest.fn(async (fn: (client: typeof tx) => unknown) =>
        fn(tx),
      ),
    };
    const access = { authorizeCase: jest.fn().mockResolvedValue(undefined) };
    const materials = {
      assertAvailableVersions: jest.fn().mockResolvedValue([{}]),
      freezeCaseJudgmentReferences: jest.fn().mockResolvedValue(undefined),
    };
    return {
      tx,
      database,
      access,
      materials,
      service: new CaseJudgmentService(
        database as never,
        access as never,
        materials as never,
      ),
    };
  }

  it('registers one immutable judgment, exact file, audit and receipt while keeping waiting-judgment', async () => {
    const f = fixture();
    const result = await f.service.register(actor, caseId, input);
    expect(result).toMatchObject({
      id: caseId,
      stage: 'WAITING_JUDGMENT',
      version: 10,
      judgmentId: expect.any(String),
    });
    expect(f.tx.caseJudgmentFact.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          kind: 'REGISTER',
          judgmentAmount: '0.00',
          paidLitigationFee: null,
          fromVersion: 9,
          toVersion: 10,
        }),
      }),
    );
    expect(f.materials.assertAvailableVersions).toHaveBeenCalledWith(
      f.tx,
      actor,
      expect.objectContaining({
        ownerType: 'CASE',
        ownerId: caseId,
        category: 'JUDGMENT',
        minCount: 1,
        maxCount: 10,
      }),
    );
    expect(f.materials.freezeCaseJudgmentReferences).toHaveBeenCalledTimes(1);
    expect(f.tx.case.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ currentJudgmentId: result.judgmentId }),
      }),
    );
    expect(f.tx.caseJudgmentReceipt.create).toHaveBeenCalledTimes(1);
  });

  it('registers a real judgment from an external waiting-judgment root', async () => {
    const f = fixture();
    jest.mocked(readCaseSourceAnchor).mockResolvedValueOnce({
      kind: 'EXTERNAL_ENTRY',
      entryId,
      initialStage: 'WAITING_JUDGMENT',
      stageReachedOn: '2026-10-05',
      known: { acceptedOn: null },
    } as never);
    const record = await f.tx.case.findFirst();
    f.tx.case.findFirst.mockResolvedValue({
      ...record,
      acceptance: null,
      currentTrialRound: {
        origin: 'EXTERNAL_CURRENT',
        externalEntryId: entryId,
        sourceResultId: null,
        revokedAt: null,
      },
      currentHearingAdvance: null,
    });
    await f.service.register(actor, caseId, input);
    expect(f.tx.caseJudgmentFact.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          kind: 'REGISTER',
          externalEntryId: entryId,
          trialRoundId: record.currentTrialRoundId,
        }),
      }),
    );
  });

  it('rechecks authorization before reading a saved receipt', async () => {
    const f = fixture();
    f.access.authorizeCase.mockRejectedValue(new ForbiddenException());
    await expect(
      f.service.register(actor, caseId, input),
    ).rejects.toMatchObject({ response: { code: 'ACTION_FORBIDDEN' } });
    expect(f.tx.caseJudgmentReceipt.findUnique).not.toHaveBeenCalled();
  });

  it('compares judgment dates with the effective corrected acceptance date', async () => {
    const f = fixture();
    const record = await f.tx.case.findFirst();
    f.tx.case.findFirst.mockResolvedValue({
      ...record,
      acceptance: {
        acceptedAt: new Date('2026-10-01T00:00:00.000Z'),
        corrections: [{ acceptedAt: new Date('2026-10-09T00:00:00.000Z') }],
      },
    });
    await expect(
      f.service.register(actor, caseId, input),
    ).rejects.toMatchObject({ response: { code: 'VALIDATION_ERROR' } });
    expect(f.tx.caseJudgmentFact.create).not.toHaveBeenCalled();
  });

  it('returns the original immutable receipt on same-key replay', async () => {
    const f = fixture();
    const first = await f.service.register(actor, caseId, input);
    const saved = f.tx.caseJudgmentReceipt.create.mock.calls[0][0].data;
    f.tx.caseJudgmentReceipt.findUnique.mockResolvedValue({
      caseId,
      requestFingerprint: saved.requestFingerprint,
      resultSnapshot: saved.resultSnapshot,
    });
    f.tx.case.findFirst.mockResolvedValue({
      ...(await f.tx.case.findFirst()),
      version: 10,
      currentJudgmentId: first.judgmentId,
    });
    expect(await f.service.register(actor, caseId, input)).toEqual(first);
    expect(f.tx.caseJudgmentFact.create).toHaveBeenCalledTimes(1);
  });

  it('appends a correction with the prior fact and leaves prior frozen files intact', async () => {
    const f = fixture();
    f.tx.case.findFirst.mockResolvedValue({
      ...(await f.tx.case.findFirst()),
      currentJudgmentId: priorId,
    });
    const result = await f.service.correct(actor, caseId, {
      ...input,
      reason: '  判决日期录入错误  ',
      judgmentAmountState: 'PENDING',
      judgmentAmount: null,
    });
    expect(result.stage).toBe('WAITING_JUDGMENT');
    expect(f.tx.caseJudgmentFact.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          kind: 'CORRECT',
          priorFactId: priorId,
          reason: '判决日期录入错误',
          judgmentAmount: null,
        }),
      }),
    );
    expect(f.tx.case.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ currentJudgmentId: result.judgmentId }),
      }),
    );
  });

  it.each([
    { judgmentAmountState: 'KNOWN', judgmentAmount: null },
    { judgmentAmountState: 'PENDING', judgmentAmount: '0' },
    { judgmentAmountState: 'KNOWN', judgmentAmount: '-1' },
    { paidLitigationFeeState: 'KNOWN', paidLitigationFee: null },
    { judgmentContentVersionIds: [] },
    { judgmentContentVersionIds: [versionId, versionId] },
    { judgmentReceivedAt: '2026-02-30' },
    { judgmentReceivedAt: '2099-01-01' },
  ])('rejects malformed judgment facts before writing: %o', async (change) => {
    const f = fixture();
    await expect(
      f.service.register(actor, caseId, { ...input, ...change } as never),
    ).rejects.toMatchObject({ response: { code: 'VALIDATION_ERROR' } });
    expect(f.tx.caseJudgmentFact.create).not.toHaveBeenCalled();
  });

  it('rejects stale version without making a fact', async () => {
    const f = fixture();
    await expect(
      f.service.register(actor, caseId, { ...input, expectedVersion: 8 }),
    ).rejects.toMatchObject({ response: { code: 'VERSION_CONFLICT' } });
    expect(f.tx.caseJudgmentFact.create).not.toHaveBeenCalled();
  });

  it('does not keep partial success if receipt creation fails', async () => {
    const f = fixture();
    f.tx.caseJudgmentReceipt.create.mockRejectedValue(
      new Error('receipt failure'),
    );
    await expect(f.service.register(actor, caseId, input)).rejects.toThrow(
      'receipt failure',
    );
  });
});
