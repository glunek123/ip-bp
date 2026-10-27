import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AccessControlService } from '../../access-control/access-control.service';
import { ActorContext } from '../../access-control/actor-context';
import { DatabaseService } from '../../database/database.service';
import { Prisma } from '../../generated/prisma/client';
import { CaseCalendarSourceService } from '../cases';
import { CustomerCalendarSourceService } from '../customers';

export type ReminderSourceType =
  | 'MANUAL'
  | 'FIRST_INSTANCE_HEARING'
  | 'SECOND_INSTANCE_HEARING'
  | 'CUSTOMER_AGREEMENT_EXPIRY'
  | 'FIRST_INSTANCE_JUDGMENT'
  | 'SECOND_INSTANCE_RESULT';
type ReminderSource = {
  sourceType: ReminderSourceType;
  sourceId: string;
  sourceEpoch: string;
  eventDate: string;
  title: string;
  note: string | null;
  caseId: string | null;
  customerId: string | null;
};
type ReminderIdentity = Pick<
  ReminderSource,
  'sourceType' | 'sourceId' | 'sourceEpoch' | 'eventDate'
>;

const forbidden = () =>
  new ForbiddenException({
    code: 'ACTION_FORBIDDEN',
    message: '当前账号无权操作个人日历',
  });
const invalid = (message: string) =>
  new BadRequestException({ code: 'VALIDATION_ERROR', message });
const dateOnly = (value: Date) => value.toISOString().slice(0, 10);
export function validCalendarDate(value: string): boolean {
  if (!/^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/.test(value)) return false;
  if (value.slice(0, 4) === '0000') return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && dateOnly(date) === value;
}
export function addCalendarDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return dateOnly(date);
}
export function reminderDueAt(source: ReminderSource): Date {
  const date =
    source.sourceType === 'FIRST_INSTANCE_JUDGMENT' ||
    source.sourceType === 'SECOND_INSTANCE_RESULT'
      ? addCalendarDays(source.eventDate, 15)
      : source.eventDate;
  return new Date(`${date}T01:00:00.000Z`); // 09:00 Asia/Shanghai
}
function sameIdentity(
  left: ReminderIdentity,
  right: ReminderIdentity,
): boolean {
  return (
    left.sourceType === right.sourceType &&
    left.sourceId === right.sourceId &&
    left.sourceEpoch === right.sourceEpoch &&
    left.eventDate === right.eventDate
  );
}
function validateManual(input: {
  title: string;
  eventDate: string;
  note?: string | null;
}): { title: string; eventDate: Date; note: string | null } {
  const title = input.title?.trim();
  const note = input.note?.trim() || null;
  if (
    !title ||
    title.length > 200 ||
    !validCalendarDate(input.eventDate) ||
    (note?.length ?? 0) > 1000
  )
    throw invalid('标题、日期或备注无效');
  return {
    title,
    eventDate: new Date(`${input.eventDate}T00:00:00.000Z`),
    note,
  };
}

@Injectable()
export class CalendarReminderService {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: AccessControlService,
    private readonly caseSource: CaseCalendarSourceService,
    private readonly customerSource: CustomerCalendarSourceService,
  ) {}

  private async assertCurrent(actor: ActorContext): Promise<void> {
    if (
      actor.clientCustomerId !== undefined ||
      actor.lawyerAccountId !== undefined ||
      actor.notaryOfficeId !== undefined
    )
      throw forbidden();
    const [account, membership] = await Promise.all([
      this.database.userAccount.findUnique({
        where: { id: actor.userId },
        select: {
          active: true,
          accountType: true,
          authorizationRevision: true,
        },
      }),
      this.database.departmentMembership.findUnique({
        where: {
          userId_departmentId: {
            userId: actor.userId,
            departmentId: actor.departmentId,
          },
        },
        select: { active: true },
      }),
    ]);
    if (
      !account?.active ||
      account.accountType !== 'INTERNAL' ||
      account.authorizationRevision !== actor.authorizationRevision ||
      !membership?.active
    )
      throw forbidden();
    await this.access.authorizeDepartmentAction(actor, 'case.read');
  }

  private async sources(actor: ActorContext): Promise<ReminderSource[]> {
    await this.assertCurrent(actor);
    const [manual, cases, agreements] = await Promise.all([
      this.database.calendarManualItem.findMany({
        where: { departmentId: actor.departmentId, ownerUserId: actor.userId },
      }),
      this.caseSource.listOwnedReminders(actor),
      this.customerSource.listOwnedReminders(actor),
    ]);
    await this.assertCurrent(actor);
    return [
      ...manual.map((item): ReminderSource => ({
        sourceType: 'MANUAL',
        sourceId: item.id,
        sourceEpoch: item.id,
        eventDate: dateOnly(item.eventDate),
        title: item.title,
        note: item.note,
        caseId: null,
        customerId: null,
      })),
      ...cases.map((item): ReminderSource => ({
        sourceType: item.sourceType,
        sourceId: item.sourceId,
        sourceEpoch: item.ownerEpoch,
        eventDate: item.date,
        title:
          item.sourceType === 'FIRST_INSTANCE_HEARING'
            ? '一审开庭'
            : item.sourceType === 'SECOND_INSTANCE_HEARING'
              ? '二审开庭'
              : item.sourceType === 'FIRST_INSTANCE_JUDGMENT'
                ? '一审判决退费待核'
                : '二审判决退费待核',
        note: item.businessNo,
        caseId: item.caseId,
        customerId: null,
      })),
      ...agreements.map((item): ReminderSource => ({
        sourceType: 'CUSTOMER_AGREEMENT_EXPIRY',
        sourceId: item.sourceId,
        sourceEpoch: item.ownerEpoch,
        eventDate: item.date,
        title: '客户协议到期',
        note: item.name,
        caseId: null,
        customerId: item.customerId,
      })),
    ];
  }

  async manualMonth(actor: ActorContext, month: string) {
    if (!/^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(month))
      throw invalid('月份无效');
    await this.assertCurrent(actor);
    const from = new Date(`${month}-01T00:00:00.000Z`);
    const through = new Date(from);
    through.setUTCMonth(through.getUTCMonth() + 1);
    const items = await this.database.calendarManualItem.findMany({
      where: {
        departmentId: actor.departmentId,
        ownerUserId: actor.userId,
        eventDate: {
          gte: from,
          lt: through,
        },
      },
      orderBy: [{ eventDate: 'asc' }, { id: 'asc' }],
    });
    await this.assertCurrent(actor);
    return items.map((item) => ({
      id: item.id,
      title: item.title,
      eventDate: dateOnly(item.eventDate),
      note: item.note,
      version: item.version,
    }));
  }

  async refundMonth(actor: ActorContext, month: string) {
    if (!/^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(month))
      throw invalid('月份无效');
    const sources = (await this.sources(actor)).filter(
      (source) =>
        (source.sourceType === 'FIRST_INSTANCE_JUDGMENT' ||
          source.sourceType === 'SECOND_INSTANCE_RESULT') &&
        reminderDueAt(source).toISOString().slice(0, 7) === month,
    );
    const applications = await this.database.caseRefundApplication.findMany({
      where: {
        departmentId: actor.departmentId,
        sourceId: { in: sources.map((source) => source.sourceId) },
      },
    });
    await this.assertCurrent(actor);
    return sources.map((source) => ({
      sourceType: source.sourceType,
      sourceId: source.sourceId,
      caseId: source.caseId,
      dueDate: reminderDueAt(source).toISOString().slice(0, 10),
      title: source.title,
      businessNo: source.note,
      applied: applications.some(
        (item) =>
          item.sourceType === source.sourceType &&
          item.sourceId === source.sourceId,
      ),
    }));
  }

  async createManual(
    actor: ActorContext,
    input: { title: string; eventDate: string; note?: string | null },
  ) {
    const data = validateManual(input);
    await this.assertCurrent(actor);
    const item = await this.database.calendarManualItem.create({
      data: {
        ...data,
        departmentId: actor.departmentId,
        ownerUserId: actor.userId,
      },
    });
    return {
      id: item.id,
      title: item.title,
      eventDate: dateOnly(item.eventDate),
      note: item.note,
      version: item.version,
    };
  }

  async updateManual(
    actor: ActorContext,
    id: string,
    input: {
      title: string;
      eventDate: string;
      note?: string | null;
      expectedVersion: number;
    },
  ) {
    const data = validateManual(input);
    if (
      !Number.isSafeInteger(input.expectedVersion) ||
      input.expectedVersion < 1
    )
      throw invalid('版本无效');
    await this.assertCurrent(actor);
    const changed = await this.database.calendarManualItem.updateMany({
      where: {
        id,
        departmentId: actor.departmentId,
        ownerUserId: actor.userId,
        version: input.expectedVersion,
      },
      data: { ...data, version: { increment: 1 } },
    });
    if (changed.count !== 1)
      throw new ConflictException({
        code: 'CALENDAR_ITEM_CHANGED',
        message: '事项已变化，请刷新后重试',
      });
    const item = await this.database.calendarManualItem.findUniqueOrThrow({
      where: { id },
    });
    return {
      id: item.id,
      title: item.title,
      eventDate: dateOnly(item.eventDate),
      note: item.note,
      version: item.version,
    };
  }

  async due(actor: ActorContext, now = new Date()) {
    const sources = (await this.sources(actor)).filter(
      (source) => reminderDueAt(source).getTime() <= now.getTime(),
    );
    const [reads, applications] = await Promise.all([
      this.database.calendarReminderRead.findMany({
        where: { departmentId: actor.departmentId, ownerUserId: actor.userId },
      }),
      this.database.caseRefundApplication.findMany({
        where: {
          departmentId: actor.departmentId,
          sourceId: {
            in: sources
              .filter(
                (item) =>
                  item.sourceType === 'FIRST_INSTANCE_JUDGMENT' ||
                  item.sourceType === 'SECOND_INSTANCE_RESULT',
              )
              .map((item) => item.sourceId),
          },
        },
      }),
    ]);
    await this.assertCurrent(actor);
    return sources
      .filter(
        (source) =>
          !applications.some(
            (item) =>
              item.sourceType === source.sourceType &&
              item.sourceId === source.sourceId,
          ),
      )
      .map((source) => ({
        ...source,
        dueAt: reminderDueAt(source).toISOString(),
        readAt:
          reads
            .find((item) =>
              sameIdentity(
                {
                  ...item,
                  eventDate: dateOnly(item.eventDate),
                } as ReminderIdentity,
                source,
              ),
            )
            ?.readAt.toISOString() ?? null,
      }))
      .sort(
        (a, b) =>
          a.dueAt.localeCompare(b.dueAt) ||
          a.sourceType.localeCompare(b.sourceType) ||
          a.sourceId.localeCompare(b.sourceId),
      );
  }

  async markRead(actor: ActorContext, identity: ReminderIdentity) {
    if (!validCalendarDate(identity.eventDate)) throw invalid('日期无效');
    const source = (await this.sources(actor)).find((item) =>
      sameIdentity(item, identity),
    );
    if (!source || reminderDueAt(source).getTime() > Date.now())
      throw new NotFoundException({
        code: 'REMINDER_NOT_FOUND',
        message: '提醒不存在或尚未到期',
      });
    if (
      source.sourceType === 'FIRST_INSTANCE_JUDGMENT' ||
      source.sourceType === 'SECOND_INSTANCE_RESULT'
    ) {
      const applied = await this.database.caseRefundApplication.findUnique({
        where: {
          departmentId_sourceType_sourceId: {
            departmentId: actor.departmentId,
            sourceType: source.sourceType,
            sourceId: source.sourceId,
          },
        },
        select: { id: true },
      });
      if (applied)
        throw new NotFoundException({
          code: 'REMINDER_NOT_FOUND',
          message: '提醒已关闭',
        });
    }
    const receipt = await this.database.calendarReminderRead.upsert({
      where: {
        departmentId_ownerUserId_sourceType_sourceId_sourceEpoch_eventDate: {
          departmentId: actor.departmentId,
          ownerUserId: actor.userId,
          sourceType: source.sourceType,
          sourceId: source.sourceId,
          sourceEpoch: source.sourceEpoch,
          eventDate: new Date(`${source.eventDate}T00:00:00.000Z`),
        },
      },
      create: {
        departmentId: actor.departmentId,
        ownerUserId: actor.userId,
        sourceType: source.sourceType,
        sourceId: source.sourceId,
        sourceEpoch: source.sourceEpoch,
        eventDate: new Date(`${source.eventDate}T00:00:00.000Z`),
      },
      update: {},
    });
    return { readAt: receipt.readAt.toISOString() };
  }

  async registerRefundApplication(
    actor: ActorContext,
    input: {
      sourceType: 'FIRST_INSTANCE_JUDGMENT' | 'SECOND_INSTANCE_RESULT';
      sourceId: string;
      applicationDate: string;
      note?: string | null;
    },
  ) {
    const today = dateOnly(new Date(Date.now() + 8 * 60 * 60 * 1000));
    if (
      !validCalendarDate(input.applicationDate) ||
      input.applicationDate > today ||
      (input.note?.trim().length ?? 0) > 1000
    )
      throw invalid('申请日期或备注无效');
    const source = (await this.sources(actor)).find(
      (item) =>
        item.sourceType === input.sourceType &&
        item.sourceId === input.sourceId &&
        item.caseId,
    );
    if (!source?.caseId)
      throw new NotFoundException({
        code: 'REFUND_SOURCE_NOT_FOUND',
        message: '正式登记不存在或已失效',
      });
    const note = input.note?.trim() || null;
    const date = new Date(`${input.applicationDate}T00:00:00.000Z`);
    const unique = {
      departmentId: actor.departmentId,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
    };
    let created;
    try {
      created = await this.database.$transaction(
        async (tx) => {
          const record = await tx.case.findFirst({
            where: {
              id: source.caseId!,
              departmentId: actor.departmentId,
              responsibleUserId: actor.userId,
            },
            select: {
              departmentId: true,
              responsibleUserId: true,
              responsibleMembership: { select: { teamId: true } },
            },
          });
          if (!record) throw forbidden();
          const validFact =
            input.sourceType === 'FIRST_INSTANCE_JUDGMENT'
              ? await tx.caseJudgmentFact.findFirst({
                  where: {
                    id: input.sourceId,
                    caseId: source.caseId!,
                    departmentId: actor.departmentId,
                    kind: 'REGISTER',
                    trialRound: { revokedAt: null },
                  },
                  select: { id: true },
                })
              : await tx.caseSecondInstanceResult.findFirst({
                  where: {
                    id: input.sourceId,
                    caseId: source.caseId!,
                    departmentId: actor.departmentId,
                    revocation: { is: null },
                    trialRound: { revokedAt: null },
                  },
                  select: { id: true },
                });
          if (!validFact)
            throw new NotFoundException({
              code: 'REFUND_SOURCE_NOT_FOUND',
              message: '正式登记不存在或已失效',
            });
          await this.access.authorizeCase(
            actor,
            'case.refund.application.record',
            {
              departmentId: record.departmentId,
              responsibleUserId: record.responsibleUserId,
              teamId: record.responsibleMembership.teamId ?? undefined,
            },
            tx,
          );
          const existing = await tx.caseRefundApplication.findUnique({
            where: { departmentId_sourceType_sourceId: unique },
          });
          if (existing) {
            if (
              dateOnly(existing.applicationDate) !== input.applicationDate ||
              existing.note !== note
            )
              throw new ConflictException({
                code: 'REFUND_APPLICATION_EXISTS',
                message: '该正式登记已有不同的申请记录',
              });
            return existing;
          }
          return tx.caseRefundApplication.create({
            data: {
              ...unique,
              caseId: source.caseId!,
              applicantUserId: actor.userId,
              applicationDate: date,
              note,
            },
          });
        },
        { isolationLevel: 'Serializable' },
      );
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError)) throw error;
      if (error.code === 'P2034')
        throw new ConflictException({
          code: 'REFUND_APPLICATION_BUSY',
          message: '申请记录正在变化，请按原内容重试',
        });
      if (error.code !== 'P2002') throw error;
      const concurrent = await this.database.caseRefundApplication.findUnique({
        where: { departmentId_sourceType_sourceId: unique },
      });
      if (
        !concurrent ||
        dateOnly(concurrent.applicationDate) !== input.applicationDate ||
        concurrent.note !== note
      )
        throw new ConflictException({
          code: 'REFUND_APPLICATION_EXISTS',
          message: '该正式登记已有不同的申请记录',
        });
      created = concurrent;
    }
    return {
      id: created.id,
      applicationDate: dateOnly(created.applicationDate),
      note: created.note,
    };
  }
}
