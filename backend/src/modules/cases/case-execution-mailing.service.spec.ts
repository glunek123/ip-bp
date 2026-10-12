import { ForbiddenException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { CaseExecutionMailingService } from './case-execution-mailing.service';

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
const fileId = '88888888-8888-4888-8888-888888888888';
const input = {
  expectedVersion: 22,
  idempotencyKey: 'execution-mail',
  expectedConfirmationId: confirmationId,
  mailedAt: '2026-10-01',
  mailReceiptContentVersionIds: [fileId],
};

describe('CaseExecutionMailingService', () => {
  function fixture() {
    const record = {
      customerId: '99999999-9999-4999-8999-999999999999',
      departmentId: actor.departmentId,
      responsibleUserId: actor.userId,
      responsibleMembership: { teamId: null },
      stage: 'WAITING_EXECUTION_STAMP',
      version: 22,
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
      },
      executionConfirmation: {
        id: confirmationId,
        submissionId,
        toVersion: 22,
      },
      executionMailing: null,
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
      customerAccountBinding: {
        findFirst: jest.fn().mockResolvedValue({ id: 'binding' }),
      },
      caseExecutionMailingReceipt: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
      },
      caseExecutionMailing: { create: jest.fn().mockResolvedValue({}) },
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
      freezeCaseExecutionMailingReferences: jest
        .fn()
        .mockResolvedValue(undefined),
    };
    const service = new CaseExecutionMailingService(
      database as never,
      access as never,
      materials as never,
    );
    return { record, tx, database, access, materials, service };
  }

  it('anchors the current confirmation, freezes exact receipt versions and advances once', async () => {
    const f = fixture();
    await expect(f.service.mail(actor, caseId, input)).resolves.toMatchObject({
      confirmationId,
      stage: 'WAITING_EXECUTION_FILING',
      version: 23,
    });
    expect(f.access.authorizeCase).toHaveBeenCalledWith(
      actor,
      'case.execution.mail',
      expect.anything(),
      f.tx,
    );
    expect(f.tx.caseExecutionMailing.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        confirmationId,
        fromVersion: 22,
        toVersion: 23,
      }),
    });
    expect(f.materials.assertAvailableVersions).toHaveBeenCalledWith(
      f.tx,
      actor,
      expect.objectContaining({
        category: 'MAIL_RECEIPT',
        contentVersionIds: [fileId],
      }),
    );
    expect(
      f.materials.freezeCaseExecutionMailingReferences,
    ).toHaveBeenCalledTimes(1);
    expect(f.tx.caseExecutionMailingReceipt.create).toHaveBeenCalledTimes(1);
    expect(f.database.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
    });
  });

  it('records a current client binding and no internal actor for a customer mailing', async () => {
    const f = fixture();
    const client = { ...actor, clientCustomerId: f.record.customerId };
    await f.service.mail(client, caseId, input);
    expect(f.tx.customerAccountBinding.findFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({
        userId: actor.userId,
        customerId: f.record.customerId,
        departmentId: actor.departmentId,
        active: true,
      }),
      select: { id: true },
    });
    expect(f.tx.caseExecutionMailing.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorType: 'CLIENT',
        customerAccountBindingId: 'binding',
      }),
    });
    expect(f.access.authorizeCase).not.toHaveBeenCalled();
  });

  it('checks the current primary lawyer binding under a lock', async () => {
    const f = fixture();
    const bindingId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    f.tx.userAccount.findUnique.mockResolvedValue({
      active: true,
      accountType: 'LAWYER',
    });
    f.tx.$queryRawUnsafe.mockImplementation((sql: string) =>
      Promise.resolve([
        { id: sql.includes('lawyer_account_bindings') ? bindingId : caseId },
      ]),
    );
    await f.service.mail(
      { ...actor, lawyerAccountId: actor.userId },
      caseId,
      input,
    );
    expect(f.tx.caseExecutionMailing.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorType: 'LAWYER',
        lawyerAccountBindingId: bindingId,
      }),
    });
    expect(f.access.authorizeCase).not.toHaveBeenCalled();
  });

  it('rejects a revoked source before writing', async () => {
    const f = fixture();
    f.record.currentJudgmentNextStep.revocation = { id: 'revoked' } as never;
    await expect(f.service.mail(actor, caseId, input)).rejects.toMatchObject({
      response: { code: 'INVALID_STATE' },
    });
    expect(f.tx.auditEvent.create).not.toHaveBeenCalled();
  });

  it('rechecks authorization before returning an existing receipt', async () => {
    const f = fixture();
    f.access.authorizeCase.mockRejectedValue(new ForbiddenException());
    f.tx.caseExecutionMailingReceipt.findUnique.mockResolvedValue({
      caseId,
      requestFingerprint: 'old',
      resultSnapshot: {},
    });
    await expect(f.service.mail(actor, caseId, input)).rejects.toMatchObject({
      response: { code: 'ACTION_FORBIDDEN' },
    });
    expect(f.tx.caseExecutionMailingReceipt.findUnique).not.toHaveBeenCalled();
  });

  it('rejects malformed, future and duplicate-version requests without a transaction', async () => {
    const f = fixture();
    for (const invalid of [
      { ...input, mailedAt: '2026-02-30' },
      { ...input, mailedAt: '2999-01-01' },
      { ...input, mailReceiptContentVersionIds: [fileId, fileId] },
    ])
      await expect(
        f.service.mail(actor, caseId, invalid),
      ).rejects.toMatchObject({ response: { code: 'VALIDATION_ERROR' } });
    expect(f.database.$transaction).not.toHaveBeenCalled();
  });

  it('propagates receipt failure so the transaction can roll back', async () => {
    const f = fixture();
    f.tx.caseExecutionMailingReceipt.create.mockRejectedValue(
      new Error('receipt failed'),
    );
    await expect(f.service.mail(actor, caseId, input)).rejects.toThrow(
      'receipt failed',
    );
    expect(
      f.materials.freezeCaseExecutionMailingReferences,
    ).toHaveBeenCalledTimes(1);
  });

  it('rejects same-key different-body reuse after authorization', async () => {
    const f = fixture();
    f.tx.caseExecutionMailingReceipt.findUnique.mockResolvedValue({
      caseId,
      requestFingerprint: 'different',
      resultSnapshot: {},
    });
    await expect(f.service.mail(actor, caseId, input)).rejects.toMatchObject({
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
          expectedConfirmationId: input.expectedConfirmationId,
          mailedAt: input.mailedAt,
          mailReceiptContentVersionIds: input.mailReceiptContentVersionIds,
        }),
      )
      .digest('hex');
    const result = {
      id: caseId,
      mailingId: fileId,
      confirmationId,
      stage: 'WAITING_EXECUTION_FILING',
      version: 23,
      mailedAt: input.mailedAt,
      recordedAt: '2026-10-01T00:00:00.000Z',
    };
    f.tx.caseExecutionMailingReceipt.findUnique.mockResolvedValue({
      caseId,
      requestFingerprint: fingerprint,
      resultSnapshot: result,
    });
    await expect(f.service.mail(actor, caseId, input)).resolves.toEqual(result);
    expect(f.tx.auditEvent.create).not.toHaveBeenCalled();
  });

  it('retries a competing receipt-key insert and replays its committed result', async () => {
    const f = fixture();
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify({
          caseId,
          expectedVersion: input.expectedVersion,
          expectedConfirmationId: input.expectedConfirmationId,
          mailedAt: input.mailedAt,
          mailReceiptContentVersionIds: input.mailReceiptContentVersionIds,
        }),
      )
      .digest('hex');
    const result = {
      id: caseId,
      mailingId: fileId,
      confirmationId,
      stage: 'WAITING_EXECUTION_FILING',
      version: 23,
      mailedAt: input.mailedAt,
      recordedAt: '2026-10-01T00:00:00.000Z',
    };
    f.database.$transaction.mockRejectedValueOnce({
      code: 'P2002',
      meta: { target: ['department_id', 'actor_user_id', 'idempotency_key'] },
    });
    f.tx.caseExecutionMailingReceipt.findUnique.mockResolvedValue({
      caseId,
      requestFingerprint: fingerprint,
      resultSnapshot: result,
    });
    await expect(f.service.mail(actor, caseId, input)).resolves.toEqual(result);
    expect(f.database.$transaction).toHaveBeenCalledTimes(2);
    expect(f.access.authorizeCase).toHaveBeenCalledTimes(1);
    expect(f.tx.auditEvent.create).not.toHaveBeenCalled();
  });
});
