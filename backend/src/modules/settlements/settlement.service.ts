import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import type { ActorContext } from '../../access-control/actor-context';
import { AccessControlService } from '../../access-control/access-control.service';
import { DatabaseService } from '../../database/database.service';
import { OrganizationService } from '../../access-control/organization.service';
import { readCaseSettlementSource } from '../cases';
import {
  lockFinancialCases,
  lockFinancialWriteContext,
  type FinancialWriteAction,
} from './settlement-write-context';
import {
  assertFinancialKey,
  financialFingerprint,
  parseFinancialDay,
} from './settlement-input';
import { loadFinancialAuditReceipt } from './settlement-audit-receipt';
import {
  calculateSettlement,
  customerPercentFromFormula,
} from './settlement-calculation';
import { billSelection, settlementBalance } from './settlement-ledger';
import type {
  CancelSettlementBillDto,
  CreateSettlementBillDto,
  LaunchCaseSettlementDto,
  SettlementPageDto,
  UpdateCaseSettlementTermsDto,
} from './settlement.dto';

function bad(code: string, message: string): BadRequestException {
  return new BadRequestException({ code, message });
}

function changed(): ConflictException {
  return new ConflictException({
    code: 'SETTLEMENT_CHANGED',
    message: '结算条件或余额已变化，请刷新后重试',
  });
}

@Injectable()
export class SettlementService {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: AccessControlService,
    private readonly organization: OrganizationService,
  ) {}

  private async caseFacts(
    reader: Prisma.TransactionClient | DatabaseService,
    actor: ActorContext,
    caseId: string,
  ) {
    const source = await readCaseSettlementSource(reader, {
      caseId,
      departmentId: actor.departmentId,
    });
    if (source === null)
      throw new NotFoundException({
        code: 'CASE_NOT_FOUND',
        message: '案件不存在',
      });
    const settlementTerms = await reader.caseSettlementTerms.findUnique({
      where: { caseId },
    });
    if (
      settlementTerms !== null &&
      settlementTerms.departmentId !== source.departmentId
    )
      throw bad('INVALID_SETTLEMENT_SOURCE', '结算条件来源不一致');
    return {
      ...source,
      id: source.caseId,
      customerId: source.customer.id,
      settlementTerms,
    };
  }

  private async authorizeWrite(
    tx: Prisma.TransactionClient,
    actor: ActorContext,
    action: FinancialWriteAction,
    caseIds: readonly string[] = [],
  ) {
    await lockFinancialWriteContext(
      tx,
      this.organization,
      this.access,
      actor,
      action,
    );
    await lockFinancialCases(tx, actor, caseIds);
  }

  private figures(record: Awaited<ReturnType<SettlementService['caseFacts']>>) {
    const terms = record.settlementTerms;
    try {
      return calculateSettlement({
        closureAmount: record.closure.amount,
        closureAmountState: record.closure.state,
        fallbackClaimAmount: record.claimAmount,
        customerFormula: terms?.customerFormula ?? null,
        lawyerMode: terms?.lawyerMode ?? null,
        lawyerBaseFee: terms?.lawyerBaseFee?.toString() ?? null,
        lawyerSplitPercent: terms?.lawyerSplitPercent?.toString() ?? null,
        customerManualAmount: terms?.customerManualAmount?.toString() ?? null,
        lawyerManualAmount: terms?.lawyerManualAmount?.toString() ?? null,
      });
    } catch {
      throw bad('INVALID_SETTLEMENT_TERMS', '结算条件无效');
    }
  }

  async context(actor: ActorContext) {
    return this.database.$transaction(
      async (tx) => {
        const can = async (
          action: Parameters<
            AccessControlService['authorizeDepartmentAction']
          >[1],
        ) => {
          try {
            await this.access.authorizeDepartmentAction(actor, action, tx);
            return true;
          } catch (error) {
            if (error instanceof ForbiddenException) return false;
            throw error;
          }
        };
        const [
          read,
          termsUpdate,
          launch,
          billCreate,
          billCancel,
          feeRead,
          feeCreate,
          feeUpdate,
          feeLaunch,
          feeDelete,
        ] = await Promise.all([
          can('settlement.read'),
          can('settlement.terms.update'),
          can('settlement.launch'),
          can('settlement.bill.create'),
          can('settlement.bill.cancel'),
          can('fee.read'),
          can('fee.create'),
          can('fee.update'),
          can('fee.launch'),
          can('fee.delete'),
        ]);
        return {
          read,
          termsUpdate,
          launch,
          billCreate,
          billCancel,
          feeRead,
          feeCreate,
          feeUpdate,
          feeLaunch,
          feeDelete,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  async caseDetail(actor: ActorContext, caseId: string) {
    return this.database.$transaction(
      async (tx) => {
        await this.access.authorizeDepartmentAction(
          actor,
          'settlement.read',
          tx,
        );
        const record = await this.caseFacts(tx, actor, caseId);
        const launches = await tx.caseSettlementLaunch.findMany({
          where: { caseId, departmentId: actor.departmentId },
          orderBy: [{ side: 'asc' }, { nth: 'asc' }, { id: 'asc' }],
        });
        const figures = this.figures(record);
        return {
          caseId: record.id,
          businessNo: record.businessNo,
          stage: record.stage,
          customer: record.customer,
          lawyers: record.lawyers,
          amountSource: record.closure,
          termsVersion: record.settlementTerms?.version ?? 0,
          terms:
            record.settlementTerms === null
              ? null
              : {
                  customerFormula: record.settlementTerms.customerFormula,
                  lawyerMode: record.settlementTerms.lawyerMode,
                  lawyerBaseFee:
                    record.settlementTerms.lawyerBaseFee?.toFixed(2) ?? null,
                  lawyerSplitPercent:
                    record.settlementTerms.lawyerSplitPercent?.toString() ??
                    null,
                  customerManualAmount:
                    record.settlementTerms.customerManualAmount?.toFixed(2) ??
                    null,
                  lawyerManualAmount:
                    record.settlementTerms.lawyerManualAmount?.toFixed(2) ??
                    null,
                },
          figures,
          customerBalance: settlementBalance(
            figures.customerAmount,
            launches
              .filter((item) => item.side === 'CUSTOMER')
              .map((item) => ({ amount: item.amount.toString() })),
          ),
          lawyerBalance: settlementBalance(
            figures.lawyerAmount,
            launches
              .filter((item) => item.side === 'LAWYER')
              .map((item) => ({ amount: item.amount.toString() })),
          ),
          launches: launches.map((item) => ({
            id: item.id,
            caseId: item.caseId,
            side: item.side,
            nth: item.nth,
            amount: item.amount.toFixed(2),
            launchDate: item.launchDate.toISOString().slice(0, 10),
            note: item.note,
            billId: item.billId,
            customerId: item.customerId,
            lawyerId: item.lawyerId,
          })),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  async updateTerms(
    actor: ActorContext,
    caseId: string,
    input: UpdateCaseSettlementTermsDto,
  ) {
    assertFinancialKey(input.idempotencyKey);
    const fingerprint = financialFingerprint({
      command: 'UPDATE_TERMS',
      caseId,
      side: input.side,
      expectedTermsVersion: input.expectedTermsVersion,
      customerFormula: input.customerFormula ?? null,
      lawyerMode: input.lawyerMode ?? null,
      lawyerBaseFee: input.lawyerBaseFee ?? null,
      lawyerSplitPercent: input.lawyerSplitPercent ?? null,
      manualAmount: input.manualAmount ?? null,
    });
    return this.database.$transaction(
      async (tx) => {
        await this.authorizeWrite(tx, actor, 'settlement.terms.update', [
          caseId,
        ]);
        const prior = await tx.auditEvent.findMany({
          where: {
            departmentId: actor.departmentId,
            actorUserId: actor.userId,
            internalActorUserId: actor.userId,
            resourceType: 'CASE',
            resourceId: caseId,
            action: 'settlement.terms.updated',
            details: { path: ['idempotencyKey'], equals: input.idempotencyKey },
          },
          select: { details: true },
        });
        if (prior.length > 1)
          throw new InternalServerErrorException({
            code: 'INVALID_FINANCIAL_RECEIPT',
            message: '结算条件回执不唯一',
          });
        if (prior.length === 1) {
          const old = prior[0]!.details;
          if (
            old === null ||
            typeof old !== 'object' ||
            Array.isArray(old) ||
            old.requestFingerprint !== fingerprint
          )
            throw new ConflictException({
              code: 'IDEMPOTENCY_CONFLICT',
              message: '原请求键与当前结算条件不一致',
            });
          if (
            typeof old.termsVersion !== 'number' ||
            !Number.isSafeInteger(old.termsVersion) ||
            old.termsVersion < 1
          )
            throw new InternalServerErrorException({
              code: 'INVALID_FINANCIAL_RECEIPT',
              message: '结算条件回执版本无效',
            });
          return { caseId, termsVersion: old.termsVersion };
        }
        const record = await this.caseFacts(tx, actor, caseId);
        if (
          record.settlementTerms?.version !==
          (input.expectedTermsVersion || undefined)
        ) {
          if (!(
            record.settlementTerms === null && input.expectedTermsVersion === 0
          ))
            throw changed();
        }
        if (input.side === 'CUSTOMER') {
          if (input.customerFormula === undefined)
            throw bad('INVALID_SETTLEMENT_TERMS', '客户结算公式不能为空');
          try {
            customerPercentFromFormula(input.customerFormula);
          } catch {
            throw bad('INVALID_SETTLEMENT_TERMS', '客户结算公式无效');
          }
          if (
            input.lawyerMode !== undefined ||
            input.lawyerBaseFee !== undefined ||
            input.lawyerSplitPercent !== undefined
          )
            throw bad('INVALID_SETTLEMENT_TERMS', '不能同时修改律师条款');
        } else {
          if (
            input.lawyerMode === undefined ||
            input.lawyerBaseFee === undefined ||
            input.lawyerSplitPercent === undefined
          )
            throw bad('INVALID_SETTLEMENT_TERMS', '律师条款不完整');
          if (
            input.lawyerMode === 'FULL_RISK' &&
            new Prisma.Decimal(input.lawyerBaseFee).isPositive()
          )
            throw bad('INVALID_SETTLEMENT_TERMS', '全风险基础费必须为 0');
          if (
            input.lawyerMode === 'FULL_RISK' &&
            new Prisma.Decimal(input.lawyerSplitPercent).isZero()
          )
            throw bad('INVALID_SETTLEMENT_TERMS', '全风险分成比例必须大于 0');
          if (input.customerFormula !== undefined)
            throw bad('INVALID_SETTLEMENT_TERMS', '不能同时修改客户公式');
        }
        const changedTerms =
          record.settlementTerms === null
            ? await tx.caseSettlementTerms.create({
                data: {
                  caseId,
                  departmentId: actor.departmentId,
                  ...(input.side === 'CUSTOMER'
                    ? {
                        customerFormula: input.customerFormula,
                        customerManualAmount: input.manualAmount ?? null,
                      }
                    : {
                        lawyerMode: input.lawyerMode,
                        lawyerBaseFee: input.lawyerBaseFee,
                        lawyerSplitPercent: input.lawyerSplitPercent,
                        lawyerManualAmount: input.manualAmount ?? null,
                      }),
                },
              })
            : await tx.caseSettlementTerms.update({
                where: { caseId },
                data: {
                  version: { increment: 1 },
                  ...(input.side === 'CUSTOMER'
                    ? {
                        customerFormula: input.customerFormula,
                        customerManualAmount: input.manualAmount ?? null,
                      }
                    : {
                        lawyerMode: input.lawyerMode,
                        lawyerBaseFee: input.lawyerBaseFee,
                        lawyerSplitPercent: input.lawyerSplitPercent,
                        lawyerManualAmount: input.manualAmount ?? null,
                      }),
                },
              });
        await tx.auditEvent.create({
          data: {
            departmentId: actor.departmentId,
            actorUserId: actor.userId,
            internalActorUserId: actor.userId,
            resourceType: 'CASE',
            resourceId: caseId,
            action: 'settlement.terms.updated',
            details: {
              side: input.side,
              termsVersion: changedTerms.version,
              idempotencyKey: input.idempotencyKey,
              requestFingerprint: fingerprint,
            },
          },
        });
        return { caseId, termsVersion: changedTerms.version };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async launch(
    actor: ActorContext,
    caseId: string,
    input: LaunchCaseSettlementDto,
  ) {
    assertFinancialKey(input.idempotencyKey);
    const launchDate = parseFinancialDay(input.launchDate);
    const requested = new Prisma.Decimal(input.amount);
    if (!requested.isPositive())
      throw bad('INVALID_AMOUNT', '发起金额须大于 0');
    const fingerprint = financialFingerprint({
      command: 'LAUNCH',
      caseId,
      side: input.side,
      amount: requested.toFixed(2),
      launchDate: input.launchDate,
      note: input.note ?? null,
      lawyerId: input.lawyerId ?? null,
      expectedTermsVersion: input.expectedTermsVersion,
    });
    try {
      return await this.database.$transaction(
        async (tx) => {
          await this.authorizeWrite(tx, actor, 'settlement.launch', [caseId]);
          const prior = await tx.caseSettlementLaunch.findUnique({
            where: {
              departmentId_actorUserId_idempotencyKey: {
                departmentId: actor.departmentId,
                actorUserId: actor.userId,
                idempotencyKey: input.idempotencyKey,
              },
            },
          });
          if (prior !== null) {
            if (
              prior.caseId !== caseId ||
              prior.side !== input.side ||
              prior.amount.toString() !== requested.toString() ||
              prior.launchDate.toISOString().slice(0, 10) !==
                input.launchDate ||
              prior.note !== (input.note ?? null) ||
              prior.lawyerId !== (input.lawyerId ?? null)
            )
              throw changed();
            await loadFinancialAuditReceipt(
              tx,
              {
                departmentId: actor.departmentId,
                actorUserId: actor.userId,
                resourceType: 'CASE',
                resourceId: caseId,
                action: 'settlement.launch.created',
                launchId: prior.id,
              },
              fingerprint,
            );
            return {
              id: prior.id,
              nth: prior.nth,
              amount: prior.amount.toFixed(2),
            };
          }
          const record = await this.caseFacts(tx, actor, caseId);
          if (
            record.stage !== 'WAITING_ARCHIVE' ||
            (record.settlementTerms?.version ?? 0) !==
              input.expectedTermsVersion
          )
            throw changed();
          const lawyer =
            input.side === 'LAWYER'
              ? record.lawyers.find(
                  (assignment) => assignment.id === input.lawyerId,
                )
              : null;
          if (
            (input.side === 'LAWYER' && lawyer === undefined) ||
            (input.side === 'CUSTOMER' && input.lawyerId !== undefined)
          )
            throw bad('INVALID_PAYEE', '收付方与案件不匹配');
          const figures = this.figures(record);
          const total =
            input.side === 'CUSTOMER'
              ? figures.customerAmount
              : figures.lawyerAmount;
          if (total === null)
            throw bad('UNKNOWN_SETTLEMENT_AMOUNT', '结算金额尚未确定');
          const previous = await tx.caseSettlementLaunch.findMany({
            where: {
              caseId,
              departmentId: actor.departmentId,
              side: input.side,
            },
            select: { amount: true, nth: true },
          });
          const balance = settlementBalance(
            total,
            previous.map((item) => ({ amount: item.amount.toString() })),
          );
          if (
            balance.remaining === null ||
            requested.greaterThan(balance.remaining)
          )
            throw changed();
          const nth =
            previous.reduce((max, item) => Math.max(max, item.nth), 0) + 1;
          const launch = await tx.caseSettlementLaunch.create({
            data: {
              caseId,
              departmentId: actor.departmentId,
              side: input.side,
              nth,
              amount: input.amount,
              launchDate,
              note: input.note ?? null,
              customerId: input.side === 'CUSTOMER' ? record.customerId : null,
              lawyerId: lawyer?.id ?? null,
              actorUserId: actor.userId,
              idempotencyKey: input.idempotencyKey,
            },
          });
          await tx.auditEvent.create({
            data: {
              departmentId: actor.departmentId,
              actorUserId: actor.userId,
              internalActorUserId: actor.userId,
              resourceType: 'CASE',
              resourceId: caseId,
              action: 'settlement.launch.created',
              details: {
                launchId: launch.id,
                side: launch.side,
                nth: launch.nth,
                amount: launch.amount.toFixed(2),
                requestFingerprint: fingerprint,
                expectedTermsVersion: input.expectedTermsVersion,
              },
            },
          });
          return {
            id: launch.id,
            nth: launch.nth,
            amount: launch.amount.toFixed(2),
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        ['P2002', 'P2034'].includes(error.code)
      )
        throw changed();
      throw error;
    }
  }

  async launches(
    actor: ActorContext,
    side: 'CUSTOMER' | 'LAWYER',
    query: SettlementPageDto,
  ) {
    const keyword = query.keyword?.trim() ?? '';
    const dates = this.listDates(query);
    const where: Prisma.CaseSettlementLaunchWhereInput = {
      departmentId: actor.departmentId,
      side,
      ...(query.stage === undefined ? {} : { case: { stage: query.stage } }),
      ...(query.billed === undefined
        ? {}
        : { billId: query.billed === 'BILLED' ? { not: null } : null }),
      ...(dates === undefined ? {} : { launchDate: dates }),
      ...(keyword === ''
        ? {}
        : {
            OR: [
              {
                case: {
                  businessNo: { contains: keyword, mode: 'insensitive' },
                },
              },
              {
                case: {
                  courtCaseNo: { contains: keyword, mode: 'insensitive' },
                },
              },
              {
                customer: { name: { contains: keyword, mode: 'insensitive' } },
              },
              {
                lawyer: {
                  fullName: { contains: keyword, mode: 'insensitive' },
                },
              },
              {
                lawyer: { lawFirm: { contains: keyword, mode: 'insensitive' } },
              },
            ],
          }),
    };
    return this.database.$transaction(
      async (tx) => {
        await this.access.authorizeDepartmentAction(
          actor,
          'settlement.read',
          tx,
        );
        const rows = await tx.caseSettlementLaunch.findMany({
          where,
          include: {
            case: { select: { businessNo: true, stage: true } },
            customer: { select: { name: true } },
            lawyer: { select: { fullName: true, lawFirm: true } },
          },
          orderBy: [{ launchDate: 'desc' }, { id: 'desc' }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        });
        const scope = { departmentId: actor.departmentId, side };
        const filteredCount = await tx.caseSettlementLaunch.count({ where });
        const total = await tx.caseSettlementLaunch.aggregate({
          where: scope,
          _sum: { amount: true },
          _count: { _all: true },
        });
        const unbilled = await tx.caseSettlementLaunch.aggregate({
          where: { ...scope, billId: null },
          _sum: { amount: true },
          _count: { _all: true },
        });
        const matching = await tx.caseSettlementLaunch.findMany({
          where: { AND: [where, { billId: null }] },
          select: { id: true },
          orderBy: { id: 'asc' },
        });
        const partners = await tx.caseSettlementLaunch.findMany({
          where: scope,
          distinct: [side === 'CUSTOMER' ? 'customerId' : 'lawyerId'],
          select: {
            customerId: true,
            lawyerId: true,
            lawyer: { select: { lawFirm: true } },
          },
        });
        const sum = total._sum.amount ?? new Prisma.Decimal(0);
        const pending = unbilled._sum.amount ?? new Prisma.Decimal(0);
        return {
          items: rows.map((row) => ({
            id: row.id,
            caseId: row.caseId,
            businessNo: row.case.businessNo,
            stage: row.case.stage,
            side: row.side,
            nth: row.nth,
            amount: row.amount.toFixed(2),
            launchDate: row.launchDate.toISOString().slice(0, 10),
            note: row.note,
            billId: row.billId,
            payeeId: row.customerId ?? row.lawyerId,
            customerId: row.customerId,
            lawyerId: row.lawyerId,
            payeeName: row.customer?.name ?? row.lawyer?.fullName ?? null,
            lawFirm: row.lawyer?.lawFirm ?? null,
            invoiceAmount: null,
            receivedAmount: null,
            paidAmount: null,
            actualPaymentDate: null,
          })),
          total: filteredCount,
          page: query.page,
          pageSize: query.pageSize,
          matchingIds: matching.map((row) => row.id),
          summary: {
            launchedAmount: sum.toFixed(2),
            billedAmount: new (Prisma.Decimal.clone({ precision: 36 }))(sum)
              .minus(pending)
              .toFixed(2),
            unbilledAmount: pending.toFixed(2),
            unbilledCount: unbilled._count._all,
            launchCount: total._count._all,
            billedCount: total._count._all - unbilled._count._all,
            invoiceAmount: null,
            receivedAmount: null,
            paidAmount: null,
            cooperatingPayeeCount: partners.length,
            knownLawFirmCount: new Set(
              partners.flatMap((row) =>
                row.lawyer?.lawFirm ? [row.lawyer.lawFirm] : [],
              ),
            ).size,
          },
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }

  private listDates(
    query: SettlementPageDto,
  ): Prisma.DateTimeFilter | undefined {
    if (query.from === undefined && query.to === undefined) return undefined;
    const from =
      query.from === undefined ? undefined : parseFinancialDay(query.from);
    const to = query.to === undefined ? undefined : parseFinancialDay(query.to);
    if (from !== undefined && to !== undefined && from > to)
      throw bad('INVALID_DATE_RANGE', '日期范围无效');
    return {
      ...(from === undefined ? {} : { gte: from }),
      ...(to === undefined ? {} : { lte: to }),
    };
  }

  private async nextBillNo(
    reader: Pick<Prisma.TransactionClient, 'settlementBill'>,
    billDate: string,
  ): Promise<string> {
    const head = billDate.replaceAll('-', '');
    const latest = await reader.settlementBill.findFirst({
      where: { billNo: { startsWith: head } },
      orderBy: { billNo: 'desc' },
      select: { billNo: true },
    });
    const sequence = latest === null ? 1 : Number(latest.billNo.slice(8)) + 1;
    if (!Number.isSafeInteger(sequence) || sequence < 1 || sequence > 99999)
      throw bad('BILL_SEQUENCE_EXHAUSTED', '该日期账单编号已用尽');
    return `${head}${String(sequence).padStart(5, '0')}`;
  }

  async previewBillNumber(actor: ActorContext, billDate: string) {
    parseFinancialDay(billDate);
    return this.database.$transaction(
      async (tx) => {
        await this.access.authorizeDepartmentAction(
          actor,
          'settlement.bill.create',
          tx,
        );
        return { billNo: await this.nextBillNo(tx, billDate), reserved: false };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }

  async createBill(actor: ActorContext, input: CreateSettlementBillDto) {
    assertFinancialKey(input.idempotencyKey);
    const billDate = parseFinancialDay(input.billDate);
    try {
      return await this.database.$transaction(
        async (tx) => {
          await this.authorizeWrite(tx, actor, 'settlement.bill.create');
          const sourceRows = await tx.caseSettlementLaunch.findMany({
            where: {
              id: { in: input.launchIds },
              departmentId: actor.departmentId,
              side: input.side,
            },
            select: { id: true, caseId: true },
          });
          if (sourceRows.length !== input.launchIds.length) throw changed();
          await lockFinancialCases(
            tx,
            actor,
            sourceRows.map((row) => row.caseId),
          );
          const prior = await tx.settlementBill.findUnique({
            where: {
              departmentId_actorUserId_idempotencyKey: {
                departmentId: actor.departmentId,
                actorUserId: actor.userId,
                idempotencyKey: input.idempotencyKey,
              },
            },
            include: { items: true },
          });
          if (prior !== null) {
            const oldIds = prior.items.map((item) => item.launchId).sort();
            if (
              prior.side !== input.side ||
              prior.billDate.toISOString().slice(0, 10) !== input.billDate ||
              prior.note !== (input.note ?? null) ||
              JSON.stringify(oldIds) !==
                JSON.stringify([...input.launchIds].sort())
            )
              throw changed();
            return {
              id: prior.id,
              billNo: prior.billNo,
              amount: prior.amount.toFixed(2),
            };
          }
          const rows = await tx.caseSettlementLaunch.findMany({
            where: {
              id: { in: input.launchIds },
              departmentId: actor.departmentId,
              side: input.side,
            },
            include: { customer: true, lawyer: true },
          });
          if (rows.some((row) => row.billId !== null)) throw changed();
          const selection = billSelection(
            input.side,
            input.launchIds,
            rows.map((row) => ({
              id: row.id,
              side: row.side,
              amount: row.amount.toString(),
              billId: row.billId,
              payeeId: row.customerId ?? row.lawyerId ?? '',
            })),
          );
          const billNo = await this.nextBillNo(tx, input.billDate);
          const bill = await tx.settlementBill.create({
            data: {
              departmentId: actor.departmentId,
              side: input.side,
              billNo,
              billDate,
              amount: selection.amount,
              note: input.note ?? null,
              actorUserId: actor.userId,
              idempotencyKey: input.idempotencyKey,
              items: {
                create: rows.map(
                  (
                    row,
                  ): Prisma.SettlementBillItemUncheckedCreateWithoutBillInput => ({
                    launchId: row.id,
                    caseId: row.caseId,
                    payeeId: row.customerId ?? row.lawyerId ?? '',
                    payeeName: row.customer?.name ?? row.lawyer?.fullName ?? '',
                    nth: row.nth,
                    amount: row.amount,
                  }),
                ),
              },
            },
          });
          const occupied = await tx.caseSettlementLaunch.updateMany({
            where: {
              id: { in: input.launchIds },
              departmentId: actor.departmentId,
              side: input.side,
              billId: null,
            },
            data: { billId: bill.id },
          });
          if (occupied.count !== input.launchIds.length) throw changed();
          await tx.auditEvent.create({
            data: {
              departmentId: actor.departmentId,
              actorUserId: actor.userId,
              internalActorUserId: actor.userId,
              resourceType: 'SETTLEMENT_BILL',
              resourceId: bill.id,
              action: 'settlement.bill.created',
              details: {
                billNo,
                side: input.side,
                amount: selection.amount,
                launchIds: selection.ids,
              },
            },
          });
          return { id: bill.id, billNo, amount: bill.amount.toFixed(2) };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        ['P2002', 'P2034'].includes(error.code)
      )
        throw changed();
      throw error;
    }
  }

  async bills(
    actor: ActorContext,
    side: 'CUSTOMER' | 'LAWYER',
    query: SettlementPageDto,
  ) {
    await this.access.authorizeDepartmentAction(actor, 'settlement.read');
    const keyword = query.keyword?.trim() ?? '';
    const dates = this.listDates(query);
    const where: Prisma.SettlementBillWhereInput = {
      departmentId: actor.departmentId,
      side,
      ...(dates === undefined ? {} : { billDate: dates }),
      ...(query.billState === undefined
        ? {}
        : {
            cancelledAt: query.billState === 'CANCELLED' ? { not: null } : null,
          }),
      ...(keyword === ''
        ? {}
        : {
            OR: [
              { billNo: { contains: keyword, mode: 'insensitive' } },
              {
                items: {
                  some: {
                    payeeName: { contains: keyword, mode: 'insensitive' },
                  },
                },
              },
            ],
          }),
    };
    const [total, rows] = await this.database.$transaction([
      this.database.settlementBill.count({ where }),
      this.database.settlementBill.findMany({
        where,
        include: { items: true },
        orderBy: [{ billDate: 'desc' }, { billNo: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      items: rows.map((row) => ({
        id: row.id,
        billNo: row.billNo,
        side: row.side,
        billDate: row.billDate.toISOString().slice(0, 10),
        amount: row.amount.toFixed(2),
        note: row.note,
        cancelledAt: row.cancelledAt?.toISOString() ?? null,
        payees: [...new Set(row.items.map((item) => item.payeeName))],
        count: row.items.length,
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async billDetail(actor: ActorContext, billId: string) {
    await this.access.authorizeDepartmentAction(actor, 'settlement.read');
    const bill = await this.database.settlementBill.findFirst({
      where: { id: billId, departmentId: actor.departmentId },
      include: { items: { orderBy: { id: 'asc' } } },
    });
    if (bill === null)
      throw new NotFoundException({
        code: 'BILL_NOT_FOUND',
        message: '账单不存在',
      });
    return {
      id: bill.id,
      billNo: bill.billNo,
      side: bill.side,
      billDate: bill.billDate.toISOString().slice(0, 10),
      amount: bill.amount.toFixed(2),
      note: bill.note,
      cancelledAt: bill.cancelledAt?.toISOString() ?? null,
      cancellationReason: bill.cancellationReason,
      items: bill.items.map((item) => ({
        id: item.id,
        launchId: item.launchId,
        caseId: item.caseId,
        payeeId: item.payeeId,
        payeeName: item.payeeName,
        nth: item.nth,
        amount: item.amount.toFixed(2),
      })),
    };
  }

  async cancelBill(
    actor: ActorContext,
    billId: string,
    input: CancelSettlementBillDto,
  ) {
    assertFinancialKey(input.idempotencyKey);
    const reason = input.reason?.trim() || null;
    const fingerprint = financialFingerprint({
      command: 'CANCEL_BILL',
      billId,
      reason,
    });
    try {
      return await this.database.$transaction(
        async (tx) => {
          await this.authorizeWrite(tx, actor, 'settlement.bill.cancel');
          await tx.$queryRaw`SELECT id FROM settlement_bills WHERE id = ${billId}::uuid AND department_id = ${actor.departmentId}::uuid FOR UPDATE`;
          const bill = await tx.settlementBill.findFirst({
            where: { id: billId, departmentId: actor.departmentId },
            include: { items: true },
          });
          if (bill === null)
            throw new NotFoundException({
              code: 'BILL_NOT_FOUND',
              message: '账单不存在',
            });
          await lockFinancialCases(
            tx,
            actor,
            bill.items.map((item) => item.caseId),
          );
          if (bill.cancelledAt !== null) {
            if (
              bill.cancellationKey !== input.idempotencyKey ||
              bill.cancellationReason !== reason
            )
              throw changed();
            await loadFinancialAuditReceipt(
              tx,
              {
                departmentId: actor.departmentId,
                actorUserId: actor.userId,
                resourceType: 'SETTLEMENT_BILL',
                resourceId: bill.id,
                action: 'settlement.bill.cancelled',
              },
              fingerprint,
              true,
            );
            return {
              id: bill.id,
              billNo: bill.billNo,
              cancelledAt: bill.cancelledAt.toISOString(),
            };
          }
          const cleared = await tx.caseSettlementLaunch.updateMany({
            where: {
              id: { in: bill.items.map((item) => item.launchId) },
              departmentId: actor.departmentId,
              billId,
            },
            data: { billId: null },
          });
          if (cleared.count !== bill.items.length) throw changed();
          const cancelled = await tx.settlementBill.update({
            where: { id: bill.id },
            data: {
              cancelledAt: new Date(),
              cancellationReason: reason,
              cancellationKey: input.idempotencyKey,
            },
          });
          await tx.auditEvent.create({
            data: {
              departmentId: actor.departmentId,
              actorUserId: actor.userId,
              internalActorUserId: actor.userId,
              resourceType: 'SETTLEMENT_BILL',
              resourceId: bill.id,
              action: 'settlement.bill.cancelled',
              details: {
                billNo: bill.billNo,
                launchIds: bill.items.map((item) => item.launchId),
                reason,
                requestFingerprint: fingerprint,
                idempotencyKey: input.idempotencyKey,
              },
            },
          });
          return {
            id: cancelled.id,
            billNo: cancelled.billNo,
            cancelledAt: cancelled.cancelledAt!.toISOString(),
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        ['P2002', 'P2034'].includes(error.code)
      )
        throw changed();
      throw error;
    }
  }
}
