import { CaseHearingAdvanceScheduler, HEARING_PASSED_AUDIT } from './case-hearing-advance.scheduler';

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

describe('CaseHearingAdvanceScheduler', () => {
  it('moves a case from waiting-hearing to waiting-judgment once the date passed', async () => {
    const { database, updateMany, auditCreate } = harness([1]);
    database.case.findMany.mockResolvedValue([
      {
        id: '11111111-1111-4111-8111-111111111111',
        departmentId: '22222222-2222-4222-8222-222222222222',
        version: 7,
      },
    ]);
    const scheduler = new CaseHearingAdvanceScheduler(database as never);

    // 2026-11-12 08:00 +08:00 → 上海日期 11-12
    const advanced = await scheduler.runOnce(
      new Date('2026-11-12T00:00:00.000Z'),
    );

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

  it('stays put when the row was already moved by someone else', async () => {
    const { database, auditCreate } = harness([0]);
    database.case.findMany.mockResolvedValue([
      {
        id: '11111111-1111-4111-8111-111111111111',
        departmentId: '22222222-2222-4222-8222-222222222222',
        version: 7,
      },
    ]);
    const scheduler = new CaseHearingAdvanceScheduler(database as never);

    expect(await scheduler.runOnce(new Date('2026-11-12T00:00:00.000Z'))).toBe(
      0,
    );
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it('does nothing when no hearing date has passed', async () => {
    const { database, updateMany } = harness([]);
    database.case.findMany.mockResolvedValue([]);
    const scheduler = new CaseHearingAdvanceScheduler(database as never);

    expect(await scheduler.runOnce(new Date('2026-11-12T00:00:00.000Z'))).toBe(
      0,
    );
    expect(updateMany).not.toHaveBeenCalled();
    expect(database.case.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          stage: 'WAITING_HEARING',
          currentHearingArrangement: {
            is: { hearingAt: { lt: new Date('2026-11-12T00:00:00Z') } },
          },
        }),
      }),
    );
  });
});
