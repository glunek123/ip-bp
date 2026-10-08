import { ForbiddenException, Logger } from '@nestjs/common';
import { CaseHearingService } from './case-hearing.service';

const actor = {
  userId: '11111111-1111-4111-8111-111111111111',
  departmentId: '22222222-2222-4222-8222-222222222222',
  authorizationRevision: 1,
};
const caseId = '33333333-3333-4333-8333-333333333333';
const arrangementId = '44444444-4444-4444-8444-444444444444';
const advanceId = '55555555-5555-4555-8555-555555555555';
const request = {
  expectedVersion: 7,
  idempotencyKey: 'hearing-1',
  hearingAt: '2026-10-08',
};

describe('CaseHearingService', () => {
  function fixture() {
    const tx = {
      $queryRawUnsafe: jest.fn().mockResolvedValue([{ id: caseId }]),
      case: {
        findFirst: jest.fn().mockResolvedValue({
          id: caseId,
          departmentId: actor.departmentId,
          stage: 'WAITING_HEARING',
          version: 7,
          responsibleUserId: actor.userId,
          responsibleMembership: { teamId: null },
          acceptance: { acceptedAt: new Date('2026-10-01T00:00:00.000Z') },
          currentHearingArrangementId: null,
          currentHearingAdvanceId: null,
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      userAccount: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ active: true, accountType: 'INTERNAL' }),
      },
      caseHearingReceipt: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
      },
      caseHearingArrangement: {
        create: jest.fn().mockResolvedValue({ id: arrangementId }),
        findUnique: jest.fn().mockResolvedValue({
          id: arrangementId,
          caseId,
          hearingAt: new Date('2026-10-08T00:00:00.000Z'),
          recordedByUserId: actor.userId,
        }),
      },
      caseHearingAdvance: {
        create: jest.fn().mockResolvedValue({ id: advanceId }),
        findUnique: jest.fn().mockResolvedValue(null),
      },
      caseHearingCorrection: { create: jest.fn().mockResolvedValue({}) },
      auditEvent: {
        create: jest
          .fn()
          .mockResolvedValue({ id: '66666666-6666-4666-8666-666666666666' }),
      },
    };
    const database = {
      $transaction: jest.fn(async (fn: (client: typeof tx) => unknown) =>
        fn(tx),
      ),
      case: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const access = { authorizeCase: jest.fn().mockResolvedValue(undefined) };
    const signal = { wake: jest.fn() };
    const clock = { now: () => new Date('2026-10-08T10:00:00.000Z') };
    const service = new CaseHearingService(
      database as never,
      access as never,
      signal as never,
      clock as never,
    );
    return { service, tx, database, access, signal };
  }

  it('rejects an omitted date instead of silently clearing the schedule', async () => {
    const f = fixture();
    await expect(
      f.service.schedule(actor, caseId, {
        ...request,
        hearingAt: undefined,
      } as never),
    ).rejects.toMatchObject({ response: { code: 'VALIDATION_ERROR' } });
    expect(f.database.$transaction).not.toHaveBeenCalled();
  });

  it('rejects a date before the immutable acceptance date', async () => {
    const f = fixture();
    await expect(
      f.service.schedule(actor, caseId, {
        ...request,
        hearingAt: '2026-09-30',
      }),
    ).rejects.toMatchObject({ response: { code: 'VALIDATION_ERROR' } });
    expect(f.tx.caseHearingArrangement.create).not.toHaveBeenCalled();
  });

  it('allows an explicit null date while keeping the case in waiting-hearing', async () => {
    const f = fixture();
    const result = await f.service.schedule(actor, caseId, {
      ...request,
      hearingAt: null,
    });
    expect(result).toMatchObject({
      stage: 'WAITING_HEARING',
      hearingAt: null,
      version: 8,
    });
    expect(
      f.tx.caseHearingArrangement.create.mock.calls[0][0].data.hearingAt,
    ).toBeNull();
  });

  it('rejects an outdated version before writing any hearing facts', async () => {
    const f = fixture();
    await expect(
      f.service.schedule(actor, caseId, { ...request, expectedVersion: 6 }),
    ).rejects.toMatchObject({ response: { code: 'VERSION_CONFLICT' } });
    expect(f.tx.auditEvent.create).not.toHaveBeenCalled();
  });

  it('rejects every hearing correction after a judgment, including a past-date correction', async () => {
    const f = fixture();
    f.tx.case.findFirst.mockResolvedValue({
      id: caseId,
      departmentId: actor.departmentId,
      stage: 'WAITING_JUDGMENT',
      version: 7,
      responsibleUserId: actor.userId,
      responsibleMembership: { teamId: null },
      acceptance: { acceptedAt: new Date('2026-10-01T00:00:00.000Z') },
      currentHearingArrangementId: arrangementId,
      currentHearingAdvanceId: advanceId,
      currentJudgmentId: '77777777-7777-4777-8777-777777777777',
    });
    f.tx.caseHearingAdvance.findUnique.mockResolvedValue({
      id: advanceId,
      arrangementId,
      caseId,
    });
    await expect(
      f.service.correct(actor, caseId, {
        ...request,
        hearingAt: '2026-10-02',
        reason: '录入有误',
      }),
    ).rejects.toMatchObject({ response: { code: 'INVALID_STATE' } });
    expect(f.tx.caseHearingCorrection.create).not.toHaveBeenCalled();
    expect(f.tx.case.updateMany).not.toHaveBeenCalled();
  });

  it('rejects an old-key successful correction replay after judgment without changing facts', async () => {
    const f = fixture();
    const before = {
      ...(await f.tx.case.findFirst()),
      stage: 'WAITING_JUDGMENT',
      version: 9,
      currentHearingArrangementId: arrangementId,
      currentHearingAdvanceId: advanceId,
      currentJudgmentId: null,
    };
    f.tx.case.findFirst.mockResolvedValue(before);
    f.tx.caseHearingAdvance.findUnique.mockResolvedValue({
      id: advanceId,
      arrangementId,
      caseId,
    });
    const correction = {
      expectedVersion: 9,
      idempotencyKey: 'past-correction',
      hearingAt: '2026-10-02',
      reason: '法院通知日期登记有误',
    };
    await f.service.correct(actor, caseId, correction);
    const receipt = f.tx.caseHearingReceipt.create.mock.calls[0][0].data;
    f.tx.caseHearingReceipt.findUnique.mockResolvedValue({ ...receipt });
    f.tx.case.findFirst.mockResolvedValue({
      ...before,
      version: 11,
      currentJudgmentId: '77777777-7777-4777-8777-777777777777',
    });
    await expect(
      f.service.correct(actor, caseId, correction),
    ).rejects.toMatchObject({
      status: 409,
      response: { code: 'INVALID_STATE' },
    });
    expect(f.access.authorizeCase).toHaveBeenCalledTimes(2);
    expect(f.tx.$queryRawUnsafe).toHaveBeenCalledTimes(2);
    expect(f.tx.caseHearingReceipt.findUnique).toHaveBeenCalledTimes(1);
    expect(f.tx.caseHearingCorrection.create).toHaveBeenCalledTimes(1);
    expect(f.tx.auditEvent.create).toHaveBeenCalledTimes(1);
    expect(f.tx.caseHearingReceipt.create).toHaveBeenCalledTimes(1);
    expect(f.tx.case.updateMany).toHaveBeenCalledTimes(1);
  });

  it('rejects a changed payload reusing the same idempotency key', async () => {
    const f = fixture();
    f.tx.caseHearingReceipt.findUnique.mockResolvedValue({
      caseId,
      requestFingerprint: 'different',
    });
    await expect(
      f.service.schedule(actor, caseId, request),
    ).rejects.toMatchObject({ response: { code: 'IDEMPOTENCY_CONFLICT' } });
    expect(f.tx.auditEvent.create).not.toHaveBeenCalled();
  });

  it('rechecks authorization before replaying a saved response', async () => {
    const f = fixture();
    f.access.authorizeCase.mockRejectedValue(new ForbiddenException());
    await expect(
      f.service.schedule(actor, caseId, request),
    ).rejects.toMatchObject({ response: { code: 'ACTION_FORBIDDEN' } });
    expect(f.tx.caseHearingReceipt.findUnique).not.toHaveBeenCalled();
  });

  it('saves one arrangement, human audit, and receipt atomically, then wakes scanning', async () => {
    const f = fixture();
    const result = await f.service.schedule(actor, caseId, request);
    expect(result).toMatchObject({
      id: caseId,
      stage: 'WAITING_HEARING',
      version: 8,
      hearingAt: request.hearingAt,
    });
    expect(result.arrangementId).toMatch(/^[0-9a-f-]{36}$/u);
    expect(f.tx.caseHearingArrangement.create.mock.calls[0][0].data.id).toBe(
      result.arrangementId,
    );
    expect(f.tx.caseHearingArrangement.create).toHaveBeenCalledTimes(1);
    expect(f.tx.auditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actorUserId: actor.userId,
          action: 'case.hearing.scheduled',
        }),
      }),
    );
    expect(f.tx.caseHearingReceipt.create).toHaveBeenCalledTimes(1);
    expect(f.signal.wake).toHaveBeenCalledTimes(1);
  });

  it('a correction of an overdue date remains in judgment and keeps the original advance', async () => {
    const f = fixture();
    f.tx.case.findFirst.mockResolvedValue({
      ...(await f.tx.case.findFirst()),
      stage: 'WAITING_JUDGMENT',
      version: 9,
      currentHearingArrangementId: arrangementId,
      currentHearingAdvanceId: advanceId,
    });
    f.tx.caseHearingAdvance.findUnique.mockResolvedValue({
      id: advanceId,
      arrangementId,
      caseId,
    });
    const result = await f.service.correct(actor, caseId, {
      expectedVersion: 9,
      idempotencyKey: 'correct-1',
      hearingAt: '2026-10-02',
      reason: '法院通知日期登记有误',
    });
    expect(result.stage).toBe('WAITING_JUDGMENT');
    expect(f.tx.case.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ currentHearingAdvanceId: advanceId }),
      }),
    );
  });

  it('records a fresh execution time for each case after acquiring its lock', async () => {
    const f = fixture();
    const secondCaseId = '77777777-7777-4777-8777-777777777777';
    const secondArrangementId = '88888888-8888-4888-8888-888888888888';
    f.database.case.findMany.mockResolvedValue([
      { id: caseId, departmentId: actor.departmentId },
      { id: secondCaseId, departmentId: actor.departmentId },
    ]);
    f.tx.$queryRawUnsafe.mockImplementation((sql: string, id: string) =>
      sql.includes('FOR UPDATE')
        ? Promise.resolve([{ id }])
        : Promise.resolve([{ due_at: new Date('2026-10-08T16:00:00.000Z') }]),
    );
    f.tx.case.findFirst.mockImplementation(
      ({ where }: { where: { id: string } }) =>
        Promise.resolve({
          stage: 'WAITING_HEARING',
          version: 8,
          currentHearingArrangementId:
            where.id === caseId ? arrangementId : secondArrangementId,
          currentHearingAdvanceId: null,
          currentHearingArrangement: {
            id: where.id === caseId ? arrangementId : secondArrangementId,
            hearingAt: new Date('2026-10-08T00:00:00.000Z'),
            toVersion: 8,
          },
        }),
    );
    const actualTimes = [
      new Date('2026-10-08T16:03:00.000Z'),
      new Date('2026-10-08T16:05:00.000Z'),
    ];
    const service = new CaseHearingService(
      f.database as never,
      f.access as never,
      f.signal as never,
      { now: jest.fn().mockImplementation(() => actualTimes.shift()) } as never,
    );
    expect(
      await service.advanceDue(new Date('2026-10-08T16:00:00.000Z')),
    ).toEqual({ advanced: 2, failed: 0 });
    expect(
      f.tx.caseHearingAdvance.create.mock.calls.map(([arg]) =>
        arg.data.executedAt.toISOString(),
      ),
    ).toEqual(['2026-10-08T16:03:00.000Z', '2026-10-08T16:05:00.000Z']);
    expect(
      f.tx.auditEvent.create.mock.calls.map(
        ([arg]) => arg.data.details.executedAt,
      ),
    ).toEqual(['2026-10-08T16:03:00.000Z', '2026-10-08T16:05:00.000Z']);
  });

  it('logs a failed case and a safe error code while continuing with the next case', async () => {
    const f = fixture();
    const secondCaseId = '77777777-7777-4777-8777-777777777777';
    f.database.case.findMany.mockResolvedValue([
      { id: caseId, departmentId: actor.departmentId },
      { id: secondCaseId, departmentId: actor.departmentId },
    ]);
    f.tx.$queryRawUnsafe.mockImplementation((sql: string, id: string) =>
      sql.includes('FOR UPDATE')
        ? Promise.resolve([{ id }])
        : Promise.resolve([{ due_at: new Date('2026-10-08T16:00:00.000Z') }]),
    );
    f.tx.case.findFirst.mockImplementation(
      ({ where }: { where: { id: string } }) =>
        Promise.resolve({
          stage: 'WAITING_HEARING',
          version: 8,
          currentHearingArrangementId: arrangementId,
          currentHearingAdvanceId: null,
          currentHearingArrangement: {
            id: arrangementId,
            hearingAt: new Date('2026-10-08T00:00:00.000Z'),
            toVersion: 8,
          },
          id: where.id,
        }),
    );
    f.tx.auditEvent.create.mockRejectedValueOnce(
      Object.assign(new Error('sensitive database text'), { code: '23514' }),
    );
    const service = new CaseHearingService(
      f.database as never,
      f.access as never,
      f.signal as never,
      { now: () => new Date('2026-10-08T16:03:00.000Z') } as never,
    );
    const logged = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    try {
      expect(
        await service.advanceDue(new Date('2026-10-08T16:00:00.000Z')),
      ).toEqual({ advanced: 1, failed: 1 });
      const output = logged.mock.calls.flat().map(String).join(' ');
      expect(output).toContain(caseId);
      expect(output).toContain('23514');
      expect(output).not.toContain('sensitive database text');
    } finally {
      logged.mockRestore();
    }
  });
});
