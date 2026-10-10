import { createHash, randomUUID } from 'node:crypto';
import {
  BadRequestException, ConflictException, ForbiddenException, Injectable,
  InternalServerErrorException, NotFoundException,
} from '@nestjs/common';
import { AccessControlService } from '../../access-control/access-control.service';
import { ActorContext } from '../../access-control/actor-context';
import { currentLawyerBindingId } from '../../access-control/lawyer-case-access';
import { DatabaseService } from '../../database/database.service';
import { Prisma } from '../../generated/prisma/client';
import {
  ChooseJudgmentNextStepDto, JudgmentNextStepResultDto,
  RevokeJudgmentNextStepDto, RevokeJudgmentNextStepResultDto,
} from './case-judgment-next-step.dto';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
type Action = 'CHOOSE' | 'REVOKE';
type Result = JudgmentNextStepResultDto | RevokeJudgmentNextStepResultDto;

@Injectable()
export class CaseJudgmentNextStepService {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: AccessControlService,
  ) {}

  choose(actor: ActorContext, caseId: string, input: ChooseJudgmentNextStepDto): Promise<JudgmentNextStepResultDto> {
    return this.command('CHOOSE', actor, caseId, input) as Promise<JudgmentNextStepResultDto>;
  }

  revoke(actor: ActorContext, caseId: string, input: RevokeJudgmentNextStepDto): Promise<RevokeJudgmentNextStepResultDto> {
    return this.command('REVOKE', actor, caseId, input) as Promise<RevokeJudgmentNextStepResultDto>;
  }

  private async command(
    action: Action,
    actor: ActorContext,
    caseId: string,
    input: ChooseJudgmentNextStepDto | RevokeJudgmentNextStepDto,
  ): Promise<Result> {
    const value = this.normalize(action, input);
    if (actor.clientCustomerId !== undefined || actor.notaryOfficeId !== undefined) throw this.forbidden();
    const fingerprint = createHash('sha256').update(JSON.stringify({ action, caseId, ...value })).digest('hex');
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.database.$transaction(async (tx) => {
          const locked = await tx.$queryRawUnsafe<Array<{ id: string }>>(
            'SELECT "id" FROM "cases" WHERE "id" = $1::uuid AND "department_id" = $2::uuid FOR UPDATE',
            caseId, actor.departmentId,
          );
          if (locked.length !== 1) throw this.notFound();
          const record = await tx.case.findFirst({
            where: { id: caseId, departmentId: actor.departmentId },
            select: {
              id: true, departmentId: true, stage: true, version: true,
              currentJudgmentId: true, currentJudgmentNextStepId: true,
              currentJudgmentNextStep: { select: { id: true, judgmentId: true, next: true } },
              rightsHolderId: true, rightsHolder: { select: { name: true } },
              defendants: { select: { id: true, name: true } },
              responsibleUserId: true, responsibleMembership: { select: { teamId: true } },
            },
          });
          if (record === null) throw this.notFound();
          const account = await tx.userAccount.findUnique({
            where: { id: actor.userId }, select: { active: true, accountType: true },
          });
          if (!account?.active) throw this.forbidden();
          let lawyerBindingId: string | undefined;
          if (action === 'CHOOSE' && account.accountType === 'LAWYER') {
            lawyerBindingId = await currentLawyerBindingId(tx, actor, caseId, true);
          } else if (account.accountType === 'INTERNAL' && actor.lawyerAccountId === undefined) {
            try {
              await this.access.authorizeCase(actor,
                action === 'CHOOSE' ? 'case.judgment.next_step' : 'case.judgment.next_step.revoke',
                {
                  departmentId: record.departmentId,
                  responsibleUserId: record.responsibleUserId,
                  ...(record.responsibleMembership.teamId ? { teamId: record.responsibleMembership.teamId } : {}),
                }, tx,
              );
            } catch (error) {
              if (error instanceof ForbiddenException) throw this.forbidden();
              throw error;
            }
          } else throw this.forbidden();
          const prior = await tx.caseJudgmentNextStepReceipt.findUnique({
            where: { departmentId_actorUserId_action_idempotencyKey: {
              departmentId: actor.departmentId, actorUserId: actor.userId,
              action, idempotencyKey: value.idempotencyKey,
            } },
          });
          if (prior !== null) {
            if (prior.caseId !== caseId || prior.requestFingerprint !== fingerprint) throw this.idempotencyConflict();
            return this.receipt(action, prior.resultSnapshot, caseId);
          }
          if (record.version !== value.expectedVersion) throw this.versionConflict();
          const recordedAt = new Date();
          const auditId = randomUUID();
          if (action === 'CHOOSE' && 'next' in value) {
            if (record.stage !== 'WAITING_JUDGMENT' || record.currentJudgmentId === null || record.currentJudgmentNextStepId !== null) throw this.invalidState();
            if (record.currentJudgmentId !== value.judgmentId) throw this.versionConflict();
            const defendants = value.next === 'APPEAL'
              ? value.defendantIds.map((id) => record.defendants.find((defendant) => defendant.id === id))
              : [];
            if (defendants.some((defendant) => defendant === undefined)) throw this.validation();
            const choiceId = randomUUID();
            const stage = value.next === 'APPEAL' ? 'SECOND_INSTANCE' : 'WAITING_EXECUTION_DOCUMENTS';
            await tx.auditEvent.create({ data: {
              id: auditId, departmentId: actor.departmentId, actorUserId: actor.userId,
              ...(lawyerBindingId === undefined ? { internalActorUserId: actor.userId } : { lawyerAccountBindingId: lawyerBindingId }),
              resourceType: 'CASE', resourceId: caseId, action: 'case.judgment.next_step',
              details: { choiceId, judgmentId: value.judgmentId, next: value.next, fromVersion: value.expectedVersion,
                toVersion: value.expectedVersion + 1, plaintiffAppeals: value.plaintiffAppeals,
                defendantIds: value.defendantIds, executionReadinessConfirmed: value.executionReadinessConfirmed },
            } });
            await tx.caseJudgmentNextStep.create({ data: {
              id: choiceId, caseId, departmentId: actor.departmentId, judgmentId: value.judgmentId,
              next: value.next, plaintiffRightsHolderId: value.plaintiffAppeals ? record.rightsHolderId : null,
              plaintiffName: value.plaintiffAppeals ? record.rightsHolder.name : null,
              executionReadinessConfirmed: value.executionReadinessConfirmed,
              fromVersion: value.expectedVersion, toVersion: value.expectedVersion + 1,
              recordedAt, recordedByUserId: actor.userId, auditEventId: auditId,
            } });
            if (defendants.length > 0) {
              await tx.caseJudgmentAppealDefendant.createMany({ data: defendants.map((defendant) => ({
                choiceId, caseId, departmentId: actor.departmentId,
                defendantId: defendant!.id, nameSnapshot: defendant!.name,
              })) });
            }
            const updated = await tx.case.updateMany({ where: {
              id: caseId, departmentId: actor.departmentId, stage: 'WAITING_JUDGMENT', version: value.expectedVersion,
              currentJudgmentId: value.judgmentId, currentJudgmentNextStepId: null,
            }, data: { stage, version: { increment: 1 }, currentJudgmentNextStepId: choiceId } });
            if (updated.count !== 1) throw this.versionConflict();
            const result: JudgmentNextStepResultDto = {
              id: caseId, stage, version: value.expectedVersion + 1,
              choiceId, judgmentId: value.judgmentId, recordedAt: recordedAt.toISOString(),
            };
            await tx.caseJudgmentNextStepReceipt.create({ data: {
              departmentId: actor.departmentId, actorUserId: actor.userId, caseId,
              action, idempotencyKey: value.idempotencyKey, requestFingerprint: fingerprint,
              resultSnapshot: { ...result },
            } });
            return result;
          }
          if (action !== 'REVOKE' || !('choiceId' in value)) throw this.validation();
          const choice = record.currentJudgmentNextStep;
          if (choice === null || choice === undefined || record.currentJudgmentNextStepId !== value.choiceId ||
              (record.stage !== 'SECOND_INSTANCE' && record.stage !== 'WAITING_EXECUTION_DOCUMENTS') ||
              record.stage !== (choice.next === 'APPEAL' ? 'SECOND_INSTANCE' : 'WAITING_EXECUTION_DOCUMENTS')) throw this.invalidState();
          const revocationId = randomUUID();
          await tx.auditEvent.create({ data: {
            id: auditId, departmentId: actor.departmentId, actorUserId: actor.userId, internalActorUserId: actor.userId,
            resourceType: 'CASE', resourceId: caseId, action: 'case.judgment.next_step.revoke',
            details: { choiceId: value.choiceId, revocationId, reason: value.reason,
              fromVersion: value.expectedVersion, toVersion: value.expectedVersion + 1 },
          } });
          await tx.caseJudgmentNextStepRevocation.create({ data: {
            id: revocationId, choiceId: value.choiceId, caseId, departmentId: actor.departmentId,
            reason: value.reason, fromVersion: value.expectedVersion, toVersion: value.expectedVersion + 1,
            recordedAt, recordedByUserId: actor.userId, auditEventId: auditId,
          } });
          const updated = await tx.case.updateMany({ where: {
            id: caseId, departmentId: actor.departmentId, stage: record.stage,
            version: value.expectedVersion, currentJudgmentNextStepId: value.choiceId,
          }, data: { stage: 'WAITING_JUDGMENT', version: { increment: 1 }, currentJudgmentNextStepId: null } });
          if (updated.count !== 1) throw this.versionConflict();
          const result: RevokeJudgmentNextStepResultDto = {
            id: caseId, stage: 'WAITING_JUDGMENT', version: value.expectedVersion + 1,
            choiceId: value.choiceId, revocationId, judgmentId: choice.judgmentId,
            recordedAt: recordedAt.toISOString(),
          };
          await tx.caseJudgmentNextStepReceipt.create({ data: {
            departmentId: actor.departmentId, actorUserId: actor.userId, caseId,
            action, idempotencyKey: value.idempotencyKey, requestFingerprint: fingerprint,
            resultSnapshot: { ...result },
          } });
          return result;
        }, { isolationLevel: 'Serializable' });
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

  private normalize(action: Action, input: ChooseJudgmentNextStepDto | RevokeJudgmentNextStepDto) {
    if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1 ||
        typeof input.idempotencyKey !== 'string' || input.idempotencyKey.length < 1 ||
        input.idempotencyKey.length > 128 || input.idempotencyKey.trim() !== input.idempotencyKey) throw this.validation();
    if (action === 'REVOKE') {
      if (!('choiceId' in input) || typeof input.choiceId !== 'string' || !uuid.test(input.choiceId) ||
          typeof input.reason !== 'string' || input.reason.trim().length < 1 || input.reason.trim().length > 500) throw this.validation();
      return { expectedVersion: input.expectedVersion, idempotencyKey: input.idempotencyKey,
        choiceId: input.choiceId, reason: input.reason.trim() };
    }
    if (!('judgmentId' in input) || typeof input.judgmentId !== 'string' || !uuid.test(input.judgmentId)) throw this.validation();
    if (input.next === 'EXECUTION') {
      if (input.executionReadinessConfirmed !== true || input.plaintiffAppeals !== undefined || input.defendantIds !== undefined) throw this.validation();
      return { expectedVersion: input.expectedVersion, idempotencyKey: input.idempotencyKey,
        judgmentId: input.judgmentId, next: 'EXECUTION' as const,
        plaintiffAppeals: false, defendantIds: [] as string[], executionReadinessConfirmed: true };
    }
    if (input.next !== 'APPEAL' || typeof input.plaintiffAppeals !== 'boolean' || !Array.isArray(input.defendantIds) ||
        input.executionReadinessConfirmed !== undefined ||
        (!input.plaintiffAppeals && input.defendantIds.length === 0) ||
        input.defendantIds.some((id) => typeof id !== 'string' || !uuid.test(id)) ||
        new Set(input.defendantIds).size !== input.defendantIds.length) throw this.validation();
    return { expectedVersion: input.expectedVersion, idempotencyKey: input.idempotencyKey,
      judgmentId: input.judgmentId, next: 'APPEAL' as const, plaintiffAppeals: input.plaintiffAppeals,
      defendantIds: [...input.defendantIds].sort(), executionReadinessConfirmed: false };
  }

  private receipt(action: Action, value: Prisma.JsonValue, caseId: string): Result {
    if (value === null || typeof value !== 'object' || Array.isArray(value) || value.id !== caseId ||
        typeof value.version !== 'number' || !Number.isInteger(value.version) ||
        typeof value.choiceId !== 'string' || !uuid.test(value.choiceId) ||
        typeof value.judgmentId !== 'string' || !uuid.test(value.judgmentId) ||
        typeof value.recordedAt !== 'string' ||
        (action === 'CHOOSE' && value.stage !== 'SECOND_INSTANCE' && value.stage !== 'WAITING_EXECUTION_DOCUMENTS') ||
        (action === 'REVOKE' && (value.stage !== 'WAITING_JUDGMENT' || typeof value.revocationId !== 'string' || !uuid.test(value.revocationId))))
      throw new InternalServerErrorException({ code: 'RECEIPT_CORRUPT', message: '判决后续选择回执不可用' });
    if (action === 'REVOKE') return { id: caseId, stage: 'WAITING_JUDGMENT', version: value.version,
      choiceId: value.choiceId, revocationId: value.revocationId as string, judgmentId: value.judgmentId,
      recordedAt: value.recordedAt };
    return { id: caseId, stage: value.stage as JudgmentNextStepResultDto['stage'],
      version: value.version, choiceId: value.choiceId, judgmentId: value.judgmentId,
      recordedAt: value.recordedAt };
  }

  private validation() { return new BadRequestException({ code: 'VALIDATION_ERROR', message: '判决后续选择参数无效' }); }
  private forbidden() { return new ForbiddenException({ code: 'ACTION_FORBIDDEN', message: '无权办理判决后续选择' }); }
  private notFound() { return new NotFoundException({ code: 'RESOURCE_NOT_FOUND', message: '案件不存在或不可访问' }); }
  private invalidState() { return new ConflictException({ code: 'INVALID_STATE', message: '案件当前不能办理判决后续选择' }); }
  private versionConflict() { return new ConflictException({ code: 'VERSION_CONFLICT', message: '案件状态、版本或判决已变化' }); }
  private idempotencyConflict() { return new ConflictException({ code: 'IDEMPOTENCY_CONFLICT', message: '幂等键已用于其他判决后续选择请求' }); }
  private hasCode(error: unknown, code: string): boolean {
    if (error === null || typeof error !== 'object') return false;
    const value = error as { code?: unknown; cause?: unknown; meta?: { driverAdapterError?: { cause?: { originalCode?: unknown; sqlState?: unknown } } } };
    return value.code === code || value.meta?.driverAdapterError?.cause?.originalCode === code ||
      value.meta?.driverAdapterError?.cause?.sqlState === code || this.hasCode(value.cause, code);
  }
}
