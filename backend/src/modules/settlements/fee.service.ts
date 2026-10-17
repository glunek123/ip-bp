import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
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
import {
  CreateFeeDto,
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
        ...(query.caseId === undefined ? {} : { caseId: query.caseId }),
      },
      include: {
        case: {
          select: {
            businessNo: true,
            stage: true,
            courtCaseNo: true,
            sourceLead: { select: { platform: true, shopName: true } },
            defendants: { select: { name: true }, orderBy: { id: 'asc' } },
          },
        },
      },
      orderBy: [{ feeDate: 'desc' }, { id: 'desc' }],
    });
    const display = mergeSampleFees(
      raw.map((row) => ({
        id: row.id,
        caseId: row.caseId,
        businessNo: row.case.businessNo,
        courtCaseNo: row.case.courtCaseNo,
        platform: row.case.sourceLead?.platform ?? null,
        shopName: row.case.sourceLead?.shopName ?? null,
        defendantNames: row.case.defendants.map((item) => item.name),
        stage: row.case.stage,
        type: row.type,
        direction: row.direction as '收入' | '支出',
        status: row.status,
        amount: row.amount.toFixed(2),
        feeDate: row.feeDate.toISOString().slice(0, 10),
        source: row.source,
        note: row.note,
        version: row.version,
        proofMaterialId: row.proofMaterialId,
        proofContentVersionId: row.proofContentVersionId,
      })),
    );
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
    return {
      items: filtered.slice(offset, offset + query.pageSize),
      total: filtered.length,
      page: query.page,
      pageSize: query.pageSize,
      summary: feeSummary(display),
      matchingIds: filtered.map((row) => row.id),
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
          },
        });
        if (record === null)
          throw new NotFoundException({
            code: 'FEE_NOT_FOUND',
            message: '费用不存在',
          });
        await lockFinancialCases(tx, actor, [record.caseId]);
        if (input.status !== undefined) checkStatus(record.type, input.status);
        const changed = await tx.feeRecord.updateMany({
          where: {
            id: feeId,
            departmentId: actor.departmentId,
            version: input.expectedVersion,
            deletedAt: null,
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
            where: { id: feeId, departmentId: actor.departmentId },
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
          if (rows.some((row) => row.deletedAt !== null))
            throw new ConflictException({
              code: 'FEE_CHANGED',
              message: '所选费用已变化',
            });
          const ready =
            command === 'LAUNCH'
              ? rows.filter((row) => row.status === '未发起')
              : rows;
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
              ...(command === 'LAUNCH' ? { status: '未发起' } : {}),
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
