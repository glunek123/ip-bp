import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { AccessControlService } from '../../access-control/access-control.service';
import { Prisma } from '../../generated/prisma/client';
import type { ActorContext } from '../../access-control/actor-context';
import { DatabaseService } from '../../database/database.service';
import { CaseEarlyArchiveService } from './case-early-archive.service';
import {
  CaseBatchArchiveDto,
  CaseBatchArchiveResultDto,
} from './case-batch-archive.dto';

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

@Injectable()
export class CaseBatchArchiveService {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: AccessControlService,
    private readonly single: CaseEarlyArchiveService,
  ) {}

  async archive(
    actor: ActorContext,
    input: CaseBatchArchiveDto,
  ): Promise<CaseBatchArchiveResultDto> {
    this.validate(input);
    const requestFingerprint = createHash('sha256')
      .update(
        JSON.stringify({
          archiveAt: input.archiveAt,
          reason: input.reason,
          items: input.items,
        }),
      )
      .digest('hex');
    const key = {
      departmentId: actor.departmentId,
      actorUserId: actor.userId,
      idempotencyKey: input.idempotencyKey,
    };
    try {
      await this.database.$transaction(
        async (tx) => {
          if (
            actor.clientCustomerId !== undefined ||
            actor.notaryOfficeId !== undefined ||
            actor.lawyerAccountId !== undefined
          )
            throw new ForbiddenException({ code: 'ACTION_FORBIDDEN' });
          const [account, membership] = await Promise.all([
            tx.userAccount.findUnique({
              where: { id: actor.userId },
              select: { active: true, accountType: true },
            }),
            tx.departmentMembership.findUnique({
              where: {
                userId_departmentId: {
                  userId: actor.userId,
                  departmentId: actor.departmentId,
                },
              },
              select: { active: true, teamId: true },
            }),
          ]);
          if (
            !account?.active ||
            account.accountType !== 'INTERNAL' ||
            !membership?.active
          )
            throw new ForbiddenException({ code: 'ACTION_FORBIDDEN' });
          await this.access.authorizeCase(
            actor,
            'case.archive',
            {
              departmentId: actor.departmentId,
              responsibleUserId: actor.userId,
              ...(membership.teamId ? { teamId: membership.teamId } : {}),
            },
            tx,
          );
          const prior = await tx.caseEarlyArchiveBatchReceipt.findUnique({
            where: { departmentId_actorUserId_idempotencyKey: key },
          });
          if (prior) {
            if (prior.requestFingerprint !== requestFingerprint)
              throw new ConflictException({
                code: 'IDEMPOTENCY_CONFLICT',
                message: '批次幂等键已用于不同请求',
              });
            return;
          }
          await tx.caseEarlyArchiveBatchReceipt.create({
            data: { ...key, requestFingerprint },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (!(
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ))
        throw error;
      const prior = await this.database.caseEarlyArchiveBatchReceipt.findUnique(
        { where: { departmentId_actorUserId_idempotencyKey: key } },
      );
      if (prior?.requestFingerprint !== requestFingerprint)
        throw new ConflictException({
          code: 'IDEMPOTENCY_CONFLICT',
          message: '批次幂等键已用于不同请求',
        });
    }
    const items: CaseBatchArchiveResultDto['items'] = [];
    for (const item of input.items) {
      const childKey = createHash('sha256')
        .update(
          JSON.stringify({ batchKey: input.idempotencyKey, caseId: item.id }),
        )
        .digest('hex');
      try {
        const result = await this.single.archive(actor, item.id, {
          idempotencyKey: childKey,
          expectedVersion: item.expectedVersion,
          archiveAt: input.archiveAt,
          reason: input.reason,
        });
        items.push({ id: item.id, status: 'SUCCEEDED', result });
      } catch (error) {
        if (
          error instanceof HttpException &&
          error.getStatus() >= 400 &&
          error.getStatus() < 500
        ) {
          const response = error.getResponse();
          const code =
            typeof response === 'object' &&
            response !== null &&
            'code' in response &&
            typeof response.code === 'string'
              ? response.code
              : 'CASE_ARCHIVE_REJECTED';
          items.push({ id: item.id, status: 'FAILED', code });
        } else
          items.push({
            id: item.id,
            status: 'UNKNOWN',
            code: 'RESULT_UNKNOWN',
          });
      }
    }
    return { items };
  }

  private validate(input: CaseBatchArchiveDto): void {
    const invalid = () =>
      new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: '批量归档输入无效',
      });
    if (
      !input ||
      typeof input !== 'object' ||
      Array.isArray(input) ||
      Object.keys(input).sort().join(',') !==
        'archiveAt,idempotencyKey,items,reason' ||
      typeof input.idempotencyKey !== 'string' ||
      input.idempotencyKey.length < 1 ||
      input.idempotencyKey.length > 128 ||
      input.idempotencyKey.trim() !== input.idempotencyKey ||
      typeof input.reason !== 'string' ||
      input.reason.length > 2000 ||
      !/\S/u.test(input.reason) ||
      typeof input.archiveAt !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/u.test(input.archiveAt) ||
      !Array.isArray(input.items) ||
      input.items.length < 1 ||
      input.items.length > 20
    )
      throw invalid();
    const date = new Date(input.archiveAt + 'T00:00:00.000Z');
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    if (
      Number.isNaN(date.getTime()) ||
      date.toISOString().slice(0, 10) !== input.archiveAt ||
      input.archiveAt > today
    )
      throw invalid();
    const seen = new Set<string>();
    for (const item of input.items) {
      if (
        !item ||
        typeof item !== 'object' ||
        Array.isArray(item) ||
        Object.keys(item).sort().join(',') !== 'expectedVersion,id' ||
        typeof item.id !== 'string' ||
        !uuid.test(item.id) ||
        seen.has(item.id) ||
        !Number.isSafeInteger(item.expectedVersion) ||
        item.expectedVersion < 1
      )
        throw invalid();
      seen.add(item.id);
    }
  }
}
