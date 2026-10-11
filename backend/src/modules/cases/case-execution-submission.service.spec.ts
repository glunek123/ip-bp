import { CaseExecutionSubmissionService } from './case-execution-submission.service';

const actor = {
  userId: '11111111-1111-4111-8111-111111111111',
  departmentId: '22222222-2222-4222-8222-222222222222',
  authorizationRevision: 1,
};
const caseId = '33333333-3333-4333-8333-333333333333';
const trialRoundId = '44444444-4444-4444-8444-444444444444';
const choiceId = '55555555-5555-4555-8555-555555555555';
const fileId = '66666666-6666-4666-8666-666666666666';
const priorId = '77777777-7777-4777-8777-777777777777';

describe('CaseExecutionSubmissionService', () => {
  function fixture() {
    const record = {
      id: caseId,
      departmentId: actor.departmentId,
      stage: 'WAITING_EXECUTION_DOCUMENTS',
      version: 20,
      currentTrialRoundId: trialRoundId,
      currentJudgmentNextStepId: choiceId,
      currentJudgmentNextStep: {
        id: choiceId,
        trialRoundId,
        next: 'EXECUTION',
        revocation: null,
      },
      currentSecondInstanceResultId: null,
      currentSecondInstanceResult: null,
      currentExecutionSubmissionId: null as string | null,
      currentExecutionSubmission: null as null | {
        id: string;
        versions: { contentVersionId: string }[];
      },
      responsibleUserId: actor.userId,
      responsibleMembership: { teamId: null },
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
      caseExecutionSubmissionReceipt: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
      },
      caseExecutionSubmission: { create: jest.fn().mockResolvedValue({}) },
      auditEvent: { create: jest.fn().mockResolvedValue({ id: priorId }) },
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
      freezeCaseExecutionSubmissionReferences: jest
        .fn()
        .mockResolvedValue(undefined),
    };
    return {
      record,
      tx,
      database,
      access,
      materials,
      service: new CaseExecutionSubmissionService(
        database as never,
        access as never,
        materials as never,
      ),
    };
  }

  const input = () => ({
    expectedVersion: 20,
    idempotencyKey: 'execution-submit-1',
    trialRoundId,
    judgmentNextStepId: choiceId,
    secondInstanceResultId: null,
    expectedSubmissionId: null,
    executionApplicationContentVersionIds: [fileId],
  });

  it('creates one direct execution submission and advances exactly one version', async () => {
    const f = fixture();
    const result = await f.service.submit(actor, caseId, input());
    expect(result).toMatchObject({
      id: caseId,
      stage: 'WAITING_EXECUTION_CONFIRMATION',
      version: 21,
      submissionId: expect.any(String),
    });
    expect(f.access.authorizeCase).toHaveBeenCalledWith(
      actor,
      'case.execution.submit',
      expect.any(Object),
      f.tx,
    );
    expect(
      f.materials.freezeCaseExecutionSubmissionReferences,
    ).toHaveBeenCalledTimes(1);
    expect(f.tx.case.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          stage: 'WAITING_EXECUTION_CONFIRMATION',
          version: { increment: 1 },
          currentExecutionSubmissionId: result.submissionId,
        },
      }),
    );
  });

  it('rejects the same file set on resubmission before creating history', async () => {
    const f = fixture();
    f.record.stage = 'WAITING_EXECUTION_CONFIRMATION';
    f.record.currentExecutionSubmissionId = priorId;
    f.record.currentExecutionSubmission = {
      id: priorId,
      versions: [{ contentVersionId: fileId }],
    };
    await expect(
      f.service.submit(actor, caseId, {
        ...input(),
        expectedSubmissionId: priorId,
        changeReason: '更正版本',
      }),
    ).rejects.toMatchObject({ response: { code: 'INVALID_STATE' } });
    expect(f.tx.caseExecutionSubmission.create).not.toHaveBeenCalled();
  });

  it('rechecks authorization before replaying the original result', async () => {
    const f = fixture();
    f.access.authorizeCase.mockRejectedValue(new Error('revoked'));
    await expect(f.service.submit(actor, caseId, input())).rejects.toThrow(
      'revoked',
    );
    expect(
      f.tx.caseExecutionSubmissionReceipt.findUnique,
    ).not.toHaveBeenCalled();
  });
});
