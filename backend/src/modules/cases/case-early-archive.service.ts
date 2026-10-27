import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { Prisma, type CaseStage } from '../../generated/prisma/client';
import { AccessControlService } from '../../access-control/access-control.service';
import type { ActorContext } from '../../access-control/actor-context';
import { DatabaseService } from '../../database/database.service';
import {
  EarlyArchiveCaseInput,
  EarlyArchiveCaseResult,
} from './case-early-archive.dto';

const fail = (code: string) => {
  const body = { code, message: '提前归档失败' };
  if (code === 'VALIDATION_ERROR') return new BadRequestException(body);
  if (code === 'ACTION_FORBIDDEN') return new ForbiddenException(body);
  if (code === 'CASE_NOT_FOUND') return new NotFoundException(body);
  if (code === 'INVALID_RECEIPT') return new InternalServerErrorException(body);
  return new ConflictException(body);
};

@Injectable()
export class CaseEarlyArchiveService {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: AccessControlService,
  ) {}

  async archive(
    actor: ActorContext,
    caseId: string,
    input: EarlyArchiveCaseInput,
  ): Promise<EarlyArchiveCaseResult> {
    this.validate(input);
    if (
      actor.clientCustomerId !== undefined ||
      actor.notaryOfficeId !== undefined ||
      actor.lawyerAccountId !== undefined
    )
      throw fail('ACTION_FORBIDDEN');
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify({
          caseId,
          expectedVersion: input.expectedVersion,
          archiveAt: input.archiveAt,
          reason: input.reason,
        }),
      )
      .digest('hex');
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.database.$transaction(
          async (tx) => {
            const locked = await tx.$queryRawUnsafe<Array<{ id: string }>>(
              'SELECT "id" FROM "cases" WHERE "id"=$1::uuid AND "department_id"=$2::uuid FOR UPDATE',
              caseId,
              actor.departmentId,
            );
            if (locked.length !== 1) throw fail('CASE_NOT_FOUND');
            const record = await tx.case.findFirst({
              where: { id: caseId, departmentId: actor.departmentId },
              select: {
                stage: true,
                version: true,
                responsibleUserId: true,
                responsibleMembership: { select: { teamId: true } },
                archive: { select: { id: true } },
                earlyArchive: { select: { id: true } },
                externalEntry: { select: { stageReachedOn: true } },
              },
            });
            if (record === null) throw fail('CASE_NOT_FOUND');
            const account = await tx.userAccount.findUnique({
              where: { id: actor.userId },
              select: { active: true, accountType: true },
            });
            if (!account?.active || account.accountType !== 'INTERNAL')
              throw fail('ACTION_FORBIDDEN');
            try {
              await this.access.authorizeCase(
                actor,
                'case.archive',
                {
                  departmentId: actor.departmentId,
                  responsibleUserId: record.responsibleUserId,
                  ...(record.responsibleMembership.teamId
                    ? { teamId: record.responsibleMembership.teamId }
                    : {}),
                },
                tx,
              );
            } catch (cause) {
              if (cause instanceof ForbiddenException)
                throw fail('ACTION_FORBIDDEN');
              throw cause;
            }
            const prior = await tx.caseEarlyArchiveReceipt.findUnique({
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
                prior.requestFingerprint !== fingerprint
              )
                throw fail('IDEMPOTENCY_CONFLICT');
              const fact = await tx.caseEarlyArchive.findUnique({
                where: { id: prior.earlyArchiveId },
              });
              const audit = fact
                ? await tx.auditEvent.findUnique({
                    where: { id: fact.auditEventId },
                  })
                : null;
              if (
                !fact ||
                !audit ||
                prior.departmentId !== actor.departmentId ||
                prior.actorUserId !== actor.userId ||
                prior.earlyArchiveId !== fact.id ||
                fact.caseId !== caseId ||
                fact.departmentId !== actor.departmentId ||
                fact.recordedByUserId !== actor.userId ||
                fact.fromVersion !== input.expectedVersion ||
                fact.toVersion !== input.expectedVersion + 1 ||
                fact.archiveAt.toISOString().slice(0, 10) !== input.archiveAt ||
                fact.reason !== input.reason ||
                record.stage !== 'ARCHIVED' ||
                record.version !== fact.toVersion ||
                record.archive !== null ||
                record.earlyArchive?.id !== fact.id ||
                audit.departmentId !== actor.departmentId ||
                audit.actorKind !== 'HUMAN' ||
                audit.actorUserId !== actor.userId ||
                audit.internalActorUserId !== actor.userId ||
                audit.customerAccountBindingId !== null ||
                audit.notaryOfficeAccountBindingId !== null ||
                audit.lawyerAccountBindingId !== null ||
                audit.resourceType !== 'CASE' ||
                audit.resourceId !== caseId ||
                audit.action !== 'case.early_archived' ||
                !this.sameObject(audit.details, {
                  earlyArchiveId: fact.id,
                  fromStage: fact.fromStage,
                  fromVersion: fact.fromVersion,
                  toVersion: fact.toVersion,
                  archiveAt: input.archiveAt,
                  reason: fact.reason,
                  requestFingerprint: fingerprint,
                })
              )
                throw fail('INVALID_RECEIPT');
              return this.receipt(prior.resultSnapshot, {
                id: caseId,
                earlyArchiveId: fact.id,
                fromStage: fact.fromStage as Exclude<CaseStage, 'ARCHIVED'>,
                stage: 'ARCHIVED',
                version: fact.toVersion,
                recordedAt: fact.recordedAt.toISOString(),
              });
            }
            if (record.version !== input.expectedVersion)
              throw fail('VERSION_CONFLICT');
            if (
              record.stage === 'ARCHIVED' ||
              record.archive !== null ||
              record.earlyArchive !== null ||
              (record.externalEntry !== null &&
                input.archiveAt <
                  record.externalEntry.stageReachedOn
                    .toISOString()
                    .slice(0, 10))
            )
              throw fail('INVALID_STATE');
            const earlyArchiveId = randomUUID();
            const auditEventId = randomUUID();
            const recordedAt = new Date();
            await tx.auditEvent.create({
              data: {
                id: auditEventId,
                departmentId: actor.departmentId,
                actorUserId: actor.userId,
                internalActorUserId: actor.userId,
                resourceType: 'CASE',
                resourceId: caseId,
                action: 'case.early_archived',
                details: {
                  earlyArchiveId,
                  fromStage: record.stage,
                  fromVersion: record.version,
                  toVersion: record.version + 1,
                  archiveAt: input.archiveAt,
                  reason: input.reason,
                  requestFingerprint: fingerprint,
                },
              },
            });
            await tx.caseEarlyArchive.create({
              data: {
                id: earlyArchiveId,
                caseId,
                departmentId: actor.departmentId,
                fromStage: record.stage,
                fromVersion: record.version,
                toVersion: record.version + 1,
                archiveAt: new Date(input.archiveAt + 'T00:00:00.000Z'),
                reason: input.reason,
                recordedAt,
                recordedByUserId: actor.userId,
                auditEventId,
              },
            });
            const updated = await tx.case.updateMany({
              where: {
                id: caseId,
                departmentId: actor.departmentId,
                stage: record.stage,
                version: record.version,
                archive: { is: null },
                earlyArchive: { is: { id: earlyArchiveId } },
              },
              data: { stage: 'ARCHIVED', version: { increment: 1 } },
            });
            if (updated.count !== 1) throw fail('VERSION_CONFLICT');
            const result: EarlyArchiveCaseResult = {
              id: caseId,
              earlyArchiveId,
              fromStage: record.stage as Exclude<CaseStage, 'ARCHIVED'>,
              stage: 'ARCHIVED',
              version: record.version + 1,
              recordedAt: recordedAt.toISOString(),
            };
            await tx.caseEarlyArchiveReceipt.create({
              data: {
                departmentId: actor.departmentId,
                actorUserId: actor.userId,
                caseId,
                earlyArchiveId,
                idempotencyKey: input.idempotencyKey,
                requestFingerprint: fingerprint,
                resultSnapshot: { ...result },
              },
            });
            return result;
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (cause) {
        if (this.hasCode(cause, 'P2034') || this.hasCode(cause, '40001')) {
          if (attempt < 2) continue;
          throw fail('VERSION_CONFLICT');
        }
        if (this.hasCode(cause, 'P2002')) {
          if (attempt < 2) continue;
          throw fail('VERSION_CONFLICT');
        }
        throw cause;
      }
    }
    throw fail('VERSION_CONFLICT');
  }

  private validate(input: EarlyArchiveCaseInput): void {
    if (
      !input ||
      typeof input !== 'object' ||
      Array.isArray(input) ||
      Object.keys(input).length !== 4 ||
      Object.keys(input).some(
        (key) =>
          ![
            'expectedVersion',
            'idempotencyKey',
            'archiveAt',
            'reason',
          ].includes(key),
      ) ||
      !Number.isSafeInteger(input.expectedVersion) ||
      input.expectedVersion < 1 ||
      typeof input.idempotencyKey !== 'string' ||
      input.idempotencyKey.trim() !== input.idempotencyKey ||
      input.idempotencyKey.length < 1 ||
      input.idempotencyKey.length > 128 ||
      typeof input.reason !== 'string' ||
      !/\S/u.test(input.reason) ||
      input.reason.length > 2000 ||
      typeof input.archiveAt !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/u.test(input.archiveAt)
    )
      throw fail('VALIDATION_ERROR');
    const date = new Date(input.archiveAt + 'T00:00:00.000Z');
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    if (
      Number.isNaN(date.getTime()) ||
      date.getUTCFullYear() < 1 ||
      date.toISOString().slice(0, 10) !== input.archiveAt ||
      input.archiveAt > today
    )
      throw fail('VALIDATION_ERROR');
  }

  private receipt(
    value: unknown,
    expected: EarlyArchiveCaseResult,
  ): EarlyArchiveCaseResult {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw fail('INVALID_RECEIPT');
    if (!this.sameObject(value, expected)) throw fail('INVALID_RECEIPT');
    return expected;
  }

  private sameObject(value: unknown, expected: object): boolean {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      return false;
    const row = value as Record<string, unknown>;
    return (
      Object.keys(row).length === Object.keys(expected).length &&
      Object.entries(expected).every(([key, item]) => row[key] === item)
    );
  }

  private hasCode(cause: unknown, code: string): boolean {
    if (!cause || typeof cause !== 'object') return false;
    const row = cause as {
      code?: unknown;
      cause?: unknown;
      meta?: {
        driverAdapterError?: {
          cause?: { originalCode?: unknown; sqlState?: unknown };
        };
      };
    };
    return (
      row.code === code ||
      row.meta?.driverAdapterError?.cause?.originalCode === code ||
      row.meta?.driverAdapterError?.cause?.sqlState === code ||
      this.hasCode(row.cause, code)
    );
  }
}
