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
});
