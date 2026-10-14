import { ForbiddenException } from '@nestjs/common';
import { CaseArchiveService } from './case-archive.service';
const id = (digit: string) =>
  `${digit.repeat(8)}-${digit.repeat(4)}-4${digit.repeat(3)}-8${digit.repeat(3)}-${digit.repeat(12)}`;
const actor = {
  userId: id('1'),
  departmentId: id('2'),
  authorizationRevision: 1,
};
const caseId = id('3');
const input = {
  expectedVersion: 26,
  idempotencyKey: 'archive-original',
  expectedClosureVersionId: id('e'),
  archiveAt: '2020-01-01',
  archiveType: 'EXECUTION_COLLECTED' as const,
  archiveReason: '分类，不推定实收',
};
function fixture() {
  const record = {
    departmentId: actor.departmentId,
    sourceLeadId: caseId,
    sourceNotaryMatterId: caseId,
    certificateId: caseId,
    externalEntry: null,
    responsibleUserId: actor.userId,
    responsibleMembership: { teamId: null },
    stage: 'WAITING_ARCHIVE',
    version: 26,
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
    closure: {
      id: id('d'),
      finishId: id('a'),
      currentVersionId: id('e'),
      currentVersion: { id: id('e'), toVersion: 26 },
      versions: [
        {
          id: id('e'),
          finishId: id('a'),
          kind: 'REGISTER',
          priorVersionId: null as string | null,
          fromVersion: 25,
          toVersion: 26,
        },
      ],
    },
    archive: null as null | {
      id: string;
      closureId: string;
      closureVersionId: string;
      currentVersionId: string;
      versions: Array<{
        id: string;
        closureVersionId: string;
        kind: string;
        priorVersionId: string | null;
        fromVersion: number;
        toVersion: number;
      }>;
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
    caseArchive: {
      create: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    caseArchiveVersion: { create: jest.fn().mockResolvedValue({}) },
    caseArchiveReceipt: {
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
    service: new CaseArchiveService(database as never, access as never),
  };
}
describe('archive commands', () => {
  it('fails a missing same-department case before authorization or receipt lookup', async () => {
    const f = fixture();
    f.tx.$queryRawUnsafe.mockResolvedValue([]);
    await expect(f.service.archive(actor, caseId, input)).rejects.toMatchObject(
      { response: { code: 'CASE_NOT_FOUND' } },
    );
    expect(f.tx.caseArchiveReceipt.findUnique).not.toHaveBeenCalled();
  });
  it('propagates audit, fact, head and receipt failures without returning a success', async () => {
    for (const target of ['audit', 'fact', 'head', 'receipt']) {
      const f = fixture();
      const cause = new Error(target + ' failed');
      if (target === 'audit') f.tx.auditEvent.create.mockRejectedValue(cause);
      if (target === 'fact')
        f.tx.caseArchiveVersion.create.mockRejectedValue(cause);
      if (target === 'head')
        f.tx.caseArchive.updateMany.mockRejectedValue(cause);
      if (target === 'receipt')
        f.tx.caseArchiveReceipt.create.mockRejectedValue(cause);
      await expect(f.service.archive(actor, caseId, input)).rejects.toBe(cause);
    }
  });
  it('rejects malformed stored receipts and bounds full transaction retries', async () => {
    const f = fixture();
    await f.service.archive(actor, caseId, input);
    const saved = f.tx.caseArchiveReceipt.create.mock.calls[0][0].data;
    f.tx.caseArchiveReceipt.findUnique.mockResolvedValue({
      ...saved,
      resultSnapshot: { ...saved.resultSnapshot, stage: 'WAITING_ARCHIVE' },
    });
    await expect(f.service.archive(actor, caseId, input)).rejects.toMatchObject(
      { response: { code: 'INVALID_RECEIPT' } },
    );
    const exhausted = fixture();
    exhausted.database.$transaction.mockRejectedValue({ code: 'P2034' });
    await expect(
      exhausted.service.archive(actor, caseId, input),
    ).rejects.toMatchObject({ response: { code: 'VERSION_CONFLICT' } });
    expect(exhausted.database.$transaction).toHaveBeenCalledTimes(3);
  });
  it('archives against the exact closure and stores fixed result without touching closure/files/money', async () => {
    const f = fixture();
    const result = await f.service.archive(actor, caseId, input);
    expect(result).toEqual({
      id: caseId,
      archiveId: expect.any(String),
      archiveVersionId: expect.any(String),
      closureId: id('d'),
      closureVersionId: id('e'),
      stage: 'ARCHIVED',
      version: 27,
      recordedAt: expect.any(String),
    });
    expect(f.tx.case.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        stage: 'WAITING_ARCHIVE',
        version: 26,
        closure: { is: { id: id('d'), currentVersionId: id('e') } },
      }),
      data: { stage: 'ARCHIVED', version: { increment: 1 } },
    });
    expect(f.tx.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'case.archived',
        internalActorUserId: actor.userId,
        details: expect.objectContaining({
          closureVersionId: id('e'),
          archiveReason: input.archiveReason,
        }),
      }),
    });
    expect(f.materials.assertAvailableVersions).not.toHaveBeenCalled();
    expect(f.materials.freezeCaseClosureReferences).not.toHaveBeenCalled();
  });
  it('archives a real closure created after an imported WAITING_ARCHIVE root', async () => {
    const f = fixture();
    Object.assign(f.record, {
      sourceLeadId: null,
      sourceNotaryMatterId: null,
      certificateId: null,
      externalEntry: {
        id: id('f'),
        caseId,
        departmentId: actor.departmentId,
        initialStage: 'WAITING_ARCHIVE',
        stageReachedOn: new Date('2019-12-31T00:00:00.000Z'),
        known: {
          courtId: null,
          courtCaseNo: null,
          acceptedOn: null,
          secondInstanceAcceptedOn: null,
          platform: null,
          shopName: null,
          shopExternalId: null,
          caseType: null,
          infringementTypes: null,
        },
      },
      version: 2,
      currentJudgmentNextStepId: null,
      currentJudgmentNextStep: null,
      currentExecutionSubmissionId: null,
      currentExecutionSubmission: null,
      executionConfirmation: null,
      executionMailing: null,
      executionFiling: null,
      executionFinish: null,
    });
    Object.assign(f.record.closure, {
      finishId: null,
      externalEntryId: id('f'),
    });
    f.record.closure.currentVersion.toVersion = 2;
    Object.assign(f.record.closure.versions[0], {
      finishId: null,
      externalEntryId: id('f'),
      fromVersion: 1,
      toVersion: 2,
    });
    await expect(
      f.service.archive(actor, caseId, { ...input, expectedVersion: 2 }),
    ).resolves.toMatchObject({ stage: 'ARCHIVED', version: 3 });
  });
  it('appends an internal correction while retaining the frozen closure anchor and original receipt', async () => {
    const f = fixture();
    const original = await f.service.archive(actor, caseId, input);
    f.record.stage = 'ARCHIVED';
    f.record.version = 27;
    f.record.archive = {
      id: original.archiveId,
      closureId: id('d'),
      closureVersionId: id('e'),
      currentVersionId: original.archiveVersionId,
      versions: [
        {
          id: original.archiveVersionId,
          closureVersionId: id('e'),
          kind: 'ARCHIVE',
          priorVersionId: null,
          fromVersion: 26,
          toVersion: 27,
        },
      ],
    };
    const correction = await f.service.correct(actor, caseId, {
      ...input,
      expectedVersion: 27,
      idempotencyKey: 'correct',
      expectedArchiveVersionId: original.archiveVersionId,
      archiveReason: '完整新资料',
      correctionReason: '原分类错误',
    });
    expect(correction).toMatchObject({
      archiveId: original.archiveId,
      closureId: original.closureId,
      closureVersionId: original.closureVersionId,
      stage: 'ARCHIVED',
      version: 28,
    });
    expect(f.tx.caseArchiveVersion.create).toHaveBeenLastCalledWith({
      data: expect.objectContaining({
        kind: 'CORRECT',
        priorVersionId: original.archiveVersionId,
        closureVersionId: id('e'),
        correctionReason: '原分类错误',
      }),
    });
    const saved = f.tx.caseArchiveReceipt.create.mock.calls[0][0].data;
    f.tx.caseArchiveReceipt.findUnique.mockResolvedValue({
      ...saved,
      resultSnapshot: original,
    });
    f.record.version = 99;
    expect(await f.service.archive(actor, caseId, input)).toEqual(original);
    expect(f.tx.caseArchiveReceipt.create).toHaveBeenCalledTimes(2);
    await expect(
      f.service.archive(actor, caseId, { ...input, archiveReason: '异参' }),
    ).rejects.toMatchObject({ response: { code: 'IDEMPOTENCY_CONFLICT' } });
    await expect(
      f.service.archive(actor, id('f'), input),
    ).rejects.toMatchObject({ response: { code: 'IDEMPOTENCY_CONFLICT' } });
    f.access.authorizeCase.mockRejectedValue(new ForbiddenException());
    await expect(f.service.archive(actor, caseId, input)).rejects.toMatchObject(
      { response: { code: 'ACTION_FORBIDDEN' } },
    );
  });
  it('allows only the current PRIMARY lawyer to archive, forbids correction and rechecks lost binding before replay', async () => {
    const f = fixture();
    const lawyer = { ...actor, lawyerAccountId: actor.userId };
    f.tx.userAccount.findUnique.mockResolvedValue({
      active: true,
      accountType: 'LAWYER',
    });
    const original = await f.service.archive(lawyer, caseId, input);
    expect(f.access.authorizeCase).not.toHaveBeenCalled();
    f.tx.caseArchiveReceipt.findUnique.mockResolvedValue(
      f.tx.caseArchiveReceipt.create.mock.calls[0][0].data,
    );
    f.tx.$queryRawUnsafe
      .mockResolvedValueOnce([{ id: caseId }])
      .mockResolvedValueOnce([]);
    await expect(
      f.service.archive(lawyer, caseId, input),
    ).rejects.toMatchObject({ response: { code: 'ACTION_FORBIDDEN' } });
    await expect(
      f.service.correct(lawyer, caseId, {
        ...input,
        expectedArchiveVersionId: original.archiveVersionId,
        correctionReason: '不能更正',
      }),
    ).rejects.toMatchObject({ response: { code: 'ACTION_FORBIDDEN' } });
  });
  it.each(['CLIENT', 'NOTARY', 'DISABLED'])(
    'rejects external or disabled accounts: %s',
    async (accountType) => {
      const f = fixture();
      f.tx.userAccount.findUnique.mockResolvedValue({
        active: accountType !== 'DISABLED',
        accountType,
      });
      await expect(
        f.service.archive(actor, caseId, input),
      ).rejects.toMatchObject({ response: { code: 'ACTION_FORBIDDEN' } });
      expect(f.tx.caseArchiveVersion.create).not.toHaveBeenCalled();
    },
  );
  it('requires the archive action and responsible scope, not a read grant', async () => {
    const f = fixture();
    await f.service.archive(actor, caseId, input);
    expect(f.access.authorizeCase).toHaveBeenCalledWith(
      actor,
      'case.archive',
      { departmentId: actor.departmentId, responsibleUserId: actor.userId },
      f.tx,
    );
  });
  it.each(['stage', 'anchor', 'gap', 'prior', 'finish', 'choice'])(
    'rejects broken exact predecessor: %s',
    async (part) => {
      const f = fixture();
      if (part === 'stage') f.record.stage = 'EXECUTING';
      if (part === 'anchor') f.record.closure.currentVersionId = id('f');
      if (part === 'gap') f.record.closure.versions[0].fromVersion = 24;
      if (part === 'prior')
        f.record.closure.versions[0].priorVersionId = id('f');
      if (part === 'finish') f.record.executionFiling.toVersion = 23;
      if (part === 'choice') f.record.currentJudgmentNextStep.next = 'CLOSE';
      await expect(
        f.service.archive(actor, caseId, input),
      ).rejects.toMatchObject({ response: { code: 'INVALID_STATE' } });
      expect(f.tx.auditEvent.create).not.toHaveBeenCalled();
    },
  );
  it('retries complete serializable transactions and detects lost CAS', async () => {
    const f = fixture();
    f.database.$transaction.mockRejectedValueOnce({ code: 'P2034' });
    await expect(
      f.service.archive(actor, caseId, input),
    ).resolves.toMatchObject({ stage: 'ARCHIVED' });
    expect(f.database.$transaction).toHaveBeenCalledTimes(2);
    f.tx.case.updateMany.mockResolvedValue({ count: 0 });
    await expect(f.service.archive(actor, caseId, input)).rejects.toMatchObject(
      { response: { code: 'VERSION_CONFLICT' } },
    );
  });
  it.each([
    { archiveAt: '2020-02-30' },
    { archiveAt: '2999-01-01' },
    { archiveAt: null },
    { archiveAt: '0000-01-01' },
    { archiveType: 'UNKNOWN' },
    { archiveReason: '   ' },
    { archiveReason: 'x'.repeat(2001) },
    { idempotencyKey: ' key' },
    { expectedClosureVersionId: 'bad' },
    { expectedVersion: 1.1 },
    { extra: true },
  ])('rejects invalid explicit input %j', async (change) => {
    const f = fixture();
    await expect(
      f.service.archive(actor, caseId, { ...input, ...change } as never),
    ).rejects.toMatchObject({ response: { code: 'VALIDATION_ERROR' } });
    expect(f.database.$transaction).not.toHaveBeenCalled();
  });
  it('rejects every omitted key and an incomplete correction', async () => {
    const f = fixture();
    for (const key of Object.keys(input))
      await expect(
        f.service.archive(
          actor,
          caseId,
          Object.fromEntries(
            Object.entries(input).filter(([k]) => k !== key),
          ) as never,
        ),
      ).rejects.toMatchObject({ response: { code: 'VALIDATION_ERROR' } });
    await expect(
      f.service.correct(actor, caseId, {
        ...input,
        expectedArchiveVersionId: id('f'),
        correctionReason: '  ',
      }),
    ).rejects.toMatchObject({ response: { code: 'VALIDATION_ERROR' } });
  });
});
