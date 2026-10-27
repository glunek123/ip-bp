import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '../../generated/prisma/client';
import type { ActorContext } from '../../access-control/actor-context';
import { AccessControlService } from '../../access-control/access-control.service';
import { DatabaseService } from '../../database/database.service';
import { OrganizationService } from '../../access-control/organization.service';
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
import { searchCaseSettlementSources } from '../cases';
import { MaterialService } from '../materials';
import { feeSummary, mergeSampleFees } from './settlement-ledger';
import { feeReadInclude, projectFeeReadRow } from './fee-read';
import {
  CreateFeeDto,
  CancelFeeDto,
  CancelledFeePageDto,
  VerifyCancelledFeePaymentDto,
  ReconcileCancelledFeeRefundDto,
  FeeCaseOptionsDto,
  FeeIdsDto,
  FeePageDto,
  UpdateFeeDto,
  ordinaryFeeStatuses,
  refundFeeStatuses,
  UpdateFeeProofDto,
} from './fee.dto';

function checkStatus(type: string, status: string): void {
  const allowed: readonly string[] =
    type === '诉讼退费' ? refundFeeStatuses : ordinaryFeeStatuses;
  if (!allowed.includes(status))
    throw new BadRequestException({
      code: 'INVALID_FEE_STATUS',
      message: '费用类型与状态不匹配',
    });
}

const ExactDecimal = Prisma.Decimal.clone({ precision: 36 });

function refundProjection(
  outcome: string,
  payment: { amount: Prisma.Decimal } | null,
  refunds: readonly { amount: Prisma.Decimal }[],
) {
  if (outcome === 'DELETED')
    return {
      reconciliationStatus: 'NOT_REQUIRED',
      remainingVerifiedPayment: null,
    };
  if (payment === null)
    return {
      reconciliationStatus: 'PAYMENT_UNVERIFIED',
      remainingVerifiedPayment: null,
    };
  const refunded = refunds.reduce(
    (sum, row) => sum.plus(row.amount),
    new ExactDecimal(0),
  );
  const verified = new ExactDecimal(payment.amount.toFixed(2));
  const remaining = verified.minus(refunded);
  return {
    reconciliationStatus: verified.isZero()
      ? 'NO_PAYMENT'
      : refunded.isZero()
        ? 'REFUND_PENDING'
        : remaining.isPositive()
          ? 'PARTIAL_REFUND'
          : 'REFUND_RECORDED',
    remainingVerifiedPayment: remaining.toFixed(2),
  };
}

@Injectable()
export class FeeService {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: AccessControlService,
    private readonly organization: OrganizationService,
    private readonly materials: MaterialService,
  ) {}

  private async authorizeWrite(
    tx: Prisma.TransactionClient,
    actor: ActorContext,
    action: FinancialWriteAction,
  ) {
    await lockFinancialWriteContext(
      tx,
      this.organization,
      this.access,
      actor,
      action,
    );
  }

  async list(actor: ActorContext, query: FeePageDto) {
    await this.access.authorizeDepartmentAction(actor, 'fee.read');
    if (query.from !== undefined) parseFinancialDay(query.from);
    if (query.to !== undefined) parseFinancialDay(query.to);
    if (
      query.from !== undefined &&
      query.to !== undefined &&
      query.from > query.to
    )
      throw new BadRequestException({
        code: 'INVALID_DATE_RANGE',
        message: '日期范围无效',
      });
    const raw = await this.database.feeRecord.findMany({
      where: {
        departmentId: actor.departmentId,
        deletedAt: null,
        cancellation: { is: null },
        ...(query.caseId === undefined ? {} : { caseId: query.caseId }),
      },
      include: feeReadInclude,
      orderBy: [{ feeDate: 'desc' }, { id: 'desc' }],
    });
    const sources = raw.map(projectFeeReadRow);
    type Source = (typeof sources)[number];
    let display: Array<
      Source & { mergeTypes?: readonly string[]; sourceRows?: Source[] }
    > = sources;
    if (query.caseId === undefined) {
      const groups = new Map<string, Source[]>();
      for (const row of sources) {
        if (row.type !== '样品费' && row.type !== '样品费退款') continue;
        const group = groups.get(row.caseId) ?? [];
        group.push(row);
        groups.set(row.caseId, group);
      }
      const projections = mergeSampleFees(sources).map((row) =>
        row.mergeTypes === undefined
          ? row
          : {
              ...row,
              proofMaterialId: null,
              proofContentVersionId: null,
              proofOriginalFilename: null,
              sourceRows: groups.get(row.caseId)!,
            },
      );
      const bySource = new Map<string, (typeof projections)[number]>();
      for (const row of projections) {
        for (const source of 'sourceRows' in row ? row.sourceRows : [row])
          bySource.set(source.id, row);
      }
      const emitted = new Set<string>();
      display = [];
      for (const source of sources) {
        // Zero net is omitted by the projection helper, not by the source ledger.
        const row = bySource.get(source.id) ?? source;
        if (emitted.has(row.id)) continue;
        emitted.add(row.id);
        display.push(row);
      }
    }
    const filtered = display.filter(
      (row) =>
        (query.type === undefined ||
          row.type === query.type ||
          row.mergeTypes?.includes(query.type) === true) &&
        (query.status === undefined || row.status === query.status) &&
        (query.direction === undefined || row.direction === query.direction) &&
        (query.from === undefined || row.feeDate >= query.from) &&
        (query.to === undefined || row.feeDate <= query.to),
    );
    const offset = (query.page - 1) * query.pageSize;
    const matching = filtered.flatMap((row) => row.sourceRows ?? [row]);
    return {
      items: filtered.slice(offset, offset + query.pageSize),
      total: filtered.length,
      page: query.page,
      pageSize: query.pageSize,
      summary: feeSummary(
        query.caseId === undefined ? mergeSampleFees(sources) : sources,
      ),
      matchingIds: matching.map((row) => row.id),
      matchingSources: matching.map((row) => ({
        id: row.id,
        businessNo: row.businessNo,
        type: row.type,
        amount: row.amount,
        status: row.status,
      })),
    };
  }

  async caseOptions(actor: ActorContext, query: FeeCaseOptionsDto) {
    return this.database.$transaction(
      async (tx) => {
        await this.access.authorizeDepartmentAction(actor, 'fee.create', tx);
        return searchCaseSettlementSources(tx, {
          departmentId: actor.departmentId,
          query: query.query ?? '',
          page: query.page,
          pageSize: query.pageSize,
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  async listCancellations(actor: ActorContext, query: CancelledFeePageDto) {
    await this.access.authorizeDepartmentAction(actor, 'fee.read');
    if (query.from !== undefined) parseFinancialDay(query.from);
    if (query.to !== undefined) parseFinancialDay(query.to);
    if (
      query.from !== undefined &&
      query.to !== undefined &&
      query.from > query.to
    )
      throw new BadRequestException({
        code: 'INVALID_DATE_RANGE',
        message: '日期范围无效',
      });
    const raw = await this.database.feeRecord.findMany({
      where: {
        departmentId: actor.departmentId,
        cancellation: { isNot: null },
        ...(query.caseId === undefined ? {} : { caseId: query.caseId }),
        ...(query.type === undefined ? {} : { type: query.type }),
        ...(query.status === undefined ? {} : { status: query.status }),
        ...(query.direction === undefined
          ? {}
          : { direction: query.direction }),
        ...(query.from === undefined && query.to === undefined
          ? {}
          : {
              feeDate: {
                ...(query.from === undefined
                  ? {}
                  : { gte: parseFinancialDay(query.from) }),
                ...(query.to === undefined
                  ? {}
                  : { lte: parseFinancialDay(query.to) }),
              },
            }),
        ...(query.businessNo?.trim()
          ? {
              case: {
                businessNo: {
                  contains: query.businessNo.trim(),
                  mode: 'insensitive',
                },
              },
            }
          : {}),
      },
      include: {
        ...feeReadInclude,
        cancellation: { include: { payment: true, refunds: true } },
      },
      orderBy: [{ feeDate: 'desc' }, { id: 'desc' }],
    });
    const offset = (query.page - 1) * query.pageSize;
    return {
      items: raw.slice(offset, offset + query.pageSize).map((row) => ({
        ...projectFeeReadRow(row),
        deletedAt: row.deletedAt,
        cancellation:
          row.cancellation === null
            ? null
            : {
                id: row.cancellation.id,
                outcome: row.cancellation.outcome,
                reason: row.cancellation.reason,
                actorUserId: row.cancellation.actorUserId,
                createdAt: row.cancellation.createdAt,
                refundReconciliationStatus:
                  row.cancellation.refundReconciliationStatus,
                ...refundProjection(
                  row.cancellation.outcome,
                  row.cancellation.payment,
                  row.cancellation.refunds,
                ),
              },
      })),
      total: raw.length,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async history(actor: ActorContext, feeId: string) {
    await this.access.authorizeDepartmentAction(actor, 'fee.read');
    const row = await this.database.feeRecord.findFirst({
      where: { id: feeId, departmentId: actor.departmentId },
      include: { ...feeReadInclude, cancellation: true },
    });
    if (row === null)
      throw new NotFoundException({
        code: 'FEE_NOT_FOUND',
        message: '费用不存在',
      });
    const payment =
      row.cancellation === null
        ? null
        : await this.database.feeCancellationPayment.findUnique({
            where: { cancellationId: row.cancellation.id },
          });
    const refunds =
      payment === null
        ? []
        : await this.database.feeRefundReconciliation.findMany({
            where: { paymentId: payment.id },
            orderBy: [{ refundDate: 'asc' }, { id: 'asc' }],
          });
    const reconciliation = refundProjection(
      row.cancellation?.outcome ?? 'DELETED',
      payment,
      refunds,
    );
    return {
      ...projectFeeReadRow(row),
      deletedAt: row.deletedAt,
      cancellation:
        row.cancellation === null
          ? null
          : {
              id: row.cancellation.id,
              outcome: row.cancellation.outcome,
              originalStatus: row.cancellation.originalStatus,
              originalAmount: row.cancellation.originalAmount.toFixed(2),
              originalVersion: row.cancellation.originalVersion,
              reason: row.cancellation.reason,
              actorUserId: row.cancellation.actorUserId,
              createdAt: row.cancellation.createdAt,
              refundReconciliationStatus:
                row.cancellation.refundReconciliationStatus,
              reconciliationStatus: reconciliation.reconciliationStatus,
            },
      paymentVerification:
        payment === null
          ? null
          : {
              id: payment.id,
              amount: payment.amount.toFixed(2),
              paymentDate:
                payment.paymentDate?.toISOString().slice(0, 10) ?? null,
              proofMaterialId: payment.proofMaterialId,
              proofContentVersionId: payment.proofContentVersionId,
              actorUserId: payment.actorUserId,
              createdAt: payment.createdAt,
            },
      refunds: refunds.map((refund) => ({
        id: refund.id,
        amount: refund.amount.toFixed(2),
        refundDate: refund.refundDate.toISOString().slice(0, 10),
        proofMaterialId: refund.proofMaterialId,
        proofContentVersionId: refund.proofContentVersionId,
        actorUserId: refund.actorUserId,
        createdAt: refund.createdAt,
      })),
      remainingVerifiedPayment: reconciliation.remainingVerifiedPayment,
    };
  }

  async create(actor: ActorContext, input: CreateFeeDto) {
    assertFinancialKey(input.idempotencyKey);
    const feeDate = parseFinancialDay(input.feeDate);
    checkStatus(input.type, input.status);
    if (!new Prisma.Decimal(input.amount).isPositive())
      throw new BadRequestException({
        code: 'INVALID_FEE_AMOUNT',
        message: '费用金额须大于 0',
      });
    const fingerprint = financialFingerprint({
      command: 'CREATE_FEE',
      caseId: input.caseId,
      type: input.type,
      direction: input.direction,
      status: input.status,
      amount: new Prisma.Decimal(input.amount).toFixed(2),
      feeDate: input.feeDate,
      note: input.note ?? null,
    });
    try {
      return await this.database.$transaction(
        async (tx) => {
          await this.authorizeWrite(tx, actor, 'fee.create');
          await lockFinancialCases(tx, actor, [input.caseId]);
          const prior = await tx.feeRecord.findUnique({
            where: {
              departmentId_actorUserId_idempotencyKey: {
                departmentId: actor.departmentId,
                actorUserId: actor.userId,
                idempotencyKey: input.idempotencyKey,
              },
            },
          });
          if (prior !== null) {
            if (prior.caseId !== input.caseId)
              throw new ConflictException({
                code: 'IDEMPOTENCY_CONFLICT',
                message: '请求键已用于不同费用',
              });
            const receipt = await loadFinancialAuditReceipt(
              tx,
              {
                departmentId: actor.departmentId,
                actorUserId: actor.userId,
                resourceType: 'FEE',
                resourceId: prior.id,
                action: 'fee.created',
              },
              fingerprint,
            );
            const snapshot = receipt.resultSnapshot;
            if (
              snapshot === null ||
              typeof snapshot !== 'object' ||
              Array.isArray(snapshot) ||
              snapshot.id !== prior.id ||
              typeof snapshot.version !== 'number' ||
              !Number.isInteger(snapshot.version) ||
              snapshot.version < 1
            ) {
              throw new InternalServerErrorException({
                code: 'INVALID_FINANCIAL_RECEIPT',
                message: '费用创建回执来源不完整',
              });
            }
            return { id: prior.id, version: snapshot.version };
          }
          const record = await tx.case.findFirst({
            where: { id: input.caseId, departmentId: actor.departmentId },
            select: { id: true },
          });
          if (record === null)
            throw new NotFoundException({
              code: 'CASE_NOT_FOUND',
              message: '案件不存在',
            });
          const created = await tx.feeRecord.create({
            data: {
              caseId: input.caseId,
              departmentId: actor.departmentId,
              type: input.type,
              direction: input.direction,
              status: input.status,
              amount: input.amount,
              feeDate,
              source: 'manual',
              note: input.note ?? null,
              actorUserId: actor.userId,
              idempotencyKey: input.idempotencyKey,
            },
          });
          await tx.auditEvent.create({
            data: {
              departmentId: actor.departmentId,
              actorUserId: actor.userId,
              internalActorUserId: actor.userId,
              resourceType: 'FEE',
              resourceId: created.id,
              action: 'fee.created',
              details: {
                caseId: input.caseId,
                type: input.type,
                amount: created.amount.toFixed(2),
                status: input.status,
                requestFingerprint: fingerprint,
                resultSnapshot: { id: created.id, version: created.version },
                facts: {
                  direction: input.direction,
                  status: input.status,
                  feeDate: input.feeDate,
                  note: input.note ?? null,
                },
              },
            },
          });
          return { id: created.id, version: created.version };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        ['P2002', 'P2034'].includes(error.code)
      )
        throw new ConflictException({
          code: 'FEE_CHANGED',
          message: '费用已变化，请刷新后重试',
        });
      throw error;
    }
  }

  async update(actor: ActorContext, feeId: string, input: UpdateFeeDto) {
    return this.database.$transaction(
      async (tx) => {
        await this.authorizeWrite(tx, actor, 'fee.update');
        const record = await tx.feeRecord.findFirst({
          where: {
            id: feeId,
            departmentId: actor.departmentId,
            deletedAt: null,
            cancellation: { is: null },
          },
        });
        if (record === null)
          throw new NotFoundException({
            code: 'FEE_NOT_FOUND',
            message: '费用不存在',
          });
        await lockFinancialCases(tx, actor, [record.caseId]);
        if (input.status !== undefined) checkStatus(record.type, input.status);
        if (
          (record.status === '发起' || record.status === '已支付') &&
          ((input.status !== undefined && input.status !== record.status) ||
            (input.direction !== undefined &&
              input.direction !== record.direction))
        )
          throw new ConflictException({
            code: 'FEE_PAYMENT_FACT_PROTECTED',
            message: '已发起或已支付费用不能直接改写原收付状态或方向',
          });
        if (input.status === '发起' && record.amount.isZero())
          throw new BadRequestException({
            code: 'ZERO_FEE_CANNOT_LAUNCH',
            message: '零元费用不能标记为发起',
          });
        const changed = await tx.feeRecord.updateMany({
          where: {
            id: feeId,
            departmentId: actor.departmentId,
            version: input.expectedVersion,
            deletedAt: null,
            cancellation: { is: null },
            ...(input.status === '发起'
              ? { amount: { gt: new Prisma.Decimal(0) } }
              : {}),
          },
          data: {
            version: { increment: 1 },
            ...(input.direction === undefined
              ? {}
              : { direction: input.direction }),
            ...(input.status === undefined ? {} : { status: input.status }),
            ...(input.note === undefined ? {} : { note: input.note }),
          },
        });
        if (changed.count !== 1)
          throw new ConflictException({
            code: 'FEE_CHANGED',
            message: '费用已变化，请刷新后重试',
          });
        await tx.auditEvent.create({
          data: {
            departmentId: actor.departmentId,
            actorUserId: actor.userId,
            internalActorUserId: actor.userId,
            resourceType: 'FEE',
            resourceId: feeId,
            action: 'fee.updated',
            details: {
              fromVersion: input.expectedVersion,
              toVersion: input.expectedVersion + 1,
              status: input.status ?? null,
              direction: input.direction ?? null,
            },
          },
        });
        return { id: feeId, version: input.expectedVersion + 1 };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async updateProof(
    actor: ActorContext,
    feeId: string,
    input: UpdateFeeProofDto,
  ) {
    assertFinancialKey(input.idempotencyKey);
    if ((input.materialId === null) !== (input.contentVersionId === null))
      throw new BadRequestException({
        code: 'INVALID_FEE_PROOF',
        message: '凭证材料与内容版本必须成对指定',
      });
    const fingerprint = financialFingerprint({
      command: 'UPDATE_FEE_PROOF',
      feeId,
      expectedVersion: input.expectedVersion,
      materialId: input.materialId,
      contentVersionId: input.contentVersionId,
    });
    try {
      return await this.database.$transaction(
        async (tx) => {
          await this.authorizeWrite(tx, actor, 'fee.update');
          const fee = await tx.feeRecord.findFirst({
            where: {
              id: feeId,
              departmentId: actor.departmentId,
              cancellation: { is: null },
            },
          });
          if (fee === null)
            throw new NotFoundException({
              code: 'FEE_NOT_FOUND',
              message: '费用不存在',
            });
          await lockFinancialCases(tx, actor, [fee.caseId]);
          const receipts = await tx.auditEvent.findMany({
            where: {
              departmentId: actor.departmentId,
              actorUserId: actor.userId,
              internalActorUserId: actor.userId,
              resourceType: 'FEE',
              resourceId: feeId,
              action: 'fee.proof-updated',
              details: {
                path: ['idempotencyKey'],
                equals: input.idempotencyKey,
              },
            },
            select: { details: true },
          });
          if (receipts.length > 1)
            throw new InternalServerErrorException({
              code: 'INVALID_FINANCIAL_RECEIPT',
              message: '凭证保存回执不唯一',
            });
          if (receipts.length === 1) {
            const details = receipts[0].details;
            if (
              details === null ||
              typeof details !== 'object' ||
              Array.isArray(details) ||
              details.requestFingerprint !== fingerprint
            )
              throw new ConflictException({
                code: 'IDEMPOTENCY_CONFLICT',
                message: '原请求键与本次凭证内容不一致',
              });
            if (
              typeof details.toVersion !== 'number' ||
              !Number.isSafeInteger(details.toVersion) ||
              details.toVersion < 2
            )
              throw new InternalServerErrorException({
                code: 'INVALID_FINANCIAL_RECEIPT',
                message: '凭证保存回执版本无效',
              });
            return { id: feeId, version: details.toVersion };
          }
          if (fee.deletedAt !== null || fee.version !== input.expectedVersion)
            throw new ConflictException({
              code: 'FEE_CHANGED',
              message: '费用已变化，请刷新后重试',
            });
          const facts =
            input.contentVersionId === null
              ? []
              : await this.materials.assertAvailableVersions(tx, actor, {
                  ownerType: 'CASE',
                  ownerId: fee.caseId,
                  category: 'FEE_PROOF',
                  contentVersionIds: [input.contentVersionId],
                  minCount: 1,
                  maxCount: 1,
                });
          if (
            facts.length !== (input.materialId === null ? 0 : 1) ||
            (input.materialId !== null &&
              facts[0]?.materialId !== input.materialId)
          )
            throw new BadRequestException({
              code: 'INVALID_FEE_PROOF',
              message: '凭证不属于当前案件或版本不匹配',
            });
          const changed = await tx.feeRecord.updateMany({
            where: {
              id: feeId,
              departmentId: actor.departmentId,
              version: input.expectedVersion,
              deletedAt: null,
              cancellation: { is: null },
            },
            data: {
              proofMaterialId: input.materialId,
              proofContentVersionId: input.contentVersionId,
              version: { increment: 1 },
            },
          });
          if (changed.count !== 1)
            throw new ConflictException({
              code: 'FEE_CHANGED',
              message: '费用已变化，请刷新后重试',
            });
          const audit = await tx.auditEvent.create({
            data: {
              departmentId: actor.departmentId,
              actorUserId: actor.userId,
              internalActorUserId: actor.userId,
              resourceType: 'FEE',
              resourceId: feeId,
              action: 'fee.proof-updated',
              details: {
                caseId: fee.caseId,
                fromVersion: input.expectedVersion,
                toVersion: input.expectedVersion + 1,
                idempotencyKey: input.idempotencyKey,
                requestFingerprint: fingerprint,
                proofMaterialId: input.materialId,
                proofContentVersionId: input.contentVersionId,
                priorProofMaterialId: fee.proofMaterialId,
                priorProofContentVersionId: fee.proofContentVersionId,
              },
            },
          });
          if (facts.length > 0)
            await this.materials.freezeReferences(tx, {
              departmentId: actor.departmentId,
              resourceType: 'fee',
              resourceId: feeId,
              facts,
              actionEventId: audit.id,
            });
          return { id: feeId, version: input.expectedVersion + 1 };
        },
        { isolationLevel: 'Serializable' },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        ['P2002', 'P2034'].includes(error.code)
      )
        throw new ConflictException({
          code: 'FEE_CHANGED',
          message: '费用或凭证已变化，请使用原请求重试',
        });
      throw error;
    }
  }

  async cancel(actor: ActorContext, feeId: string, input: CancelFeeDto) {
    assertFinancialKey(input.idempotencyKey);
    const reason = input.reason.trim();
    if (reason.length === 0)
      throw new BadRequestException({
        code: 'INVALID_CANCEL_REASON',
        message: '请填写取消原因',
      });
    const fingerprint = financialFingerprint({
      command: 'CANCEL_FEE',
      feeId,
      expectedVersion: input.expectedVersion,
      reason,
    });
    try {
      return await this.database.$transaction(
        async (tx) => {
          await this.authorizeWrite(tx, actor, 'fee.delete');
          const fee = await tx.feeRecord.findFirst({
            where: { id: feeId, departmentId: actor.departmentId },
          });
          if (fee === null)
            throw new NotFoundException({
              code: 'FEE_NOT_FOUND',
              message: '费用不存在',
            });
          await lockFinancialCases(tx, actor, [fee.caseId]);
          const prior = await tx.feeCancellation.findUnique({
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
              prior.feeId !== feeId ||
              prior.requestFingerprint !== fingerprint
            )
              throw new ConflictException({
                code: 'IDEMPOTENCY_CONFLICT',
                message: '请求键已用于不同取消操作',
              });
            return {
              id: feeId,
              version: prior.originalVersion + 1,
              cancellationId: prior.id,
              outcome: prior.outcome,
              refundReconciliationStatus: prior.refundReconciliationStatus,
            };
          }
          if (fee.deletedAt !== null || fee.version !== input.expectedVersion)
            throw new ConflictException({
              code: 'FEE_CHANGED',
              message: '费用已变化，请刷新后重试',
            });
          const alreadyCancelled = await tx.feeCancellation.findUnique({
            where: { feeId },
          });
          if (alreadyCancelled !== null)
            throw new ConflictException({
              code: 'FEE_CHANGED',
              message: '费用已经取消',
            });
          if (!['未发起', '发起', '已支付'].includes(fee.status))
            throw new ConflictException({
              code: 'FEE_PAYMENT_UNVERIFIED',
              message: '该费用状态不能取消，请先核对费用事实',
            });
          const outcome = fee.status === '未发起' ? 'DELETED' : 'VOIDED';
          const changed = await tx.feeRecord.updateMany({
            where: {
              id: feeId,
              departmentId: actor.departmentId,
              version: input.expectedVersion,
              deletedAt: null,
              cancellation: { is: null },
              status: fee.status,
            },
            data: {
              version: { increment: 1 },
              ...(outcome === 'DELETED' ? { deletedAt: new Date() } : {}),
            },
          });
          if (changed.count !== 1)
            throw new ConflictException({
              code: 'FEE_CHANGED',
              message: '费用已变化，请刷新后重试',
            });
          const cancellationId = randomUUID();
          const actionEvent = await tx.auditEvent.create({
            data: {
              departmentId: actor.departmentId,
              actorUserId: actor.userId,
              internalActorUserId: actor.userId,
              resourceType: 'FEE',
              resourceId: feeId,
              action: outcome === 'VOIDED' ? 'fee.voided' : 'fee.deleted',
              details: {
                cancellationId,
                fromVersion: fee.version,
                toVersion: fee.version + 1,
                originalStatus: fee.status,
                originalAmount: fee.amount.toFixed(2),
                reason,
                requestFingerprint: fingerprint,
              },
            },
          });
          const cancellation = await tx.feeCancellation.create({
            data: {
              id: cancellationId,
              feeId,
              departmentId: actor.departmentId,
              caseId: fee.caseId,
              originalStatus: fee.status,
              originalAmount: fee.amount,
              originalVersion: fee.version,
              reason,
              actorUserId: actor.userId,
              idempotencyKey: input.idempotencyKey,
              requestFingerprint: fingerprint,
              actionEventId: actionEvent.id,
              outcome,
              refundReconciliationStatus:
                outcome === 'DELETED'
                  ? 'NOT_REQUIRED'
                  : fee.status === '发起'
                    ? 'PAYMENT_UNVERIFIED'
                    : 'PENDING',
            },
          });
          return {
            id: feeId,
            version: fee.version + 1,
            cancellationId: cancellation.id,
            outcome,
            refundReconciliationStatus: cancellation.refundReconciliationStatus,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        ['P2002', 'P2034'].includes(error.code)
      )
        throw new ConflictException({
          code: 'FEE_CHANGED',
          message: '费用已变化，请使用原请求重试',
        });
      throw error;
    }
  }

  private async cancellationProof(
    tx: Prisma.TransactionClient,
    actor: ActorContext,
    caseId: string,
    materialId: string | null,
    contentVersionId: string | null,
  ) {
    if ((materialId === null) !== (contentVersionId === null))
      throw new BadRequestException({
        code: 'INVALID_FEE_PROOF',
        message: '凭证材料与内容版本必须成对指定',
      });
    if (contentVersionId === null) return [];
    const facts = await this.materials.assertAvailableVersions(tx, actor, {
      ownerType: 'CASE',
      ownerId: caseId,
      category: 'FEE_PROOF',
      contentVersionIds: [contentVersionId],
      minCount: 1,
      maxCount: 1,
    });
    if (facts.length !== 1 || facts[0]?.materialId !== materialId)
      throw new BadRequestException({
        code: 'INVALID_FEE_PROOF',
        message: '凭证不属于当前案件或版本不匹配',
      });
    return facts;
  }

  async verifyCancelledPayment(
    actor: ActorContext,
    feeId: string,
    input: VerifyCancelledFeePaymentDto,
  ) {
    assertFinancialKey(input.idempotencyKey);
    const amount = new Prisma.Decimal(input.amount);
    if (!amount.isFinite() || amount.isNegative() || amount.decimalPlaces() > 2)
      throw new BadRequestException({
        code: 'INVALID_PAYMENT_AMOUNT',
        message: '实付金额无效',
      });
    if ((input.paymentDate === null) !== amount.isZero())
      throw new BadRequestException({
        code: 'INVALID_PAYMENT_DATE',
        message: '有实付时须填写日期；确认未付时日期须为空',
      });
    const paymentDate =
      input.paymentDate === null ? null : parseFinancialDay(input.paymentDate);
    const fingerprint = financialFingerprint({
      command: 'VERIFY_CANCELLED_FEE_PAYMENT',
      feeId,
      amount: amount.toFixed(2),
      paymentDate: input.paymentDate,
      proofMaterialId: input.proofMaterialId,
      proofContentVersionId: input.proofContentVersionId,
    });
    try {
      return await this.database.$transaction(
        async (tx) => {
          await this.authorizeWrite(tx, actor, 'fee.update');
          const fee = await tx.feeRecord.findFirst({
            where: { id: feeId, departmentId: actor.departmentId },
            select: { caseId: true },
          });
          if (fee === null)
            throw new NotFoundException({
              code: 'FEE_NOT_FOUND',
              message: '费用不存在',
            });
          await lockFinancialCases(tx, actor, [fee.caseId]);
          const cancellation = await tx.feeCancellation.findUnique({
            where: { feeId },
          });
          if (cancellation === null || cancellation.outcome !== 'VOIDED')
            throw new ConflictException({
              code: 'FEE_NOT_VOIDED',
              message: '费用未作废，不能核对实付',
            });
          const prior = await tx.feeCancellationPayment.findUnique({
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
              prior.cancellationId !== cancellation.id ||
              prior.requestFingerprint !== fingerprint
            )
              throw new ConflictException({
                code: 'IDEMPOTENCY_CONFLICT',
                message: '请求键已用于不同支付核对',
              });
            return {
              id: prior.id,
              cancellationId: cancellation.id,
              amount: prior.amount.toFixed(2),
              paymentDate:
                prior.paymentDate?.toISOString().slice(0, 10) ?? null,
            };
          }
          const existing = await tx.feeCancellationPayment.findUnique({
            where: { cancellationId: cancellation.id },
          });
          if (existing !== null)
            throw new ConflictException({
              code: 'PAYMENT_ALREADY_VERIFIED',
              message: '实付已核对，不可覆盖原事实',
            });
          const facts = await this.cancellationProof(
            tx,
            actor,
            fee.caseId,
            input.proofMaterialId,
            input.proofContentVersionId,
          );
          const paymentId = randomUUID();
          const audit = await tx.auditEvent.create({
            data: {
              departmentId: actor.departmentId,
              actorUserId: actor.userId,
              internalActorUserId: actor.userId,
              resourceType: 'FEE',
              resourceId: feeId,
              action: 'fee.payment-verified',
              details: {
                paymentId,
                cancellationId: cancellation.id,
                amount: amount.toFixed(2),
                paymentDate: input.paymentDate,
                proofMaterialId: input.proofMaterialId,
                proofContentVersionId: input.proofContentVersionId,
                requestFingerprint: fingerprint,
              },
            },
          });
          if (facts.length > 0)
            await this.materials.freezeReferences(tx, {
              departmentId: actor.departmentId,
              resourceType: 'fee-payment-verification',
              resourceId: paymentId,
              facts,
              actionEventId: audit.id,
            });
          const payment = await tx.feeCancellationPayment.create({
            data: {
              id: paymentId,
              cancellationId: cancellation.id,
              feeId,
              departmentId: actor.departmentId,
              caseId: fee.caseId,
              amount,
              paymentDate,
              proofMaterialId: input.proofMaterialId,
              proofContentVersionId: input.proofContentVersionId,
              actorUserId: actor.userId,
              idempotencyKey: input.idempotencyKey,
              requestFingerprint: fingerprint,
              actionEventId: audit.id,
            },
          });
          return {
            id: payment.id,
            cancellationId: cancellation.id,
            amount: payment.amount.toFixed(2),
            paymentDate:
              payment.paymentDate?.toISOString().slice(0, 10) ?? null,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        ['P2002', 'P2034'].includes(error.code)
      )
        throw new ConflictException({
          code: 'PAYMENT_VERIFICATION_CHANGED',
          message: '支付核对已变化，请使用原请求重试',
        });
      throw error;
    }
  }

  async reconcileCancelledRefund(
    actor: ActorContext,
    feeId: string,
    input: ReconcileCancelledFeeRefundDto,
  ) {
    assertFinancialKey(input.idempotencyKey);
    const amount = new Prisma.Decimal(input.amount);
    if (
      !amount.isFinite() ||
      !amount.isPositive() ||
      amount.decimalPlaces() > 2
    )
      throw new BadRequestException({
        code: 'INVALID_REFUND_AMOUNT',
        message: '退款金额须大于 0',
      });
    const refundDate = parseFinancialDay(input.refundDate);
    const fingerprint = financialFingerprint({
      command: 'RECONCILE_CANCELLED_FEE_REFUND',
      feeId,
      amount: amount.toFixed(2),
      refundDate: input.refundDate,
      proofMaterialId: input.proofMaterialId,
      proofContentVersionId: input.proofContentVersionId,
    });
    try {
      return await this.database.$transaction(
        async (tx) => {
          await this.authorizeWrite(tx, actor, 'fee.update');
          const fee = await tx.feeRecord.findFirst({
            where: { id: feeId, departmentId: actor.departmentId },
            select: { caseId: true },
          });
          if (fee === null)
            throw new NotFoundException({
              code: 'FEE_NOT_FOUND',
              message: '费用不存在',
            });
          await lockFinancialCases(tx, actor, [fee.caseId]);
          const cancellation = await tx.feeCancellation.findUnique({
            where: { feeId },
          });
          if (cancellation === null || cancellation.outcome !== 'VOIDED')
            throw new ConflictException({
              code: 'FEE_NOT_VOIDED',
              message: '费用未作废，不能核对退款',
            });
          const prior = await tx.feeRefundReconciliation.findUnique({
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
              prior.cancellationId !== cancellation.id ||
              prior.requestFingerprint !== fingerprint
            )
              throw new ConflictException({
                code: 'IDEMPOTENCY_CONFLICT',
                message: '请求键已用于不同退款核对',
              });
            return {
              id: prior.id,
              cancellationId: cancellation.id,
              amount: prior.amount.toFixed(2),
              refundDate: prior.refundDate.toISOString().slice(0, 10),
            };
          }
          const payment = await tx.feeCancellationPayment.findUnique({
            where: { cancellationId: cancellation.id },
          });
          if (payment === null || !payment.amount.isPositive())
            throw new ConflictException({
              code: 'PAYMENT_NOT_VERIFIED',
              message: '请先核对原实际支付金额',
            });
          const previous = await tx.feeRefundReconciliation.aggregate({
            where: { paymentId: payment.id },
            _sum: { amount: true },
          });
          const refunded = new ExactDecimal(
            previous._sum.amount?.toFixed(2) ?? '0.00',
          );
          if (refunded.plus(amount.toFixed(2)).gt(payment.amount.toFixed(2)))
            throw new ConflictException({
              code: 'REFUND_EXCEEDS_PAYMENT',
              message: '累计退款不能超过已核实实付金额',
            });
          const facts = await this.cancellationProof(
            tx,
            actor,
            fee.caseId,
            input.proofMaterialId,
            input.proofContentVersionId,
          );
          const refundId = randomUUID();
          const audit = await tx.auditEvent.create({
            data: {
              departmentId: actor.departmentId,
              actorUserId: actor.userId,
              internalActorUserId: actor.userId,
              resourceType: 'FEE',
              resourceId: feeId,
              action: 'fee.refund-reconciled',
              details: {
                refundId,
                cancellationId: cancellation.id,
                paymentId: payment.id,
                amount: amount.toFixed(2),
                refundDate: input.refundDate,
                proofMaterialId: input.proofMaterialId,
                proofContentVersionId: input.proofContentVersionId,
                requestFingerprint: fingerprint,
              },
            },
          });
          if (facts.length > 0)
            await this.materials.freezeReferences(tx, {
              departmentId: actor.departmentId,
              resourceType: 'fee-refund-reconciliation',
              resourceId: refundId,
              facts,
              actionEventId: audit.id,
            });
          const refund = await tx.feeRefundReconciliation.create({
            data: {
              id: refundId,
              cancellationId: cancellation.id,
              paymentId: payment.id,
              feeId,
              departmentId: actor.departmentId,
              caseId: fee.caseId,
              amount,
              refundDate,
              proofMaterialId: input.proofMaterialId,
              proofContentVersionId: input.proofContentVersionId,
              actorUserId: actor.userId,
              idempotencyKey: input.idempotencyKey,
              requestFingerprint: fingerprint,
              actionEventId: audit.id,
            },
          });
          return {
            id: refund.id,
            cancellationId: cancellation.id,
            amount: refund.amount.toFixed(2),
            refundDate: refund.refundDate.toISOString().slice(0, 10),
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        ['P2002', 'P2034'].includes(error.code)
      )
        throw new ConflictException({
          code: 'REFUND_RECONCILIATION_CHANGED',
          message: '退款核对已变化，请使用原请求重试',
        });
      throw error;
    }
  }

  async batch(
    actor: ActorContext,
    command: 'LAUNCH' | 'DELETE',
    input: FeeIdsDto,
  ) {
    assertFinancialKey(input.idempotencyKey);
    if (new Set(input.ids).size !== input.ids.length || input.ids.length === 0)
      throw new BadRequestException({
        code: 'INVALID_FEE_SELECTION',
        message: '费用选择无效',
      });
    const selectedIds = [...input.ids].sort();
    try {
      return await this.database.$transaction(
        async (tx) => {
          await this.authorizeWrite(
            tx,
            actor,
            command === 'LAUNCH' ? 'fee.launch' : 'fee.delete',
          );
          const rows = await tx.feeRecord.findMany({
            where: {
              id: { in: selectedIds },
              departmentId: actor.departmentId,
            },
            select: {
              id: true,
              caseId: true,
              status: true,
              amount: true,
              deletedAt: true,
              version: true,
              cancellation: { select: { id: true } },
            },
          });
          if (rows.length !== selectedIds.length)
            throw new ConflictException({
              code: 'FEE_CHANGED',
              message: '所选费用已变化',
            });
          await lockFinancialCases(
            tx,
            actor,
            rows.map((row) => row.caseId),
          );
          const prior = await tx.feeBatchReceipt.findUnique({
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
              prior.command !== command ||
              JSON.stringify(prior.selectedIds) !== JSON.stringify(selectedIds)
            )
              throw new ConflictException({
                code: 'IDEMPOTENCY_CONFLICT',
                message: '请求键已用于不同批量操作',
              });
            return prior.resultSnapshot;
          }
          if (
            rows.some(
              (row) => row.deletedAt !== null || row.cancellation !== null,
            )
          )
            throw new ConflictException({
              code: 'FEE_CHANGED',
              message: '所选费用已变化',
            });
          const ready =
            command === 'LAUNCH'
              ? rows.filter(
                  (row) => row.status === '未发起' && row.amount.gt(0),
                )
              : rows;
          if (
            command === 'DELETE' &&
            rows.some((row) => row.status !== '未发起')
          )
            throw new ConflictException({
              code: 'FEE_REQUIRES_CANCELLATION',
              message: '已发起或已支付费用不能直接删除，请核对后作废',
            });
          if (ready.length === 0)
            throw new BadRequestException({
              code: 'NO_LAUNCHABLE_FEES',
              message: '没有可发起的费用',
            });
          const processedIds = ready.map((row) => row.id);
          const amount = ready
            .reduce((sum, row) => sum.plus(row.amount), new ExactDecimal(0))
            .toFixed(2);
          const changed = await tx.feeRecord.updateMany({
            where: {
              id: { in: processedIds },
              departmentId: actor.departmentId,
              deletedAt: null,
              cancellation: { is: null },
              ...(command === 'LAUNCH'
                ? {
                    status: '未发起',
                    amount: { gt: new Prisma.Decimal(0) },
                  }
                : { status: '未发起' }),
            },
            data:
              command === 'LAUNCH'
                ? {
                    status: '发起',
                    launchedAt: new Date(),
                    version: { increment: 1 },
                  }
                : { deletedAt: new Date(), version: { increment: 1 } },
          });
          if (changed.count !== processedIds.length)
            throw new ConflictException({
              code: 'FEE_CHANGED',
              message: '所选费用已变化',
            });
          const result = {
            processedIds,
            amount,
            processedCount: processedIds.length,
          };
          await tx.feeBatchReceipt.create({
            data: {
              departmentId: actor.departmentId,
              actorUserId: actor.userId,
              idempotencyKey: input.idempotencyKey,
              command,
              selectedIds,
              resultSnapshot: result,
            },
          });
          await tx.auditEvent.create({
            data: {
              departmentId: actor.departmentId,
              actorUserId: actor.userId,
              internalActorUserId: actor.userId,
              resourceType: 'FEE_BATCH',
              resourceId: selectedIds[0],
              action:
                command === 'LAUNCH'
                  ? 'fee.batch.launched'
                  : 'fee.batch.deleted',
              details: { selectedIds, processedIds, amount },
            },
          });
          return result;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        ['P2002', 'P2034'].includes(error.code)
      )
        throw new ConflictException({
          code: 'FEE_CHANGED',
          message: '费用已变化，请刷新后重试',
        });
      throw error;
    }
  }
}
