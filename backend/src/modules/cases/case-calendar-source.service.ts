import { ForbiddenException, Injectable } from '@nestjs/common';
import { AccessControlService } from '../../access-control/access-control.service';
import { ActorContext } from '../../access-control/actor-context';
import { DatabaseService } from '../../database/database.service';
import { Prisma } from '../../generated/prisma/client';

export type CaseCalendarFact = {
  sourceType: 'FIRST_INSTANCE_HEARING' | 'SECOND_INSTANCE_HEARING';
  sourceId: string;
  date: string;
  caseId: string;
  businessNo: string;
  party: string | null;
  defendant: string | null;
  place: string | null;
  judge: string | null;
};

type Principal = 'INTERNAL' | 'LAWYER' | 'CLIENT';
const calendarDate = (value: Date): string => value.toISOString().slice(0, 10);
const forbidden = () =>
  new ForbiddenException({
    code: 'ACTION_FORBIDDEN',
    message: '无权访问案件',
  });
const factOrder = (a: CaseCalendarFact, b: CaseCalendarFact): number =>
  a.caseId.localeCompare(b.caseId) ||
  a.sourceType.localeCompare(b.sourceType) ||
  a.sourceId.localeCompare(b.sourceId);

@Injectable()
export class CaseCalendarSourceService {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: AccessControlService,
  ) {}

  private async principal(actor: ActorContext): Promise<Principal> {
    if (actor.notaryOfficeId !== undefined) throw forbidden();
    const account = await this.database.userAccount.findUnique({
      where: { id: actor.userId },
      select: { accountType: true, active: true, authorizationRevision: true },
    });
    if (
      !account?.active ||
      account.authorizationRevision !== actor.authorizationRevision
    )
      throw forbidden();
    if (account.accountType === 'CLIENT') {
      if (
        actor.clientCustomerId === undefined ||
        actor.lawyerAccountId !== undefined
      )
        throw forbidden();
      const binding = await this.database.customerAccountBinding.findFirst({
        where: {
          userId: actor.userId,
          customerId: actor.clientCustomerId,
          departmentId: actor.departmentId,
          active: true,
          user: { active: true, accountType: 'CLIENT' },
          customer: { profileStatus: 'ADMITTED' },
        },
        select: { id: true },
      });
      if (!binding) throw forbidden();
      return 'CLIENT';
    }
    if (actor.clientCustomerId !== undefined) throw forbidden();
    if (account.accountType === 'LAWYER') {
      if (actor.lawyerAccountId !== actor.userId) throw forbidden();
      const binding = await this.database.lawyerAccountBinding.findFirst({
        where: {
          userId: actor.userId,
          departmentId: actor.departmentId,
          active: true,
        },
        select: { id: true },
      });
      if (!binding) throw forbidden();
      return 'LAWYER';
    }
    if (
      account.accountType !== 'INTERNAL' ||
      actor.lawyerAccountId !== undefined
    )
      throw forbidden();
    try {
      await this.access.authorizeDepartmentAction(actor, 'case.read');
    } catch (error) {
      if (error instanceof ForbiddenException) throw forbidden();
      throw error;
    }
    return 'INTERNAL';
  }

  private where(
    actor: ActorContext,
    principal: Principal,
    ids?: string[],
  ): Prisma.CaseWhereInput {
    return {
      departmentId: actor.departmentId,
      ...(ids ? { id: { in: ids } } : {}),
      ...(principal === 'CLIENT'
        ? {
            customerId: actor.clientCustomerId,
            complaintConfirmation: { isNot: null },
          }
        : principal === 'LAWYER'
          ? {
              lawyers: {
                some: {
                  role: 'PRIMARY',
                  endedAt: null,
                  lawyer: {
                    accountBinding: {
                      is: {
                        userId: actor.userId,
                        departmentId: actor.departmentId,
                        active: true,
                        user: { active: true, accountType: 'LAWYER' },
                      },
                    },
                  },
                },
              },
            }
          : {}),
      OR: [
        { currentHearingArrangement: { is: { hearingAt: { not: null } } } },
        { currentSecondInstanceProgress: { is: { hearingAt: { not: null } } } },
      ],
    };
  }

  private readCases(where: Prisma.CaseWhereInput) {
    return this.database.case.findMany({
      where,
      select: {
        id: true,
        businessNo: true,
        rightsHolder: { select: { name: true } },
        defendants: { orderBy: { id: 'asc' }, select: { name: true } },
        currentHearingArrangement: { select: { id: true, hearingAt: true } },
        currentSecondInstanceProgress: {
          select: {
            id: true,
            hearingAt: true,
            hearingPlace: true,
            judgeName: true,
          },
        },
      },
    });
  }

  private project(
    cases: Awaited<ReturnType<CaseCalendarSourceService['readCases']>>,
    principal: Principal,
  ): CaseCalendarFact[] {
    const facts: CaseCalendarFact[] = [];
    for (const item of cases) {
      const common = {
        caseId: item.id,
        businessNo: item.businessNo,
        party: item.rightsHolder.name,
        defendant:
          item.defendants.map((entry) => entry.name).join('、') || null,
      };
      const first = item.currentHearingArrangement;
      if (first?.hearingAt)
        facts.push({
          sourceType: 'FIRST_INSTANCE_HEARING',
          sourceId: first.id,
          date: calendarDate(first.hearingAt),
          ...common,
          place: null,
          judge: null,
        });
      const second = item.currentSecondInstanceProgress;
      if (second?.hearingAt)
        facts.push({
          sourceType: 'SECOND_INSTANCE_HEARING',
          sourceId: second.id,
          date: calendarDate(second.hearingAt),
          ...common,
          place: principal === 'CLIENT' ? null : second.hearingPlace,
          judge: principal === 'CLIENT' ? null : second.judgeName,
        });
    }
    return facts;
  }

  async list(actor: ActorContext): Promise<CaseCalendarFact[]> {
    const principal = await this.principal(actor);
    const cases = await this.readCases(this.where(actor, principal));
    if ((await this.principal(actor)) !== principal) throw forbidden();
    const facts = this.project(cases, principal);
    await this.revalidate(actor, facts);
    return facts;
  }

  async revalidate(
    actor: ActorContext,
    facts: CaseCalendarFact[],
  ): Promise<void> {
    const principal = await this.principal(actor);
    const ids = [...new Set(facts.map((fact) => fact.caseId))];
    if (ids.length === 0) return;
    // Re-read selected cases with the identical current authorization predicate.
    // The second read is this response's explicit consistency point.
    const current = await this.readCases(this.where(actor, principal, ids));
    const actual = this.project(current, principal).sort(factOrder);
    if (JSON.stringify(actual) !== JSON.stringify([...facts].sort(factOrder)))
      throw forbidden();
    if ((await this.principal(actor)) !== principal) throw forbidden();
  }
}
