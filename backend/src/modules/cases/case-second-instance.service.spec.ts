import { CaseSecondInstanceService } from './case-second-instance.service';

const actor = {
  userId: '11111111-1111-4111-8111-111111111111',
  departmentId: '22222222-2222-4222-8222-222222222222',
  authorizationRevision: 1,
};
const caseId = '33333333-3333-4333-8333-333333333333';
const trialRoundId = '44444444-4444-4444-8444-444444444444';
const choiceId = '55555555-5555-4555-8555-555555555555';
const judgmentId = '66666666-6666-4666-8666-666666666666';
const resultId = '99999999-9999-4999-8999-999999999999';
const documentVersionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const blank = {
  hearingAt: null,
  hearingPlace: null,
  judgeName: null,
  documentContentVersionIds: [],
  serviceContentVersionIds: [],
};

describe('CaseSecondInstanceService', () => {
  function fixture() {
    const record = {
      id: caseId,
      departmentId: actor.departmentId,
      stage: 'SECOND_INSTANCE',
      version: 12,
      currentTrialRoundId: trialRoundId,
      currentAcceptanceId: '77777777-7777-4777-8777-777777777777',
      currentHearingArrangementId: null,
      currentHearingAdvanceId: null,
      currentJudgmentId: judgmentId,
      currentJudgmentNextStepId: choiceId,
      currentSecondInstanceProgressId: null as string | null,
      currentSecondInstanceResultId: null as string | null,
      currentSecondInstanceResult: null as null | {
        id: string;
        result: 'REMAND' | 'CHANGE' | 'AFFIRM';
        trialRoundId: string;
        choiceId: string;
        progressId: string | null;
      },
      courtCaseNo: '（2026）京0101民初1号',
      acceptance: {
        acceptedAt: new Date('2026-01-01T00:00:00.000Z'),
        corrections: [] as { acceptedAt: Date }[],
      },
      currentJudgment: {
        id: judgmentId,
        judgmentAmountState: 'KNOWN',
        judgmentAmount: '100.00',
      },
      currentJudgmentNextStep: {
        id: choiceId,
        judgmentId,
        trialRoundId,
        next: 'APPEAL',
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
      caseSecondInstanceReceipt: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
      },
      caseSecondInstanceProgress: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
      },
      caseSecondInstanceResult: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
      },
      caseSecondInstanceAcceptanceChange: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      caseExecutionSubmission: { count: jest.fn().mockResolvedValue(0) },
      caseSecondInstanceResultRevocation: {
        create: jest.fn().mockResolvedValue({}),
      },
      caseTrialRound: {
        create: jest.fn().mockResolvedValue({}),
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue({}),
      },
      caseAcceptance: { findFirst: jest.fn().mockResolvedValue(null) },
      caseHearingArrangement: { findFirst: jest.fn().mockResolvedValue(null) },
      caseHearingAdvance: { findFirst: jest.fn().mockResolvedValue(null) },
      caseJudgmentFact: { findFirst: jest.fn().mockResolvedValue(null) },
      caseJudgmentNextStep: { findFirst: jest.fn().mockResolvedValue(null) },
      auditEvent: {
        create: jest
          .fn()
          .mockResolvedValue({ id: '88888888-8888-4888-8888-888888888888' }),
      },
    };
    const database = {
      $transaction: jest.fn(async (fn: (client: typeof tx) => unknown) =>
        fn(tx),
      ),
    };
    const access = { authorizeCase: jest.fn().mockResolvedValue(undefined) };
    const materials = {
      assertAvailableVersions: jest.fn().mockResolvedValue([]),
      freezeCaseSecondInstanceReferences: jest
        .fn()
        .mockResolvedValue(undefined),
    };
    return {
      record,
      tx,
      database,
      access,
      materials,
      service: new CaseSecondInstanceService(
        database as never,
        access as never,
        materials as never,
      ),
    };
  }

  const saveInput = (key = 'save-1') => ({
    expectedVersion: 12,
    idempotencyKey: key,
    trialRoundId,
    choiceId,
    expectedProgressId: null,
    progress: { ...blank, hearingPlace: '北京一中院' },
  });
  const resultInput = (
    kind: 'REMAND' | 'CHANGE' | 'AFFIRM',
    key = `result-${kind}`,
  ) => ({
    ...saveInput(key),
    progress: { ...blank },
    result: kind,
    resultReceivedAt: '2026-01-02',
    judgmentContentVersionIds: [documentVersionId],
    paidLitigationFee: { state: 'PENDING' as const, amount: null },
    ...(kind === 'CHANGE'
      ? { judgmentAmount: { state: 'KNOWN' as const, amount: '0' } }
      : {}),
  });

  it('saves a real progress revision and leaves the case in second instance', async () => {
    const f = fixture();
    const result = await f.service.save(actor, caseId, {
      expectedVersion: 12,
      idempotencyKey: 'save-1',
      trialRoundId,
      choiceId,
      expectedProgressId: null,
      progress: { ...blank, hearingPlace: '北京一中院' },
    });
    expect(result).toMatchObject({
      id: caseId,
      stage: 'SECOND_INSTANCE',
      version: 13,
      currentTrialRoundId: trialRoundId,
      resultId: null,
    });
    expect(f.tx.caseSecondInstanceProgress.create).toHaveBeenCalledTimes(1);
    expect(f.materials.assertAvailableVersions).toHaveBeenNthCalledWith(
      1,
      f.tx,
      actor,
      expect.objectContaining({
        category: 'SECOND_INSTANCE_DOCUMENT',
        contentVersionIds: [],
        minCount: 0,
      }),
    );
    expect(f.materials.assertAvailableVersions).toHaveBeenNthCalledWith(
      2,
      f.tx,
      actor,
      expect.objectContaining({
        category: 'SECOND_INSTANCE_SERVICE',
        contentVersionIds: [],
        minCount: 0,
      }),
    );
    expect(f.tx.case.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          stage: 'SECOND_INSTANCE',
          version: { increment: 1 },
        }),
      }),
    );
  });

  it('does not create a blank first progress fact or advance version', async () => {
    const f = fixture();
    const response = await f.service.save(actor, caseId, {
      ...saveInput('blank'),
      progress: { ...blank },
    });
    expect(response).toMatchObject({
      version: 12,
      progressId: null,
      resultId: null,
      stage: 'SECOND_INSTANCE',
    });
    expect(f.tx.caseSecondInstanceProgress.create).not.toHaveBeenCalled();
    expect(f.tx.case.updateMany).not.toHaveBeenCalled();
    expect(f.tx.caseSecondInstanceReceipt.create).toHaveBeenCalledTimes(1);
  });

  it.each(['REMAND', 'CHANGE', 'AFFIRM'] as const)(
    'registers %s with an exact result fact and receipt',
    async (kind) => {
      const f = fixture();
      const response = await f.service.registerResult(
        actor,
        caseId,
        resultInput(kind),
      );
      expect(response).toMatchObject({
        stage:
          kind === 'REMAND'
            ? 'WAITING_FORMAL_ACCEPTANCE'
            : 'WAITING_EXECUTION_DOCUMENTS',
        version: 13,
        progressId: null,
        currentTrialRoundId:
          kind === 'REMAND'
            ? expect.not.stringMatching(trialRoundId)
            : trialRoundId,
      });
      expect(f.tx.caseSecondInstanceResult.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            result: kind,
            choiceId,
            judgmentId,
            judgmentAmountState: kind === 'REMAND' ? null : 'KNOWN',
            judgmentAmount:
              kind === 'REMAND' ? null : kind === 'CHANGE' ? '0.00' : '100.00',
            paidLitigationFeeState: 'PENDING',
            paidLitigationFee: null,
          }),
        }),
      );
      expect(f.tx.caseTrialRound.create).toHaveBeenCalledTimes(
        kind === 'REMAND' ? 1 : 0,
      );
      expect(f.materials.assertAvailableVersions).toHaveBeenCalledWith(
        f.tx,
        actor,
        expect.objectContaining({
          category: 'SECOND_INSTANCE_JUDGMENT',
          contentVersionIds: [documentVersionId],
          minCount: 1,
        }),
      );
      expect(f.tx.caseSecondInstanceReceipt.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'RESULT' }),
        }),
      );
    },
  );

  it('compares second-instance result dates with corrected first-instance acceptance', async () => {
    const f = fixture();
    f.record.acceptance = {
      acceptedAt: new Date('2026-01-01T00:00:00.000Z'),
      corrections: [{ acceptedAt: new Date('2026-01-03T00:00:00.000Z') }],
    };
    await expect(
      f.service.registerResult(actor, caseId, resultInput('AFFIRM')),
    ).rejects.toMatchObject({ response: { code: 'VALIDATION_ERROR' } });
    expect(f.tx.caseSecondInstanceResult.create).not.toHaveBeenCalled();
  });

  it('atomically saves unsaved progress before result with consecutive versions', async () => {
    const f = fixture();
    const response = await f.service.registerResult(actor, caseId, {
      ...resultInput('CHANGE', 'combined'),
      progress: { ...blank, judgeName: '张法官' },
    });
    expect(response).toMatchObject({
      version: 14,
      stage: 'WAITING_EXECUTION_DOCUMENTS',
    });
    expect(f.tx.caseSecondInstanceProgress.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          fromVersion: 12,
          toVersion: 13,
        }),
      }),
    );
    expect(f.tx.caseSecondInstanceResult.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          fromVersion: 13,
          toVersion: 14,
        }),
      }),
    );
    expect(f.tx.case.updateMany).toHaveBeenCalledTimes(2);
  });

  it('rechecks authorization before returning an old receipt', async () => {
    const f = fixture();
    f.tx.userAccount.findUnique.mockResolvedValue({
      active: false,
      accountType: 'INTERNAL',
    });
    f.tx.caseSecondInstanceReceipt.findUnique.mockResolvedValue({
      caseId,
      requestFingerprint: 'irrelevant',
      resultSnapshot: {},
    });
    await expect(
      f.service.save(actor, caseId, saveInput()),
    ).rejects.toMatchObject({ status: 403 });
    expect(f.tx.caseSecondInstanceReceipt.findUnique).not.toHaveBeenCalled();
  });

  it('rejects a reused key with different body after authorization', async () => {
    const f = fixture();
    f.tx.caseSecondInstanceReceipt.findUnique.mockResolvedValue({
      caseId,
      requestFingerprint: 'different',
      resultSnapshot: {},
    });
    await expect(
      f.service.save(actor, caseId, saveInput()),
    ).rejects.toMatchObject({ status: 409 });
    expect(f.access.authorizeCase).toHaveBeenCalledTimes(1);
    expect(f.tx.caseSecondInstanceProgress.create).not.toHaveBeenCalled();
  });

  it('distinguishes a receipt-key collision from another unique constraint', async () => {
    const nonReceipt = fixture();
    const uniqueError = {
      code: 'P2002',
      meta: { target: 'case_second_instance_results_case_from_key' },
    };
    nonReceipt.database.$transaction.mockRejectedValueOnce(uniqueError);
    await expect(
      nonReceipt.service.save(actor, caseId, saveInput('unique-fact')),
    ).rejects.toBe(uniqueError);
    const receipt = fixture();
    receipt.database.$transaction.mockRejectedValueOnce({
      code: 'P2002',
      meta: { target: 'case_second_instance_receipts_actor_key' },
    });
    await expect(
      receipt.service.save(actor, caseId, saveInput('unique-receipt')),
    ).rejects.toMatchObject({ response: { code: 'IDEMPOTENCY_CONFLICT' } });
  });

  it.each([
    {
      label: 'stale case version',
      mutate: (f: ReturnType<typeof fixture>) => {
        f.record.version = 13;
      },
    },
    {
      label: 'wrong current round',
      mutate: (f: ReturnType<typeof fixture>) => {
        f.record.currentTrialRoundId = resultId;
      },
    },
    {
      label: 'wrong choice',
      mutate: (f: ReturnType<typeof fixture>) => {
        f.record.currentJudgmentNextStepId = resultId;
      },
    },
    {
      label: 'stale progress anchor',
      mutate: (f: ReturnType<typeof fixture>) => {
        f.record.currentSecondInstanceProgressId = resultId;
      },
    },
  ])('rejects $label before fact creation', async ({ mutate }) => {
    const f = fixture();
    mutate(f);
    await expect(
      f.service.save(actor, caseId, saveInput()),
    ).rejects.toMatchObject({ status: 409 });
    expect(f.tx.caseSecondInstanceProgress.create).not.toHaveBeenCalled();
  });

  it('rejects an invalid result date before creating a result receipt', async () => {
    const f = fixture();
    await expect(
      f.service.registerResult(actor, caseId, {
        ...resultInput('REMAND'),
        resultReceivedAt: '2025-12-31',
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(f.tx.caseSecondInstanceResult.create).not.toHaveBeenCalled();
    expect(f.tx.caseSecondInstanceReceipt.create).not.toHaveBeenCalled();
  });

  it('rolls back the command when exact file validation fails', async () => {
    const f = fixture();
    f.materials.assertAvailableVersions.mockRejectedValue(
      new Error('foreign case file'),
    );
    await expect(
      f.service.registerResult(actor, caseId, resultInput('CHANGE')),
    ).rejects.toThrow('foreign case file');
    expect(f.tx.caseSecondInstanceResult.create).not.toHaveBeenCalled();
    expect(f.tx.caseSecondInstanceReceipt.create).not.toHaveBeenCalled();
  });

  it('revokes an unchanged REMAND child and restores source pointers', async () => {
    const f = fixture();
    const childRoundId = documentVersionId;
    f.record.stage = 'WAITING_FORMAL_ACCEPTANCE';
    f.record.currentTrialRoundId = childRoundId;
    f.record.currentSecondInstanceResultId = resultId;
    f.record.currentSecondInstanceResult = {
      id: resultId,
      result: 'REMAND',
      trialRoundId,
      choiceId,
      progressId: null,
    };
    f.tx.caseTrialRound.findFirst.mockResolvedValue({
      id: childRoundId,
      revokedAt: null,
    });
    f.tx.caseJudgmentNextStep.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: choiceId, judgmentId });
    f.tx.caseAcceptance.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: f.record.currentAcceptanceId,
        courtCaseNo: f.record.courtCaseNo,
        corrections: [{ courtCaseNo: 'CORRECTED-SOURCE-NO' }],
      });
    const response = await f.service.revokeResult(actor, caseId, {
      expectedVersion: 12,
      idempotencyKey: 'revoke-1',
      trialRoundId,
      resultId,
      reason: '结果录入错误',
    });
    expect(response).toMatchObject({
      stage: 'SECOND_INSTANCE',
      version: 13,
      currentTrialRoundId: trialRoundId,
      resultId: null,
    });
    expect(f.tx.caseTrialRound.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: childRoundId },
        data: { revokedAt: expect.any(Date) },
      }),
    );
    expect(f.tx.case.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          currentTrialRoundId: trialRoundId,
          currentAcceptanceId: f.record.currentAcceptanceId,
          currentJudgmentId: judgmentId,
          currentJudgmentNextStepId: choiceId,
          courtCaseNo: 'CORRECTED-SOURCE-NO',
        }),
      }),
    );
  });

  it('rejects revocation after child acceptance wins the lock', async () => {
    const f = fixture();
    f.record.stage = 'WAITING_HEARING';
    f.record.currentTrialRoundId = documentVersionId;
    f.record.currentSecondInstanceResultId = resultId;
    f.record.currentSecondInstanceResult = {
      id: resultId,
      result: 'REMAND',
      trialRoundId,
      choiceId,
      progressId: null,
    };
    await expect(
      f.service.revokeResult(actor, caseId, {
        expectedVersion: 12,
        idempotencyKey: 'revoke-late',
        trialRoundId,
        resultId,
        reason: '撤销',
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(
      f.tx.caseSecondInstanceResultRevocation.create,
    ).not.toHaveBeenCalled();
  });

  it('rejects result revocation after a formal execution submission exists', async () => {
    const f = fixture();
    f.record.stage = 'WAITING_EXECUTION_DOCUMENTS';
    f.record.currentSecondInstanceResultId = resultId;
    f.record.currentSecondInstanceResult = {
      id: resultId,
      result: 'CHANGE',
      trialRoundId,
      choiceId,
      progressId: null,
    };
    f.tx.caseExecutionSubmission.count.mockResolvedValue(1);
    f.tx.caseTrialRound.findFirst.mockResolvedValue({ id: trialRoundId });
    f.tx.caseJudgmentNextStep.findFirst.mockResolvedValue({
      id: choiceId,
      judgmentId,
    });
    f.tx.caseAcceptance.findFirst.mockResolvedValue({
      id: f.record.currentAcceptanceId,
      courtCaseNo: f.record.courtCaseNo,
      corrections: [],
    });
    await expect(
      f.service.revokeResult(actor, caseId, {
        expectedVersion: 12,
        idempotencyKey: 'revoke-after-execution',
        trialRoundId,
        resultId,
        reason: '误录',
      }),
    ).rejects.toMatchObject({ response: { code: 'INVALID_STATE' } });
    expect(f.tx.caseExecutionSubmission.count).toHaveBeenCalledTimes(1);
    expect(
      f.tx.caseSecondInstanceResultRevocation.create,
    ).not.toHaveBeenCalled();
  });
});
