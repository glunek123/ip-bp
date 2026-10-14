import { CaseSecondInstanceService } from './case-second-instance.service';
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
const trialRoundId = '44444444-4444-4444-8444-444444444444';
const choiceId = '55555555-5555-4555-8555-555555555555';
const judgmentId = '66666666-6666-4666-8666-666666666666';
const resultId = '99999999-9999-4999-8999-999999999999';
const documentVersionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const entryId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
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
      currentTrialRound: {
        origin: 'NORMAL',
        externalEntryId: null as string | null,
        sourceResultId: null as string | null,
        revokedAt: null,
      },
      currentAcceptanceId: '77777777-7777-4777-8777-777777777777' as
        string | null,
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
        choiceId: string | null;
        externalEntryId?: string | null;
        progressId: string | null;
      },
      courtCaseNo: '（2026）京0101民初1号',
      acceptance: {
        acceptedAt: new Date('2026-01-01T00:00:00.000Z'),
        corrections: [] as { acceptedAt: Date }[],
      },
      currentJudgment: {
        id: judgmentId,
        trialRoundId,
        externalEntryId: null as string | null,
        judgmentReceivedAt: new Date('2026-01-01T00:00:00.000Z'),
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

  function directEntryFixture() {
    const f = fixture();
    jest.mocked(readCaseSourceAnchor).mockResolvedValueOnce({
      kind: 'EXTERNAL_ENTRY',
      entryId,
      initialStage: 'SECOND_INSTANCE',
      stageReachedOn: '2026-01-01',
      known: { acceptedOn: null, secondInstanceAcceptedOn: null },
    } as never);
    f.record.currentTrialRound = {
      origin: 'EXTERNAL_CURRENT',
      externalEntryId: entryId,
      sourceResultId: null,
      revokedAt: null,
    };
    f.record.currentAcceptanceId = null;
    f.record.acceptance = null as never;
    f.record.currentJudgmentId = null as never;
    f.record.currentJudgment = null as never;
    f.record.currentJudgmentNextStepId = null as never;
    f.record.currentJudgmentNextStep = null as never;
    return f;
  }

  async function remandedExternalAppealFixture() {
    const f = fixture();
    const source = {
      kind: 'EXTERNAL_ENTRY',
      entryId,
      initialStage: 'WAITING_JUDGMENT',
      stageReachedOn: '2025-12-31',
      known: {
        acceptedOn: null,
        secondInstanceAcceptedOn: null,
        courtCaseNo: 'EXTERNAL-CASE-NO',
      },
    } as never;
    jest
      .mocked(readCaseSourceAnchor)
      .mockResolvedValueOnce(source)
      .mockResolvedValueOnce(source);
    f.record.currentTrialRound = {
      origin: 'EXTERNAL_CURRENT',
      externalEntryId: entryId,
      sourceResultId: null,
      revokedAt: null,
    };
    f.record.currentAcceptanceId = null;
    f.record.acceptance = null as never;
    f.record.currentJudgment.externalEntryId = entryId;
    const result = await f.service.registerResult(
      actor,
      caseId,
      resultInput('REMAND', 'real-external-appeal-remand'),
    );
    f.record.stage = 'WAITING_FORMAL_ACCEPTANCE';
    f.record.currentTrialRoundId = result.currentTrialRoundId;
    f.record.currentTrialRound = {
      origin: 'NORMAL',
      externalEntryId: entryId,
      sourceResultId: result.resultId,
      revokedAt: null,
    };
    f.record.currentSecondInstanceResultId = result.resultId;
    f.record.currentSecondInstanceResult = {
      id: result.resultId!,
      result: 'REMAND',
      trialRoundId,
      choiceId,
      externalEntryId: entryId,
      progressId: null,
    };
    return { f, result };
  }

  it('saves direct second-instance progress with a null choice and exact entry', async () => {
    const f = directEntryFixture();
    await f.service.save(actor, caseId, {
      ...saveInput('external-save'),
      choiceId: null,
    });
    expect(f.tx.caseSecondInstanceProgress.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          choiceId: null,
          externalEntryId: entryId,
          trialRoundId,
        }),
      }),
    );
  });

  it('registers a direct second-instance result and a real REMAND child', async () => {
    const f = directEntryFixture();
    const result = await f.service.registerResult(actor, caseId, {
      ...resultInput('REMAND', 'external-remand'),
      choiceId: null,
    });
    expect(result.stage).toBe('WAITING_FORMAL_ACCEPTANCE');
    expect(f.tx.caseSecondInstanceResult.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          choiceId: null,
          judgmentId: null,
          externalEntryId: entryId,
        }),
      }),
    );
    expect(f.tx.caseTrialRound.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sourceResultId: result.resultId,
          externalEntryId: entryId,
          origin: 'NORMAL',
        }),
      }),
    );
  });

  it('registers a direct second-instance CHANGE without a synthetic choice', async () => {
    const f = directEntryFixture();
    const result = await f.service.registerResult(actor, caseId, {
      ...resultInput('CHANGE', 'external-change'),
      choiceId: null,
    });
    expect(result.stage).toBe('WAITING_EXECUTION_DOCUMENTS');
    expect(f.tx.caseSecondInstanceResult.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          choiceId: null,
          judgmentId: null,
          externalEntryId: entryId,
          judgmentAmountState: 'KNOWN',
          judgmentAmount: '0.00',
        }),
      }),
    );
  });

  it.each([
    [{ state: 'KNOWN' as const, amount: '125.40' }, 'KNOWN', '125.40'],
    [{ state: 'PENDING' as const, amount: null }, 'PENDING', null],
  ])(
    'registers a direct AFFIRM with an explicit %s amount',
    async (money, state, amount) => {
      const f = directEntryFixture();
      const result = await f.service.registerResult(actor, caseId, {
        ...resultInput('AFFIRM', `external-affirm-${state}`),
        choiceId: null,
        judgmentAmount: money,
      });
      expect(result.stage).toBe('WAITING_EXECUTION_DOCUMENTS');
      expect(f.tx.caseSecondInstanceResult.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            choiceId: null,
            judgmentId: null,
            externalEntryId: entryId,
            judgmentAmountState: state,
            judgmentAmount: amount,
          }),
        }),
      );
    },
  );

  it('rejects a direct AFFIRM without an explicit amount state', async () => {
    const f = directEntryFixture();
    await expect(
      f.service.registerResult(actor, caseId, {
        ...resultInput('AFFIRM', 'external-affirm-missing'),
        choiceId: null,
      }),
    ).rejects.toThrow();
    expect(f.tx.caseSecondInstanceResult.create).not.toHaveBeenCalled();
  });

  it('rejects a supplied AFFIRM amount when a real first judgment exists', async () => {
    const f = fixture();
    await expect(
      f.service.registerResult(actor, caseId, {
        ...resultInput('AFFIRM', 'real-appeal-affirm-supplied'),
        judgmentAmount: { state: 'KNOWN', amount: '125.40' },
      }),
    ).rejects.toThrow();
    expect(f.tx.caseSecondInstanceResult.create).not.toHaveBeenCalled();
  });

  it('revokes an untouched direct-entry REMAND and restores null source pointers', async () => {
    const f = directEntryFixture();
    const childRoundId = documentVersionId;
    f.record.stage = 'WAITING_FORMAL_ACCEPTANCE';
    f.record.currentTrialRoundId = childRoundId;
    f.record.currentTrialRound = {
      origin: 'NORMAL',
      externalEntryId: entryId,
      sourceResultId: resultId,
      revokedAt: null,
    };
    f.record.currentSecondInstanceResultId = resultId;
    f.record.currentSecondInstanceResult = {
      id: resultId,
      result: 'REMAND',
      trialRoundId,
      choiceId: null as never,
      externalEntryId: entryId,
      progressId: null,
    };
    f.tx.caseTrialRound.findFirst
      .mockResolvedValueOnce({ id: childRoundId, revokedAt: null })
      .mockResolvedValueOnce({
        id: trialRoundId,
        origin: 'EXTERNAL_CURRENT',
        externalEntryId: entryId,
      });
    const response = await f.service.revokeResult(actor, caseId, {
      expectedVersion: 12,
      idempotencyKey: 'external-revoke',
      trialRoundId,
      resultId,
      reason: '真实结果登记错误',
    });
    expect(response.stage).toBe('SECOND_INSTANCE');
    expect(f.tx.case.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          currentTrialRoundId: trialRoundId,
          currentAcceptanceId: null,
          currentJudgmentId: null,
          currentJudgmentNextStepId: null,
        }),
      }),
    );
  });

  it('revokes a real external appeal REMAND without inventing an old acceptance', async () => {
    const { f, result } = await remandedExternalAppealFixture();
    f.tx.caseTrialRound.findFirst
      .mockResolvedValueOnce({
        id: result.currentTrialRoundId,
        revokedAt: null,
      })
      .mockResolvedValueOnce({
        id: trialRoundId,
        origin: 'EXTERNAL_CURRENT',
        externalEntryId: entryId,
      });
    f.tx.caseJudgmentNextStep.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: choiceId, judgmentId });
    f.tx.caseJudgmentFact.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: judgmentId });
    const response = await f.service.revokeResult(actor, caseId, {
      expectedVersion: 12,
      idempotencyKey: 'real-external-appeal-revoke',
      trialRoundId,
      resultId: result.resultId!,
      reason: 'Real appeal remand correction',
    });
    expect(response.stage).toBe('SECOND_INSTANCE');
    expect(f.tx.caseJudgmentFact.findFirst).toHaveBeenLastCalledWith({
      where: {
        id: judgmentId,
        caseId,
        departmentId: actor.departmentId,
        trialRoundId,
        externalEntryId: entryId,
      },
      select: { id: true },
    });
    expect(f.tx.case.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          currentTrialRoundId: trialRoundId,
          currentAcceptanceId: null,
          currentJudgmentId: judgmentId,
          currentJudgmentNextStepId: choiceId,
          courtCaseNo: 'EXTERNAL-CASE-NO',
        }),
      }),
    );
  });

  it('blocks external appeal REMAND revocation after a child acceptance exists', async () => {
    const { f, result } = await remandedExternalAppealFixture();
    f.tx.caseTrialRound.findFirst.mockResolvedValueOnce({
      id: result.currentTrialRoundId,
      revokedAt: null,
    });
    f.tx.caseAcceptance.findFirst.mockResolvedValueOnce({
      id: documentVersionId,
    });
    await expect(
      f.service.revokeResult(actor, caseId, {
        expectedVersion: 12,
        idempotencyKey: 'real-external-appeal-child-fact',
        trialRoundId,
        resultId: result.resultId!,
        reason: 'Too late after child acceptance',
      }),
    ).rejects.toMatchObject({ response: { code: 'INVALID_STATE' } });
    expect(
      f.tx.caseSecondInstanceResultRevocation.create,
    ).not.toHaveBeenCalled();
    expect(f.tx.caseTrialRound.update).not.toHaveBeenCalled();
  });

  it('rejects a null choice for a normal second-instance case', async () => {
    const f = fixture();
    await expect(
      f.service.save(actor, caseId, {
        ...saveInput('normal-null-choice'),
        choiceId: null,
      }),
    ).rejects.toMatchObject({ response: { code: 'INVALID_STATE' } });
    expect(f.tx.caseSecondInstanceProgress.create).not.toHaveBeenCalled();
  });

  it('continues a real appeal after an external judgment without invented acceptance', async () => {
    const f = fixture();
    jest.mocked(readCaseSourceAnchor).mockResolvedValueOnce({
      kind: 'EXTERNAL_ENTRY',
      entryId,
      initialStage: 'WAITING_JUDGMENT',
      stageReachedOn: '2025-12-31',
      known: { acceptedOn: null, secondInstanceAcceptedOn: null },
    } as never);
    f.record.currentTrialRound = {
      origin: 'EXTERNAL_CURRENT',
      externalEntryId: entryId,
      sourceResultId: null,
      revokedAt: null,
    };
    f.record.currentAcceptanceId = null;
    f.record.acceptance = null as never;
    f.record.currentJudgment.externalEntryId = entryId;
    await f.service.save(actor, caseId, saveInput('real-external-appeal'));
    expect(f.tx.caseSecondInstanceProgress.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          choiceId,
          externalEntryId: entryId,
        }),
      }),
    );
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
