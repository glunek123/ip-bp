import { CaseRecordEditService } from './case-record-edit.service';

const actor = {
  userId: '11111111-1111-4111-8111-111111111111',
  departmentId: '22222222-2222-4222-8222-222222222222',
  authorizationRevision: 1,
};
const caseId = '33333333-3333-4333-8333-333333333333';
const defendantId = '44444444-4444-4444-8444-444444444444';
const acceptanceId = '55555555-5555-4555-8555-555555555555';
const roundId = '66666666-6666-4666-8666-666666666666';
const choiceId = '99999999-9999-4999-8999-999999999999';
const secondInput = {
  choiceId,
  trialRoundId: roundId,
  expectedAcceptanceRevision: 0,
  idempotencyKey: 'second-acceptance-1',
  acceptedAt: '2026-10-09',
  courtCaseNo: null,
  reason: null,
};
const contactInput = {
  defendantId,
  expectedContactRevision: 0,
  idempotencyKey: 'contact-1',
  phone: ' 123456 ',
  address: ' 北京 ',
};
const acceptanceInput = {
  acceptanceId,
  expectedAcceptanceRevision: 0,
  idempotencyKey: 'acceptance-1',
  acceptedAt: '2026-10-03',
  courtCaseNo: ' （2026）京01民初2号 ',
  reason: ' 原日期和案号录入错误 ',
};

describe('CaseRecordEditService', () => {
  function fixture() {
    const record = {
      id: caseId,
      departmentId: actor.departmentId,
      responsibleUserId: actor.userId,
      responsibleMembership: { teamId: null },
      currentAcceptanceId: acceptanceId,
      currentTrialRoundId: roundId,
      currentJudgmentNextStepId: choiceId,
      sourceLeadId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      sourceNotaryMatterId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      certificateId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      externalEntry: null,
      filingSubmission: { submittedAt: new Date('2026-10-01T00:00:00.000Z') },
      hearingArrangements: [],
      judgmentFacts: [],
      secondInstanceProgresses: [],
      secondInstanceResults: [],
      executionSubmissions: [],
      executionMailing: null,
      executionFiling: null,
      executionFinish: null,
      closure: null,
      archive: null,
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
      caseRecordEditReceipt: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
      },
      caseDefendant: {
        findFirst: jest.fn().mockResolvedValue({
          phone: null,
          address: null,
          contactRevision: 0,
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      caseDefendantContactChange: { create: jest.fn().mockResolvedValue({}) },
      caseAcceptance: {
        findFirst: jest.fn().mockResolvedValue({
          trialRoundId: roundId,
          acceptedAt: new Date('2026-10-02T00:00:00.000Z'),
          courtCaseNo: '（2026）京01民初1号',
          corrections: [],
        }),
      },
      caseAcceptanceCorrection: { create: jest.fn().mockResolvedValue({}) },
      caseJudgmentNextStep: {
        findFirst: jest.fn().mockResolvedValue({
          id: choiceId,
          judgment: {
            judgmentReceivedAt: new Date('2026-10-08T00:00:00.000Z'),
          },
        }),
      },
      caseTrialRound: {
        findFirst: jest.fn().mockResolvedValue({ id: roundId }),
      },
      caseSecondInstanceAcceptanceChange: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
      },
      caseSecondInstanceProgress: { count: jest.fn().mockResolvedValue(0) },
      caseSecondInstanceResult: { count: jest.fn().mockResolvedValue(0) },
      $queryRaw: jest.fn().mockResolvedValue([{ valid: true }]),
      auditEvent: {
        create: jest
          .fn()
          .mockResolvedValue({ id: '77777777-7777-4777-8777-777777777777' }),
      },
    };
    const database = {
      $transaction: jest.fn(async (work: (transaction: typeof tx) => unknown) =>
        work(tx),
      ),
    };
    const access = { authorizeCase: jest.fn().mockResolvedValue(undefined) };
    return {
      record,
      tx,
      access,
      service: new CaseRecordEditService(database as never, access as never),
    };
  }

  it('appends a contact change and only advances contact revision', async () => {
    const f = fixture();
    const result = await f.service.updateContact(actor, caseId, contactInput);
    expect(result).toMatchObject({
      caseId,
      defendantId,
      contactRevision: 1,
      phone: '123456',
      address: '北京',
    });
    expect(f.tx.caseDefendant.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ contactRevision: 0, id: defendantId }),
        data: {
          phone: '123456',
          address: '北京',
          contactRevision: { increment: 1 },
        },
      }),
    );
    expect(f.tx.case.updateMany).not.toHaveBeenCalled();
    expect(f.tx.caseDefendantContactChange.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          beforePhone: null,
          beforeAddress: null,
          phone: '123456',
          address: '北京',
        }),
      }),
    );
  });

  it('rejects stale contact revision and a no-op without writing', async () => {
    const f = fixture();
    await expect(
      f.service.updateContact(actor, caseId, {
        ...contactInput,
        expectedContactRevision: 1,
      }),
    ).rejects.toMatchObject({ response: { code: 'VERSION_CONFLICT' } });
    f.tx.caseDefendant.findFirst.mockResolvedValue({
      phone: '123456',
      address: '北京',
      contactRevision: 0,
    });
    await expect(
      f.service.updateContact(actor, caseId, contactInput),
    ).rejects.toMatchObject({ response: { code: 'VALIDATION_ERROR' } });
    expect(f.tx.auditEvent.create).not.toHaveBeenCalled();
  });

  it('applies contact length limits after trimming', async () => {
    const f = fixture();
    const result = await f.service.updateContact(actor, caseId, {
      ...contactInput,
      phone: `  ${'1'.repeat(100)}  `,
      address: `  ${'a'.repeat(500)}  `,
    });
    expect(result).toMatchObject({
      phone: '1'.repeat(100),
      address: 'a'.repeat(500),
    });
    await expect(
      f.service.updateContact(actor, caseId, {
        ...contactInput,
        phone: ` ${'1'.repeat(101)} `,
      }),
    ).rejects.toMatchObject({ response: { code: 'VALIDATION_ERROR' } });
    await expect(
      f.service.updateContact(actor, caseId, {
        ...contactInput,
        address: ` ${'a'.repeat(501)} `,
      }),
    ).rejects.toMatchObject({ response: { code: 'VALIDATION_ERROR' } });
    expect(f.tx.caseDefendantContactChange.create).toHaveBeenCalledTimes(1);
  });

  it('rechecks current authorization before returning a saved receipt', async () => {
    const f = fixture();
    const saved = await f.service.updateContact(actor, caseId, contactInput);
    f.tx.caseRecordEditReceipt.findUnique.mockResolvedValue({
      caseId,
      requestFingerprint:
        f.tx.caseRecordEditReceipt.create.mock.calls[0][0].data
          .requestFingerprint,
      resultSnapshot: saved,
    });
    f.access.authorizeCase.mockRejectedValue(
      new (await import('@nestjs/common')).ForbiddenException(),
    );
    await expect(
      f.service.updateContact(actor, caseId, contactInput),
    ).rejects.toMatchObject({ response: { code: 'ACTION_FORBIDDEN' } });
    expect(f.tx.caseDefendantContactChange.create).toHaveBeenCalledTimes(1);
  });

  it('corrects the current round without changing the case workflow version', async () => {
    const f = fixture();
    const result = await f.service.correctAcceptance(
      actor,
      caseId,
      acceptanceInput,
    );
    expect(result).toMatchObject({
      caseId,
      acceptanceId,
      acceptanceRevision: 1,
      acceptedAt: '2026-10-03',
      courtCaseNo: '（2026）京01民初2号',
    });
    expect(f.tx.case.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { courtCaseNo: '（2026）京01民初2号' },
      }),
    );
    expect(f.tx.caseAcceptanceCorrection.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          priorCorrectionId: null,
          fromRevision: 0,
          toRevision: 1,
          reason: '原日期和案号录入错误',
        }),
      }),
    );
    expect(f.tx.case.updateMany.mock.calls[0][0].data).not.toHaveProperty(
      'version',
    );
  });

  it('applies court number and reason limits after trimming', async () => {
    const f = fixture();
    const result = await f.service.correctAcceptance(actor, caseId, {
      ...acceptanceInput,
      courtCaseNo: `  ${'C'.repeat(100)}  `,
      reason: `  ${'r'.repeat(500)}  `,
    });
    expect(result.courtCaseNo).toBe('C'.repeat(100));
    expect(
      f.tx.caseAcceptanceCorrection.create.mock.calls[0][0].data.reason,
    ).toBe('r'.repeat(500));
    await expect(
      f.service.correctAcceptance(actor, caseId, {
        ...acceptanceInput,
        courtCaseNo: ` ${'C'.repeat(101)} `,
      }),
    ).rejects.toMatchObject({ response: { code: 'VALIDATION_ERROR' } });
    await expect(
      f.service.correctAcceptance(actor, caseId, {
        ...acceptanceInput,
        reason: ` ${'r'.repeat(501)} `,
      }),
    ).rejects.toMatchObject({ response: { code: 'VALIDATION_ERROR' } });
    expect(f.tx.caseAcceptanceCorrection.create).toHaveBeenCalledTimes(1);
  });

  it('corrects a historical round without changing the current court number', async () => {
    const f = fixture();
    f.record.currentAcceptanceId = '88888888-8888-4888-8888-888888888888';
    await f.service.correctAcceptance(actor, caseId, acceptanceInput);
    expect(f.tx.case.updateMany).not.toHaveBeenCalled();
  });

  it('rejects a correction after an actual hearing date or before filing', async () => {
    const f = fixture();
    f.record.hearingArrangements.push({
      hearingAt: new Date('2026-10-02T00:00:00.000Z'),
    } as never);
    await expect(
      f.service.correctAcceptance(actor, caseId, acceptanceInput),
    ).rejects.toMatchObject({ response: { code: 'VALIDATION_ERROR' } });
    expect(f.tx.auditEvent.create).not.toHaveBeenCalled();
    f.record.hearingArrangements.pop();
    await expect(
      f.service.correctAcceptance(actor, caseId, {
        ...acceptanceInput,
        acceptedAt: '2026-09-30',
      }),
    ).rejects.toMatchObject({ response: { code: 'VALIDATION_ERROR' } });
  });

  it('rejects a remand child correction that would precede parent second acceptance', async () => {
    const f = fixture();
    f.tx.$queryRaw.mockResolvedValue([{ valid: false }]);
    await expect(
      f.service.correctAcceptance(actor, caseId, acceptanceInput),
    ).rejects.toMatchObject({ response: { code: 'VALIDATION_ERROR' } });
    expect(f.tx.caseAcceptanceCorrection.create).not.toHaveBeenCalled();
  });

  it('records a partial second-instance acceptance without changing case workflow', async () => {
    const f = fixture();
    const result = await f.service.saveSecondInstanceAcceptance(
      actor,
      caseId,
      secondInput,
    );
    expect(result).toMatchObject({
      choiceId,
      trialRoundId: roundId,
      acceptanceRevision: 1,
      acceptedAt: '2026-10-09',
      courtCaseNo: null,
    });
    expect(f.tx.caseSecondInstanceAcceptanceChange.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          priorChangeId: null,
          fromRevision: 0,
          toRevision: 1,
          reason: null,
          courtCaseNo: null,
        }),
      }),
    );
    expect(f.tx.case.updateMany).not.toHaveBeenCalled();
    expect(f.tx.caseRecordEditReceipt.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          command: 'SECOND_INSTANCE_ACCEPTANCE_SAVE',
        }),
      }),
    );
  });

  it('records a direct second-instance acceptance against the real entry and local round', async () => {
    const f = fixture();
    f.record.sourceLeadId = null as never;
    f.record.sourceNotaryMatterId = null as never;
    f.record.certificateId = null as never;
    f.record.currentJudgmentNextStepId = null as never;
    f.record.externalEntry = {
      id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      caseId,
      departmentId: actor.departmentId,
      initialStage: 'SECOND_INSTANCE',
      stageReachedOn: new Date('2026-10-08T00:00:00.000Z'),
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
    } as never;
    const direct = { ...secondInput, choiceId: null };
    const result = await f.service.saveSecondInstanceAcceptance(
      actor,
      caseId,
      direct,
    );
    expect(result.choiceId).toBeNull();
    expect(f.tx.caseJudgmentNextStep.findFirst).not.toHaveBeenCalled();
    expect(f.tx.caseSecondInstanceAcceptanceChange.create).toHaveBeenCalledWith(
      {
        data: expect.objectContaining({
          choiceId: null,
          externalEntryId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        }),
      },
    );
  });

  it('rejects null choice on a normal-source second-instance case', async () => {
    const f = fixture();
    await expect(
      f.service.saveSecondInstanceAcceptance(actor, caseId, {
        ...secondInput,
        choiceId: null,
      }),
    ).rejects.toMatchObject({ response: { code: 'INVALID_STATE' } });
    expect(
      f.tx.caseSecondInstanceAcceptanceChange.create,
    ).not.toHaveBeenCalled();
  });

  it('requires a reason on correction and permits clearing a mistaken field', async () => {
    const f = fixture();
    f.tx.caseSecondInstanceAcceptanceChange.findFirst.mockResolvedValue({
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      toRevision: 1,
      acceptedAt: new Date('2026-10-09T00:00:00.000Z'),
      courtCaseNo: null,
    });
    await expect(
      f.service.saveSecondInstanceAcceptance(actor, caseId, {
        ...secondInput,
        expectedAcceptanceRevision: 1,
        acceptedAt: null,
        reason: null,
      }),
    ).rejects.toMatchObject({ response: { code: 'VALIDATION_ERROR' } });
    const result = await f.service.saveSecondInstanceAcceptance(actor, caseId, {
      ...secondInput,
      expectedAcceptanceRevision: 1,
      acceptedAt: null,
      courtCaseNo: '  二审案号  ',
      reason: '  原日期误填  ',
    });
    expect(result).toMatchObject({
      acceptanceRevision: 2,
      acceptedAt: null,
      courtCaseNo: '二审案号',
    });
    expect(f.tx.caseSecondInstanceAcceptanceChange.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          fromRevision: 1,
          toRevision: 2,
          acceptedAt: null,
          reason: '原日期误填',
        }),
      }),
    );
  });

  it('rechecks authorization before replaying the original second-instance receipt', async () => {
    const f = fixture();
    const saved = await f.service.saveSecondInstanceAcceptance(
      actor,
      caseId,
      secondInput,
    );
    f.tx.caseRecordEditReceipt.findUnique.mockResolvedValue({
      caseId,
      requestFingerprint:
        f.tx.caseRecordEditReceipt.create.mock.calls[0][0].data
          .requestFingerprint,
      resultSnapshot: saved,
    });
    f.access.authorizeCase.mockRejectedValue(
      new (await import('@nestjs/common')).ForbiddenException(),
    );
    await expect(
      f.service.saveSecondInstanceAcceptance(actor, caseId, secondInput),
    ).rejects.toMatchObject({ response: { code: 'ACTION_FORBIDDEN' } });
    expect(
      f.tx.caseSecondInstanceAcceptanceChange.create,
    ).toHaveBeenCalledTimes(1);
  });
});
