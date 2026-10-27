import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { AccessControlService } from '../../access-control/access-control.service';
import { ActorContext } from '../../access-control/actor-context';
import { DatabaseService } from '../../database/database.service';
import { CaseCalendarSourceService } from '../cases';
import { CustomerCalendarSourceService } from '../customers';
import {
  CalendarReminderService,
  addCalendarDays,
  reminderDueAt,
  validCalendarDate,
} from './calendar-reminder.service';

const actor: ActorContext = {
  userId: '11111111-1111-4111-8111-111111111111',
  departmentId: '22222222-2222-4222-8222-222222222222',
  authorizationRevision: 1,
};
const manualId = '33333333-3333-4333-8333-333333333333';
const judgmentId = '44444444-4444-4444-8444-444444444444';
const caseId = '55555555-5555-4555-8555-555555555555';
const epoch = `${caseId}:0`;

function fixture() {
  const database = {
    userAccount: {
      findUnique: jest.fn().mockResolvedValue({
        active: true,
        accountType: 'INTERNAL',
        authorizationRevision: 1,
      }),
    },
    departmentMembership: {
      findUnique: jest.fn().mockResolvedValue({ active: true }),
    },
    calendarManualItem: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      updateMany: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
    calendarReminderRead: {
      findMany: jest.fn().mockResolvedValue([]),
      upsert: jest.fn(),
    },
    caseRefundApplication: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
    },
    case: {
      findFirst: jest.fn().mockResolvedValue({
        departmentId: actor.departmentId,
        responsibleUserId: actor.userId,
        responsibleMembership: { teamId: null },
      }),
    },
    caseJudgmentFact: {
      findFirst: jest.fn().mockResolvedValue({ id: judgmentId }),
    },
    caseSecondInstanceResult: {
      findFirst: jest.fn().mockResolvedValue({ id: judgmentId }),
    },
    $transaction: jest.fn(),
  };
  database.$transaction.mockImplementation((operation) => operation(database));
  const access = {
    authorizeDepartmentAction: jest.fn().mockResolvedValue(undefined),
    authorizeCase: jest.fn().mockResolvedValue(undefined),
  };
  const cases = { listOwnedReminders: jest.fn().mockResolvedValue([]) };
  const customers = { listOwnedReminders: jest.fn().mockResolvedValue([]) };
  const service = new CalendarReminderService(
    database as unknown as DatabaseService,
    access as unknown as AccessControlService,
    cases as unknown as CaseCalendarSourceService,
    customers as unknown as CustomerCalendarSourceService,
  );
  return { database, access, cases, customers, service };
}
const judgment = {
  sourceType: 'FIRST_INSTANCE_JUDGMENT' as const,
  sourceId: judgmentId,
  date: '2026-10-27',
  caseId,
  businessNo: '案-1',
  ownerEpoch: epoch,
};

describe('calendar reminder dates', () => {
  it('uses the first server registration Beijing day and natural day 15 at 09:00', () => {
    const source = {
      sourceType: 'FIRST_INSTANCE_JUDGMENT' as const,
      eventDate: '2026-10-27',
    };
    expect(addCalendarDays(source.eventDate, 15)).toBe('2026-11-11');
    expect(
      reminderDueAt(
        source as Parameters<typeof reminderDueAt>[0],
      ).toISOString(),
    ).toBe('2026-11-11T01:00:00.000Z');
    expect(validCalendarDate('2026-02-29')).toBe(false);
    expect(validCalendarDate('2028-02-29')).toBe(true);
    expect(validCalendarDate('0000-01-01')).toBe(false);
  });
  it('shows exactly one due judgment after 09, including late login and cross-day unread', async () => {
    const { service, cases } = fixture();
    cases.listOwnedReminders.mockResolvedValue([judgment]);
    expect(
      await service.due(actor, new Date('2026-11-11T00:59:59Z')),
    ).toHaveLength(0);
    const due = await service.due(actor, new Date('2026-11-11T01:00:00Z'));
    expect(due).toMatchObject([
      { sourceId: judgmentId, dueAt: '2026-11-11T01:00:00.000Z', readAt: null },
    ]);
    expect(
      await service.due(actor, new Date('2026-11-13T09:00:00Z')),
    ).toHaveLength(1);
  });
  it('keeps read receipt per owner epoch and current source date; read does not mean applied', async () => {
    const { service, cases, database } = fixture();
    cases.listOwnedReminders.mockResolvedValue([judgment]);
    database.calendarReminderRead.findMany.mockResolvedValue([
      {
        sourceType: judgment.sourceType,
        sourceId: judgmentId,
        sourceEpoch: epoch,
        eventDate: new Date('2026-10-27T00:00:00Z'),
        readAt: new Date('2026-11-11T02:00:00Z'),
      },
    ]);
    expect(
      (await service.due(actor, new Date('2026-11-12T02:00:00Z')))[0].readAt,
    ).toBe('2026-11-11T02:00:00.000Z');
    cases.listOwnedReminders.mockResolvedValue([
      { ...judgment, ownerEpoch: `${caseId}:2` },
    ]);
    expect(
      (await service.due(actor, new Date('2026-11-12T02:00:00Z')))[0].readAt,
    ).toBeNull();
    cases.listOwnedReminders.mockResolvedValue([
      { ...judgment, date: '2026-10-28' },
    ]);
    expect(
      (await service.due(actor, new Date('2026-11-12T02:00:00Z')))[0].readAt,
    ).toBeNull();
  });
  it('rejects another principal and old reminder identity', async () => {
    const { service, cases } = fixture();
    cases.listOwnedReminders.mockResolvedValue([judgment]);
    await expect(
      service.due({ ...actor, clientCustomerId: manualId }),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      service.markRead(actor, {
        sourceType: judgment.sourceType,
        sourceId: judgmentId,
        sourceEpoch: `${caseId}:1`,
        eventDate: judgment.date,
      }),
    ).rejects.toThrow(NotFoundException);
  });
  it('supports own manual item and rejects another owner or stale edit version', async () => {
    const { service, database } = fixture();
    database.calendarManualItem.create.mockResolvedValue({
      id: manualId,
      title: '庭前整理',
      eventDate: new Date('2026-10-27T00:00:00Z'),
      note: null,
      version: 1,
    });
    expect(
      await service.createManual(actor, {
        title: ' 庭前整理 ',
        eventDate: '2026-10-27',
      }),
    ).toMatchObject({ id: manualId, title: '庭前整理' });
    database.calendarManualItem.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      service.updateManual(actor, manualId, {
        title: '改期',
        eventDate: '2026-10-28',
        expectedVersion: 1,
      }),
    ).rejects.toThrow(ConflictException);
    expect(database.calendarManualItem.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          ownerUserId: actor.userId,
          departmentId: actor.departmentId,
        }),
      }),
    );
    await expect(
      service.createManual(actor, { title: 'x', eventDate: '2026-02-30' }),
    ).rejects.toThrow(BadRequestException);
  });
  it('registers a real application independently of reminder read and rejects changed retry', async () => {
    const { service, cases, database, access } = fixture();
    cases.listOwnedReminders.mockResolvedValue([judgment]);
    const input = {
      sourceType: judgment.sourceType,
      sourceId: judgmentId,
      applicationDate: '2026-10-27',
      note: '已提交',
    };
    database.caseRefundApplication.create.mockResolvedValue({
      id: manualId,
      applicationDate: new Date('2026-10-27T00:00:00Z'),
      note: '已提交',
    });
    expect(await service.registerRefundApplication(actor, input)).toMatchObject(
      { id: manualId, applicationDate: '2026-10-27' },
    );
    expect(access.authorizeCase).toHaveBeenCalledWith(
      actor,
      'case.refund.application.record',
      expect.objectContaining({ responsibleUserId: actor.userId }),
      database,
    );
    database.caseRefundApplication.findUnique.mockResolvedValue({
      applicationDate: new Date('2026-10-27T00:00:00Z'),
      note: '已提交',
      id: manualId,
    });
    await expect(
      service.registerRefundApplication(actor, { ...input, note: '不同' }),
    ).rejects.toThrow(ConflictException);
    database.caseRefundApplication.findMany.mockResolvedValue([
      { sourceType: judgment.sourceType, sourceId: judgmentId },
    ]);
    expect(await service.due(actor, new Date('2026-11-11T02:00:00Z'))).toEqual(
      [],
    );
  });
});
