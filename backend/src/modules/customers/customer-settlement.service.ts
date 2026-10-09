import { createHash, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  Prisma,
  type CustomerSettlementVersion,
} from '../../generated/prisma/client';
import type { ActorContext } from '../../access-control/actor-context';
import {
  AccessControlService,
  type CustomerAction,
} from '../../access-control/access-control.service';
import { OrganizationService } from '../../access-control/organization.service';
import { lockCustomerActorFacts } from '../../access-control/customer-actor-facts-lock';
import { DatabaseService } from '../../database/database.service';
import type {
  CorrectCustomerSettlementDto,
  CustomerSettlementPageDto,
  RegisterCustomerSettlementDto,
} from './customer-settlement.dto';

type Reader = Prisma.TransactionClient | DatabaseService;
type Action = 'REGISTER' | 'CORRECT';
type Facts = {
  settlementDate: string;
  settlementAmount: string;
  invoiceAmount: string | null;
  receivedAmount: string | null;
  receivedDate: string | null;
};
type VisibleCustomer = {
  id: string;
  departmentId: string;
  responsibleUserId: string;
  teamId: string | null;
  version: number;
};
const moneyPattern = /^(0|[1-9]\d{0,15})(?:\.\d{1,2})?$/u;

function invalid(message: string): BadRequestException {
  return new BadRequestException({ code: 'VALIDATION_ERROR', message });
}
function conflict(code: string): ConflictException {
  return new ConflictException({ code, message: '结算记录或请求版本已变化' });
}
export function normalizeSettlementMoney(value: unknown): string {
  if (typeof value !== 'string' || !moneyPattern.test(value))
    throw invalid('金额格式无效');
  const [integer, fraction = ''] = value.split('.');
  return `${integer}.${fraction.padEnd(2, '0')}`;
}
export function parseSettlementDate(value: unknown): Date {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/u.test(value) ||
    value.startsWith('0000-')
  )
    throw invalid('结算日期无效');
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  )
    throw invalid('结算日期无效');
  return parsed;
}
function day(value: Date | null): string | null {
  return value?.toISOString().slice(0, 10) ?? null;
}
function cents(value: string): bigint {
  const negative = value.startsWith('-');
  const [whole, fraction] = (negative ? value.slice(1) : value).split('.');
  const amount = BigInt(whole) * 100n + BigInt(fraction);
  return negative ? -amount : amount;
}
function rate(received: string, total: string): string | null {
  const denominator = cents(total);
  if (denominator === 0n) return null;
  const numerator = cents(received) * 10000n;
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  const rounded = quotient + (remainder * 2n >= denominator ? 1n : 0n);
  return `${rounded / 100n}.${String(rounded % 100n).padStart(2, '0')}`;
}
export function settlementStats(
  rows: Array<{
    settlementAmount: Prisma.Decimal;
    invoiceAmount: Prisma.Decimal | null;
    receivedAmount: Prisma.Decimal | null;
  }>,
) {
  const Decimal = Prisma.Decimal.clone({
    precision: Math.max(40, String(rows.length).length + 20),
  });
  let total = new Decimal(0);
  let invoice = new Decimal(0);
  let received = new Decimal(0);
  let invoiceUnknownCount = 0;
  let receivedUnknownCount = 0;
  for (const row of rows) {
    total = total.plus(row.settlementAmount.toString());
    if (row.invoiceAmount === null) invoiceUnknownCount += 1;
    else invoice = invoice.plus(row.invoiceAmount.toString());
    if (row.receivedAmount === null) receivedUnknownCount += 1;
    else received = received.plus(row.receivedAmount.toString());
  }
  const totalSettlement = total.toFixed(2);
  const invoiceKnownSubtotal = invoice.toFixed(2);
  const receivedKnownSubtotal = received.toFixed(2);
  return {
    recordCount: rows.length,
    totalSettlement,
    invoiceKnownSubtotal,
    invoiceUnknownCount,
    receivedKnownSubtotal,
    receivedUnknownCount,
    pendingAmount:
      receivedUnknownCount === 0 ? total.minus(received).toFixed(2) : null,
    recoveryRate:
      receivedUnknownCount === 0
        ? rate(receivedKnownSubtotal, totalSettlement)
        : null,
  };
}
function versionResponse(row: CustomerSettlementVersion) {
  return {
    id: row.id,
    recordId: row.recordId,
    customerId: row.customerId,
    departmentId: row.departmentId,
    version: row.version,
    action: row.action,
    settlementDate: day(row.settlementDate)!,
    settlementAmount: row.settlementAmount.toFixed(2),
    invoiceAmount: row.invoiceAmount?.toFixed(2) ?? null,
    receivedAmount: row.receivedAmount?.toFixed(2) ?? null,
    receivedDate: day(row.receivedDate),
    correctionReason: row.correctionReason,
    recordedByUserId: row.recordedByUserId,
    recordedAt: row.recordedAt.toISOString(),
    auditEventId: row.auditEventId,
  };
}
function canonical(
  input: RegisterCustomerSettlementDto | CorrectCustomerSettlementDto,
  action: Action,
): Facts {
  if (
    action === 'CORRECT' &&
    (input.invoiceAmount === undefined ||
      input.receivedAmount === undefined ||
      input.receivedDate === undefined)
  )
    throw invalid('更正必须提供完整结算事实');
  return {
    settlementDate: day(parseSettlementDate(input.settlementDate))!,
    settlementAmount: normalizeSettlementMoney(input.settlementAmount),
    invoiceAmount:
      input.invoiceAmount == null
        ? null
        : normalizeSettlementMoney(input.invoiceAmount),
    receivedAmount:
      input.receivedAmount == null
        ? null
        : normalizeSettlementMoney(input.receivedAmount),
    receivedDate:
      input.receivedDate == null
        ? null
        : day(parseSettlementDate(input.receivedDate)),
  };
}
function retryable(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false;
  const candidate = error as {
    code?: unknown;
    cause?: unknown;
    meta?: {
      code?: unknown;
      databaseErrorCode?: unknown;
      driverAdapterError?: {
        cause?: { originalCode?: unknown; sqlState?: unknown };
      };
    };
  };
  return (
    ['P2034', '55P03', '40001', '40P01'].some((code) =>
      [
        candidate.code,
        candidate.meta?.code,
        candidate.meta?.databaseErrorCode,
        candidate.meta?.driverAdapterError?.cause?.originalCode,
        candidate.meta?.driverAdapterError?.cause?.sqlState,
      ].includes(code),
    ) || retryable(candidate.cause)
  );
}

@Injectable()
export class CustomerSettlementService {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: AccessControlService,
    private readonly organization: OrganizationService,
  ) {}

  private notFound(): NotFoundException {
    return new NotFoundException({
      code: 'RESOURCE_NOT_FOUND',
      message: '客户或结算记录不存在或不可访问',
    });
  }
  private permission(action: Action | 'READ'): CustomerAction {
    return `customer.settlement.${action.toLowerCase()}` as CustomerAction;
  }
  private async visible(
    reader: Reader,
    actor: ActorContext,
    customerId: string,
    action: Action | 'READ',
  ): Promise<VisibleCustomer> {
    const readScope = await this.access.tryBuildCustomerScope(
      actor,
      'customer.read',
      reader,
    );
    if (readScope === null) throw this.notFound();
    const customer = await reader.customer.findFirst({
      where: {
        id: customerId,
        departmentId: actor.departmentId,
        deletedAt: null,
        AND: [readScope],
      },
      select: {
        id: true,
        departmentId: true,
        responsibleUserId: true,
        teamId: true,
        version: true,
      },
    });
    if (customer === null) throw this.notFound();
    const allowed = await this.access.canAuthorizeCustomer(
      actor,
      this.permission(action),
      {
        departmentId: customer.departmentId,
        responsibleUserId: customer.responsibleUserId,
        ...(customer.teamId === null ? {} : { teamId: customer.teamId }),
      },
      reader,
    );
    if (!allowed)
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: '无结算操作权限',
      });
    return customer;
  }
  private async capabilities(
    reader: Reader,
    actor: ActorContext,
    customer: VisibleCustomer,
  ) {
    const facts = {
      departmentId: customer.departmentId,
      responsibleUserId: customer.responsibleUserId,
      ...(customer.teamId === null ? {} : { teamId: customer.teamId }),
    };
    const [read, register, correct] = await Promise.all([
      this.access.canAuthorizeCustomer(
        actor,
        'customer.settlement.read',
        facts,
        reader,
      ),
      this.access.canAuthorizeCustomer(
        actor,
        'customer.settlement.register',
        facts,
        reader,
      ),
      this.access.canAuthorizeCustomer(
        actor,
        'customer.settlement.correct',
        facts,
        reader,
      ),
    ]);
    return { read, register, correct };
  }
  private async locked(
    tx: Prisma.TransactionClient,
    actor: ActorContext,
    customerId: string,
    action: Action,
  ) {
    await lockCustomerActorFacts(tx, this.organization, actor);
    await this.visible(tx, actor, customerId, action);
    const locked = await tx.$queryRaw<
      Array<{ id: string }>
    >`SELECT id FROM customers WHERE id = ${customerId}::uuid AND department_id = ${actor.departmentId}::uuid FOR UPDATE`;
    if (locked.length !== 1) throw this.notFound();
    return this.visible(tx, actor, customerId, action);
  }

  async list(
    actor: ActorContext,
    customerId: string,
    query: CustomerSettlementPageDto,
  ) {
    return this.database.$transaction(
      async (tx) => {
        const customer = await this.visible(tx, actor, customerId, 'READ');
        const rows = await tx.customerSettlementRecord.findMany({
          where: { customerId, departmentId: actor.departmentId },
          include: { currentVersion: true },
        });
        const current = rows.map((row) => {
          if (!row.currentVersion)
            throw new Error('Settlement current version missing');
          return {
            id: row.id,
            version: row.version,
            currentVersion: row.currentVersion,
          };
        });
        current.sort(
          (a, b) =>
            b.currentVersion.settlementDate.getTime() -
              a.currentVersion.settlementDate.getTime() ||
            (b.id < a.id ? -1 : b.id > a.id ? 1 : 0),
        );
        const stats = settlementStats(current.map((row) => row.currentVersion));
        return {
          items: current
            .slice(
              (query.page - 1) * query.pageSize,
              query.page * query.pageSize,
            )
            .map((row) => ({
              id: row.id,
              version: row.version,
              currentVersion: versionResponse(row.currentVersion),
            })),
          total: rows.length,
          page: query.page,
          pageSize: query.pageSize,
          stats,
          capabilities: await this.capabilities(tx, actor, customer),
          customerVersion: customer.version,
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
  async detail(actor: ActorContext, customerId: string, recordId: string) {
    return this.database.$transaction(
      async (tx) => {
        const customer = await this.visible(tx, actor, customerId, 'READ');
        const row = await tx.customerSettlementRecord.findFirst({
          where: { id: recordId, customerId, departmentId: actor.departmentId },
          include: { currentVersion: true },
        });
        if (!row?.currentVersion) throw this.notFound();
        return {
          record: {
            id: row.id,
            version: row.version,
            currentVersion: versionResponse(row.currentVersion),
          },
          capabilities: await this.capabilities(tx, actor, customer),
          customerVersion: customer.version,
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
  async versions(
    actor: ActorContext,
    customerId: string,
    recordId: string,
    query: CustomerSettlementPageDto,
  ) {
    return this.database.$transaction(
      async (tx) => {
        await this.visible(tx, actor, customerId, 'READ');
        const record = await tx.customerSettlementRecord.findFirst({
          where: { id: recordId, customerId, departmentId: actor.departmentId },
          select: { id: true },
        });
        if (!record) throw this.notFound();
        const where = {
          recordId,
          customerId,
          departmentId: actor.departmentId,
        };
        const [items, total] = await Promise.all([
          tx.customerSettlementVersion.findMany({
            where,
            orderBy: [{ version: 'desc' }, { id: 'desc' }],
            skip: (query.page - 1) * query.pageSize,
            take: query.pageSize,
          }),
          tx.customerSettlementVersion.count({ where }),
        ]);
        return {
          items: items.map(versionResponse),
          total,
          page: query.page,
          pageSize: query.pageSize,
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
  register(
    actor: ActorContext,
    customerId: string,
    key: string,
    input: RegisterCustomerSettlementDto,
  ) {
    return this.command(actor, customerId, null, key, 'REGISTER', input);
  }
  correct(
    actor: ActorContext,
    customerId: string,
    recordId: string,
    key: string,
    input: CorrectCustomerSettlementDto,
  ) {
    return this.command(actor, customerId, recordId, key, 'CORRECT', input);
  }
  private async command(
    actor: ActorContext,
    customerId: string,
    recordId: string | null,
    key: string,
    action: Action,
    input: RegisterCustomerSettlementDto | CorrectCustomerSettlementDto,
  ) {
    const facts = canonical(input, action);
    const reason =
      action === 'CORRECT'
        ? (input as CorrectCustomerSettlementDto).reason?.trim()
        : null;
    if (
      action === 'CORRECT' &&
      (typeof reason !== 'string' || reason.length < 1 || reason.length > 500)
    )
      throw invalid('更正原因无效');
    const hash = createHash('sha256')
      .update(
        JSON.stringify({
          action,
          customerId,
          recordId,
          facts,
          reason,
          expectedCustomerVersion: input.expectedCustomerVersion,
          expectedRecordVersion:
            action === 'CORRECT'
              ? (input as CorrectCustomerSettlementDto).expectedRecordVersion
              : null,
        }),
      )
      .digest('hex');
    for (let attempt = 0; attempt < 6; attempt += 1) {
      try {
        return await this.database.$transaction(
          async (tx) => {
            const customer = await this.locked(tx, actor, customerId, action);
            const previous = await tx.customerSettlementReceipt.findUnique({
              where: {
                departmentId_actorUserId_action_idempotencyKey: {
                  departmentId: actor.departmentId,
                  actorUserId: actor.userId,
                  action,
                  idempotencyKey: key,
                },
              },
              include: { resultVersion: true },
            });
            if (previous) {
              if (
                previous.customerId !== customerId ||
                previous.recordId !== (recordId ?? previous.recordId) ||
                previous.requestFingerprint !== hash
              )
                throw conflict('CUSTOMER_IDEMPOTENCY_CONFLICT');
              return {
                recordId: previous.recordId,
                version: previous.resultVersion.version,
                customerVersion: previous.resultCustomerVersion,
                snapshot: versionResponse(previous.resultVersion),
              };
            }
            if (customer.version !== input.expectedCustomerVersion)
              throw conflict('CUSTOMER_VERSION_CONFLICT');
            const record =
              recordId === null
                ? null
                : await tx.customerSettlementRecord.findFirst({
                    where: {
                      id: recordId,
                      customerId,
                      departmentId: actor.departmentId,
                    },
                  });
            if (action === 'CORRECT' && !record) throw this.notFound();
            if (
              action === 'CORRECT' &&
              record?.version !==
                (input as CorrectCustomerSettlementDto).expectedRecordVersion
            )
              throw conflict('SETTLEMENT_VERSION_CONFLICT');
            if (recordId !== null) {
              const locked = await tx.$queryRaw<
                Array<{ id: string }>
              >`SELECT id FROM customer_settlement_records WHERE id = ${recordId}::uuid AND customer_id = ${customerId}::uuid AND department_id = ${actor.departmentId}::uuid FOR UPDATE`;
              if (locked.length !== 1) throw this.notFound();
            }
            const changed = await tx.customer.updateMany({
              where: {
                id: customerId,
                departmentId: actor.departmentId,
                deletedAt: null,
                version: input.expectedCustomerVersion,
              },
              data: { version: { increment: 1 } },
            });
            if (changed.count !== 1)
              throw conflict('CUSTOMER_VERSION_CONFLICT');
            const stableId = recordId ?? randomUUID();
            const versionNumber = (record?.version ?? 0) + 1;
            if (recordId === null)
              await tx.customerSettlementRecord.create({
                data: {
                  id: stableId,
                  customerId,
                  departmentId: actor.departmentId,
                  version: 1,
                },
              });
            const audit = await tx.auditEvent.create({
              data: {
                departmentId: actor.departmentId,
                actorUserId: actor.userId,
                resourceType: 'customer_settlement',
                resourceId: stableId,
                action:
                  action === 'REGISTER'
                    ? 'customer.settlement.register'
                    : 'customer.settlement.correct',
                details: { version: versionNumber },
              },
            });
            const created = await tx.customerSettlementVersion.create({
              data: {
                id: randomUUID(),
                recordId: stableId,
                customerId,
                departmentId: actor.departmentId,
                version: versionNumber,
                action,
                settlementDate: parseSettlementDate(facts.settlementDate),
                settlementAmount: new Prisma.Decimal(facts.settlementAmount),
                invoiceAmount:
                  facts.invoiceAmount === null
                    ? null
                    : new Prisma.Decimal(facts.invoiceAmount),
                receivedAmount:
                  facts.receivedAmount === null
                    ? null
                    : new Prisma.Decimal(facts.receivedAmount),
                receivedDate:
                  facts.receivedDate === null
                    ? null
                    : parseSettlementDate(facts.receivedDate),
                correctionReason: reason,
                recordedByUserId: actor.userId,
                auditEventId: audit.id,
              },
            });
            const updated = await tx.customerSettlementRecord.updateMany({
              where: {
                id: stableId,
                customerId,
                departmentId: actor.departmentId,
                version: record?.version ?? 1,
              },
              data: {
                currentVersionId: created.id,
                ...(record ? { version: { increment: 1 } } : {}),
              },
            });
            if (updated.count !== 1)
              throw conflict('SETTLEMENT_VERSION_CONFLICT');
            await tx.customerSettlementReceipt.create({
              data: {
                departmentId: actor.departmentId,
                actorUserId: actor.userId,
                action,
                idempotencyKey: key,
                requestFingerprint: hash,
                customerId,
                recordId: stableId,
                resultVersionId: created.id,
                resultCustomerVersion: customer.version + 1,
              },
            });
            return {
              recordId: stableId,
              version: versionNumber,
              customerVersion: customer.version + 1,
              snapshot: versionResponse(created),
            };
          },
          { isolationLevel: 'Serializable', timeout: 15000 },
        );
      } catch (error) {
        if (!retryable(error)) throw error;
        if (attempt === 5)
          throw new ServiceUnavailableException({
            code: 'BUSY',
            message: '结算维护繁忙，请保留原请求重试',
          });
      }
    }
    throw new Error('Unreachable settlement retry state');
  }
}
