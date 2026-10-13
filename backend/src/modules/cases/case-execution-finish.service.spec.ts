import { ForbiddenException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { CaseExecutionFinishService } from './case-execution-finish.service';

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
const filingId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const input = {
  expectedVersion: 24,
  idempotencyKey: 'execution-filing',
  expectedFilingId: filingId,
  finishedAt: '2026-10-01',
  reason: '已执行完毕',
  basisNote: null,
  basisContentVersionIds: [fileId],
};

describe('CaseExecutionFinishService', () => {
  it('accepts a note alone and a true past business day without inventing a filing-date cutoff', async () => {
    const f = fixture();
    const noteOnly = {
      ...input,
      finishedAt: '2020-01-01',
      basisNote: '  真实依据说明  ',
      basisContentVersionIds: [],
    };
    await expect(
      f.service.finish(actor, caseId, noteOnly),
    ).resolves.toMatchObject({ finishedAt: '2020-01-01', version: 25 });
    expect(f.materials.assertAvailableVersions).not.toHaveBeenCalled();
    expect(
      f.materials.freezeCaseExecutionFinishReferences,
    ).not.toHaveBeenCalled();
    expect(f.tx.caseExecutionFinish.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        basisNote: '  真实依据说明  ',
        reason: input.reason,
      }),
    });
  });
  it.each([
    { ...input, basisNote: null, basisContentVersionIds: [] },
    { ...input, basisNote: '' },
    { ...input, reason: '  \n ' },
    { ...input, reason: 'x'.repeat(2001) },
    { ...input, idempotencyKey: ' leading' },
    { ...input, expectedVersion: Number.MAX_SAFE_INTEGER + 1 },
    { ...input, unexpected: true },
  ])(
    'rejects missing basis or malformed input before locking: %j',
    async (invalid) => {
      const f = fixture();
      await expect(
        f.service.finish(actor, caseId, invalid),
      ).rejects.toMatchObject({ response: { code: 'VALIDATION_ERROR' } });
      expect(f.database.$transaction).not.toHaveBeenCalled();
    },
  );
  it.each([
    'expectedVersion',
    'idempotencyKey',
    'expectedFilingId',
    'finishedAt',
    'reason',
    'basisNote',
    'basisContentVersionIds',
  ])('requires explicit %s', async (key) => {
    const f = fixture();
    const invalid = Object.fromEntries(
      Object.entries(input).filter(([name]) => name !== key),
    );
    await expect(
      f.service.finish(actor, caseId, invalid as never),
    ).rejects.toMatchObject({ response: { code: 'VALIDATION_ERROR' } });
  });
  it.each(['filing', 'mailing', 'confirmation', 'submission'])(
    'rejects a broken exact %s version link',
    async (link) => {
      const f = fixture();
      if (link === 'filing') f.record.executionFiling.toVersion += 1;
      if (link === 'mailing') f.record.executionMailing.toVersion += 1;
      if (link === 'confirmation')
        f.record.executionConfirmation.toVersion += 1;
      if (link === 'submission')
        f.record.currentExecutionSubmission.toVersion += 1;
      await expect(
        f.service.finish(actor, caseId, input),
      ).rejects.toMatchObject({ response: { code: 'INVALID_STATE' } });
      expect(f.tx.auditEvent.create).not.toHaveBeenCalled();
    },
  );
  it('uses the current primary lawyer path for both first submit and replay authorization', async () => {
    const f = fixture();
    f.tx.userAccount.findUnique.mockResolvedValue({
      active: true,
      accountType: 'LAWYER',
    });
    await expect(
      f.service.finish(
        { ...actor, lawyerAccountId: actor.userId },
        caseId,
        input,
      ),
    ).resolves.toMatchObject({ stage: 'WAITING_ARCHIVE' });
    expect(f.access.authorizeCase).not.toHaveBeenCalled();
    expect(f.tx.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        lawyerAccountBindingId: caseId,
        actorUserId: actor.userId,
      }),
    });
  });
  it('propagates audit, fact and receipt failures to the complete transaction', async () => {
    for (const target of ['audit', 'fact', 'receipt']) {
      const f = fixture();
      const failure = new Error(target);
      if (target === 'audit') f.tx.auditEvent.create.mockRejectedValue(failure);
      if (target === 'fact')
        f.tx.caseExecutionFinish.create.mockRejectedValue(failure);
      if (target === 'receipt')
        f.tx.caseExecutionFinishReceipt.create.mockRejectedValue(failure);
      await expect(f.service.finish(actor, caseId, input)).rejects.toThrow(
        target,
      );
      expect(f.database.$transaction).toHaveBeenCalledTimes(1);
    }
  });
  it('retries serialization failures, but never treats an unrelated unique conflict as success', async () => {
    const f = fixture();
    f.database.$transaction.mockRejectedValueOnce({ code: 'P2034' });
    await expect(f.service.finish(actor, caseId, input)).resolves.toMatchObject(
      { version: 25 },
    );
    expect(f.database.$transaction).toHaveBeenCalledTimes(2);
    const conflict = fixture();
    conflict.database.$transaction.mockRejectedValue({
      code: 'P2002',
      meta: { target: ['filing_id'] },
    });
    await expect(
      conflict.service.finish(actor, caseId, input),
    ).rejects.toMatchObject({ response: { code: 'VERSION_CONFLICT' } });
    expect(conflict.database.$transaction).toHaveBeenCalledTimes(1);
  });
  it('fails a stale CAS without freezing or recording a success receipt', async () => {
    const f = fixture();
    f.tx.case.updateMany.mockResolvedValue({ count: 0 });
    await expect(f.service.finish(actor, caseId, input)).rejects.toMatchObject({
      response: { code: 'VERSION_CONFLICT' },
    });
    expect(
      f.materials.freezeCaseExecutionFinishReferences,
    ).not.toHaveBeenCalled();
    expect(f.tx.caseExecutionFinishReceipt.create).not.toHaveBeenCalled();
  });
  function fixture() {
    const record = {
      departmentId: actor.departmentId,
      responsibleUserId: actor.userId,
      responsibleMembership: { teamId: null },
      stage: 'EXECUTING',
      version: 24,
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
        fromVersion: 21,
        toVersion: 22,
      },
      executionMailing: {
        id: mailingId,
        confirmationId,
        fromVersion: 22,
        toVersion: 23,
      },
      executionFiling: {
        id: filingId,
        mailingId,
        fromVersion: 23,
        toVersion: 24,
      },
      executionFinish: null,
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
      caseExecutionFinishReceipt: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
      },
      caseExecutionFinish: { create: jest.fn().mockResolvedValue({}) },
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
      freezeCaseExecutionFinishReferences: jest
        .fn()
        .mockResolvedValue(undefined),
    };
    const service = new CaseExecutionFinishService(
      database as never,
      access as never,
      materials as never,
    );
    return { record, tx, database, access, materials, service };
  }

  it('anchors the current mailing, freezes exact proof versions and advances once', async () => {
    const f = fixture();
    await expect(f.service.finish(actor, caseId, input)).resolves.toMatchObject(
      { filingId, stage: 'WAITING_ARCHIVE', version: 25 },
    );
    expect(f.access.authorizeCase).toHaveBeenCalledWith(
      actor,
      'case.execution.finish',
      expect.anything(),
      f.tx,
    );
    expect(f.tx.caseExecutionFinish.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        filingId,
        fromVersion: 24,
        toVersion: 25,
      }),
    });
    expect(f.materials.assertAvailableVersions).toHaveBeenCalledWith(
      f.tx,
      actor,
      expect.objectContaining({
        category: 'EXECUTION_FINISH_BASIS',
        contentVersionIds: [fileId],
      }),
    );
    expect(
      f.materials.freezeCaseExecutionFinishReferences,
    ).toHaveBeenCalledTimes(1);
    expect(f.tx.caseExecutionFinishReceipt.create).toHaveBeenCalledTimes(1);
    expect(f.database.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
    });
  });

  it('rejects a stale mailing anchor before writing', async () => {
    const f = fixture();
    f.record.executionMailing.id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    await expect(f.service.finish(actor, caseId, input)).rejects.toMatchObject({
      response: { code: 'INVALID_STATE' },
    });
    expect(f.tx.auditEvent.create).not.toHaveBeenCalled();
  });

  it('denies a client before a transaction', async () => {
    const f = fixture();
    await expect(
      f.service.finish({ ...actor, clientCustomerId: 'client' }, caseId, input),
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
    f.tx.caseExecutionFinishReceipt.findUnique.mockResolvedValue({
      caseId,
      requestFingerprint: 'old',
      resultSnapshot: {},
    });
    await expect(
      f.service.finish(
        { ...actor, lawyerAccountId: actor.userId },
        caseId,
        input,
      ),
    ).rejects.toMatchObject({ response: { code: 'ACTION_FORBIDDEN' } });
    expect(f.tx.caseExecutionFinishReceipt.findUnique).not.toHaveBeenCalled();
  });

  it('rejects malformed, future and duplicate-version requests', async () => {
    const f = fixture();
    for (const invalid of [
      { ...input, finishedAt: '2026-02-30' },
      { ...input, finishedAt: '2999-01-01' },
      { ...input, basisContentVersionIds: [fileId, fileId] },
    ])
      await expect(
        f.service.finish(actor, caseId, invalid),
      ).rejects.toMatchObject({ response: { code: 'VALIDATION_ERROR' } });
    expect(f.database.$transaction).not.toHaveBeenCalled();
  });

  it('propagates a freezing failure so the transaction can roll back', async () => {
    const f = fixture();
    f.materials.freezeCaseExecutionFinishReferences.mockRejectedValue(
      new Error('freeze failed'),
    );
    await expect(f.service.finish(actor, caseId, input)).rejects.toThrow(
      'freeze failed',
    );
    expect(f.tx.caseExecutionFinishReceipt.create).not.toHaveBeenCalled();
  });

  it('rechecks authorization before an idempotent replay', async () => {
    const f = fixture();
    f.access.authorizeCase.mockRejectedValue(new ForbiddenException());
    f.tx.caseExecutionFinishReceipt.findUnique.mockResolvedValue({
      caseId,
      requestFingerprint: 'old',
      resultSnapshot: {},
    });
    await expect(f.service.finish(actor, caseId, input)).rejects.toMatchObject({
      response: { code: 'ACTION_FORBIDDEN' },
    });
    expect(f.tx.caseExecutionFinishReceipt.findUnique).not.toHaveBeenCalled();
  });

  it('rejects same-key different-body reuse after authorization', async () => {
    const f = fixture();
    f.tx.caseExecutionFinishReceipt.findUnique.mockResolvedValue({
      caseId,
      requestFingerprint: 'different',
      resultSnapshot: {},
    });
    await expect(f.service.finish(actor, caseId, input)).rejects.toMatchObject({
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
          expectedFilingId: input.expectedFilingId,
          finishedAt: input.finishedAt,
          reason: input.reason,
          basisNote: input.basisNote,
          basisContentVersionIds: input.basisContentVersionIds,
        }),
      )
      .digest('hex');
    const result = {
      id: caseId,
      finishId: fileId,
      filingId,
      stage: 'WAITING_ARCHIVE',
      version: 25,
      finishedAt: input.finishedAt,
      recordedAt: '2026-10-01T00:00:00.000Z',
    };
    f.tx.caseExecutionFinishReceipt.findUnique.mockResolvedValue({
      caseId,
      requestFingerprint: fingerprint,
      resultSnapshot: result,
    });
    await expect(f.service.finish(actor, caseId, input)).resolves.toEqual(
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
          expectedFilingId: input.expectedFilingId,
          finishedAt: input.finishedAt,
          reason: input.reason,
          basisNote: input.basisNote,
          basisContentVersionIds: input.basisContentVersionIds,
        }),
      )
      .digest('hex');
    const result = {
      id: caseId,
      finishId: fileId,
      filingId,
      stage: 'WAITING_ARCHIVE',
      version: 25,
      finishedAt: input.finishedAt,
      recordedAt: '2026-10-01T00:00:00.000Z',
    };
    f.database.$transaction.mockRejectedValueOnce({
      code: 'P2002',
      meta: { target: ['department_id', 'actor_user_id', 'idempotency_key'] },
    });
    f.tx.caseExecutionFinishReceipt.findUnique.mockResolvedValue({
      caseId,
      requestFingerprint: fingerprint,
      resultSnapshot: result,
    });
    await expect(f.service.finish(actor, caseId, input)).resolves.toEqual(
      result,
    );
    expect(f.database.$transaction).toHaveBeenCalledTimes(2);
    expect(f.access.authorizeCase).toHaveBeenCalledTimes(1);
    expect(f.tx.auditEvent.create).not.toHaveBeenCalled();
  });
});
