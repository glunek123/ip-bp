import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { AccessControlService } from '../../access-control/access-control.service';
import { OrganizationService } from '../../access-control/organization.service';
import type { ActorContext } from '../../access-control/actor-context';
import { Prisma } from '../../generated/prisma/client';
import {
  assertFinancialKey,
  financialFingerprint,
  parseFinancialDay,
} from './settlement-input';
import {
  lockFinancialCases,
  lockFinancialWriteContext,
} from './settlement-write-context';
import { ordinaryFeeStatuses, refundFeeStatuses } from './fee.dto';
import { CreateCaseFeeEntriesDto } from './case-fee-entry.dto';

@Injectable()
export class CaseFeeEntryService {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: AccessControlService,
    private readonly organization: OrganizationService,
  ) {}
  async create(actor: ActorContext, input: CreateCaseFeeEntriesDto) {
    assertFinancialKey(input.idempotencyKey);
    const rows = input.rows.map((row) => {
      assertFinancialKey(row.idempotencyKey);
      const statuses: readonly string[] =
        row.type === '诉讼退费' ? refundFeeStatuses : ordinaryFeeStatuses;
      if (
        row.caseId !== input.caseId ||
        !statuses.includes(row.status) ||
        !new Prisma.Decimal(row.amount).isPositive()
      )
        throw new BadRequestException({
          code: 'INVALID_CASE_FEE_ENTRIES',
          message: '费用行须属于同一案件，金额和状态必须有效',
        });
      return {
        ...row,
        amount: new Prisma.Decimal(row.amount).toFixed(2),
        feeDate: parseFinancialDay(row.feeDate),
        note: row.note ?? null,
      };
    });
    if (
      rows.length === 0 ||
      new Set(rows.map((row) => row.idempotencyKey)).size !== rows.length
    )
      throw new BadRequestException({
        code: 'INVALID_CASE_FEE_ENTRIES',
        message: '至少填写一笔有效费用，且每行请求身份必须唯一',
      });
    const fingerprint = financialFingerprint({
      command: 'CREATE_CASE_FEE_ENTRIES',
      caseId: input.caseId,
      rows: rows.map((row) => ({
        caseId: row.caseId,
        type: row.type,
        direction: row.direction,
        status: row.status,
        amount: row.amount,
        feeDate: row.feeDate.toISOString().slice(0, 10),
        note: row.note,
        idempotencyKey: row.idempotencyKey,
      })),
    });
    try {
      return await this.database.$transaction(
        async (tx) => {
          await lockFinancialWriteContext(
            tx,
            this.organization,
            this.access,
            actor,
            'fee.create',
          );
          await lockFinancialCases(tx, actor, [input.caseId]);
          // The existing immutable fee.created audit action protects this batch
          // receipt too. The resource type/command distinguish it from one fee.
          const prior = await tx.auditEvent.findMany({
            where: {
              departmentId: actor.departmentId,
              actorUserId: actor.userId,
              internalActorUserId: actor.userId,
              resourceType: 'FEE_BATCH',
              resourceId: input.caseId,
              action: 'fee.created',
              details: {
                path: ['idempotencyKey'],
                equals: input.idempotencyKey,
              },
            },
            select: { details: true },
          });
          if (prior.length > 1)
            throw new InternalServerErrorException({
              code: 'INVALID_FINANCIAL_RECEIPT',
              message: '费用批次回执不唯一',
            });
          if (prior.length === 1) {
            const saved = prior[0]!.details;
            if (
              saved === null ||
              typeof saved !== 'object' ||
              Array.isArray(saved) ||
              saved.command !== 'CREATE_CASE_FEE_ENTRIES' ||
              saved.requestFingerprint !== fingerprint
            )
              throw new ConflictException({
                code: 'IDEMPOTENCY_CONFLICT',
                message: '原请求键与费用批次不一致',
              });
            if (
              !Array.isArray(saved.createdIds) ||
              saved.createdIds.length !== rows.length ||
              saved.createdIds.some((id) => typeof id !== 'string')
            )
              throw new InternalServerErrorException({
                code: 'INVALID_FINANCIAL_RECEIPT',
                message: '费用批次回执内容不完整',
              });
            return {
              createdIds: saved.createdIds as string[],
              createdCount: saved.createdIds.length,
            };
          }
          const createdIds: string[] = [];
          for (const row of rows) {
            const fee = await tx.feeRecord.create({
              data: {
                departmentId: actor.departmentId,
                caseId: input.caseId,
                type: row.type,
                direction: row.direction,
                status: row.status,
                amount: row.amount,
                feeDate: row.feeDate,
                note: row.note,
                source: 'manual',
                actorUserId: actor.userId,
                idempotencyKey: row.idempotencyKey,
              },
            });
            const rowFingerprint = financialFingerprint({
              command: 'CREATE_FEE',
              caseId: input.caseId,
              type: row.type,
              direction: row.direction,
              status: row.status,
              amount: row.amount,
              feeDate: row.feeDate.toISOString().slice(0, 10),
              note: row.note,
            });
            await tx.auditEvent.create({
              data: {
                departmentId: actor.departmentId,
                actorUserId: actor.userId,
                internalActorUserId: actor.userId,
                resourceType: 'FEE',
                resourceId: fee.id,
                action: 'fee.created',
                details: {
                  caseId: input.caseId,
                  type: row.type,
                  amount: row.amount,
                  status: row.status,
                  requestFingerprint: rowFingerprint,
                  resultSnapshot: { id: fee.id, version: fee.version },
                  facts: {
                    direction: row.direction,
                    status: row.status,
                    feeDate: row.feeDate.toISOString().slice(0, 10),
                    note: row.note,
                  },
                },
              },
            });
            createdIds.push(fee.id);
          }
          await tx.auditEvent.create({
            data: {
              departmentId: actor.departmentId,
              actorUserId: actor.userId,
              internalActorUserId: actor.userId,
              resourceType: 'FEE_BATCH',
              resourceId: input.caseId,
              action: 'fee.created',
              details: {
                command: 'CREATE_CASE_FEE_ENTRIES',
                idempotencyKey: input.idempotencyKey,
                requestFingerprint: fingerprint,
                createdIds,
              },
            },
          });
          return { createdIds, createdCount: createdIds.length };
        },
        { isolationLevel: 'Serializable' },
      );
    } catch (cause) {
      if (
        cause instanceof Prisma.PrismaClientKnownRequestError &&
        ['P2002', 'P2034'].includes(cause.code)
      )
        throw new ConflictException({
          code: 'FEE_CHANGED',
          message: '费用批次发生冲突，请用原请求重试或刷新核对',
        });
      throw cause;
    }
  }
}
