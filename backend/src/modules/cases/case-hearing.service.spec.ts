import { ForbiddenException, Logger } from '@nestjs/common';
import { CaseHearingService } from './case-hearing.service';
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
const arrangementId = '44444444-4444-4444-8444-444444444444';
const advanceId = '55555555-5555-4555-8555-555555555555';
const trialRoundId = '99999999-9999-4999-8999-999999999999';
const entryId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const externalHearing = {
  kind: 'EXTERNAL_ENTRY' as const,
  entryId,
  initialStage: 'WAITING_HEARING' as const,
  stageReachedOn: '2026-10-03',
  known: { acceptedOn: '2026-10-04' },
};
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
          currentTrialRoundId: trialRoundId,
          responsibleUserId: actor.userId,
          responsibleMembership: { teamId: null },
          acceptance: {
            acceptedAt: new Date('2026-10-01T00:00:00.000Z'),
            corrections: [],
          },
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

  it('schedules the real external current round without creating acceptance', async () => {
    const f = fixture();
    jest
      .mocked(readCaseSourceAnchor)
      .mockResolvedValueOnce(externalHearing as never);
    const record = await f.tx.case.findFirst();
    f.tx.case.findFirst.mockResolvedValue({
      ...record,
      acceptance: null,
      currentTrialRound: {
        origin: 'EXTERNAL_CURRENT',
        externalEntryId: entryId,
        sourceResultId: null,
        revokedAt: null,
      },
    });
    await f.service.schedule(actor, caseId, request);
    expect(f.tx.caseHearingArrangement.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          trialRoundId,
          externalEntryId: entryId,
          source: 'SCHEDULE',
        }),
      }),
    );
    expect(f.tx.caseHearingAdvance.create).not.toHaveBeenCalled();
  });

  it('enforces both entry date and known accepted date before external schedule', async () => {
    const f = fixture();
    jest
      .mocked(readCaseSourceAnchor)
      .mockResolvedValueOnce(externalHearing as never);
    const record = await f.tx.case.findFirst();
    f.tx.case.findFirst.mockResolvedValue({
      ...record,
      acceptance: null,
      currentTrialRound: {
        origin: 'EXTERNAL_CURRENT',
        externalEntryId: entryId,
        sourceResultId: null,
        revokedAt: null,
      },
    });
    await expect(
      f.service.schedule(actor, caseId, {
        ...request,
        hearingAt: '2026-10-03',
      }),
    ).rejects.toMatchObject({ response: { code: 'VALIDATION_ERROR' } });
    expect(f.tx.caseHearingArrangement.create).not.toHaveBeenCalled();
  });

  it('compares hearing dates with the effective corrected acceptance date', async () => {
    const f = fixture();
    const record = await f.tx.case.findFirst();
    f.tx.case.findFirst.mockResolvedValue({
      ...record,
      acceptance: {
        acceptedAt: new Date('2026-10-01T00:00:00.000Z'),
        corrections: [{ acceptedAt: new Date('2026-10-04T00:00:00.000Z') }],
      },
    });
    await expect(
      f.service.schedule(actor, caseId, {
        ...request,
        hearingAt: '2026-10-03',
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
      acceptance: {
        acceptedAt: new Date('2026-10-01T00:00:00.000Z'),
        corrections: [],
      },
      currentHearingArrangementId: arrangementId,
      currentHearingAdvanceId: advanceId,
      currentJudgmentId: '77777777-7777-4777-8777-777777777777',
    });
    f.tx.caseHearingAdvance.findUnique.mockResolvedValue({
      id: advanceId,
      departmentId: actor.departmentId,
      toVersion: 9,
      arrangementId,
      caseId,
      trialRoundId,
      externalEntryId: null,
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
      departmentId: actor.departmentId,
      toVersion: 9,
      arrangementId,
      caseId,
      trialRoundId,
      externalEntryId: null,
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
      departmentId: actor.departmentId,
      toVersion: 9,
      arrangementId,
      caseId,
      trialRoundId,
      externalEntryId: null,
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

  function correctionFixture() {
    const f = fixture();
    f.tx.case.findFirst.mockResolvedValue({
      id: caseId,
      departmentId: actor.departmentId,
      stage: 'WAITING_JUDGMENT',
      version: 11,
      currentTrialRoundId: trialRoundId,
      responsibleUserId: actor.userId,
      responsibleMembership: { teamId: null },
      acceptance: {
        acceptedAt: new Date('2026-10-01T00:00:00.000Z'),
        corrections: [],
      },
      currentHearingArrangementId: 'current-correction',
      currentHearingAdvanceId: advanceId,
      currentJudgmentId: null,
    });
    const advance = {
      id: advanceId,
      departmentId: actor.departmentId,
      caseId,
      arrangementId,
      trialRoundId,
      externalEntryId: null,
      toVersion: 9,
    };
    const correction = {
      caseId,
      departmentId: actor.departmentId,
      newArrangementId: 'current-correction',
      priorAdvanceId: advanceId,
      resultStage: 'WAITING_JUDGMENT',
      fromVersion: 10,
      toVersion: 11,
    };
    const arrangement = {
      id: 'current-correction',
      caseId,
      departmentId: actor.departmentId,
      trialRoundId,
      externalEntryId: null,
      source: 'CORRECTION',
      fromVersion: 10,
      toVersion: 11,
      correctionAsNew: correction,
    };
    f.tx.caseHearingAdvance.findUnique.mockResolvedValue(advance);
    f.tx.caseHearingArrangement.findUnique.mockResolvedValue(arrangement);
    const input = {
      expectedVersion: 11,
      idempotencyKey: 'third-correction',
      hearingAt: '2026-10-07',
      reason: '法院再次通知改期',
    };
    return { ...f, advance, arrangement, correction, input };
  }

  it.each(['2026-10-08', '2026-10-10', null])(
    'continues two past-date corrections into %s, preserving the original advance history',
    async (hearingAt) => {
      const f = correctionFixture();
      const result = await f.service.correct(actor, caseId, {
        ...f.input,
        hearingAt,
      });
      expect(result).toMatchObject({
        stage: 'WAITING_HEARING',
        version: 12,
        hearingAt,
      });
      expect(f.tx.caseHearingArrangement.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'current-correction' } }),
      );
      expect(f.tx.caseHearingCorrection.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            priorArrangementId: 'current-correction',
            priorAdvanceId: advanceId,
            newArrangementId: result.arrangementId,
            fromVersion: 11,
            toVersion: 12,
          }),
        }),
      );
      expect(f.tx.case.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ currentHearingAdvanceId: null }),
        }),
      );
      expect(f.tx.caseHearingAdvance.create).not.toHaveBeenCalled();
      expect(f.signal.wake).toHaveBeenCalledTimes(1);
    },
  );

  it('continues another past-date correction without inventing a second advance', async () => {
    const f = correctionFixture();
    expect(await f.service.correct(actor, caseId, f.input)).toMatchObject({
      stage: 'WAITING_JUDGMENT',
      version: 12,
    });
    expect(f.tx.case.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ currentHearingAdvanceId: advanceId }),
      }),
    );
    expect(f.tx.caseHearingAdvance.create).not.toHaveBeenCalled();
    expect(f.signal.wake).not.toHaveBeenCalled();
  });

  it('continues the exact external source without requiring a fabricated acceptance', async () => {
    const f = correctionFixture();
    jest
      .mocked(readCaseSourceAnchor)
      .mockResolvedValueOnce(externalHearing as never);
    const record = await f.tx.case.findFirst();
    f.tx.case.findFirst.mockResolvedValue({
      ...record,
      acceptance: null,
      currentTrialRound: {
        origin: 'EXTERNAL_CURRENT',
        externalEntryId: entryId,
        sourceResultId: null,
        revokedAt: null,
      },
    });
    Object.assign(f.advance, { externalEntryId: entryId });
    Object.assign(f.arrangement, { externalEntryId: entryId });
    expect(await f.service.correct(actor, caseId, f.input)).toMatchObject({
      stage: 'WAITING_JUDGMENT',
    });
    expect(f.tx.caseHearingArrangement.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          externalEntryId: entryId,
          trialRoundId,
        }),
      }),
    );
  });

  it('rejects a stale direct advance version without consulting unrelated corrections', async () => {
    const f = correctionFixture();
    Object.assign(f.advance, { arrangementId: 'current-correction' });
    await expect(
      f.service.correct(actor, caseId, f.input),
    ).rejects.toMatchObject({ response: { code: 'INVALID_STATE' } });
    expect(f.tx.caseHearingArrangement.findUnique).not.toHaveBeenCalled();
  });

  it.each([
    ['advance case', 'advance', 'caseId', 'other'],
    ['advance department', 'advance', 'departmentId', 'other'],
    ['advance round', 'advance', 'trialRoundId', 'other'],
    ['advance source', 'advance', 'externalEntryId', entryId],
    ['advance pointer', 'advance', 'id', 'other'],
    ['advance future version', 'advance', 'toVersion', 12],
    ['arrangement case', 'arrangement', 'caseId', 'other'],
    ['arrangement department', 'arrangement', 'departmentId', 'other'],
    ['arrangement round', 'arrangement', 'trialRoundId', 'other'],
    ['arrangement source anchor', 'arrangement', 'externalEntryId', entryId],
    ['arrangement type', 'arrangement', 'source', 'SCHEDULE'],
    ['arrangement pointer', 'arrangement', 'id', 'other'],
    ['arrangement stale version', 'arrangement', 'toVersion', 10],
    ['arrangement broken version step', 'arrangement', 'fromVersion', 9],
    ['missing correction', 'arrangement', 'correctionAsNew', null],
    ['correction case', 'correction', 'caseId', 'other'],
    ['correction department', 'correction', 'departmentId', 'other'],
    ['correction new arrangement', 'correction', 'newArrangementId', 'other'],
    ['correction prior advance', 'correction', 'priorAdvanceId', 'other'],
    ['correction result stage', 'correction', 'resultStage', 'WAITING_HEARING'],
    ['correction from version', 'correction', 'fromVersion', 9],
    ['correction to version', 'correction', 'toVersion', 10],
  ])(
    'rejects broken continuation proof: %s',
    async (_name, entity, key, value) => {
      const f = correctionFixture();
      const target =
        entity === 'advance'
          ? f.advance
          : entity === 'arrangement'
            ? f.arrangement
            : f.correction;
      Object.assign(target, { [key as string]: value });
      await expect(
        f.service.correct(actor, caseId, f.input),
      ).rejects.toMatchObject({
        response: { code: 'INVALID_STATE' },
      });
      expect(f.tx.auditEvent.create).not.toHaveBeenCalled();
      expect(f.tx.caseHearingCorrection.create).not.toHaveBeenCalled();
    },
  );

  it('rejects a stale request before querying the correction chain', async () => {
    const f = correctionFixture();
    await expect(
      f.service.correct(actor, caseId, {
        ...f.input,
        expectedVersion: 10,
      }),
    ).rejects.toMatchObject({ response: { code: 'VERSION_CONFLICT' } });
    expect(f.tx.caseHearingAdvance.findUnique).not.toHaveBeenCalled();
    expect(f.tx.caseHearingArrangement.findUnique).not.toHaveBeenCalled();
  });

  it('replays an unknown committed outcome without reading the now superseded chain', async () => {
    const f = correctionFixture();
    const result = await f.service.correct(actor, caseId, f.input);
    const receipt = f.tx.caseHearingReceipt.create.mock.calls[0][0].data;
    f.tx.caseHearingReceipt.findUnique.mockResolvedValue(receipt);
    f.tx.caseHearingArrangement.findUnique.mockClear().mockResolvedValue(null);
    expect(await f.service.correct(actor, caseId, f.input)).toEqual(result);
    expect(f.tx.caseHearingArrangement.findUnique).not.toHaveBeenCalled();
    await expect(
      f.service.correct(actor, caseId, {
        ...f.input,
        hearingAt: null,
      }),
    ).rejects.toMatchObject({ response: { code: 'IDEMPOTENCY_CONFLICT' } });
    f.access.authorizeCase.mockRejectedValue(new ForbiddenException());
    await expect(
      f.service.correct(actor, caseId, f.input),
    ).rejects.toMatchObject({
      response: { code: 'ACTION_FORBIDDEN' },
    });
    expect(f.tx.caseHearingCorrection.create).toHaveBeenCalledTimes(1);
    expect(f.tx.auditEvent.create).toHaveBeenCalledTimes(1);
  });

  function effectiveScanFixture(
    originalDate: string | null,
    headDate?: string | null,
  ) {
    const f = fixture();
    const date = (value: string | null) =>
      value === null ? null : new Date(`${value}T00:00:00.000Z`);
    const record = {
      stage: 'WAITING_HEARING',
      version: 8,
      currentTrialRoundId: trialRoundId,
      currentHearingArrangementId: arrangementId,
      currentHearingAdvanceId: null,
      currentHearingArrangement: {
        id: arrangementId,
        hearingAt: date(originalDate),
        toVersion: 8,
        trialRoundId,
        externalEntryId: null,
        recordCorrections:
          headDate === undefined ? [] : [{ hearingAt: date(headDate) }],
      },
    };
    f.database.case.findMany.mockResolvedValue([
      { id: caseId, departmentId: actor.departmentId },
    ]);
    f.tx.case.findFirst.mockResolvedValue(record);
    f.tx.$queryRawUnsafe.mockImplementation((sql: string) =>
      sql.includes('FOR UPDATE')
        ? Promise.resolve([{ id: caseId }])
        : Promise.resolve([{ due_at: new Date('2026-10-07T16:00:00.000Z') }]),
    );
    return { ...f, record };
  }

  it.each(['2026-10-12', null])(
    'advances original %s using the exact past-date record head',
    async (originalDate) => {
      const f = effectiveScanFixture(originalDate, '2026-10-07');
      expect(
        await f.service.advanceDue(new Date('2026-10-08T10:00:00.000Z')),
      ).toEqual({ advanced: 1, failed: 0 });
      expect(f.database.case.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            currentHearingArrangement: {
              is: {
                OR: [
                  { hearingAt: { lt: new Date('2026-10-08T00:00:00.000Z') } },
                  {
                    recordCorrections: {
                      some: {
                        hearingAt: { lt: new Date('2026-10-08T00:00:00.000Z') },
                      },
                    },
                  },
                ],
              },
            },
          }),
        }),
      );
      expect(f.tx.case.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          select: expect.objectContaining({
            currentHearingArrangement: {
              select: expect.objectContaining({
                recordCorrections: {
                  orderBy: { toRevision: 'desc' },
                  take: 1,
                  select: { hearingAt: true },
                },
              }),
            },
          }),
        }),
      );
      expect(f.tx.$queryRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining('$1::date'),
        '2026-10-07',
      );
      expect(f.tx.caseHearingAdvance.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            arrangementId,
            dueAt: new Date('2026-10-07T16:00:00.000Z'),
            fromVersion: 8,
            toVersion: 9,
          }),
        }),
      );
    },
  );

  it.each(['2026-10-12', '2026-10-08', null])(
    'does not advance a past original date when the latest record head is %s',
    async (headDate) => {
      const f = effectiveScanFixture('2026-10-06', headDate);
      expect(
        await f.service.advanceDue(new Date('2026-10-08T10:00:00.000Z')),
      ).toEqual({ advanced: 0, failed: 0 });
      expect(f.tx.caseHearingAdvance.create).not.toHaveBeenCalled();
      expect(f.tx.auditEvent.create).not.toHaveBeenCalled();
    },
  );

  it('uses the original date only when the arrangement has no record correction', async () => {
    const f = effectiveScanFixture('2026-10-07');
    expect(
      await f.service.advanceDue(new Date('2026-10-08T10:00:00.000Z')),
    ).toEqual({ advanced: 1, failed: 0 });
    expect(f.tx.$queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('$1::date'),
      '2026-10-07',
    );
  });

  it.each(['2026-10-12', null])(
    'rereads record correction %s committed before acquiring the case lock',
    async (headDate) => {
      const f = effectiveScanFixture('2026-10-06', '2026-10-07');
      f.tx.$queryRawUnsafe.mockImplementation((sql: string) => {
        if (sql.includes('FOR UPDATE')) {
          f.record.currentHearingArrangement.recordCorrections = [
            {
              hearingAt:
                headDate === null
                  ? null
                  : new Date(`${headDate}T00:00:00.000Z`),
            },
          ];
          return Promise.resolve([{ id: caseId }]);
        }
        return Promise.resolve([
          { due_at: new Date('2026-10-07T16:00:00.000Z') },
        ]);
      });
      expect(
        await f.service.advanceDue(new Date('2026-10-08T10:00:00.000Z')),
      ).toEqual({ advanced: 0, failed: 0 });
      expect(f.tx.caseHearingAdvance.create).not.toHaveBeenCalled();
    },
  );

  it('does not advance a stale candidate after its due arrangement was replaced', async () => {
    const f = effectiveScanFixture('2026-10-12');
    f.record.currentHearingArrangementId = 'new-arrangement';
    f.record.currentHearingArrangement.id = 'new-arrangement';
    expect(
      await f.service.advanceDue(new Date('2026-10-08T10:00:00.000Z')),
    ).toEqual({ advanced: 0, failed: 0 });
    expect(f.tx.caseHearingAdvance.create).not.toHaveBeenCalled();
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
          currentTrialRoundId: trialRoundId,
          currentHearingArrangementId:
            where.id === caseId ? arrangementId : secondArrangementId,
          currentHearingAdvanceId: null,
          currentHearingArrangement: {
            id: where.id === caseId ? arrangementId : secondArrangementId,
            hearingAt: new Date('2026-10-08T00:00:00.000Z'),
            recordCorrections: [],
            toVersion: 8,
            trialRoundId,
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

  it('does not advance an arrangement left by a prior trial round', async () => {
    const f = fixture();
    f.database.case.findMany.mockResolvedValue([
      { id: caseId, departmentId: actor.departmentId },
    ]);
    f.tx.case.findFirst.mockResolvedValue({
      stage: 'WAITING_HEARING',
      version: 8,
      currentTrialRoundId: trialRoundId,
      currentHearingArrangementId: arrangementId,
      currentHearingAdvanceId: null,
      currentHearingArrangement: {
        id: arrangementId,
        hearingAt: new Date('2026-10-08T00:00:00.000Z'),
        recordCorrections: [],
        toVersion: 8,
        trialRoundId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      },
    });
    expect(
      await f.service.advanceDue(new Date('2026-10-09T00:00:00.000Z')),
    ).toEqual({ advanced: 0, failed: 0 });
    expect(f.tx.caseHearingAdvance.create).not.toHaveBeenCalled();
  });

  it('advances only the current real external arrangement with matching entry', async () => {
    const f = fixture();
    jest
      .mocked(readCaseSourceAnchor)
      .mockResolvedValueOnce(externalHearing as never);
    f.database.case.findMany.mockResolvedValue([
      { id: caseId, departmentId: actor.departmentId },
    ]);
    f.tx.$queryRawUnsafe.mockImplementation((sql: string) =>
      sql.includes('FOR UPDATE')
        ? Promise.resolve([{ id: caseId }])
        : Promise.resolve([{ due_at: new Date('2026-10-08T16:00:00.000Z') }]),
    );
    f.tx.case.findFirst.mockResolvedValue({
      stage: 'WAITING_HEARING',
      version: 8,
      currentTrialRoundId: trialRoundId,
      currentTrialRound: {
        origin: 'EXTERNAL_CURRENT',
        externalEntryId: entryId,
        sourceResultId: null,
        revokedAt: null,
      },
      currentHearingArrangementId: arrangementId,
      currentHearingAdvanceId: null,
      currentHearingArrangement: {
        id: arrangementId,
        hearingAt: new Date('2026-10-08T00:00:00.000Z'),
        recordCorrections: [],
        toVersion: 8,
        trialRoundId,
        externalEntryId: entryId,
      },
    });
    const service = new CaseHearingService(
      f.database as never,
      f.access as never,
      f.signal as never,
      { now: () => new Date('2026-10-08T16:01:00.000Z') } as never,
    );
    const result = await service.advanceDue(
      new Date('2026-10-09T00:00:00.000Z'),
    );
    expect(result).toEqual({ advanced: 1, failed: 0 });
    expect(f.tx.caseHearingAdvance.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          arrangementId,
          trialRoundId,
          externalEntryId: entryId,
        }),
      }),
    );
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
          currentTrialRoundId: trialRoundId,
          currentHearingArrangementId: arrangementId,
          currentHearingAdvanceId: null,
          currentHearingArrangement: {
            id: arrangementId,
            hearingAt: new Date('2026-10-08T00:00:00.000Z'),
            recordCorrections: [],
            toVersion: 8,
            trialRoundId,
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
