import { ForbiddenException } from '@nestjs/common';
import { CaseClosureService } from './case-closure.service';
const id = (digit: string) =>
  `${digit.repeat(8)}-${digit.repeat(4)}-4${digit.repeat(3)}-8${digit.repeat(3)}-${digit.repeat(12)}`;
const actor = {
  userId: id('1'),
  departmentId: id('2'),
  authorizationRevision: 1,
};
const caseId = id('3');
const input = {
  expectedVersion: 25,
  idempotencyKey: 'record',
  expectedFinishId: id('a'),
  closeAt: null,
  closeAmountState: 'PENDING' as const,
  closeAmt: null,
  note: null,
  closeContentVersionIds: [] as string[],
};
function fixture() {
  const record = {
    departmentId: actor.departmentId,
    responsibleUserId: actor.userId,
    responsibleMembership: { teamId: null },
    stage: 'WAITING_ARCHIVE',
    version: 25,
    currentTrialRoundId: id('4'),
    currentJudgmentNextStepId: id('5'),
    currentSecondInstanceResultId: null,
    currentExecutionSubmissionId: id('6'),
    currentJudgmentNextStep: {
      id: id('5'),
      trialRoundId: id('4'),
      next: 'EXECUTION',
      revocation: null,
    },
    currentSecondInstanceResult: null,
    currentExecutionSubmission: {
      id: id('6'),
      trialRoundId: id('4'),
      judgmentNextStepId: id('5'),
      secondInstanceResultId: null,
      toVersion: 21,
    },
    executionConfirmation: {
      id: id('7'),
      submissionId: id('6'),
      fromVersion: 21,
      toVersion: 22,
    },
    executionMailing: {
      id: id('8'),
      confirmationId: id('7'),
      fromVersion: 22,
      toVersion: 23,
    },
    executionFiling: {
      id: id('9'),
      mailingId: id('8'),
      fromVersion: 23,
      toVersion: 24,
    },
    executionFinish: {
      id: id('a'),
      filingId: id('9'),
      fromVersion: 24,
      toVersion: 25,
    },
    closure: null as null | {
      id: string;
      finishId: string;
      currentVersionId: string;
      currentVersion: { id: string; toVersion: number };
    },
  };
  const tx = {
    $queryRawUnsafe: jest.fn().mockResolvedValue([{ id: caseId }]),
    case: {
      findFirst: jest.fn().mockImplementation(async () => record),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    userAccount: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ active: true, accountType: 'INTERNAL' }),
    },
    auditEvent: { create: jest.fn().mockResolvedValue({}) },
    caseClosure: {
      create: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    caseClosureVersion: { create: jest.fn().mockResolvedValue({}) },
    caseClosureReceipt: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
    },
    lawyerAccountBinding: {
      findFirst: jest.fn().mockResolvedValue({ id: id('b') }),
    },
    caseLawyerAssignment: {
      findFirst: jest.fn().mockResolvedValue({ id: id('c') }),
    },
  };
  const database = {
    $transaction: jest
      .fn()
      .mockImplementation(async (operation) => operation(tx)),
  };
  const access = { authorizeCase: jest.fn().mockResolvedValue(undefined) };
  const materials = {
    assertAvailableVersions: jest
      .fn()
      .mockResolvedValue([{ materialId: id('d'), contentVersionId: id('e') }]),
    freezeCaseClosureReferences: jest.fn().mockResolvedValue(undefined),
  };
  return {
    record,
    tx,
    database,
    access,
    materials,
    service: new CaseClosureService(
      database as never,
      access as never,
      materials as never,
    ),
  };
}
describe('closure commands', () => {
  it('allows current PRIMARY lawyer registration but rechecks binding before original-key replay', async () => {
    const f = fixture();
    const lawyer = { ...actor, lawyerAccountId: actor.userId };
    f.tx.userAccount.findUnique.mockResolvedValue({
      active: true,
      accountType: 'LAWYER',
    });
    await expect(
      f.service.record(lawyer, caseId, input),
    ).resolves.toMatchObject({ stage: 'WAITING_ARCHIVE' });
    expect(f.access.authorizeCase).not.toHaveBeenCalled();
    expect(f.tx.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ lawyerAccountBindingId: caseId }),
    });
    f.tx.$queryRawUnsafe
      .mockResolvedValueOnce([{ id: caseId }])
      .mockResolvedValueOnce([]);
    await expect(f.service.record(lawyer, caseId, input)).rejects.toMatchObject(
      { response: { code: 'ACTION_FORBIDDEN' } },
    );
  });
  it('stores unknown date and pending amount without manufacturing receipt or payment facts', async () => {
    const f = fixture();
    const result = await f.service.record(actor, caseId, input);
    expect(Object.keys(result)).toEqual([
      'id',
      'closureId',
      'closureVersionId',
      'finishId',
      'stage',
      'version',
      'recordedAt',
    ]);
    expect(result).toMatchObject({
      id: caseId,
      finishId: input.expectedFinishId,
      stage: 'WAITING_ARCHIVE',
      version: 26,
    });
    expect(f.tx.caseClosureVersion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        closeAt: null,
        closeAmt: null,
        closeAmountState: 'PENDING',
        kind: 'REGISTER',
        priorVersionId: null,
      }),
    });
    expect(f.materials.assertAvailableVersions).not.toHaveBeenCalled();
    expect(f.materials.freezeCaseClosureReferences).not.toHaveBeenCalled();
  });
  it('keeps a true zero and canonical audit decimal, then appends a full correction', async () => {
    const f = fixture();
    await f.service.record(actor, caseId, {
      ...input,
      closeAmountState: 'KNOWN',
      closeAmt: '0',
      closeAt: '2020-01-01',
    });
    expect(f.tx.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        details: expect.objectContaining({
          closeAmt: '0.00',
          closeAt: '2020-01-01',
        }),
      }),
    });
    f.record.version = 26;
    f.record.closure = {
      id: id('b'),
      finishId: id('a'),
      currentVersionId: id('c'),
      currentVersion: { id: id('c'), toVersion: 26 },
    };
    await f.service.correct(actor, caseId, {
      ...input,
      expectedVersion: 26,
      expectedClosureVersionId: id('c'),
      correctionReason: '真实更正',
      note: '完整新版',
    });
    expect(f.access.authorizeCase).toHaveBeenLastCalledWith(
      actor,
      'case.closure.correct',
      expect.any(Object),
      f.tx,
    );
    expect(f.tx.caseClosureVersion.create).toHaveBeenLastCalledWith({
      data: expect.objectContaining({
        kind: 'CORRECT',
        priorVersionId: id('c'),
        fromVersion: 26,
        toVersion: 27,
        note: '完整新版',
        correctionReason: '真实更正',
      }),
    });
  });
  it('replays the original receipt after a later correction only after current authorization', async () => {
    const f = fixture();
    const first = await f.service.record(actor, caseId, input);
    const receipt = f.tx.caseClosureReceipt.create.mock.calls[0][0].data;
    f.tx.caseClosureReceipt.findUnique.mockResolvedValue(receipt);
    f.record.version = 99;
    await expect(f.service.record(actor, caseId, input)).resolves.toEqual(
      first,
    );
    expect(f.tx.caseClosureVersion.create).toHaveBeenCalledTimes(1);
    await expect(
      f.service.record(actor, caseId, { ...input, note: 'changed' }),
    ).rejects.toMatchObject({ response: { code: 'IDEMPOTENCY_CONFLICT' } });
    f.access.authorizeCase.mockRejectedValue(new ForbiddenException());
    await expect(f.service.record(actor, caseId, input)).rejects.toMatchObject({
      response: { code: 'ACTION_FORBIDDEN' },
    });
    expect(f.tx.caseClosureReceipt.findUnique).toHaveBeenCalledTimes(3);
  });
  it.each([
    { ...input, extra: true },
    { ...input, closeAt: '2026-02-30' },
    { ...input, closeAt: '2999-01-01' },
    { ...input, closeAmountState: 'KNOWN', closeAmt: null },
    { ...input, closeAmt: '0' },
    { ...input, note: ' ' },
    { ...input, closeAmt: '100000000000000.00', closeAmountState: 'KNOWN' },
  ])(
    'rejects malformed or contradictory business input before a transaction: %j',
    async (invalid) => {
      const f = fixture();
      await expect(
        f.service.record(actor, caseId, invalid as never),
      ).rejects.toMatchObject({ response: { code: 'VALIDATION_ERROR' } });
      expect(f.database.$transaction).not.toHaveBeenCalled();
    },
  );
  it.each([
    'filing',
    'mailing',
    'confirmation',
    'submission',
    'finish',
    'case',
  ])('rejects a skipped %s version', async (part) => {
    const f = fixture();
    if (part === 'filing') f.record.executionFiling.toVersion++;
    if (part === 'mailing') f.record.executionMailing.toVersion++;
    if (part === 'confirmation') f.record.executionConfirmation.toVersion++;
    if (part === 'submission') f.record.currentExecutionSubmission.toVersion++;
    if (part === 'finish') f.record.executionFinish.toVersion++;
    if (part === 'case') f.record.version++;
    await expect(f.service.record(actor, caseId, input)).rejects.toMatchObject({
      status: 409,
    });
    expect(f.tx.caseClosureVersion.create).not.toHaveBeenCalled();
  });
  it('rejects stale correction heads and lawyers correcting, clients or offices writing', async () => {
    const f = fixture();
    f.record.closure = {
      id: id('b'),
      finishId: id('a'),
      currentVersionId: id('c'),
      currentVersion: { id: id('c'), toVersion: 25 },
    };
    const correction = {
      ...input,
      expectedClosureVersionId: id('d'),
      correctionReason: '真实原因',
    };
    await expect(
      f.service.correct(actor, caseId, correction),
    ).rejects.toMatchObject({ response: { code: 'INVALID_STATE' } });
    f.tx.userAccount.findUnique.mockResolvedValue({
      active: true,
      accountType: 'LAWYER',
    });
    await expect(
      f.service.correct(
        { ...actor, lawyerAccountId: actor.userId },
        caseId,
        correction,
      ),
    ).rejects.toMatchObject({ response: { code: 'ACTION_FORBIDDEN' } });
    await expect(
      f.service.record({ ...actor, clientCustomerId: id('f') }, caseId, input),
    ).rejects.toMatchObject({ response: { code: 'ACTION_FORBIDDEN' } });
    await expect(
      f.service.record({ ...actor, notaryOfficeId: id('f') }, caseId, input),
    ).rejects.toMatchObject({ response: { code: 'ACTION_FORBIDDEN' } });
  });
  it('uses exact frozen material service facts and propagates transaction failure', async () => {
    const f = fixture();
    await f.service.record(actor, caseId, {
      ...input,
      closeContentVersionIds: [id('e')],
    });
    expect(f.materials.freezeCaseClosureReferences).toHaveBeenCalledWith(
      f.tx,
      actor,
      caseId,
      expect.any(String),
      expect.any(Array),
      expect.any(String),
    );
    f.tx.caseClosureReceipt.create.mockRejectedValue(
      new Error('receipt failed'),
    );
    await expect(f.service.record(actor, caseId, input)).rejects.toThrow(
      'receipt failed',
    );
    // Atomic rollback itself is a real-database integration obligation.
    expect(f.database.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
    });
  });
  it('rejects two versions of one material before creating any closure facts', async () => {
    const f = fixture();
    f.materials.assertAvailableVersions.mockResolvedValue([
      { materialId: id('d'), contentVersionId: id('e') },
      { materialId: id('d'), contentVersionId: id('f') },
    ]);
    await expect(
      f.service.record(actor, caseId, {
        ...input,
        closeContentVersionIds: [id('e'), id('f')],
      }),
    ).rejects.toMatchObject({ response: { code: 'VALIDATION_ERROR' } });
    expect(f.tx.auditEvent.create).not.toHaveBeenCalled();
    expect(f.tx.caseClosureVersion.create).not.toHaveBeenCalled();
  });
  it('retries full serialization failures but never mistakes an unrelated unique conflict for a replay', async () => {
    const f = fixture();
    f.database.$transaction.mockRejectedValueOnce({ code: 'P2034' });
    await expect(f.service.record(actor, caseId, input)).resolves.toMatchObject(
      { version: 26 },
    );
    expect(f.database.$transaction).toHaveBeenCalledTimes(2);
    f.database.$transaction.mockRejectedValue({
      code: 'P2002',
      meta: { target: ['case_id', 'to_version'] },
    });
    await expect(f.service.record(actor, caseId, input)).rejects.toMatchObject({
      response: { code: 'VERSION_CONFLICT' },
    });
  });
});
