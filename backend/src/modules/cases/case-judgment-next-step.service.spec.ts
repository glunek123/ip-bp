import { ForbiddenException } from '@nestjs/common';
import { CaseJudgmentNextStepService } from './case-judgment-next-step.service';

const actor = {
  userId: '11111111-1111-4111-8111-111111111111',
  departmentId: '22222222-2222-4222-8222-222222222222',
  authorizationRevision: 1,
};
const caseId = '33333333-3333-4333-8333-333333333333';
const judgmentId = '44444444-4444-4444-8444-444444444444';
const defendantId = '55555555-5555-4555-8555-555555555555';

describe('CaseJudgmentNextStepService', () => {
  function fixture() {
    const record = {
      id: caseId,
      departmentId: actor.departmentId,
      stage: 'WAITING_JUDGMENT',
      version: 10,
      currentJudgmentId: judgmentId,
      currentJudgmentNextStepId: null,
      rightsHolderId: '66666666-6666-4666-8666-666666666666',
      rightsHolder: { name: '权利主体' },
      responsibleUserId: actor.userId,
      responsibleMembership: { teamId: null },
      defendants: [{ id: defendantId, name: '被告甲' }],
    };
    const tx = {
      $queryRawUnsafe: jest.fn().mockResolvedValue([{ id: caseId }]),
      case: {
        findFirst: jest.fn().mockResolvedValue(record),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      userAccount: {
        findUnique: jest.fn().mockResolvedValue({ active: true, accountType: 'INTERNAL' }),
      },
      caseJudgmentNextStepReceipt: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
      },
      caseJudgmentNextStep: { create: jest.fn().mockResolvedValue({}) },
      caseJudgmentAppealDefendant: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
      caseJudgmentNextStepRevocation: { create: jest.fn().mockResolvedValue({}) },
      auditEvent: { create: jest.fn().mockResolvedValue({ id: '77777777-7777-4777-8777-777777777777' }) },
    };
    const database = { $transaction: jest.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)) };
    const access = { authorizeCase: jest.fn().mockResolvedValue(undefined) };
    return { tx, database, access, record, service: new CaseJudgmentNextStepService(database as never, access as never) };
  }

  it('rejects a choice when there is no registered judgment', async () => {
    const f = fixture();
    f.tx.case.findFirst.mockResolvedValue({ ...f.record, currentJudgmentId: null });
    await expect(f.service.choose(actor, caseId, {
      expectedVersion: 10, idempotencyKey: 'choice-1', judgmentId,
      next: 'EXECUTION', executionReadinessConfirmed: true,
    })).rejects.toMatchObject({ response: { code: 'INVALID_STATE' } });
    expect(f.tx.caseJudgmentNextStep.create).not.toHaveBeenCalled();
  });

  it('requires an explicit execution readiness confirmation', async () => {
    const f = fixture();
    await expect(f.service.choose(actor, caseId, {
      expectedVersion: 10, idempotencyKey: 'choice-1', judgmentId,
      next: 'EXECUTION', executionReadinessConfirmed: false,
    } as never)).rejects.toMatchObject({ response: { code: 'VALIDATION_ERROR' } });
    expect(f.tx.caseJudgmentNextStep.create).not.toHaveBeenCalled();
  });

  it('rejects empty and foreign defendant appeal sets', async () => {
    const f = fixture();
    for (const defendantIds of [[], ['88888888-8888-4888-8888-888888888888']]) {
      await expect(f.service.choose(actor, caseId, {
        expectedVersion: 10, idempotencyKey: 'choice-1', judgmentId,
        next: 'APPEAL', plaintiffAppeals: false, defendantIds,
      })).rejects.toMatchObject({ response: { code: expect.stringMatching(/VALIDATION_ERROR|INVALID_STATE/) } });
    }
    expect(f.tx.caseJudgmentNextStep.create).not.toHaveBeenCalled();
  });

  it('rejects a stale judgment after current judgment changes', async () => {
    const f = fixture();
    await expect(f.service.choose(actor, caseId, {
      expectedVersion: 10, idempotencyKey: 'choice-1',
      judgmentId: '99999999-9999-4999-8999-999999999999',
      next: 'EXECUTION', executionReadinessConfirmed: true,
    })).rejects.toMatchObject({ response: { code: 'VERSION_CONFLICT' } });
  });

  it('rechecks permission before replaying an immutable receipt', async () => {
    const f = fixture();
    f.access.authorizeCase.mockRejectedValue(new ForbiddenException());
    await expect(f.service.choose(actor, caseId, {
      expectedVersion: 10, idempotencyKey: 'choice-1', judgmentId,
      next: 'EXECUTION', executionReadinessConfirmed: true,
    })).rejects.toMatchObject({ response: { code: 'ACTION_FORBIDDEN' } });
    expect(f.tx.caseJudgmentNextStepReceipt.findUnique).not.toHaveBeenCalled();
  });

  it('records both plaintiff and a selected defendant by stable identity and replays its original receipt', async () => {
    const f = fixture();
    const input = { expectedVersion: 10, idempotencyKey: 'appeal-1', judgmentId,
      next: 'APPEAL' as const, plaintiffAppeals: true, defendantIds: [defendantId] };
    const result = await f.service.choose(actor, caseId, input);
    expect(result).toMatchObject({ id: caseId, stage: 'SECOND_INSTANCE', version: 11,
      judgmentId, choiceId: expect.any(String) });
    expect(f.tx.caseJudgmentNextStep.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        judgmentId, next: 'APPEAL', plaintiffRightsHolderId: f.record.rightsHolderId,
        plaintiffName: '权利主体',
      }),
    }));
    expect(f.tx.caseJudgmentAppealDefendant.createMany).toHaveBeenCalledWith({ data: [{
      choiceId: result.choiceId, caseId, departmentId: actor.departmentId,
      defendantId, nameSnapshot: '被告甲',
    }] });
    const saved = f.tx.caseJudgmentNextStepReceipt.create.mock.calls[0][0].data;
    f.tx.caseJudgmentNextStepReceipt.findUnique.mockResolvedValue({ caseId,
      requestFingerprint: saved.requestFingerprint, resultSnapshot: saved.resultSnapshot });
    expect(await f.service.choose(actor, caseId, input)).toEqual(result);
    expect(f.tx.caseJudgmentNextStep.create).toHaveBeenCalledTimes(1);
    await expect(f.service.choose(actor, caseId, { ...input, plaintiffAppeals: false }))
      .rejects.toMatchObject({ response: { code: 'IDEMPOTENCY_CONFLICT' } });
  });

  it('revokes only the current choice under a distinct internal permission', async () => {
    const f = fixture();
    const choiceId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    f.tx.case.findFirst.mockResolvedValue({ ...f.record, stage: 'SECOND_INSTANCE',
      version: 11, currentJudgmentNextStepId: choiceId,
      currentJudgmentNextStep: { id: choiceId, judgmentId, next: 'APPEAL' } });
    const result = await f.service.revoke(actor, caseId, {
      expectedVersion: 11, idempotencyKey: 'revoke-1', choiceId, reason: '  误选  ',
    });
    expect(result).toMatchObject({ stage: 'WAITING_JUDGMENT', version: 12, choiceId,
      judgmentId, revocationId: expect.any(String) });
    expect(f.access.authorizeCase).toHaveBeenCalledWith(actor,
      'case.judgment.next_step.revoke', expect.any(Object), f.tx);
    expect(f.tx.caseJudgmentNextStepRevocation.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ reason: '误选', choiceId }),
    }));
  });
});
