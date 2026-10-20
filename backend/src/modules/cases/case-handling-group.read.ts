import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { isUUID, maxLength } from 'class-validator';
import {
  AccessControlService,
  LeadScopePredicate,
} from '../../access-control/access-control.service';
import { ActorContext } from '../../access-control/actor-context';
import { DatabaseService } from '../../database/database.service';
import { Prisma } from '../../generated/prisma/client';
import {
  CaseHandlingGroupCandidateQueryDto,
  CaseHandlingGroupCandidatesDto,
  CaseHandlingGroupCapabilityDto,
  CaseHandlingGroupDetailDto,
  CaseHandlingGroupListDto,
  CaseHandlingGroupMemberDto,
  CaseHandlingGroupPageQueryDto,
} from './case-handling-group.dto';
import { caseListTextWhere } from './case-list-query';

export const handlingGroupCaseSelect = {
  id: true,
  departmentId: true,
  customerId: true,
  businessNo: true,
  stage: true,
  responsibleUserId: true,
  responsibleMembership: { select: { teamId: true } },
  customer: { select: { id: true, departmentId: true, name: true } },
} satisfies Prisma.CaseSelect;
export type HandlingGroupCase = Prisma.CaseGetPayload<{
  select: typeof handlingGroupCaseSelect;
}>;
export type HandlingGroupAction = 'case.group.create' | 'case.group.dissolve';
const groupSelect = (scope: Prisma.CaseWhereInput) =>
  ({
    id: true,
    departmentId: true,
    revision: true,
    status: true,
    createdAt: true,
    members: {
      where: { case: { is: scope } },
      orderBy: { caseId: 'asc' },
      select: { case: { select: handlingGroupCaseSelect } },
    },
  }) satisfies Prisma.CaseHandlingGroupSelect;
type GroupRow = Prisma.CaseHandlingGroupGetPayload<{
  select: ReturnType<typeof groupSelect>;
}>;
const forbidden = () =>
  new ForbiddenException({ code: 'CASE_ACTION_FORBIDDEN' });
const invalid = () => new BadRequestException({ code: 'VALIDATION_ERROR' });
export const handlingGroupNotFound = () =>
  new NotFoundException({ code: 'CASE_HANDLING_GROUP_NOT_FOUND' });

export async function requireHandlingInternal(
  tx: Prisma.TransactionClient,
  actor: ActorContext,
): Promise<string> {
  if (
    actor.clientCustomerId !== undefined ||
    actor.lawyerAccountId !== undefined ||
    actor.notaryOfficeId !== undefined
  )
    throw forbidden();
  const user = await tx.userAccount.findUnique({
    where: { id: actor.userId },
    select: { accountType: true, active: true, displayName: true },
  });
  if (user?.accountType !== 'INTERNAL' || !user.active) throw forbidden();
  return user.displayName;
}

export async function authorizeHandlingCases(
  tx: Prisma.TransactionClient,
  access: AccessControlService,
  actor: ActorContext,
  action: HandlingGroupAction,
  cases: readonly Pick<
    HandlingGroupCase,
    'departmentId' | 'responsibleMembership'
  >[],
): Promise<void> {
  for (const record of cases) {
    // Omitting responsibleUserId deliberately prevents SELF grants from covering group actions.
    await access.authorizeCase(
      actor,
      action,
      {
        departmentId: record.departmentId,
        ...(record.responsibleMembership.teamId === null
          ? {}
          : { teamId: record.responsibleMembership.teamId }),
      },
      tx,
    );
  }
}

export function handlingCaseScope(
  scope: LeadScopePredicate,
  groupAction = false,
): Prisma.CaseWhereInput {
  if (scope.teamId)
    return {
      departmentId: scope.departmentId,
      responsibleMembership: { is: { teamId: scope.teamId } },
    };
  if (scope.OR) {
    const alternatives = scope.OR.flatMap<Prisma.CaseWhereInput>((part) =>
      'teamId' in part
        ? [{ responsibleMembership: { is: { teamId: part.teamId } } }]
        : groupAction
          ? []
          : [{ responsibleUserId: part.responsibleUserId }],
    );
    if (!alternatives.length) throw forbidden();
    return { departmentId: scope.departmentId, OR: alternatives };
  }
  if (scope.responsibleUserId) {
    if (groupAction) throw forbidden();
    return {
      departmentId: scope.departmentId,
      responsibleUserId: scope.responsibleUserId,
    };
  }
  return { departmentId: scope.departmentId };
}

function pageInput(
  input: Partial<CaseHandlingGroupCandidateQueryDto>,
  candidate: boolean,
) {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).some(
      (key) =>
        !(
          candidate
            ? ['page', 'pageSize', 'customerId', 'q']
            : ['page', 'pageSize']
        ).includes(key),
    )
  )
    throw invalid();
  const page = input.page ?? 1;
  const pageSize = input.pageSize ?? 20;
  if (
    !Number.isInteger(page) ||
    page < 1 ||
    !Number.isInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > 100 ||
    (page - 1) * pageSize > 2147483647
  )
    throw invalid();
  if (input.customerId !== undefined && !isUUID(input.customerId))
    throw invalid();
  if (
    input.q !== undefined &&
    (typeof input.q !== 'string' || !maxLength(input.q.trim(), 200))
  )
    throw invalid();
  return { page, pageSize, skip: (page - 1) * pageSize };
}

function member(record: HandlingGroupCase): CaseHandlingGroupMemberDto {
  if (
    record.customer.id !== record.customerId ||
    record.customer.departmentId !== record.departmentId
  )
    throw new InternalServerErrorException({ code: 'INVALID_CASE_SOURCE' });
  return {
    caseId: record.id,
    businessNo: record.businessNo,
    customerId: record.customerId,
    customerName: record.customer.name,
    stage: record.stage,
  };
}

@Injectable()
export class CaseHandlingGroupRead {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: AccessControlService,
  ) {}

  private read<T>(
    actor: ActorContext,
    run: (
      tx: Prisma.TransactionClient,
      scope: Prisma.CaseWhereInput,
    ) => Promise<T>,
  ): Promise<T> {
    return this.database.$transaction(
      async (tx) => {
        await requireHandlingInternal(tx, actor);
        const scope = handlingCaseScope(
          await this.access.buildLeadScope(actor, 'case.read', tx),
        );
        return run(tx, scope);
      },
      { isolationLevel: 'RepeatableRead', timeout: 15_000 },
    );
  }

  capability(actor: ActorContext): Promise<CaseHandlingGroupCapabilityDto> {
    return this.read(actor, async (tx) => {
      try {
        handlingCaseScope(
          await this.access.buildLeadScope(actor, 'case.group.create', tx),
          true,
        );
        return { canCreate: true };
      } catch (error) {
        if (error instanceof ForbiddenException) return { canCreate: false };
        throw error;
      }
    });
  }

  candidates(
    actor: ActorContext,
    query: Partial<CaseHandlingGroupCandidateQueryDto>,
  ): Promise<CaseHandlingGroupCandidatesDto> {
    const { page, pageSize, skip } = pageInput(query, true);
    return this.read(actor, async (tx, scope) => {
      const actionScope = handlingCaseScope(
        await this.access.buildLeadScope(actor, 'case.group.create', tx),
        true,
      );
      const where: Prisma.CaseWhereInput = {
        AND: [
          scope,
          actionScope,
          {
            ...caseListTextWhere({ q: query.q }),
            ...(query.customerId === undefined
              ? {}
              : { customerId: query.customerId.toLowerCase() }),
          },
        ],
      };
      const total = await tx.case.count({ where });
      const rows = await tx.case.findMany({
        where,
        select: handlingGroupCaseSelect,
        orderBy: [{ businessNo: 'asc' }, { id: 'asc' }],
        skip,
        take: pageSize,
      });
      return { items: rows.map(member), total, page, pageSize };
    });
  }

  list(
    actor: ActorContext,
    query: Partial<CaseHandlingGroupPageQueryDto>,
  ): Promise<CaseHandlingGroupListDto> {
    const { page, pageSize, skip } = pageInput(query, false);
    return this.read(actor, async (tx, scope) => {
      const where: Prisma.CaseHandlingGroupWhereInput = {
        departmentId: actor.departmentId,
        members: { some: { case: { is: scope } } },
      };
      const total = await tx.caseHandlingGroup.count({ where });
      const rows = await tx.caseHandlingGroup.findMany({
        where,
        select: groupSelect(scope),
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip,
        take: pageSize,
      });
      const items: CaseHandlingGroupDetailDto[] = [];
      for (const row of rows) {
        const detail = await this.project(tx, actor, row);
        if (detail.members.length) items.push(detail);
      }
      return { items, total, page, pageSize };
    });
  }

  detail(actor: ActorContext, id: string): Promise<CaseHandlingGroupDetailDto> {
    if (!isUUID(id)) throw invalid();
    return this.read(actor, async (tx, scope) => {
      const row = await tx.caseHandlingGroup.findFirst({
        where: {
          id: id.toLowerCase(),
          departmentId: actor.departmentId,
          members: { some: { case: { is: scope } } },
        },
        select: groupSelect(scope),
      });
      if (!row) throw handlingGroupNotFound();
      const result = await this.project(tx, actor, row);
      if (!result.members.length) throw handlingGroupNotFound();
      return result;
    });
  }

  private async project(
    tx: Prisma.TransactionClient,
    actor: ActorContext,
    group: GroupRow,
  ): Promise<CaseHandlingGroupDetailDto> {
    if (group.departmentId !== actor.departmentId)
      throw handlingGroupNotFound();
    if (group.status !== 'ACTIVE' && group.status !== 'DISSOLVED')
      throw new InternalServerErrorException({ code: 'INVALID_GROUP_STATE' });
    const members: CaseHandlingGroupMemberDto[] = [];
    const cases = group.members.map((entry) => entry.case);
    for (const record of cases) {
      try {
        await this.access.authorizeLead(
          actor,
          'case.read',
          {
            departmentId: record.departmentId,
            responsibleUserId: record.responsibleUserId,
            ...(record.responsibleMembership.teamId === null
              ? {}
              : { teamId: record.responsibleMembership.teamId }),
          },
          tx,
        );
        members.push(member(record));
      } catch (error) {
        if (!(error instanceof ForbiddenException)) throw error;
      }
    }
    let canDissolve = false;
    if (group.status === 'ACTIVE') {
      const authorizationFacts = await tx.caseHandlingGroupMember.findMany({
        where: { groupId: group.id, departmentId: actor.departmentId },
        select: {
          case: {
            select: {
              departmentId: true,
              responsibleMembership: { select: { teamId: true } },
            },
          },
        },
      });
      try {
        if (authorizationFacts.length < 2) throw forbidden();
        await authorizeHandlingCases(
          tx,
          this.access,
          actor,
          'case.group.dissolve',
          authorizationFacts.map((entry) => entry.case),
        );
        canDissolve = true;
      } catch (error) {
        if (!(error instanceof ForbiddenException)) throw error;
      }
    }
    return {
      id: group.id,
      revision: group.revision,
      status: group.status,
      createdAt: group.createdAt.toISOString(),
      members,
      canDissolve,
    };
  }
}
