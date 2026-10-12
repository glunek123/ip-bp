import { ForbiddenException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { CaseExecutionFilingService } from './case-execution-filing.service';

const actor = {
  userId: '11111111-1111-4111-8111-111111111111',
  departmentId: '22222222-2222-4222-8222-222222222222',
  authorizationRevision: 1,
};
const caseId = '33333333-3333-4333-8333-333333333333';
const choiceId = '44444444-4444-4444-8444-444444444444';
const roundId = '55555555-5555-4555-8555-555555555555';
const submissionId = '66666666-6666-4666-8666-666666666666';
const confirmationId = '77777777-7777-4777-8777-777777777777';
const mailingId = '88888888-8888-4888-8888-888888888888';
const fileId = '99999999-9999-4999-8999-999999999999';
const input = {
  expectedVersion: 23,
  idempotencyKey: 'execution-filing',
  expectedMailingId: mailingId,
  submittedAt: '2026-10-01',
  executionFilingProofContentVersionIds: [fileId],
};

describe('CaseExecutionFilingService', () => {
  function fixture() {
    const record = {
      departmentId: actor.departmentId,
      responsibleUserId: actor.userId,
      responsibleMembership: { teamId: null },
      stage: 'WAITING_EXECUTION_FILING',
      version: 23,
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
      },
      executionConfirmation: { id: confirmationId, submissionId },
      executionMailing: { id: mailingId, confirmationId, toVersion: 23 },
      executionFiling: null,
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
      caseExecutionFilingReceipt: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
      },
      caseExecutionFiling: { create: jest.fn().mockResolvedValue({}) },
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
      freezeCaseExecutionFilingReferences: jest
        .fn()
        .mockResolvedValue(undefined),
    };
    const service = new CaseExecutionFilingService(
      database as never,
      access as never,
      materials as never,
    );
    return { record, tx, database, access, materials, service };
  }

  it('anchors the current mailing, freezes exact proof versions and advances once', async () => {
    const f = fixture();
    await expect(f.service.submit(actor, caseId, input)).resolves.toMatchObject(
      { mailingId, stage: 'EXECUTING', version: 24 },
    );
    expect(f.access.authorizeCase).toHaveBeenCalledWith(
      actor,
      'case.execution.filing.submit',
      expect.anything(),
      f.tx,
    );
    expect(f.tx.caseExecutionFiling.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        mailingId,
        fromVersion: 23,
        toVersion: 24,
      }),
    });
    expect(f.materials.assertAvailableVersions).toHaveBeenCalledWith(
      f.tx,
      actor,
      expect.objectContaining({
        category: 'EXECUTION_FILING_PROOF',
        contentVersionIds: [fileId],
      }),
    );
    expect(
      f.materials.freezeCaseExecutionFilingReferences,
    ).toHaveBeenCalledTimes(1);
    expect(f.tx.caseExecutionFilingReceipt.create).toHaveBeenCalledTimes(1);
    expect(f.database.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
    });
  });

  it('rejects a stale mailing anchor before writing', async () => {
    const f = fixture();
    f.record.executionMailing.id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    await expect(f.service.submit(actor, caseId, input)).rejects.toMatchObject({
      response: { code: 'INVALID_STATE' },
    });
    expect(f.tx.auditEvent.create).not.toHaveBeenCalled();
  });

  it('denies a client before a transaction', async () => {
    const f = fixture();
    await expect(
      f.service.submit({ ...actor, clientCustomerId: 'client' }, caseId, input),
    ).rejects.toMatchObject({ response: { code: 'ACTION_FORBIDDEN' } });
    expect(f.database.$transaction).not.toHaveBeenCalled();
  });

  it('rejects a former lawyer before reading a replay receipt', async () => {
    const f = fixture();
    f.tx.userAccount.findUnique.mockResolvedValue({
      active: true,
      accountType: 'LAWYER',
    });
    f.tx.$queryRawUnsafe.mockImplementation((sql: string) =>
      Promise.resolve(
        sql.includes('lawyer_account_bindings') ? [] : [{ id: caseId }],
      ),
    );
    f.tx.caseExecutionFilingReceipt.findUnique.mockResolvedValue({
      caseId,
      requestFingerprint: 'old',
      resultSnapshot: {},
    });
    await expect(
      f.service.submit(
        { ...actor, lawyerAccountId: actor.userId },
        caseId,
        input,
      ),
    ).rejects.toMatchObject({ response: { code: 'ACTION_FORBIDDEN' } });
    expect(f.tx.caseExecutionFilingReceipt.findUnique).not.toHaveBeenCalled();
  });

  it('rejects malformed, future and duplicate-version requests', async () => {
    const f = fixture();
    for (const invalid of [
      { ...input, submittedAt: '2026-02-30' },
      { ...input, submittedAt: '2999-01-01' },
      { ...input, executionFilingProofContentVersionIds: [fileId, fileId] },
    ])
      await expect(
        f.service.submit(actor, caseId, invalid),
      ).rejects.toMatchObject({ response: { code: 'VALIDATION_ERROR' } });
    expect(f.database.$transaction).not.toHaveBeenCalled();
  });

  it('propagates a freezing failure so the transaction can roll back', async () => {
    const f = fixture();
    f.materials.freezeCaseExecutionFilingReferences.mockRejectedValue(
      new Error('freeze failed'),
    );
    await expect(f.service.submit(actor, caseId, input)).rejects.toThrow(
      'freeze failed',
    );
    expect(f.tx.caseExecutionFilingReceipt.create).not.toHaveBeenCalled();
  });

  it('rechecks authorization before an idempotent replay', async () => {
    const f = fixture();
    f.access.authorizeCase.mockRejectedValue(new ForbiddenException());
    f.tx.caseExecutionFilingReceipt.findUnique.mockResolvedValue({
      caseId,
      requestFingerprint: 'old',
      resultSnapshot: {},
    });
    await expect(f.service.submit(actor, caseId, input)).rejects.toMatchObject({
      response: { code: 'ACTION_FORBIDDEN' },
    });
    expect(f.tx.caseExecutionFilingReceipt.findUnique).not.toHaveBeenCalled();
  });

  it('rejects same-key different-body reuse after authorization', async () => {
    const f = fixture();
    f.tx.caseExecutionFilingReceipt.findUnique.mockResolvedValue({
      caseId,
      requestFingerprint: 'different',
      resultSnapshot: {},
    });
    await expect(f.service.submit(actor, caseId, input)).rejects.toMatchObject({
      response: { code: 'IDEMPOTENCY_CONFLICT' },
    });
    expect(f.access.authorizeCase).toHaveBeenCalledTimes(1);
    expect(f.tx.auditEvent.create).not.toHaveBeenCalled();
  });

  it('returns an authorized matching receipt without another write', async () => {
    const f = fixture();
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify({
          caseId,
          expectedVersion: input.expectedVersion,
          expectedMailingId: input.expectedMailingId,
          submittedAt: input.submittedAt,
          executionFilingProofContentVersionIds:
            input.executionFilingProofContentVersionIds,
        }),
      )
      .digest('hex');
    const result = {
      id: caseId,
      filingId: fileId,
      mailingId,
      stage: 'EXECUTING',
      version: 24,
      submittedAt: input.submittedAt,
      recordedAt: '2026-10-01T00:00:00.000Z',
    };
    f.tx.caseExecutionFilingReceipt.findUnique.mockResolvedValue({
      caseId,
      requestFingerprint: fingerprint,
      resultSnapshot: result,
    });
    await expect(f.service.submit(actor, caseId, input)).resolves.toEqual(
      result,
    );
    expect(f.tx.auditEvent.create).not.toHaveBeenCalled();
  });

  it('retries a competing receipt-key insert and replays its committed result', async () => {
    const f = fixture();
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify({
          caseId,
          expectedVersion: input.expectedVersion,
          expectedMailingId: input.expectedMailingId,
          submittedAt: input.submittedAt,
          executionFilingProofContentVersionIds:
            input.executionFilingProofContentVersionIds,
        }),
      )
      .digest('hex');
    const result = {
      id: caseId,
      filingId: fileId,
      mailingId,
      stage: 'EXECUTING',
      version: 24,
      submittedAt: input.submittedAt,
      recordedAt: '2026-10-01T00:00:00.000Z',
    };
    f.database.$transaction.mockRejectedValueOnce({
      code: 'P2002',
      meta: { target: ['department_id', 'actor_user_id', 'idempotency_key'] },
    });
    f.tx.caseExecutionFilingReceipt.findUnique.mockResolvedValue({
      caseId,
      requestFingerprint: fingerprint,
      resultSnapshot: result,
    });
    await expect(f.service.submit(actor, caseId, input)).resolves.toEqual(
      result,
    );
    expect(f.database.$transaction).toHaveBeenCalledTimes(2);
    expect(f.access.authorizeCase).toHaveBeenCalledTimes(1);
    expect(f.tx.auditEvent.create).not.toHaveBeenCalled();
  });
});
