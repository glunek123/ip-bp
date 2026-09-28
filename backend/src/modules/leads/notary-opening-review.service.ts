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
import { ReviewNotaryOpeningDto } from './lead-notary.dto';

type ReviewResult = {
  id: string;
  stage: 'ISSUANCE_DECISION' | 'ARCHIVED';
  version: number;
  reviewDecision: {
    result: 'INFRINGEMENT' | 'NO_INFRINGEMENT';
    reason: string | null;
    actorKind: 'INTERNAL' | 'CLIENT';
    actorDisplayName: string;
    decidedAt: string;
    archivedAt: string | null;
  };
};

@Injectable()
export class NotaryOpeningReviewService {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: AccessControlService,
  ) {}

  async review(
    actor: ActorContext,
    matterId: string,
    idempotencyKey: string,
    input: ReviewNotaryOpeningDto,
  ): Promise<ReviewResult> {
    const request = this.normalize(matterId, idempotencyKey, input);
    const fingerprint = createHash('sha256')
      .update(JSON.stringify(request))
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
                customerId: true,
                departmentId: true,
                stage: true,
                version: true,
                opening: { select: { matterId: true } },
                sourceLead: {
                  select: {
                    responsibleUserId: true,
                    teamId: true,
                    pushedAt: true,
                    pushedByUserId: true,
                  },
                },
              },
            });
            if (matter === null) throw this.notFound();
            const actorKind =
              actor.clientCustomerId === undefined ? 'INTERNAL' : 'CLIENT';
            let customerAccountBindingId: string | null = null;
            let actorDisplayName: string;
            if (actorKind === 'CLIENT') {
              if (actor.clientCustomerId !== matter.customerId)
                throw this.forbidden();
              if (
                matter.sourceLead.pushedAt === null ||
                matter.sourceLead.pushedByUserId === null
              )
                throw this.forbidden();
              const binding = await tx.customerAccountBinding.findFirst({
                where: {
                  userId: actor.userId,
                  customerId: matter.customerId,
                  departmentId: matter.departmentId,
                  active: true,
                  user: { accountType: 'CLIENT', active: true },
                  customer: { profileStatus: 'ADMITTED' },
                },
                select: { id: true, user: { select: { displayName: true } } },
              });
              if (binding === null) throw this.forbidden();
              customerAccountBindingId = binding.id;
              actorDisplayName = binding.user.displayName;
            } else {
              const account = await tx.userAccount.findUnique({
                where: { id: actor.userId },
                select: { accountType: true, active: true, displayName: true },
              });
              if (account?.accountType !== 'INTERNAL' || !account.active)
                throw this.forbidden();
              try {
                await this.access.authorizeLead(
                  actor,
                  'notary.opening.review',
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
              actorDisplayName = account.displayName;
            }
            const prior = await tx.notaryOpeningReviewReceipt.findUnique({
              where: {
                departmentId_actorUserId_idempotencyKey: {
                  departmentId: matter.departmentId,
                  actorUserId: actor.userId,
                  idempotencyKey,
                },
              },
            });
            if (prior !== null)
              return this.replay(tx, prior, matterId, fingerprint);
            if (matter.stage !== 'UNBOX_REVIEW' || matter.opening === null)
              throw new ConflictException({
                code: 'INVALID_STATE',
                message: '该公证事项当前不能审核开箱',
              });
            if (matter.version !== request.expectedVersion)
              throw this.versionConflict();
            const frozenPhotos = await tx.materialReference.count({
              where: {
                departmentId: matter.departmentId,
                resourceType: 'notary_matter',
                resourceId: matterId,
                purpose: 'NOTARY_OPENING_PHOTO',
                actionEventId: { not: null },
                actionEvent: {
                  action: 'notary.opening_recorded',
                  resourceType: 'notary_matter',
                  resourceId: matterId,
                  departmentId: matter.departmentId,
                },
                material: {
                  ownerType: 'NOTARY_MATTER',
                  ownerId: matterId,
                  category: 'NOTARY_OPENING_PHOTO',
                  departmentId: matter.departmentId,
                },
              },
            });
            if (frozenPhotos < 1)
              throw new ConflictException({
                code: 'OPENING_PHOTO_REQUIRED',
                message: '尚无已冻结的开箱照片',
              });
            const stage =
              request.result === 'INFRINGEMENT'
                ? 'ISSUANCE_DECISION'
                : 'ARCHIVED';
            const changed = await tx.notaryMatter.updateMany({
              where: {
                id: matterId,
                departmentId: matter.departmentId,
                stage: 'UNBOX_REVIEW',
                version: request.expectedVersion,
              },
              data: { stage, version: request.expectedVersion + 1 },
            });
            if (changed.count !== 1) throw this.versionConflict();
            const decidedAt = new Date();
            const archivedAt = stage === 'ARCHIVED' ? decidedAt : null;
            const decision = await tx.notaryOpeningReviewDecision.create({
              data: {
                matterId,
                departmentId: matter.departmentId,
                customerId: matter.customerId,
                actorUserId: actor.userId,
                actorKind,
                internalActorUserId:
                  actorKind === 'INTERNAL' ? actor.userId : null,
                customerAccountBindingId,
                actorDisplayNameSnapshot: actorDisplayName.trim(),
                result: request.result,
                reason: request.reason,
                archivedAt,
                decidedAt,
                fromVersion: request.expectedVersion,
                toVersion: request.expectedVersion + 1,
              },
            });
            const result: ReviewResult = {
              id: matterId,
              stage,
              version: request.expectedVersion + 1,
              reviewDecision: {
                result: request.result,
                reason: request.reason,
                actorKind,
                actorDisplayName: actorDisplayName.trim(),
                decidedAt: decision.decidedAt.toISOString(),
                archivedAt: archivedAt?.toISOString() ?? null,
              },
            };
            await tx.notaryOpeningReviewAuditEvent.create({
              data: {
                reviewDecisionId: decision.id,
                matterId,
                departmentId: matter.departmentId,
                customerId: matter.customerId,
                actorUserId: actor.userId,
                actorKind,
                result: request.result,
                matterVersion: result.version,
                action: 'notary.opening.review.succeeded',
                occurredAt: decidedAt,
              },
            });
            await tx.notaryOpeningReviewReceipt.create({
              data: {
                departmentId: matter.departmentId,
                customerId: matter.customerId,
                actorUserId: actor.userId,
                actorKind,
                internalActorUserId:
                  actorKind === 'INTERNAL' ? actor.userId : null,
                customerAccountBindingId,
                idempotencyKey,
                requestFingerprint: fingerprint,
                resultMatterId: matterId,
                resultMatterVersion: result.version,
                reviewDecisionId: decision.id,
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

  private normalize(
    matterId: string,
    idempotencyKey: string,
    input: ReviewNotaryOpeningDto,
  ) {
    if (
      typeof idempotencyKey !== 'string' ||
      idempotencyKey.trim() !== idempotencyKey ||
      idempotencyKey.length < 1 ||
      idempotencyKey.length > 128 ||
      !Number.isInteger(input.expectedVersion) ||
      input.expectedVersion < 1
    )
      throw this.validation();
    if (input.result === 'INFRINGEMENT') {
      if (input.reason !== undefined && input.reason !== null)
        throw this.validation();
      return {
        matterId,
        result: input.result,
        reason: null,
        expectedVersion: input.expectedVersion,
      };
    }
    if (input.result !== 'NO_INFRINGEMENT' || typeof input.reason !== 'string')
      throw this.validation();
    const reason = input.reason.trim();
    if (reason.length < 1 || reason.length > 2000) throw this.validation();
    return {
      matterId,
      result: input.result,
      reason,
      expectedVersion: input.expectedVersion,
    };
  }

  private async replay(
    tx: Pick<Prisma.TransactionClient, 'notaryOpeningReviewDecision'>,
    receipt: {
      reviewDecisionId: string;
      departmentId: string;
      customerId: string;
      actorUserId: string;
      actorKind: string;
      requestFingerprint: string;
      resultMatterId: string;
      resultMatterVersion: number;
      resultSnapshot: Prisma.JsonValue;
    },
    matterId: string,
    fingerprint: string,
  ): Promise<ReviewResult> {
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
    const decision = result.reviewDecision;
    if (
      result.id !== matterId ||
      result.version !== receipt.resultMatterVersion ||
      !this.hasExactKeys(result, [
        'id',
        'stage',
        'version',
        'reviewDecision',
      ]) ||
      decision === null ||
      typeof decision !== 'object' ||
      Array.isArray(decision)
    )
      throw this.corruptReceipt();
    const snapshot = decision as Record<string, unknown>;
    if (
      !this.hasExactKeys(snapshot, [
        'result',
        'reason',
        'actorKind',
        'actorDisplayName',
        'decidedAt',
        'archivedAt',
      ]) ||
      !['ISSUANCE_DECISION', 'ARCHIVED'].includes(String(result.stage)) ||
      !['INFRINGEMENT', 'NO_INFRINGEMENT'].includes(String(snapshot.result)) ||
      !['INTERNAL', 'CLIENT'].includes(String(snapshot.actorKind)) ||
      typeof snapshot.actorDisplayName !== 'string' ||
      snapshot.actorDisplayName.trim() !== snapshot.actorDisplayName ||
      snapshot.actorDisplayName.length < 1 ||
      snapshot.actorDisplayName.length > 200 ||
      typeof snapshot.decidedAt !== 'string' ||
      !this.isIsoDate(snapshot.decidedAt) ||
      (snapshot.reason !== null && typeof snapshot.reason !== 'string') ||
      (snapshot.archivedAt !== null &&
        (typeof snapshot.archivedAt !== 'string' ||
          !this.isIsoDate(snapshot.archivedAt))) ||
      (snapshot.result === 'INFRINGEMENT' &&
        (result.stage !== 'ISSUANCE_DECISION' ||
          snapshot.reason !== null ||
          snapshot.archivedAt !== null)) ||
      (snapshot.result === 'NO_INFRINGEMENT' &&
        (result.stage !== 'ARCHIVED' ||
          typeof snapshot.reason !== 'string' ||
          snapshot.reason.trim() !== snapshot.reason ||
          snapshot.reason.length < 1 ||
          snapshot.reason.length > 2000 ||
          typeof snapshot.archivedAt !== 'string' ||
          snapshot.archivedAt !== snapshot.decidedAt))
    )
      throw this.corruptReceipt();
    const stored = await tx.notaryOpeningReviewDecision.findUnique({
      where: { id: receipt.reviewDecisionId },
      select: {
        matterId: true,
        departmentId: true,
        customerId: true,
        actorUserId: true,
        actorKind: true,
        actorDisplayNameSnapshot: true,
        result: true,
        reason: true,
        archivedAt: true,
        decidedAt: true,
        toVersion: true,
      },
    });
    if (
      stored === null ||
      stored.matterId !== matterId ||
      stored.departmentId !== receipt.departmentId ||
      stored.customerId !== receipt.customerId ||
      stored.actorUserId !== receipt.actorUserId ||
      stored.actorKind !== receipt.actorKind ||
      stored.toVersion !== receipt.resultMatterVersion ||
      stored.result !== snapshot.result ||
      stored.reason !== snapshot.reason ||
      stored.actorKind !== snapshot.actorKind ||
      stored.actorDisplayNameSnapshot !== snapshot.actorDisplayName ||
      stored.decidedAt.toISOString() !== snapshot.decidedAt ||
      (stored.archivedAt?.toISOString() ?? null) !== snapshot.archivedAt
    )
      throw this.corruptReceipt();
    return value as ReviewResult;
  }

  private isIsoDate(value: string): boolean {
    const parsed = new Date(value);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
  }

  private hasExactKeys(
    value: Record<string, unknown>,
    keys: string[],
  ): boolean {
    const actual = Object.keys(value);
    return (
      actual.length === keys.length &&
      keys.every((key) => Object.hasOwn(value, key))
    );
  }

  private validation() {
    return new BadRequestException({
      code: 'VALIDATION_ERROR',
      message: '开箱审核参数无效',
    });
  }
  private forbidden() {
    return new ForbiddenException({
      code: 'ACTION_FORBIDDEN',
      message: '无权审核开箱',
    });
  }
  private notFound() {
    return new NotFoundException({
      code: 'RESOURCE_NOT_FOUND',
      message: '公证事项不存在或不可访问',
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
      message: '开箱审核回执不可用',
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
