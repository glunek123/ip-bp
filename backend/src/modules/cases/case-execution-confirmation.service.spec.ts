import { CaseExecutionConfirmationService } from './case-execution-confirmation.service';

const actor = {
  userId: '11111111-1111-4111-8111-111111111111',
  departmentId: '22222222-2222-4222-8222-222222222222',
  authorizationRevision: 1,
};
const caseId = '33333333-3333-4333-8333-333333333333';
const roundId = '44444444-4444-4444-8444-444444444444';
const choiceId = '55555555-5555-4555-8555-555555555555';
const submissionId = '66666666-6666-4666-8666-666666666666';
const fileId = '77777777-7777-4777-8777-777777777777';
const secondResultId = '88888888-8888-4888-8888-888888888888';
const input = {
  expectedVersion: 21,
  idempotencyKey: 'confirm-1',
  expectedSubmissionId: submissionId,
};

describe('CaseExecutionConfirmationService', () => {
  function fixture() {
    const record = {
      departmentId: actor.departmentId,
      responsibleUserId: actor.userId,
      responsibleMembership: { teamId: null },
      stage: 'WAITING_EXECUTION_CONFIRMATION',
      version: 21,
      currentTrialRoundId: roundId,
      currentJudgmentNextStepId: choiceId,
      currentJudgmentNextStep: {
        id: choiceId,
        trialRoundId: roundId,
        next: 'EXECUTION',
        revocation: null,
      },
      currentSecondInstanceResultId: null,
      currentSecondInstanceResult: null,
      currentExecutionSubmissionId: submissionId,
      currentExecutionSubmission: {
        id: submissionId,
        trialRoundId: roundId,
        judgmentNextStepId: choiceId,
        secondInstanceResultId: null,
        toVersion: 21,
        versions: [{ contentVersionId: fileId }],
      },
      executionConfirmation: null,
    };
    const tx = {
      $queryRawUnsafe: jest.fn().mockResolvedValue([{ id: caseId }]),
      case: {
        findFirst: jest.fn().mockResolvedValue(record),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      userAccount: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ active: true, accountType: 'INTERNAL' }),
      },
      caseExecutionConfirmationReceipt: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
      },
      caseExecutionConfirmation: { create: jest.fn().mockResolvedValue({}) },
      auditEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    const database = {
      $transaction: jest.fn(async (fn: (client: typeof tx) => unknown) =>
        fn(tx),
      ),
    };
    const access = { authorizeCase: jest.fn().mockResolvedValue(undefined) };
    const materials = {
      assertAvailableVersions: jest
        .fn()
        .mockResolvedValue([{ contentVersionId: fileId }]),
    };
    return {
      record,
      tx,
      database,
      access,
      materials,
      service: new CaseExecutionConfirmationService(
        database as never,
        access as never,
        materials as never,
      ),
    };
  }

  it('confirms precisely the current submission and advances the case once', async () => {
    const f = fixture();
    const result = await f.service.confirm(actor, caseId, input);
    expect(result).toMatchObject({
      id: caseId,
      submissionId,
      stage: 'WAITING_EXECUTION_STAMP',
      version: 22,
    });
    expect(f.access.authorizeCase).toHaveBeenCalledWith(
      actor,
      'case.execution.confirm',
      expect.any(Object),
      f.tx,
    );
    expect(f.materials.assertAvailableVersions).toHaveBeenCalledWith(
      f.tx,
      actor,
      {
        ownerType: 'CASE',
        ownerId: caseId,
        category: 'EXECUTION_APPLICATION',
        contentVersionIds: [fileId],
        minCount: 1,
        maxCount: 10,
      },
    );
    expect(f.tx.case.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          currentExecutionSubmissionId: submissionId,
          version: 21,
        }),
        data: { stage: 'WAITING_EXECUTION_STAMP', version: { increment: 1 } },
      }),
    );
    expect(f.tx.caseExecutionConfirmation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: result.confirmationId,
        submissionId,
        fromVersion: 21,
        toVersion: 22,
      }),
    });
    expect(f.tx.caseExecutionConfirmationReceipt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        resultSnapshot: result,
      }),
    });
  });

  it('rejects a stale submission pointer without creating a fact', async () => {
    const f = fixture();
    await expect(
      f.service.confirm(actor, caseId, {
        ...input,
        expectedSubmissionId: caseId,
      }),
    ).rejects.toMatchObject({ response: { code: 'INVALID_STATE' } });
    expect(f.tx.caseExecutionConfirmation.create).not.toHaveBeenCalled();
  });

  it('accepts an unrevoked appeal CHANGE source and rejects a revoked source', async () => {
    const f = fixture();
    f.record.currentJudgmentNextStep.next = 'APPEAL';
    f.record.currentSecondInstanceResultId = secondResultId as never;
    f.record.currentExecutionSubmission.secondInstanceResultId =
      secondResultId as never;
    f.record.currentSecondInstanceResult = {
      id: secondResultId,
      trialRoundId: roundId,
      choiceId,
      result: 'CHANGE',
      revocation: null,
    } as never;
    await expect(
      f.service.confirm(actor, caseId, input),
    ).resolves.toMatchObject({ stage: 'WAITING_EXECUTION_STAMP' });
    f.record.currentSecondInstanceResult = {
      id: secondResultId,
      trialRoundId: roundId,
      choiceId,
      result: 'CHANGE',
      revocation: { id: 'revoked' },
    } as never;
    await expect(f.service.confirm(actor, caseId, input)).rejects.toMatchObject(
      { response: { code: 'INVALID_STATE' } },
    );
  });

  it('rechecks permission before returning a prior receipt', async () => {
    const f = fixture();
    f.access.authorizeCase.mockRejectedValue(new Error('revoked'));
    f.tx.caseExecutionConfirmationReceipt.findUnique.mockResolvedValue({
      caseId,
      requestFingerprint: 'unused',
    });
    await expect(f.service.confirm(actor, caseId, input)).rejects.toThrow(
      'revoked',
    );
    expect(
      f.tx.caseExecutionConfirmationReceipt.findUnique,
    ).not.toHaveBeenCalled();
  });

  it('rejects extra client-selected versions and unavailable frozen versions', async () => {
    const f = fixture();
    await expect(
      f.service.confirm(actor, caseId, {
        ...input,
        executionApplicationContentVersionIds: [fileId],
      } as never),
    ).rejects.toMatchObject({ response: { code: 'VALIDATION_ERROR' } });
    f.materials.assertAvailableVersions.mockRejectedValue(
      new Error('unavailable'),
    );
    await expect(f.service.confirm(actor, caseId, input)).rejects.toThrow(
      'unavailable',
    );
    expect(f.tx.caseExecutionConfirmation.create).not.toHaveBeenCalled();
  });
});
