import { createHash, randomUUID } from 'node:crypto';
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
import { currentLawyerBindingId } from '../../access-control/lawyer-case-access';
import { DatabaseService } from '../../database/database.service';
import { Prisma } from '../../generated/prisma/client';
import { MaterialService } from '../materials';
import {
  CaseJudgmentCommandResultDto,
  CorrectCaseJudgmentDto,
  RegisterCaseJudgmentDto,
} from './case-judgment.dto';

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
type Action = 'REGISTER' | 'CORRECT';

@Injectable()
export class CaseJudgmentService {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: AccessControlService,
    private readonly materials: MaterialService,
  ) {}

  register(
    actor: ActorContext,
    caseId: string,
    input: RegisterCaseJudgmentDto,
  ) {
    return this.command('REGISTER', actor, caseId, input);
  }
  correct(actor: ActorContext, caseId: string, input: CorrectCaseJudgmentDto) {
    return this.command('CORRECT', actor, caseId, input);
  }

  private async command(
    action: Action,
    actor: ActorContext,
    caseId: string,
    input: RegisterCaseJudgmentDto | CorrectCaseJudgmentDto,
  ): Promise<CaseJudgmentCommandResultDto> {
    const value = this.normalize(action, input);
    if (
      actor.clientCustomerId !== undefined ||
      actor.notaryOfficeId !== undefined
    )
      throw this.forbidden();
    const fingerprint = createHash('sha256')
      .update(JSON.stringify({ action, caseId, ...value }))
      .digest('hex');
    for (let attempt = 0; attempt < 3; attempt++) {
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
                currentJudgmentId: true,
                responsibleUserId: true,
                responsibleMembership: { select: { teamId: true } },
                acceptance: { select: { acceptedAt: true } },
              },
            });
            if (record === null) throw this.notFound();
            const account = await tx.userAccount.findUnique({
              where: { id: actor.userId },
              select: { active: true, accountType: true },
            });
            if (!account?.active) throw this.forbidden();
            let lawyerBindingId: string | undefined;
            if (action === 'REGISTER' && account.accountType === 'LAWYER')
              lawyerBindingId = await currentLawyerBindingId(
                tx,
                actor,
                caseId,
                true,
              );
            else if (
              account.accountType === 'INTERNAL' &&
              actor.lawyerAccountId === undefined
            )
              try {
                await this.access.authorizeCase(
                  actor,
                  action === 'REGISTER'
                    ? 'case.judgment.register'
                    : 'case.judgment.correct',
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
            else throw this.forbidden();
            const prior = await tx.caseJudgmentReceipt.findUnique({
              where: {
                departmentId_actorUserId_action_idempotencyKey: {
                  departmentId: actor.departmentId,
                  actorUserId: actor.userId,
                  action,
                  idempotencyKey: value.idempotencyKey,
                },
              },
            });
            if (prior !== null) {
              if (
                prior.caseId !== caseId ||
                prior.requestFingerprint !== fingerprint
              )
                throw this.idempotencyConflict();
              return this.receipt(prior.resultSnapshot, caseId);
            }
            if (
              record.stage !== 'WAITING_JUDGMENT' ||
              record.acceptance === null ||
              (action === 'REGISTER' && record.currentJudgmentId !== null) ||
              (action === 'CORRECT' && record.currentJudgmentId === null)
            )
              throw this.invalidState();
            if (record.version !== value.expectedVersion)
              throw this.versionConflict();
            if (
              value.judgmentReceivedAt <
              record.acceptance.acceptedAt.toISOString().slice(0, 10)
            )
              throw this.validation();
            const versions = await this.materials.assertAvailableVersions(
              tx,
              actor,
              {
                ownerType: 'CASE',
                ownerId: caseId,
                category: 'JUDGMENT',
                contentVersionIds: value.judgmentContentVersionIds,
                minCount: 1,
                maxCount: 10,
              },
            );
            const judgmentId = randomUUID();
            const recordedAt = new Date();
            const audit = await tx.auditEvent.create({
              data: {
                departmentId: actor.departmentId,
                actorUserId: actor.userId,
                ...(lawyerBindingId === undefined
                  ? { internalActorUserId: actor.userId }
                  : { lawyerAccountBindingId: lawyerBindingId }),
                resourceType: 'CASE',
                resourceId: caseId,
                action:
                  action === 'REGISTER'
                    ? 'case.judgment.registered'
                    : 'case.judgment.corrected',
                details: {
                  judgmentId,
                  fromVersion: value.expectedVersion,
                  toVersion: value.expectedVersion + 1,
                  judgmentReceivedAt: value.judgmentReceivedAt,
                  judgmentAmountState: value.judgmentAmountState,
                  judgmentAmount: value.judgmentAmount,
                  paidLitigationFeeState: value.paidLitigationFeeState,
                  paidLitigationFee: value.paidLitigationFee,
                  judgmentContentVersionIds: value.judgmentContentVersionIds,
                  ...(action === 'CORRECT'
                    ? {
                        priorFactId: record.currentJudgmentId,
                        reason: value.reason,
                      }
                    : {}),
                },
              },
              select: { id: true },
            });
            await tx.caseJudgmentFact.create({
              data: {
                id: judgmentId,
                departmentId: actor.departmentId,
                caseId,
                kind: action,
                priorFactId:
                  action === 'CORRECT' ? record.currentJudgmentId : null,
                judgmentReceivedAt: new Date(
                  `${value.judgmentReceivedAt}T00:00:00.000Z`,
                ),
                judgmentAmountState: value.judgmentAmountState,
                judgmentAmount: value.judgmentAmount,
                paidLitigationFeeState: value.paidLitigationFeeState,
                paidLitigationFee: value.paidLitigationFee,
                reason: value.reason,
                recordedAt,
                recordedByUserId: actor.userId,
                fromVersion: value.expectedVersion,
                toVersion: value.expectedVersion + 1,
                auditEventId: audit.id,
              },
            });
            await this.materials.freezeCaseJudgmentReferences(
              tx,
              actor,
              caseId,
              judgmentId,
              versions,
              audit.id,
            );
            const updated = await tx.case.updateMany({
              where: {
                id: caseId,
                departmentId: actor.departmentId,
                stage: 'WAITING_JUDGMENT',
                version: value.expectedVersion,
                currentJudgmentId: record.currentJudgmentId,
              },
              data: {
                version: { increment: 1 },
                currentJudgmentId: judgmentId,
              },
            });
            if (updated.count !== 1) throw this.versionConflict();
            const result: CaseJudgmentCommandResultDto = {
              id: caseId,
              stage: 'WAITING_JUDGMENT',
              version: value.expectedVersion + 1,
              judgmentId,
              recordedAt: recordedAt.toISOString(),
            };
            await tx.caseJudgmentReceipt.create({
              data: {
                departmentId: actor.departmentId,
                actorUserId: actor.userId,
                caseId,
                action,
                idempotencyKey: value.idempotencyKey,
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

  private normalize(
    action: Action,
    input: RegisterCaseJudgmentDto | CorrectCaseJudgmentDto,
  ) {
    const date =
      typeof input.judgmentReceivedAt === 'string' &&
      /^\d{4}-\d{2}-\d{2}$/u.test(input.judgmentReceivedAt)
        ? new Date(`${input.judgmentReceivedAt}T00:00:00.000Z`)
        : null;
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    const ids = input.judgmentContentVersionIds;
    const reason =
      action === 'CORRECT' &&
      'reason' in input &&
      typeof input.reason === 'string'
        ? input.reason.trim()
        : null;
    if (
      !Number.isInteger(input.expectedVersion) ||
      input.expectedVersion < 1 ||
      typeof input.idempotencyKey !== 'string' ||
      input.idempotencyKey.trim() !== input.idempotencyKey ||
      input.idempotencyKey.length < 1 ||
      input.idempotencyKey.length > 128 ||
      date === null ||
      Number.isNaN(date.getTime()) ||
      date.toISOString().slice(0, 10) !== input.judgmentReceivedAt ||
      input.judgmentReceivedAt > today ||
      !Array.isArray(ids) ||
      ids.length < 1 ||
      ids.length > 10 ||
      ids.some((id) => typeof id !== 'string' || !uuid.test(id)) ||
      new Set(ids).size !== ids.length ||
      (action === 'CORRECT' &&
        (reason === null || reason.length < 1 || reason.length > 500))
    )
      throw this.validation();
    const judgmentAmount = this.amount(
      input.judgmentAmountState,
      input.judgmentAmount,
    );
    const paidLitigationFee = this.amount(
      input.paidLitigationFeeState,
      input.paidLitigationFee,
    );
    return {
      expectedVersion: input.expectedVersion,
      idempotencyKey: input.idempotencyKey,
      judgmentReceivedAt: input.judgmentReceivedAt,
      judgmentAmountState: input.judgmentAmountState,
      judgmentAmount,
      paidLitigationFeeState: input.paidLitigationFeeState,
      paidLitigationFee,
      judgmentContentVersionIds: [...ids].sort(),
      reason,
    };
  }

  private amount(
    state: 'KNOWN' | 'PENDING',
    amount: string | null,
  ): string | null {
    if (state === 'PENDING' && amount === null) return null;
    if (
      state === 'KNOWN' &&
      typeof amount === 'string' &&
      /^(0|[1-9]\d{0,13})(\.\d{1,2})?$/u.test(amount)
    )
      return new Prisma.Decimal(amount).toFixed(2);
    throw this.validation();
  }
  private receipt(
    value: Prisma.JsonValue,
    caseId: string,
  ): CaseJudgmentCommandResultDto {
    if (
      value === null ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      value.id !== caseId ||
      value.stage !== 'WAITING_JUDGMENT' ||
      typeof value.version !== 'number' ||
      !Number.isInteger(value.version) ||
      typeof value.judgmentId !== 'string' ||
      !uuid.test(value.judgmentId) ||
      typeof value.recordedAt !== 'string'
    )
      throw new InternalServerErrorException({
        code: 'RECEIPT_CORRUPT',
        message: '判决回执不可用',
      });
    return {
      id: value.id,
      stage: value.stage,
      version: value.version,
      judgmentId: value.judgmentId,
      recordedAt: value.recordedAt,
    };
  }
  private validation() {
    return new BadRequestException({
      code: 'VALIDATION_ERROR',
      message: '判决参数无效',
    });
  }
  private forbidden() {
    return new ForbiddenException({
      code: 'ACTION_FORBIDDEN',
      message: '无权办理判决',
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
      message: '案件当前不能办理判决',
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
      message: '幂等键已用于其他判决请求',
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
