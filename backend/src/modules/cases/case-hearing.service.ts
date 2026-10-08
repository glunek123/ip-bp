import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { AccessControlService } from '../../access-control/access-control.service';
import { ActorContext } from '../../access-control/actor-context';
import { currentLawyerBindingId } from '../../access-control/lawyer-case-access';
import { DatabaseService } from '../../database/database.service';
import { hearingIsDue } from './case-hearing-date';
import {
  CaseHearingCommandResultDto,
  CorrectCaseHearingDto,
  SaveCaseHearingDto,
} from './case-hearing.dto';
import {
  CASE_HEARING_CLOCK,
  CaseHearingClock,
  CaseHearingSignal,
} from './case-hearing-signal';

const shanghai = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const businessDate = (date: Date) => {
  const parts = shanghai.formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
};
const isoDate = (date: Date | null) => date?.toISOString().slice(0, 10) ?? null;

@Injectable()
export class CaseHearingService {
  private readonly logger = new Logger(CaseHearingService.name);
  constructor(
    private readonly database: DatabaseService,
    private readonly access: AccessControlService,
    private readonly signal: CaseHearingSignal,
    @Inject(CASE_HEARING_CLOCK) private readonly clock: CaseHearingClock,
  ) {}

  async schedule(
    actor: ActorContext,
    caseId: string,
    input: SaveCaseHearingDto,
  ): Promise<CaseHearingCommandResultDto> {
    return this.command('SCHEDULE', actor, caseId, input);
  }

  async correct(
    actor: ActorContext,
    caseId: string,
    input: CorrectCaseHearingDto,
  ): Promise<CaseHearingCommandResultDto> {
    return this.command('CORRECT', actor, caseId, input);
  }

  private normalize(input: SaveCaseHearingDto, action: 'SCHEDULE' | 'CORRECT') {
    const key = input.idempotencyKey;
    const date = input.hearingAt;
    const parsed =
      typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(date)
        ? new Date(`${date}T00:00:00.000Z`)
        : null;
    const reason =
      action === 'CORRECT' &&
      'reason' in input &&
      typeof input.reason === 'string'
        ? input.reason.trim()
        : null;
    if (
      !Number.isInteger(input.expectedVersion) ||
      input.expectedVersion < 1 ||
      typeof key !== 'string' ||
      key.length < 1 ||
      key.length > 128 ||
      key.trim() !== key ||
      (date !== null &&
        (parsed === null ||
          Number.isNaN(parsed.getTime()) ||
          isoDate(parsed) !== date)) ||
      (action === 'CORRECT' &&
        (reason === null || reason.length < 1 || reason.length > 500))
    )
      throw this.validation();
    return {
      expectedVersion: input.expectedVersion,
      idempotencyKey: key,
      hearingAt: date,
      ...(action === 'CORRECT' ? { reason } : {}),
    };
  }

  private async command(
    action: 'SCHEDULE' | 'CORRECT',
    actor: ActorContext,
    caseId: string,
    input: SaveCaseHearingDto | CorrectCaseHearingDto,
  ): Promise<CaseHearingCommandResultDto> {
    const value = this.normalize(input, action);
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
        const result = await this.database.$transaction(
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
                acceptance: { select: { acceptedAt: true } },
                currentHearingArrangementId: true,
                currentHearingAdvanceId: true,
                currentJudgmentId: true,
              },
            });
            if (record === null) throw this.notFound();
            const account = await tx.userAccount.findUnique({
              where: { id: actor.userId },
              select: { active: true, accountType: true },
            });
            if (!account?.active) throw this.forbidden();
            let lawyerBindingId: string | undefined;
            if (action === 'SCHEDULE' && account.accountType === 'LAWYER')
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
                  action === 'SCHEDULE'
                    ? 'case.hearing.schedule'
                    : 'case.hearing.correct',
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
            const prior = await tx.caseHearingReceipt.findUnique({
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
              record.acceptance === null ||
              (action === 'SCHEDULE' && record.stage !== 'WAITING_HEARING') ||
              (action === 'CORRECT' &&
                (record.stage !== 'WAITING_JUDGMENT' ||
                  record.currentJudgmentId != null))
            )
              throw this.invalidState();
            if (record.version !== value.expectedVersion)
              throw this.versionConflict();
            if (
              value.hearingAt !== null &&
              value.hearingAt < isoDate(record.acceptance.acceptedAt)!
            )
              throw this.validation();
            let priorAdvanceId: string | null = null;
            if (action === 'CORRECT') {
              if (
                record.currentHearingArrangementId === null ||
                record.currentHearingAdvanceId === null
              )
                throw this.invalidState();
              const advance = await tx.caseHearingAdvance.findUnique({
                where: { id: record.currentHearingAdvanceId },
                select: { id: true, caseId: true, arrangementId: true },
              });
              if (advance?.caseId !== caseId) throw this.invalidState();
              priorAdvanceId = advance.id;
            }
            const recordedAt = this.clock.now();
            const newStage =
              action === 'CORRECT' && hearingIsDue(value.hearingAt, recordedAt)
                ? 'WAITING_JUDGMENT'
                : 'WAITING_HEARING';
            const arrangementId = randomUUID();
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
                  action === 'SCHEDULE'
                    ? 'case.hearing.scheduled'
                    : 'case.hearing.corrected',
                details: {
                  arrangementId,
                  hearingAt: value.hearingAt,
                  fromVersion: value.expectedVersion,
                  toVersion: value.expectedVersion + 1,
                  ...(action === 'CORRECT'
                    ? {
                        reason: value.reason,
                        priorArrangementId: record.currentHearingArrangementId,
                        priorAdvanceId,
                        resultStage: newStage,
                      }
                    : {}),
                },
              },
              select: { id: true },
            });
            await tx.caseHearingArrangement.create({
              data: {
                id: arrangementId,
                departmentId: actor.departmentId,
                caseId,
                hearingAt:
                  value.hearingAt === null
                    ? null
                    : new Date(`${value.hearingAt}T00:00:00.000Z`),
                source: action === 'SCHEDULE' ? 'SCHEDULE' : 'CORRECTION',
                recordedAt,
                recordedByUserId: actor.userId,
                fromVersion: value.expectedVersion,
                toVersion: value.expectedVersion + 1,
                auditEventId: audit.id,
              },
            });
            if (action === 'CORRECT')
              await tx.caseHearingCorrection.create({
                data: {
                  departmentId: actor.departmentId,
                  caseId,
                  priorArrangementId: record.currentHearingArrangementId!,
                  priorAdvanceId: priorAdvanceId!,
                  newArrangementId: arrangementId,
                  reason: value.reason!,
                  recordedAt,
                  recordedByUserId: actor.userId,
                  fromVersion: value.expectedVersion,
                  toVersion: value.expectedVersion + 1,
                  resultStage: newStage,
                  auditEventId: audit.id,
                },
              });
            const updated = await tx.case.updateMany({
              where: {
                id: caseId,
                departmentId: actor.departmentId,
                stage: record.stage,
                version: value.expectedVersion,
              },
              data: {
                stage: newStage,
                version: { increment: 1 },
                currentHearingArrangementId: arrangementId,
                currentHearingAdvanceId:
                  newStage === 'WAITING_JUDGMENT' ? priorAdvanceId : null,
              },
            });
            if (updated.count !== 1) throw this.versionConflict();
            const result: CaseHearingCommandResultDto = {
              id: caseId,
              stage: newStage,
              version: value.expectedVersion + 1,
              arrangementId,
              hearingAt: value.hearingAt,
              recordedAt: recordedAt.toISOString(),
            };
            await tx.caseHearingReceipt.create({
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
        if (action === 'SCHEDULE' || result.stage === 'WAITING_HEARING') {
          try {
            this.signal.wake();
          } catch {
            /* the next persistent scan retries */
          }
        }
        return result;
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

  async advanceDue(now: Date): Promise<{ advanced: number; failed: number }> {
    const today = businessDate(now);
    const candidates = await this.database.case.findMany({
      where: {
        stage: 'WAITING_HEARING',
        currentHearingArrangement: {
          is: { hearingAt: { lt: new Date(`${today}T00:00:00.000Z`) } },
        },
      },
      select: { id: true, departmentId: true },
    });
    let advanced = 0,
      failed = 0;
    for (const candidate of candidates) {
      try {
        const changed = await this.database.$transaction(
          async (tx) => {
            const locked = await tx.$queryRawUnsafe<Array<{ id: string }>>(
              'SELECT "id" FROM "cases" WHERE "id" = $1::uuid AND "department_id" = $2::uuid FOR UPDATE',
              candidate.id,
              candidate.departmentId,
            );
            if (locked.length !== 1) return false;
            const record = await tx.case.findFirst({
              where: { id: candidate.id, departmentId: candidate.departmentId },
              select: {
                stage: true,
                version: true,
                currentHearingArrangementId: true,
                currentHearingAdvanceId: true,
                currentHearingArrangement: {
                  select: { id: true, hearingAt: true, toVersion: true },
                },
              },
            });
            const arrangement = record?.currentHearingArrangement;
            if (
              record?.stage !== 'WAITING_HEARING' ||
              record.currentHearingAdvanceId !== null ||
              arrangement?.hearingAt == null ||
              record.version !== arrangement.toVersion
            )
              return false;
            const prior = await tx.caseHearingAdvance.findUnique({
              where: { arrangementId: arrangement.id },
              select: { id: true },
            });
            if (prior !== null) return false;
            const due = await tx.$queryRawUnsafe<Array<{ due_at: Date }>>(
              'SELECT (("hearing_at" + 1)::timestamp AT TIME ZONE \'Asia/Shanghai\') AS due_at FROM "case_hearing_arrangements" WHERE "id" = $1::uuid',
              arrangement.id,
            );
            const executedAt = this.clock.now();
            if (
              due.length !== 1 ||
              due[0].due_at > executedAt ||
              !hearingIsDue(isoDate(arrangement.hearingAt), executedAt)
            )
              return false;
            const advanceId = randomUUID();
            const audit = await tx.auditEvent.create({
              data: {
                departmentId: candidate.departmentId,
                actorKind: 'SYSTEM',
                resourceType: 'CASE',
                resourceId: candidate.id,
                action: 'case.hearing.auto_advanced',
                details: {
                  advanceId,
                  arrangementId: arrangement.id,
                  dueAt: due[0].due_at.toISOString(),
                  executedAt: executedAt.toISOString(),
                  fromVersion: record.version,
                  toVersion: record.version + 1,
                },
              },
              select: { id: true },
            });
            await tx.caseHearingAdvance.create({
              data: {
                id: advanceId,
                departmentId: candidate.departmentId,
                caseId: candidate.id,
                arrangementId: arrangement.id,
                dueAt: due[0].due_at,
                executedAt,
                fromVersion: record.version,
                toVersion: record.version + 1,
                auditEventId: audit.id,
              },
            });
            const updated = await tx.case.updateMany({
              where: {
                id: candidate.id,
                departmentId: candidate.departmentId,
                stage: 'WAITING_HEARING',
                version: record.version,
                currentHearingArrangementId: arrangement.id,
              },
              data: {
                stage: 'WAITING_JUDGMENT',
                version: { increment: 1 },
                currentHearingAdvanceId: advanceId,
              },
            });
            if (updated.count !== 1) throw this.versionConflict();
            return true;
          },
          { isolationLevel: 'Serializable' },
        );
        if (changed) advanced++;
      } catch (error) {
        failed++;
        this.logger.error(
          `Hearing advance failed case=${candidate.id} code=${this.safeErrorCode(error)}`,
        );
      }
    }
    return { advanced, failed };
  }

  private receipt(
    snapshot: unknown,
    caseId: string,
  ): CaseHearingCommandResultDto {
    if (
      snapshot === null ||
      typeof snapshot !== 'object' ||
      Array.isArray(snapshot)
    )
      throw this.corruptReceipt();
    const item = snapshot as Record<string, unknown>;
    if (
      item.id !== caseId ||
      (item.stage !== 'WAITING_HEARING' && item.stage !== 'WAITING_JUDGMENT') ||
      typeof item.version !== 'number' ||
      !Number.isInteger(item.version) ||
      typeof item.arrangementId !== 'string' ||
      (item.hearingAt !== null && typeof item.hearingAt !== 'string') ||
      typeof item.recordedAt !== 'string'
    )
      throw this.corruptReceipt();
    return {
      id: item.id as string,
      stage: item.stage as 'WAITING_HEARING' | 'WAITING_JUDGMENT',
      version: item.version as number,
      arrangementId: item.arrangementId as string,
      hearingAt: item.hearingAt as string | null,
      recordedAt: item.recordedAt as string,
    };
  }
  private validation() {
    return new BadRequestException({
      code: 'VALIDATION_ERROR',
      message: '开庭安排参数无效',
    });
  }
  private forbidden() {
    return new ForbiddenException({
      code: 'ACTION_FORBIDDEN',
      message: '无权办理开庭安排',
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
      message: '案件阶段或推进来源不允许此操作',
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
      message: '幂等键已用于其他开庭请求',
    });
  }
  private corruptReceipt() {
    return new InternalServerErrorException({
      code: 'RECEIPT_CORRUPT',
      message: '开庭回执不可用',
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

  private safeErrorCode(error: unknown): string {
    if (error === null || typeof error !== 'object') return 'UNKNOWN';
    const value = error as {
      code?: unknown;
      cause?: unknown;
      meta?: {
        driverAdapterError?: {
          cause?: { originalCode?: unknown; sqlState?: unknown };
        };
      };
    };
    for (const candidate of [
      value.code,
      value.meta?.driverAdapterError?.cause?.originalCode,
      value.meta?.driverAdapterError?.cause?.sqlState,
    ]) {
      if (typeof candidate === 'string' && /^[A-Z0-9_]{1,16}$/u.test(candidate))
        return candidate;
    }
    return this.safeErrorCode(value.cause);
  }
}
