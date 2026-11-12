import {
  CaseHearingAdvanceScheduler,
  HEARING_PASSED_AUDIT,
} from './case-hearing-advance.scheduler';

const TODAY = new Date('2026-11-12T00:00:00.000Z');
const YESTERDAY = new Date('2026-11-11T00:00:00.000Z');
const TOMORROW = new Date('2026-11-13T00:00:00.000Z');

function harness(counts: number[]) {
  const updateMany = jest.fn();
  for (const count of counts) updateMany.mockResolvedValueOnce({ count });
  const auditCreate = jest.fn().mockResolvedValue({});
  const tx = {
    case: { updateMany },
    auditEvent: { create: auditCreate },
  };
  const database = {
    case: { findMany: jest.fn() },
    $transaction: jest.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
  };
  return { database, updateMany, auditCreate };
}

function row(hearingAt: Date | null, version = 7) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    departmentId: '22222222-2222-4222-8222-222222222222',
    version,
    currentHearingArrangement: { hearingAt },
  };
}

describe('CaseHearingAdvanceScheduler', () => {
  beforeEach(() => {
    delete process.env.HEARING_ADVANCE_CUTOFF_HOUR;
  });

  it('advances a case whose hearing date already passed', async () => {
    const { database, updateMany, auditCreate } = harness([1]);
    database.case.findMany.mockResolvedValue([row(YESTERDAY)]);

    const advanced = await new CaseHearingAdvanceScheduler(
      database as never,
    ).runOnce(new Date('2026-11-12T00:00:00.000Z'));

    expect(advanced).toBe(1);
    expect(updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        stage: 'WAITING_HEARING',
        version: 7,
      }),
      data: { stage: 'WAITING_JUDGMENT', version: { increment: 1 } },
    });
    expect(auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: HEARING_PASSED_AUDIT,
        actorKind: 'SYSTEM',
        actorUserId: null,
        resourceType: 'CASE',
      }),
    });
  });

  it('advances on the hearing day itself', async () => {
    const { database, updateMany } = harness([1]);
    database.case.findMany.mockResolvedValue([row(TODAY)]);

    expect(
      await new CaseHearingAdvanceScheduler(database as never).runOnce(
        new Date('2026-11-12T00:10:00.000Z'),
      ),
    ).toBe(1);
    expect(updateMany).toHaveBeenCalled();
  });

  it('waits for the configured cutoff hour on the hearing day', async () => {
    process.env.HEARING_ADVANCE_CUTOFF_HOUR = '18';

    // 上海时间 09:10，未到 18 点
    const early = harness([]);
    early.database.case.findMany.mockResolvedValue([row(TODAY)]);
    expect(
      await new CaseHearingAdvanceScheduler(early.database as never).runOnce(
        new Date('2026-11-12T01:10:00.000Z'),
      ),
    ).toBe(0);
    expect(early.updateMany).not.toHaveBeenCalled();

    // 上海时间 18:00 之后
    const late = harness([1]);
    late.database.case.findMany.mockResolvedValue([row(TODAY)]);
    expect(
      await new CaseHearingAdvanceScheduler(late.database as never).runOnce(
        new Date('2026-11-12T10:00:00.000Z'),
      ),
    ).toBe(1);
    expect(late.updateMany).toHaveBeenCalled();
  });

  it('never advances a future hearing date', async () => {
    const { database, updateMany } = harness([]);
    database.case.findMany.mockResolvedValue([row(TOMORROW)]);

    expect(
      await new CaseHearingAdvanceScheduler(database as never).runOnce(
        new Date('2026-11-12T02:00:00.000Z'),
      ),
    ).toBe(0);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('skips cases without a hearing date', async () => {
    const { database, updateMany } = harness([]);
    database.case.findMany.mockResolvedValue([row(null)]);

    expect(
      await new CaseHearingAdvanceScheduler(database as never).runOnce(
        new Date('2026-11-12T02:00:00.000Z'),
      ),
    ).toBe(0);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('stays put when the row was already moved by someone else', async () => {
    const { database, auditCreate } = harness([0]);
    database.case.findMany.mockResolvedValue([row(YESTERDAY)]);

    expect(
      await new CaseHearingAdvanceScheduler(database as never).runOnce(
        new Date('2026-11-12T00:00:00.000Z'),
      ),
    ).toBe(0);
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it('queries only through today, never a future date', async () => {
    const { database } = harness([]);
    database.case.findMany.mockResolvedValue([]);

    await new CaseHearingAdvanceScheduler(database as never).runOnce(
      new Date('2026-11-12T02:00:00.000Z'),
    );

    expect(database.case.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          stage: 'WAITING_HEARING',
          currentHearingArrangement: {
            is: { hearingAt: { lte: new Date('2026-11-12T00:00:00.000Z') } },
          },
        }),
      }),
    );
  });
});
