import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { AccessControlService } from '../../access-control/access-control.service';
import { ActorContext } from '../../access-control/actor-context';
import { DatabaseService } from '../../database/database.service';
import { Prisma } from '../../generated/prisma/client';

type DecisionInput = {
  decision: 'ISSUE' | 'NO_ISSUE';
  expectedVersion: number;
};
type DecisionResult = {
  id: string;
  stage: 'WAITING_CERTIFICATE' | 'WAITING_RETURN';
  version: number;
  issuanceDecision: {
    decision: DecisionInput['decision'];
    actorDisplayName: string;
    decidedAt: string;
  };
};
const ACTION = 'notary.issuance.decide';

@Injectable()
export class NotaryIssuanceDecisionService {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: AccessControlService,
  ) {}

  async decide(
    actor: ActorContext,
    matterId: string,
    idempotencyKey: string,
    input: DecisionInput,
  ): Promise<DecisionResult> {
    if (
      typeof idempotencyKey !== 'string' ||
      idempotencyKey.trim() !== idempotencyKey ||
      idempotencyKey.length < 1 ||
      idempotencyKey.length > 128 ||
      (input.decision !== 'ISSUE' && input.decision !== 'NO_ISSUE') ||
      !Number.isInteger(input.expectedVersion) ||
      input.expectedVersion < 1
    )
      throw this.validation();
    if (
      actor.clientCustomerId !== undefined ||
      actor.notaryOfficeId !== undefined
    )
      throw this.forbidden();
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify({
          matterId,
          decision: input.decision,
          expectedVersion: input.expectedVersion,
        }),
      )
      .digest('hex');
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        return await this.database.$transaction(
          async (tx) => {
            const locked = await tx.$queryRawUnsafe<Array<{ id: string }>>(
              'SELECT "id" FROM "notary_matters" WHERE "id" = $1::uuid AND "department_id" = $2::uuid FOR UPDATE',
              matterId,
              actor.departmentId,
            );
            if (locked.length !== 1) throw this.notFound();
            const matter = await tx.notaryMatter.findFirst({
              where: { id: matterId, departmentId: actor.departmentId },
              select: {
                departmentId: true,
                stage: true,
                version: true,
                sourceLead: {
                  select: { responsibleUserId: true, teamId: true },
                },
                openingReviewDecision: {
                  select: {
                    id: true,
                    result: true,
                    reason: true,
                    archivedAt: true,
                    decidedAt: true,
                  },
                },
              },
            });
            if (matter === null) throw this.notFound();
            const account = await tx.userAccount.findUnique({
              where: { id: actor.userId },
              select: { accountType: true, active: true, displayName: true },
            });
            if (account?.accountType !== 'INTERNAL' || !account.active)
              throw this.forbidden();
            try {
              await this.access.authorizeLead(
                actor,
                ACTION,
                {
                  departmentId: matter.departmentId,
                  responsibleUserId: matter.sourceLead.responsibleUserId,
                  ...(matter.sourceLead.teamId === null
                    ? {}
                    : { teamId: matter.sourceLead.teamId }),
                },
                tx,
              );
            } catch (error) {
              if (error instanceof ForbiddenException) throw this.forbidden();
              throw error;
            }
            const prior = await tx.notaryMatterCommandReceipt.findUnique({
              where: {
                departmentId_actorUserId_action_idempotencyKey: {
                  departmentId: matter.departmentId,
                  actorUserId: actor.userId,
                  action: ACTION,
                  idempotencyKey,
                },
              },
            });
            if (prior !== null)
              return this.replay(tx, prior, matterId, fingerprint);
            const review = matter.openingReviewDecision;
            if (
              matter.stage !== 'ISSUANCE_DECISION' ||
              review === null ||
              review.result !== 'INFRINGEMENT' ||
              review.reason !== null ||
              review.archivedAt !== null
            )
              throw this.invalidState();
            if (matter.version !== input.expectedVersion)
              throw this.versionConflict();
            const stage =
              input.decision === 'ISSUE'
                ? 'WAITING_CERTIFICATE'
                : 'WAITING_RETURN';
            const changed = await tx.notaryMatter.updateMany({
              where: {
                id: matterId,
                departmentId: matter.departmentId,
                stage: 'ISSUANCE_DECISION',
                version: input.expectedVersion,
              },
              data: { stage, version: input.expectedVersion + 1 },
            });
            if (changed.count !== 1) throw this.versionConflict();
            const decidedAt = new Date();
            const actorDisplayName = account.displayName.trim();
            const decision = await tx.notaryIssuanceDecision.create({
              data: {
                matterId,
                departmentId: matter.departmentId,
                openingReviewDecisionId: review.id,
                openingReviewResult: 'INFRINGEMENT',
                actorUserId: actor.userId,
                actorDisplayNameSnapshot: actorDisplayName,
                decision: input.decision,
                decidedAt,
                fromVersion: input.expectedVersion,
                toVersion: input.expectedVersion + 1,
              },
            });
            const result: DecisionResult = {
              id: matterId,
              stage,
              version: input.expectedVersion + 1,
              issuanceDecision: {
                decision: input.decision,
                actorDisplayName,
                decidedAt: decision.decidedAt.toISOString(),
              },
            };
            await tx.notaryIssuanceDecisionAuditEvent.create({
              data: {
                issuanceDecisionId: decision.id,
                matterId,
                departmentId: matter.departmentId,
                actorUserId: actor.userId,
                decision: input.decision,
                matterVersion: result.version,
                action: 'notary.issuance.decide.succeeded',
                occurredAt: decidedAt,
              },
            });
            await tx.notaryMatterCommandReceipt.create({
              data: {
                departmentId: matter.departmentId,
                actorUserId: actor.userId,
                internalActorUserId: actor.userId,
                action: ACTION,
                idempotencyKey,
                requestFingerprint: fingerprint,
                resultMatterId: matterId,
                resultMatterVersion: result.version,
                resultSnapshot: result,
              },
            });
            return result;
          },
          { isolationLevel: 'Serializable' },
        );
      } catch (error) {
        if (this.isSerializationConflict(error)) {
          if (attempt < 3) continue;
          throw this.versionConflict();
        }
        if (this.isUnique(error)) throw this.versionConflict();
        throw error;
      }
    }
    throw this.versionConflict();
  }

  private async replay(
    tx: Pick<Prisma.TransactionClient, 'notaryIssuanceDecision'>,
    receipt: {
      departmentId: string;
      actorUserId: string;
      requestFingerprint: string;
      resultMatterId: string;
      resultMatterVersion: number;
      resultSnapshot: Prisma.JsonValue;
    },
    matterId: string,
    fingerprint: string,
  ): Promise<DecisionResult> {
    if (
      receipt.requestFingerprint !== fingerprint ||
      receipt.resultMatterId !== matterId
    )
      throw new ConflictException({
        code: 'IDEMPOTENCY_CONFLICT',
        message: '该 Idempotency-Key 已用于不同请求',
      });
    const value = receipt.resultSnapshot;
    if (value === null || typeof value !== 'object' || Array.isArray(value))
      throw this.corruptReceipt();
    const result = value as Record<string, unknown>;
    const summary = result.issuanceDecision;
    if (
      Object.keys(result).sort().join() !==
        'id,issuanceDecision,stage,version' ||
      result.id !== matterId ||
      result.version !== receipt.resultMatterVersion ||
      (result.stage !== 'WAITING_CERTIFICATE' &&
        result.stage !== 'WAITING_RETURN') ||
      summary === null ||
      typeof summary !== 'object' ||
      Array.isArray(summary)
    )
      throw this.corruptReceipt();
    const detail = summary as Record<string, unknown>;
    if (
      Object.keys(detail).sort().join() !==
        'actorDisplayName,decidedAt,decision' ||
      (detail.decision !== 'ISSUE' && detail.decision !== 'NO_ISSUE') ||
      result.stage !==
        (detail.decision === 'ISSUE'
          ? 'WAITING_CERTIFICATE'
          : 'WAITING_RETURN') ||
      typeof detail.actorDisplayName !== 'string' ||
      detail.actorDisplayName.trim() !== detail.actorDisplayName ||
      detail.actorDisplayName.length < 1 ||
      typeof detail.decidedAt !== 'string' ||
      !this.isIsoDate(detail.decidedAt)
    )
      throw this.corruptReceipt();
    const stored = await tx.notaryIssuanceDecision.findUnique({
      where: { matterId },
      select: {
        departmentId: true,
        actorUserId: true,
        decision: true,
        actorDisplayNameSnapshot: true,
        decidedAt: true,
        fromVersion: true,
        toVersion: true,
      },
    });
    if (
      stored === null ||
      stored.departmentId !== receipt.departmentId ||
      stored.actorUserId !== receipt.actorUserId ||
      stored.decision !== detail.decision ||
      stored.actorDisplayNameSnapshot !== detail.actorDisplayName ||
      stored.decidedAt.toISOString() !== detail.decidedAt ||
      stored.toVersion !== result.version ||
      stored.fromVersion !== receipt.resultMatterVersion - 1
    )
      throw this.corruptReceipt();
    return value as DecisionResult;
  }

  private isIsoDate(value: string): boolean {
    const parsed = new Date(value);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
  }
  private validation() {
    return new BadRequestException({
      code: 'VALIDATION_ERROR',
      message: '出证选择参数无效',
    });
  }
  private forbidden() {
    return new ForbiddenException({
      code: 'ACTION_FORBIDDEN',
      message: '无权决定出证',
    });
  }
  private notFound() {
    return new NotFoundException({
      code: 'RESOURCE_NOT_FOUND',
      message: '公证事项不存在或不可访问',
    });
  }
  private invalidState() {
    return new ConflictException({
      code: 'INVALID_STATE',
      message: '该公证事项当前不能选择出证',
    });
  }
  private versionConflict() {
    return new ConflictException({
      code: 'VERSION_CONFLICT',
      message: '公证事项状态或版本已变化',
    });
  }
  private corruptReceipt() {
    return new InternalServerErrorException({
      code: 'RECEIPT_CORRUPT',
      message: '出证选择回执不可用',
    });
  }
  private isUnique(error: unknown): boolean {
    return (
      error !== null &&
      typeof error === 'object' &&
      ((error as { code?: unknown }).code === 'P2002' ||
        this.isUnique((error as { cause?: unknown }).cause))
    );
  }
  private isSerializationConflict(error: unknown): boolean {
    if (error === null || typeof error !== 'object') return false;
    const record = error as {
      code?: unknown;
      cause?: unknown;
      meta?: {
        driverAdapterError?: {
          cause?: { originalCode?: unknown; sqlState?: unknown };
        };
      };
    };
    return (
      record.code === 'P2034' ||
      record.code === '40001' ||
      record.meta?.driverAdapterError?.cause?.originalCode === '40001' ||
      record.meta?.driverAdapterError?.cause?.sqlState === '40001' ||
      this.isSerializationConflict(record.cause)
    );
  }
}
