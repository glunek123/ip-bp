import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '../../generated/prisma/client';
import type { ActorContext } from '../../access-control/actor-context';
import { AccessControlService } from '../../access-control/access-control.service';
import { OrganizationService } from '../../access-control/organization.service';
import { lockCustomerActorFacts } from '../../access-control/customer-actor-facts-lock';
import { isDatabaseTransactionConflict } from '../../common/database-transaction-conflict';
import { DatabaseService } from '../../database/database.service';
import {
  assertFinancialKey,
  financialFingerprint,
  parseFinancialDay,
} from './settlement-input';
import type {
  AllocateSettlementActualFactDto,
  CreateSettlementActualFactDto,
  RegisterCaseSettlementActualDto,
  SupplementSettlementActualSourceDto,
} from './settlement-actual.dto';
import { settlementActualPositiveMoney } from './settlement-actual.dto';

type Side = 'CUSTOMER' | 'LAWYER';

function cents(value: Prisma.Decimal): bigint {
  return BigInt(value.toFixed(2).replace('.', ''));
}

function formatCents(value: bigint): string {
  return `${value / 100n}.${(value % 100n).toString().padStart(2, '0')}`;
}

function invalid(message: string) {
  return new BadRequestException({
    code: 'INVALID_ACTUAL_SETTLEMENT',
    message,
  });
}
function conflict() {
  return new ConflictException({
    code: 'ACTUAL_SETTLEMENT_CHANGED',
    message: '实际款项或分配已变化，请刷新后重试',
  });
}
function positiveAmount(value: string): Prisma.Decimal {
  if (typeof value !== 'string' || !settlementActualPositiveMoney.test(value))
    throw invalid('金额须为大于零且最多两位小数');
  return new Prisma.Decimal(value);
}

/** Append-only actual facts and separately authorized case allocations. */
@Injectable()
export class SettlementActualService {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: AccessControlService,
    private readonly organization: OrganizationService,
  ) {}

  private async authorizeCase(
    tx: Prisma.TransactionClient,
    actor: ActorContext,
    caseId: string,
  ) {
    if (actor.clientCustomerId || actor.notaryOfficeId || actor.lawyerAccountId)
      throw new ForbiddenException({
        code: 'ACTION_FORBIDDEN',
        message: '仅内部人员可登记实际结算',
      });
    await lockCustomerActorFacts(tx, this.organization, actor);
    const account = await tx.userAccount.findUnique({
      where: { id: actor.userId },
      select: { accountType: true, active: true },
    });
    if (account?.accountType !== 'INTERNAL' || !account.active)
      throw new ForbiddenException({
        code: 'ACTION_FORBIDDEN',
        message: '当前账号不可登记实际结算',
      });
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM cases WHERE id = ${caseId}::uuid AND department_id = ${actor.departmentId}::uuid FOR UPDATE`;
    if (locked.length !== 1)
      throw new NotFoundException({
        code: 'CASE_NOT_FOUND',
        message: '案件不存在',
      });
    const record = await tx.case.findFirst({
      where: { id: caseId, departmentId: actor.departmentId },
      select: {
        responsibleUserId: true,
        responsibleMembership: { select: { teamId: true } },
        customerId: true,
        lawyers: { where: { endedAt: null }, select: { lawyerId: true } },
      },
    });
    if (record?.responsibleUserId !== actor.userId)
      throw new ForbiddenException({
        code: 'ACTION_FORBIDDEN',
        message: '仅案件负责人可登记实际结算',
      });
    await this.access.authorizeCase(
      actor,
      'case.read',
      {
        departmentId: actor.departmentId,
        responsibleUserId: record.responsibleUserId,
        teamId: record.responsibleMembership.teamId ?? undefined,
      },
      tx,
    );
    return record;
  }

  /** Display snapshot only. Archive must lock and re-read current rows in its own write transaction. */
  async caseActualDisplaySnapshot(actor: ActorContext, caseId: string) {
    return this.database.$transaction(
      async (tx) => {
        await this.authorizeCase(tx, actor, caseId);
        const membership = await tx.caseConsolidationMember.findFirst({
          where: { caseId, departmentId: actor.departmentId },
          select: { consolidationId: true, isMain: true },
        });
        let caseIds = [caseId];
        if (membership?.isMain) {
          const consolidation = await tx.caseConsolidation.findFirst({
            where: {
              id: membership.consolidationId,
              mainCaseId: caseId,
              departmentId: actor.departmentId,
            },
            select: {
              members: {
                where: { departmentId: actor.departmentId },
                select: { caseId: true, departmentId: true, isMain: true },
              },
            },
          });
          if (
            !consolidation ||
            consolidation.members.filter(
              (row) => row.isMain && row.caseId === caseId,
            ).length !== 1 ||
            consolidation.members.some(
              (row) => row.departmentId !== actor.departmentId,
            )
          )
            throw conflict();
          caseIds = [
            ...new Set(consolidation.members.map((row) => row.caseId)),
          ].sort();
          for (const memberId of caseIds) {
            if (memberId !== caseId)
              await this.authorizeCase(tx, actor, memberId);
          }
        }
        const loaded = await tx.caseSettlementActualAllocation.findMany({
          where: { caseId: { in: caseIds }, departmentId: actor.departmentId },
          include: {
            fact: {
              select: {
                sourceCaseId: true,
                partyId: true,
                occurredOn: true,
                sourceReference: true,
                sourceSupplement: { select: { sourceReference: true } },
              },
            },
          },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        });
        const seen = new Set<string>();
        const rows = loaded.filter((row) => {
          if (seen.has(row.id)) return false;
          seen.add(row.id);
          return true;
        });
        const total = (side: Side) => {
          const matches = rows.filter((row) => row.side === side);
          return matches.length === 0
            ? null
            : formatCents(
                matches.reduce((sum, row) => sum + cents(row.amount), 0n),
              );
        };
        return {
          readPurpose: 'DISPLAY_ONLY' as const,
          caseId,
          countedCaseIds: caseIds,
          customerReceiptState: rows.some((row) => row.side === 'CUSTOMER')
            ? 'RECORDED'
            : 'UNKNOWN',
          lawyerInvoiceState: rows.some((row) => row.side === 'LAWYER')
            ? 'RECORDED'
            : 'UNKNOWN',
          customerReceivedAmount: total('CUSTOMER'),
          lawyerInvoicedAmount: total('LAWYER'),
          allocations: rows.map((row) => ({
            id: row.id,
            factId: row.factId,
            registeredCaseId: row.fact.sourceCaseId,
            allocatedCaseId: row.caseId,
            partyId: row.fact.partyId,
            side: row.side,
            amount: row.amount.toFixed(2),
            occurredOn: row.fact.occurredOn.toISOString().slice(0, 10),
            sourceReference:
              row.fact.sourceSupplement?.sourceReference ??
              row.fact.sourceReference,
          })),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  /** Main-case totals only. This grants no source-case detail or handling access.
   * Kept separate from caseActualDisplaySnapshot so its detailed read boundary
   * remains unchanged. Archive must independently lock and re-read its evidence.
   */
  async caseActualAggregateDisplaySnapshot(
    actor: ActorContext,
    caseId: string,
  ) {
    return this.database.$transaction(
      async (tx) => {
        if (
          actor.clientCustomerId ||
          actor.notaryOfficeId ||
          actor.lawyerAccountId
        )
          throw new ForbiddenException({
            code: 'ACTION_FORBIDDEN',
            message: '仅内部人员可查看实际结算汇总',
          });
        await lockCustomerActorFacts(tx, this.organization, actor);
        const account = await tx.userAccount.findUnique({
          where: { id: actor.userId },
          select: {
            accountType: true,
            active: true,
            authorizationRevision: true,
          },
        });
        if (
          !account?.active ||
          account.accountType !== 'INTERNAL' ||
          account.authorizationRevision !== actor.authorizationRevision
        )
          throw new ForbiddenException({
            code: 'ACTION_FORBIDDEN',
            message: '当前账号不可查看实际结算汇总',
          });
        // Read the complete relation, without a department filter that could
        // silently hide a malformed foreign member or a second main relation.
        const discover = async () => {
          const memberships = await tx.$queryRaw<
            Array<{
              consolidation_id: string;
              department_id: string;
              is_main: boolean;
            }>
          >`
            SELECT consolidation_id,department_id,is_main FROM case_consolidation_members WHERE case_id=${caseId}::uuid`;
          const heads = await tx.$queryRaw<
            Array<{ id: string; department_id: string }>
          >`
            SELECT id,department_id FROM case_consolidations WHERE main_case_id=${caseId}::uuid`;
          if (
            memberships.length !== 1 ||
            !memberships[0].is_main ||
            heads.length !== 1 ||
            memberships[0].department_id !== actor.departmentId ||
            heads[0].department_id !== actor.departmentId ||
            memberships[0].consolidation_id !== heads[0].id
          )
            throw conflict();
          const members = await tx.$queryRaw<
            Array<{ case_id: string; department_id: string; is_main: boolean }>
          >`
            SELECT case_id,department_id,is_main FROM case_consolidation_members WHERE consolidation_id=${heads[0].id}::uuid ORDER BY case_id`;
          const ids = members.map((row) => row.case_id).sort();
          if (
            members.length < 2 ||
            new Set(ids).size !== ids.length ||
            members.some((row) => row.department_id !== actor.departmentId) ||
            members.filter((row) => row.is_main).length !== 1 ||
            !members.some((row) => row.case_id === caseId && row.is_main)
          )
            throw conflict();
          return { consolidationId: heads[0].id, ids };
        };
        const scope = await discover();
        // Match consolidation/archive lock ordering: discover first, then lock
        // all cases in one sorted operation, never lock the main case first.
        const locked = await tx.$queryRaw<
          Array<{
            id: string;
            responsible_user_id: string;
            team_id: string | null;
          }>
        >`
          SELECT c.id,c.responsible_user_id,m.team_id FROM cases c
          JOIN department_memberships m ON m.user_id=c.responsible_user_id AND m.department_id=c.department_id
          WHERE c.id=ANY(${scope.ids}::uuid[]) AND c.department_id=${actor.departmentId}::uuid
          ORDER BY c.id FOR UPDATE OF c FOR SHARE OF m NOWAIT`;
        if (
          locked.length !== scope.ids.length ||
          JSON.stringify(locked.map((row) => row.id).sort()) !==
            JSON.stringify(scope.ids)
        )
          throw conflict();
        const main = locked.find((row) => row.id === caseId);
        if (!main || main.responsible_user_id !== actor.userId)
          throw new ForbiddenException({
            code: 'ACTION_FORBIDDEN',
            message: '仅案件负责人可查看实际结算汇总',
          });
        await this.access.authorizeCase(
          actor,
          'case.read',
          {
            departmentId: actor.departmentId,
            responsibleUserId: main.responsible_user_id,
            ...(main.team_id ? { teamId: main.team_id } : {}),
          },
          tx,
        );
        if (JSON.stringify(await discover()) !== JSON.stringify(scope))
          throw conflict();
        const allocations = await tx.caseSettlementActualAllocation.findMany({
          where: {
            caseId: { in: scope.ids },
            departmentId: actor.departmentId,
          },
          select: { id: true, side: true, amount: true },
          orderBy: { id: 'asc' },
        });
        const unique = new Map<string, (typeof allocations)[number]>();
        for (const row of allocations) {
          const prior = unique.get(row.id);
          if (
            prior &&
            (prior.side !== row.side || !prior.amount.eq(row.amount))
          )
            throw conflict();
          unique.set(row.id, row);
        }
        const total = (side: Side) => {
          const matches = [...unique.values()].filter(
            (row) => row.side === side,
          );
          return matches.length === 0
            ? null
            : formatCents(
                matches.reduce((sum, row) => sum + cents(row.amount), 0n),
              );
        };
        const customerReceivedAmount = total('CUSTOMER');
        const lawyerInvoicedAmount = total('LAWYER');
        return {
          readPurpose: 'DISPLAY_ONLY' as const,
          aggregateScope: 'CONSOLIDATION' as const,
          caseId,
          customerReceiptState:
            customerReceivedAmount === null
              ? ('UNKNOWN' as const)
              : ('RECORDED' as const),
          lawyerInvoiceState:
            lawyerInvoicedAmount === null
              ? ('UNKNOWN' as const)
              : ('RECORDED' as const),
          customerReceivedAmount,
          lawyerInvoicedAmount,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  private shanghaiToday(): string {
    return new Date().toLocaleDateString('en-CA', {
      timeZone: 'Asia/Shanghai',
    });
  }

  async createFact(actor: ActorContext, input: CreateSettlementActualFactDto) {
    return this.createFactCommand(actor, input, false);
  }

  /** One operation records the money fact and assigns its entire amount to this case. */
  async registerForCase(
    actor: ActorContext,
    input: RegisterCaseSettlementActualDto,
  ) {
    return this.createFactCommand(actor, input, true);
  }

  private async createFactCommand(
    actor: ActorContext,
    input: CreateSettlementActualFactDto,
    allocateToCase: boolean,
  ) {
    assertFinancialKey(input.idempotencyKey);
    const amount = positiveAmount(input.amount);
    const occurredOn = parseFinancialDay(input.occurredOn);
    const sourceReference = input.sourceReference?.trim() || null;
    if (
      (sourceReference !== null && sourceReference.length > 200) ||
      (input.side !== 'CUSTOMER' && input.side !== 'LAWYER')
    )
      throw invalid('实际结算类型或来源编号无效');
    const note = input.note?.trim() || null;
    if (note !== null && note.length > 500) throw invalid('备注过长');
    const fingerprint = financialFingerprint({
      command: allocateToCase ? 'REGISTER_CASE_ACTUAL' : 'CREATE_ACTUAL',
      caseId: input.caseId,
      side: input.side,
      lawyerId: input.lawyerId ?? null,
      amount: amount.toFixed(2),
      occurredOn: input.occurredOn,
      sourceReference,
      note,
    });
    try {
      return await this.database.$transaction(
        async (tx) => {
          const sourceCase = await this.authorizeCase(tx, actor, input.caseId);
          const old = await tx.settlementActualFact.findUnique({
            where: {
              departmentId_actorUserId_idempotencyKey: {
                departmentId: actor.departmentId,
                actorUserId: actor.userId,
                idempotencyKey: input.idempotencyKey,
              },
            },
          });
          if (old) {
            if (old.requestFingerprint !== fingerprint) throw conflict();
            if (allocateToCase) {
              const allocation =
                await tx.caseSettlementActualAllocation.findUnique({
                  where: {
                    departmentId_actorUserId_idempotencyKey: {
                      departmentId: actor.departmentId,
                      actorUserId: actor.userId,
                      idempotencyKey: input.idempotencyKey,
                    },
                  },
                });
              if (
                !allocation ||
                allocation.factId !== old.id ||
                allocation.caseId !== input.caseId ||
                allocation.requestFingerprint !== fingerprint ||
                !allocation.amount.eq(old.amount)
              )
                throw conflict();
              return {
                id: old.id,
                amount: old.amount.toFixed(2),
                allocatedAmount: allocation.amount.toFixed(2),
                allocationId: allocation.id,
              };
            }
            return {
              id: old.id,
              amount: old.amount.toFixed(2),
              allocatedAmount: null,
            };
          }
          // A replay is a read of an existing fact. Apply the current-day rule
          // only to new facts, after the bound replay check above.
          if (input.occurredOn > this.shanghaiToday())
            throw invalid('实际发生日期不能晚于上海时区当天');
          const partyId =
            input.side === 'CUSTOMER' ? sourceCase.customerId : input.lawyerId;
          if (
            !partyId ||
            (input.side === 'CUSTOMER' && input.lawyerId !== undefined) ||
            (input.side === 'LAWYER' &&
              !sourceCase.lawyers.some((row) => row.lawyerId === partyId))
          )
            throw invalid('实际结算对象与案件不符');
          const factId = randomUUID();
          const allocationId = allocateToCase ? randomUUID() : null;
          const audit = await tx.auditEvent.create({
            data: {
              departmentId: actor.departmentId,
              actorUserId: actor.userId,
              internalActorUserId: actor.userId,
              resourceType: 'SETTLEMENT_ACTUAL',
              resourceId: factId,
              action: 'settlement.actual.created',
              details: {
                ...(allocateToCase ? { command: 'REGISTER_CASE_ACTUAL' } : {}),
                caseId: input.caseId,
                ...(allocationId === null ? {} : { allocationId }),
                side: input.side,
                partyId,
                amount: amount.toFixed(2),
                occurredOn: input.occurredOn,
                sourceReference,
                idempotencyKey: input.idempotencyKey,
                requestFingerprint: fingerprint,
              },
            },
          });
          if (sourceReference !== null)
            await tx.settlementActualSourceClaim.create({
              data: {
                factId,
                departmentId: actor.departmentId,
                side: input.side,
                partyId,
                sourceReference,
              },
            });
          const fact = await tx.settlementActualFact.create({
            data: {
              id: factId,
              sourceCaseId: input.caseId,
              departmentId: actor.departmentId,
              side: input.side,
              amount,
              occurredOn,
              partyId,
              sourceReference,
              note,
              actorUserId: actor.userId,
              idempotencyKey: input.idempotencyKey,
              requestFingerprint: fingerprint,
              auditEventId: audit.id,
            },
          });
          if (allocationId !== null) {
            const allocationAudit = await tx.auditEvent.create({
              data: {
                departmentId: actor.departmentId,
                actorUserId: actor.userId,
                internalActorUserId: actor.userId,
                resourceType: 'CASE',
                resourceId: input.caseId,
                action: 'settlement.actual.allocated',
                details: {
                  command: 'REGISTER_CASE_ACTUAL',
                  allocationId,
                  factId,
                  side: input.side,
                  partyId,
                  sourceReference,
                  amount: amount.toFixed(2),
                  idempotencyKey: input.idempotencyKey,
                  requestFingerprint: fingerprint,
                },
              },
            });
            await tx.caseSettlementActualAllocation.create({
              data: {
                id: allocationId,
                factId,
                caseId: input.caseId,
                departmentId: actor.departmentId,
                side: input.side,
                amount,
                actorUserId: actor.userId,
                idempotencyKey: input.idempotencyKey,
                requestFingerprint: fingerprint,
                auditEventId: allocationAudit.id,
              },
            });
            return {
              id: factId,
              amount: amount.toFixed(2),
              allocatedAmount: amount.toFixed(2),
              allocationId,
            };
          }
          return {
            id: fact.id,
            amount: fact.amount.toFixed(2),
            allocatedAmount: null,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (isDatabaseTransactionConflict(error, { retryUnique: true }))
        throw conflict();
      throw error;
    }
  }

  async allocationCandidates(actor: ActorContext, caseId: string) {
    try {
      return await this.database.$transaction(
        async (tx) => {
          const target = await this.authorizeCase(tx, actor, caseId);
          const facts = await tx.settlementActualFact.findMany({
            where: {
              departmentId: actor.departmentId,
              actorUserId: actor.userId,
              occurredOn: { lte: parseFinancialDay(this.shanghaiToday()) },
              OR: [
                { side: 'CUSTOMER', partyId: target.customerId },
                {
                  side: 'LAWYER',
                  partyId: { in: target.lawyers.map((row) => row.lawyerId) },
                },
              ],
              sourceCase: {
                responsibleUserId: actor.userId,
                departmentId: actor.departmentId,
              },
            },
            orderBy: [{ occurredOn: 'desc' }, { id: 'asc' }],
          });
          const result = [];
          for (const fact of facts) {
            if (
              fact.occurredOn.toISOString().slice(0, 10) > this.shanghaiToday()
            )
              continue;
            try {
              await this.authorizeCase(tx, actor, fact.sourceCaseId);
            } catch (error) {
              if (
                error instanceof ForbiddenException ||
                error instanceof NotFoundException
              )
                continue;
              throw error;
            }
            const total = await tx.caseSettlementActualAllocation.aggregate({
              where: { factId: fact.id },
              _sum: { amount: true },
            });
            const remaining =
              cents(fact.amount) -
              cents(total._sum.amount ?? new Prisma.Decimal(0));
            if (remaining <= 0n) continue;
            result.push({
              id: fact.id,
              side: fact.side,
              amount: fact.amount.toFixed(2),
              remainingAmount: formatCents(remaining),
              occurredOn: fact.occurredOn.toISOString().slice(0, 10),
              sourceReference: fact.sourceReference,
            });
          }
          return result;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (isDatabaseTransactionConflict(error)) throw conflict();
      throw error;
    }
  }

  async allocate(actor: ActorContext, input: AllocateSettlementActualFactDto) {
    assertFinancialKey(input.idempotencyKey);
    const amount = positiveAmount(input.amount);
    const fingerprint = financialFingerprint({
      command: 'ALLOCATE_ACTUAL',
      factId: input.factId,
      caseId: input.caseId,
      amount: amount.toFixed(2),
    });
    try {
      return await this.database.$transaction(
        async (tx) => {
          const targetCase = await this.authorizeCase(tx, actor, input.caseId);
          await tx.$queryRaw`SELECT id FROM settlement_actual_facts WHERE id = ${input.factId}::uuid AND department_id = ${actor.departmentId}::uuid FOR UPDATE`;
          const fact = await tx.settlementActualFact.findFirst({
            where: { id: input.factId, departmentId: actor.departmentId },
          });
          if (!fact)
            throw new NotFoundException({
              code: 'ACTUAL_SETTLEMENT_NOT_FOUND',
              message: '实际结算记录不存在',
            });
          if (fact.actorUserId !== actor.userId)
            throw new ForbiddenException({
              code: 'ACTION_FORBIDDEN',
              message: '仅可分配本人登记的实际款项',
            });
          await this.authorizeCase(tx, actor, fact.sourceCaseId);
          const old = await tx.caseSettlementActualAllocation.findUnique({
            where: {
              departmentId_actorUserId_idempotencyKey: {
                departmentId: actor.departmentId,
                actorUserId: actor.userId,
                idempotencyKey: input.idempotencyKey,
              },
            },
          });
          if (old) {
            if (old.requestFingerprint !== fingerprint) throw conflict();
            return {
              id: old.id,
              factId: fact.id,
              caseId: old.caseId,
              amount: old.amount.toFixed(2),
            };
          }
          if (fact.occurredOn.toISOString().slice(0, 10) > this.shanghaiToday())
            throw invalid('实际发生日期不能晚于上海时区当天');
          if (
            fact.side === 'CUSTOMER'
              ? targetCase.customerId !== fact.partyId
              : !targetCase.lawyers.some((row) => row.lawyerId === fact.partyId)
          )
            throw invalid('来源与目标案件的结算对象不一致');
          const total = await tx.caseSettlementActualAllocation.aggregate({
            where: { factId: fact.id },
            _sum: { amount: true },
          });
          if (
            cents(total._sum.amount ?? new Prisma.Decimal(0)) + cents(amount) >
            cents(fact.amount)
          )
            throw invalid('按案分配合计不能超过实际金额');
          const allocationId = randomUUID();
          const audit = await tx.auditEvent.create({
            data: {
              departmentId: actor.departmentId,
              actorUserId: actor.userId,
              internalActorUserId: actor.userId,
              resourceType: 'CASE',
              resourceId: input.caseId,
              action: 'settlement.actual.allocated',
              details: {
                allocationId,
                factId: fact.id,
                side: fact.side,
                partyId: fact.partyId,
                sourceReference: fact.sourceReference,
                amount: amount.toFixed(2),
                idempotencyKey: input.idempotencyKey,
                requestFingerprint: fingerprint,
              },
            },
          });
          const allocation = await tx.caseSettlementActualAllocation.create({
            data: {
              id: allocationId,
              factId: fact.id,
              caseId: input.caseId,
              departmentId: actor.departmentId,
              side: fact.side,
              amount,
              actorUserId: actor.userId,
              idempotencyKey: input.idempotencyKey,
              requestFingerprint: fingerprint,
              auditEventId: audit.id,
            },
          });
          return {
            id: allocation.id,
            factId: fact.id,
            caseId: input.caseId,
            amount: allocation.amount.toFixed(2),
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (isDatabaseTransactionConflict(error, { retryUnique: true }))
        throw conflict();
      throw error;
    }
  }

  /** Adds a source number as an immutable event; the original money fact stays intact. */
  async supplementSource(
    actor: ActorContext,
    input: SupplementSettlementActualSourceDto,
  ) {
    assertFinancialKey(input.idempotencyKey);
    const sourceReference = input.sourceReference?.trim();
    if (!sourceReference || sourceReference.length > 200)
      throw invalid('来源编号无效');
    const fingerprint = financialFingerprint({
      command: 'SUPPLEMENT_ACTUAL_SOURCE',
      factId: input.factId,
      sourceReference,
    });
    try {
      return await this.database.$transaction(
        async (tx) => {
          const source = await tx.settlementActualFact.findFirst({
            where: { id: input.factId, departmentId: actor.departmentId },
            select: { sourceCaseId: true },
          });
          if (!source)
            throw new NotFoundException({
              code: 'ACTUAL_SETTLEMENT_NOT_FOUND',
              message: '实际结算记录不存在',
            });
          await this.authorizeCase(tx, actor, source.sourceCaseId);
          await tx.$queryRaw`SELECT id FROM settlement_actual_facts WHERE id = ${input.factId}::uuid AND department_id = ${actor.departmentId}::uuid FOR UPDATE`;
          const fact = await tx.settlementActualFact.findFirst({
            where: { id: input.factId, departmentId: actor.departmentId },
            include: { sourceSupplement: true },
          });
          if (!fact) throw conflict();
          const old = await tx.settlementActualSourceSupplement.findUnique({
            where: {
              departmentId_actorUserId_idempotencyKey: {
                departmentId: actor.departmentId,
                actorUserId: actor.userId,
                idempotencyKey: input.idempotencyKey,
              },
            },
          });
          if (old) {
            if (
              old.factId !== fact.id ||
              old.requestFingerprint !== fingerprint
            )
              throw conflict();
            return {
              id: old.id,
              factId: fact.id,
              sourceReference: old.sourceReference,
            };
          }
          if (fact.sourceReference !== null || fact.sourceSupplement !== null)
            throw conflict();
          const supplementId = randomUUID();
          const audit = await tx.auditEvent.create({
            data: {
              departmentId: actor.departmentId,
              actorUserId: actor.userId,
              internalActorUserId: actor.userId,
              resourceType: 'SETTLEMENT_ACTUAL',
              resourceId: fact.id,
              action: 'settlement.actual.source-supplemented',
              details: {
                supplementId,
                side: fact.side,
                partyId: fact.partyId,
                sourceReference,
                idempotencyKey: input.idempotencyKey,
                requestFingerprint: fingerprint,
              },
            },
          });
          await tx.settlementActualSourceClaim.create({
            data: {
              factId: fact.id,
              departmentId: actor.departmentId,
              side: fact.side,
              partyId: fact.partyId,
              sourceReference,
            },
          });
          const created = await tx.settlementActualSourceSupplement.create({
            data: {
              id: supplementId,
              factId: fact.id,
              departmentId: actor.departmentId,
              side: fact.side,
              partyId: fact.partyId,
              sourceReference,
              actorUserId: actor.userId,
              idempotencyKey: input.idempotencyKey,
              requestFingerprint: fingerprint,
              auditEventId: audit.id,
            },
          });
          return {
            id: created.id,
            factId: fact.id,
            sourceReference: created.sourceReference,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (isDatabaseTransactionConflict(error, { retryUnique: true }))
        throw conflict();
      throw error;
    }
  }
}
