import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { AccessControlService } from '../../access-control/access-control.service';
import { ActorContext } from '../../access-control/actor-context';
import { DatabaseService } from '../../database/database.service';
import { Prisma } from '../../generated/prisma/client';
import { MaterialService } from '../materials';
import {
  ConfirmCaseComplaintDto,
  ConfirmCaseComplaintResponseDto,
} from './case-complaint-confirmation.dto';

@Injectable()
export class CaseComplaintConfirmationService {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: AccessControlService,
    private readonly materials: MaterialService,
  ) {}

  async confirm(
    actor: ActorContext,
    caseId: string,
    input: ConfirmCaseComplaintDto,
  ): Promise<ConfirmCaseComplaintResponseDto> {
    const normalized = this.normalize(input);
    if (
      actor.clientCustomerId !== undefined ||
      actor.notaryOfficeId !== undefined
    )
      throw this.forbidden();
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify({ caseId, ...normalized, idempotencyKey: undefined }),
      )
      .digest('hex');
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.database.$transaction(
          async (tx) => {
            const locked = await tx.$queryRawUnsafe<Array<{ id: string }>>(
              'SELECT "id" FROM "cases" WHERE "id" = $1::uuid AND "department_id" = $2::uuid FOR UPDATE',
              caseId,
              actor.departmentId,
            );
            if (locked.length !== 1) throw this.notFound();
            const record = await tx.case.findFirst({
              where: { id: caseId, departmentId: actor.departmentId },
              select: {
                id: true,
                departmentId: true,
                stage: true,
                version: true,
                responsibleUserId: true,
                responsibleMembership: { select: { teamId: true } },
                complaintAmountState: true,
                complaintAmount: true,
                complaintPendingReason: true,
              },
            });
            if (record === null) throw this.notFound();
            const account = await tx.userAccount.findUnique({
              where: { id: actor.userId },
              select: { accountType: true, active: true },
            });
            if (account?.accountType !== 'INTERNAL' || !account.active)
              throw this.forbidden();
            try {
              await this.access.authorizeCase(
                actor,
                'case.complaint.confirm',
                {
                  departmentId: record.departmentId,
                  responsibleUserId: record.responsibleUserId,
                  ...(record.responsibleMembership.teamId
                    ? { teamId: record.responsibleMembership.teamId }
                    : {}),
                },
                tx,
              );
            } catch (error) {
              if (error instanceof ForbiddenException) throw this.forbidden();
              throw error;
            }
            const prior = await tx.caseComplaintConfirmationReceipt.findUnique({
              where: {
                departmentId_actorUserId_idempotencyKey: {
                  departmentId: actor.departmentId,
                  actorUserId: actor.userId,
                  idempotencyKey: normalized.idempotencyKey,
                },
              },
            });
            if (prior !== null) {
              if (
                prior.caseId !== caseId ||
                prior.requestFingerprint !== fingerprint
              )
                throw this.idempotencyConflict();
              const snapshot =
                prior.resultSnapshot as Partial<ConfirmCaseComplaintResponseDto>;
              if (
                snapshot.id !== caseId ||
                snapshot.stage !== 'WAITING_COMPLAINT_STAMP' ||
                !Number.isInteger(snapshot.version) ||
                typeof snapshot.confirmedAt !== 'string'
              )
                throw this.corruptReceipt();
              return snapshot as ConfirmCaseComplaintResponseDto;
            }
            if (record.stage !== 'WAITING_COMPLAINT_CONFIRMATION')
              throw this.invalidState();
            if (record.version !== normalized.expectedVersion)
              throw this.versionConflict();
            const complaint = await this.materials.assertAvailableVersions(
              tx,
              actor,
              {
                ownerType: 'CASE',
                ownerId: caseId,
                category: 'COMPLAINT',
                contentVersionIds: [
                  normalized.confirmedComplaintContentVersionId,
                ],
                minCount: 1,
                maxCount: 1,
              },
            );
            const submittedIds =
              await this.materials.listSubmittedCaseComplaintVersionIds(
                tx,
                actor,
                caseId,
              );
            const priorAmount =
              record.complaintAmount === null
                ? null
                : new Prisma.Decimal(record.complaintAmount.toString()).toFixed(
                    2,
                  );
            const changed =
              !submittedIds.includes(
                normalized.confirmedComplaintContentVersionId,
              ) ||
              record.complaintAmountState !== normalized.amountState ||
              priorAmount !== normalized.amount ||
              record.complaintPendingReason !== normalized.pendingReason;
            if (changed && normalized.changeNote === null)
              throw this.validation();
            const confirmedAt = new Date();
            const updated = await tx.case.updateMany({
              where: {
                id: caseId,
                departmentId: actor.departmentId,
                stage: 'WAITING_COMPLAINT_CONFIRMATION',
                version: normalized.expectedVersion,
              },
              data: {
                stage: 'WAITING_COMPLAINT_STAMP',
                version: { increment: 1 },
              },
            });
            if (updated.count !== 1) throw this.versionConflict();
            const audit = await tx.auditEvent.create({
              data: {
                departmentId: actor.departmentId,
                actorUserId: actor.userId,
                internalActorUserId: actor.userId,
                resourceType: 'CASE',
                resourceId: caseId,
                action: 'case.complaint.confirmed',
                details: {
                  fromVersion: normalized.expectedVersion,
                  toVersion: normalized.expectedVersion + 1,
                  confirmedComplaintContentVersionId:
                    normalized.confirmedComplaintContentVersionId,
                  amountState: normalized.amountState,
                  amount: normalized.amount,
                  pendingReason: normalized.pendingReason,
                  changeNote: normalized.changeNote,
                  confirmDisclose: normalized.confirmDisclose,
                },
              },
              select: { id: true },
            });
            await this.materials.freezeCaseComplaintConfirmationReference(
              tx,
              actor,
              caseId,
              complaint[0],
              audit.id,
            );
            await tx.caseComplaintConfirmation.create({
              data: {
                departmentId: actor.departmentId,
                caseId,
                confirmedComplaintContentVersionId:
                  normalized.confirmedComplaintContentVersionId,
                amountState: normalized.amountState,
                amount: normalized.amount,
                pendingReason: normalized.pendingReason,
                changeNote: normalized.changeNote,
                confirmDisclose: normalized.confirmDisclose,
                confirmedByUserId: actor.userId,
                confirmedAt,
                auditEventId: audit.id,
              },
            });
            const result: ConfirmCaseComplaintResponseDto = {
              id: caseId,
              stage: 'WAITING_COMPLAINT_STAMP',
              version: normalized.expectedVersion + 1,
              confirmedAt: confirmedAt.toISOString(),
            };
            await tx.caseComplaintConfirmationReceipt.create({
              data: {
                departmentId: actor.departmentId,
                actorUserId: actor.userId,
                caseId,
                idempotencyKey: normalized.idempotencyKey,
                requestFingerprint: fingerprint,
                resultSnapshot: { ...result },
              },
            });
            return result;
          },
          { isolationLevel: 'Serializable' },
        );
      } catch (error) {
        if (this.hasCode(error, 'P2034') || this.hasCode(error, '40001')) {
          if (attempt < 2) continue;
          throw this.versionConflict();
        }
        if (this.hasCode(error, 'P2002')) throw this.idempotencyConflict();
        throw error;
      }
    }
    throw this.versionConflict();
  }

  private normalize(input: ConfirmCaseComplaintDto): ConfirmCaseComplaintDto & {
    amount: string | null;
    pendingReason: string | null;
    changeNote: string | null;
  } {
    if (
      !Number.isInteger(input.expectedVersion) ||
      input.expectedVersion < 1 ||
      typeof input.idempotencyKey !== 'string' ||
      input.idempotencyKey.trim() !== input.idempotencyKey ||
      input.idempotencyKey.length < 1 ||
      input.idempotencyKey.length > 128 ||
      typeof input.confirmedComplaintContentVersionId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
        input.confirmedComplaintContentVersionId,
      ) ||
      typeof input.confirmDisclose !== 'boolean' ||
      (input.changeNote !== undefined &&
        input.changeNote !== null &&
        (typeof input.changeNote !== 'string' ||
          input.changeNote.trim() !== input.changeNote ||
          input.changeNote.length < 1 ||
          input.changeNote.length > 500))
    )
      throw this.validation();
    const changeNote = input.changeNote ?? null;
    if (input.amountState === 'KNOWN') {
      if (
        typeof input.amount !== 'string' ||
        !/^(0|[1-9]\d{0,13})(\.\d{1,2})?$/u.test(input.amount) ||
        (input.pendingReason !== null && input.pendingReason !== undefined)
      )
        throw this.validation();
      return {
        ...input,
        amount: new Prisma.Decimal(input.amount).toFixed(2),
        pendingReason: null,
        changeNote,
      };
    }
    if (
      input.amountState !== 'PENDING' ||
      (input.amount !== null && input.amount !== undefined) ||
      typeof input.pendingReason !== 'string' ||
      input.pendingReason.trim() !== input.pendingReason ||
      input.pendingReason.length < 1 ||
      input.pendingReason.length > 500
    )
      throw this.validation();
    return {
      ...input,
      amount: null,
      pendingReason: input.pendingReason,
      changeNote,
    };
  }
  private validation() {
    return new BadRequestException({
      code: 'VALIDATION_ERROR',
      message: '诉状确认参数无效',
    });
  }
  private forbidden() {
    return new ForbiddenException({
      code: 'ACTION_FORBIDDEN',
      message: '无权确认诉状',
    });
  }
  private notFound() {
    return new NotFoundException({
      code: 'RESOURCE_NOT_FOUND',
      message: '案件不存在或不可访问',
    });
  }
  private invalidState() {
    return new ConflictException({
      code: 'INVALID_STATE',
      message: '案件当前不能确认诉状',
    });
  }
  private versionConflict() {
    return new ConflictException({
      code: 'VERSION_CONFLICT',
      message: '案件状态或版本已变化',
    });
  }
  private idempotencyConflict() {
    return new ConflictException({
      code: 'IDEMPOTENCY_CONFLICT',
      message: '幂等键已用于其他诉状确认请求',
    });
  }
  private corruptReceipt() {
    return new InternalServerErrorException({
      code: 'RECEIPT_CORRUPT',
      message: '诉状确认回执不可用',
    });
  }
  private hasCode(error: unknown, code: string): boolean {
    if (error === null || typeof error !== 'object') return false;
    const value = error as {
      code?: unknown;
      cause?: unknown;
      meta?: {
        driverAdapterError?: {
          cause?: { originalCode?: unknown; sqlState?: unknown };
        };
      };
    };
    return (
      value.code === code ||
      value.meta?.driverAdapterError?.cause?.originalCode === code ||
      value.meta?.driverAdapterError?.cause?.sqlState === code ||
      this.hasCode(value.cause, code)
    );
  }
}
