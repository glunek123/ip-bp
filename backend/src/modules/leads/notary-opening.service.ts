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
import { MaterialService } from '../materials';
import { RecordNotaryOpeningDto } from './lead-notary.dto';

type OpeningPhoto = { materialId: string; contentVersionId: string };
type OpeningResult = {
  id: string;
  stage: 'UNBOX_REVIEW';
  version: number;
  opening: {
    senderName: string | null;
    senderPhone: string | null;
    senderAddress: string | null;
    recordedAt: string;
    recordedByUserId: string;
    photos: OpeningPhoto[];
  };
};

@Injectable()
export class NotaryOpeningService {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: AccessControlService,
    private readonly materials: MaterialService,
  ) {}

  async record(
    actor: ActorContext,
    matterId: string,
    idempotencyKey: string,
    input: RecordNotaryOpeningDto,
  ): Promise<OpeningResult> {
    const normalized = this.normalize(input);
    const fingerprint = createHash('sha256')
      .update(JSON.stringify({ matterId, ...normalized }))
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
                stage: true,
                version: true,
                departmentId: true,
                sourceLead: {
                  select: { responsibleUserId: true, teamId: true },
                },
              },
            });
            if (matter === null) throw this.notFound();
            const account = await tx.userAccount.findUnique({
              where: { id: actor.userId },
              select: { accountType: true, active: true },
            });
            if (account?.accountType !== 'INTERNAL' || !account.active)
              throw this.forbidden();
            try {
              await this.access.authorizeLead(
                actor,
                'notary.unbox.record',
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
                  departmentId: actor.departmentId,
                  actorUserId: actor.userId,
                  action: 'opening.record',
                  idempotencyKey,
                },
              },
            });
            if (prior !== null)
              return this.receiptResult(prior, fingerprint, matterId);
            if (matter.stage !== 'WAITING_UNBOX')
              throw new ConflictException({
                code: 'INVALID_STATE',
                message: '该公证事项当前不能登记开箱材料',
              });
            if (matter.version !== normalized.expectedVersion)
              throw this.versionConflict();
            const facts = await this.materials.assertAvailableVersions(
              tx,
              actor,
              {
                ownerType: 'NOTARY_MATTER',
                ownerId: matterId,
                category: 'NOTARY_OPENING_PHOTO',
                contentVersionIds: normalized.contentVersionIds,
                minCount: 1,
                maxCount: 50,
                leadAction: 'notary.unbox.record',
              },
            );
            const changed = await tx.notaryMatter.updateMany({
              where: {
                id: matterId,
                departmentId: actor.departmentId,
                stage: 'WAITING_UNBOX',
                version: normalized.expectedVersion,
              },
              data: {
                stage: 'UNBOX_REVIEW',
                version: normalized.expectedVersion + 1,
              },
            });
            if (changed.count !== 1) throw this.versionConflict();
            const recordedAt = new Date();
            await tx.notaryMatterOpening.create({
              data: {
                matterId,
                departmentId: actor.departmentId,
                senderName: normalized.senderName,
                senderPhone: normalized.senderPhone,
                senderAddress: normalized.senderAddress,
                recordedByUserId: actor.userId,
                recordedAt,
              },
            });
            const photos = facts.map(({ materialId, contentVersionId }) => ({
              materialId,
              contentVersionId,
            }));
            const result: OpeningResult = {
              id: matterId,
              stage: 'UNBOX_REVIEW',
              version: normalized.expectedVersion + 1,
              opening: {
                senderName: normalized.senderName,
                senderPhone: normalized.senderPhone,
                senderAddress: normalized.senderAddress,
                recordedAt: recordedAt.toISOString(),
                recordedByUserId: actor.userId,
                photos,
              },
            };
            const audit = await tx.auditEvent.create({
              data: {
                departmentId: actor.departmentId,
                actorUserId: actor.userId,
                resourceType: 'notary_matter',
                resourceId: matterId,
                action: 'notary.opening_recorded',
                details: {
                  fromStage: 'WAITING_UNBOX',
                  toStage: 'UNBOX_REVIEW',
                  fromVersion: normalized.expectedVersion,
                  toVersion: result.version,
                  contentVersionIds: normalized.contentVersionIds,
                },
              },
            });
            await this.materials.freezeReferences(tx, {
              departmentId: actor.departmentId,
              resourceType: 'notary_matter',
              resourceId: matterId,
              facts,
              actionEventId: audit.id,
            });
            await tx.notaryMatterCommandReceipt.create({
              data: {
                departmentId: actor.departmentId,
                actorUserId: actor.userId,
                action: 'opening.record',
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
        if (this.isSerializationConflict(error) || this.isUnique(error)) {
          if (attempt < 3) continue;
          throw this.versionConflict();
        }
        throw error;
      }
    }
    throw this.versionConflict();
  }

  private normalize(input: RecordNotaryOpeningDto) {
    if (
      !Number.isInteger(input.expectedVersion) ||
      input.expectedVersion < 1 ||
      !Array.isArray(input.contentVersionIds) ||
      input.contentVersionIds.length < 1 ||
      input.contentVersionIds.length > 50 ||
      new Set(input.contentVersionIds).size !==
        input.contentVersionIds.length ||
      input.contentVersionIds.some(
        (id) =>
          typeof id !== 'string' ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
            id,
          ),
      )
    )
      throw this.validation();
    const optional = (value: string | null | undefined, limit: number) => {
      if (value === undefined || value === null) return null;
      if (typeof value !== 'string') throw this.validation();
      const trimmed = value.trim();
      if (trimmed.length < 1 || trimmed.length > limit) throw this.validation();
      return trimmed;
    };
    return {
      expectedVersion: input.expectedVersion,
      contentVersionIds: [...input.contentVersionIds],
      senderName: optional(input.senderName, 200),
      senderPhone: optional(input.senderPhone, 100),
      senderAddress: optional(input.senderAddress, 500),
    };
  }

  private receiptResult(
    receipt: {
      requestFingerprint: string;
      resultMatterId: string;
      resultMatterVersion: number;
      resultSnapshot: Prisma.JsonValue;
    },
    fingerprint: string,
    matterId: string,
  ): OpeningResult {
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
    const opening = result.opening;
    if (
      result.id !== matterId ||
      result.stage !== 'UNBOX_REVIEW' ||
      result.version !== receipt.resultMatterVersion ||
      opening === null ||
      typeof opening !== 'object' ||
      Array.isArray(opening)
    )
      throw this.corruptReceipt();
    const record = opening as Record<string, unknown>;
    if (
      !['senderName', 'senderPhone', 'senderAddress'].every(
        (field) => record[field] === null || typeof record[field] === 'string',
      ) ||
      typeof record.recordedAt !== 'string' ||
      typeof record.recordedByUserId !== 'string' ||
      !Array.isArray(record.photos) ||
      record.photos.length < 1 ||
      record.photos.length > 50 ||
      !record.photos.every(
        (photo) =>
          photo !== null &&
          typeof photo === 'object' &&
          typeof photo.materialId === 'string' &&
          typeof photo.contentVersionId === 'string',
      )
    )
      throw this.corruptReceipt();
    return value as OpeningResult;
  }

  private validation() {
    return new BadRequestException({
      code: 'VALIDATION_ERROR',
      message: '开箱材料参数无效',
    });
  }
  private forbidden() {
    return new ForbiddenException({
      code: 'ACTION_FORBIDDEN',
      message: '无权登记开箱材料',
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
      message: '开箱回执不可用',
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
    const record = error as { code?: unknown; cause?: unknown; meta?: unknown };
    if (record.code === 'P2034' || record.code === '40001') return true;
    const meta = record.meta as
      | {
          driverAdapterError?: {
            cause?: { originalCode?: unknown; sqlState?: unknown };
          };
        }
      | undefined;
    if (
      meta?.driverAdapterError?.cause?.originalCode === '40001' ||
      meta?.driverAdapterError?.cause?.sqlState === '40001'
    )
      return true;
    return this.isSerializationConflict(record.cause);
  }
}
