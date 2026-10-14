import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { AccessControlService } from '../../access-control/access-control.service';
import { ActorContext } from '../../access-control/actor-context';
import { currentLawyerBindingId } from '../../access-control/lawyer-case-access';
import { DatabaseService } from '../../database/database.service';
import {
  CaseArchiveResult,
  CorrectCaseArchiveInput,
  ArchiveCaseInput,
} from './case-archive.dto';

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const failure = (code: string) => {
  const body = { code, message: '保存归档资料失败' };
  if (code === 'VALIDATION_ERROR') return new BadRequestException(body);
  if (code === 'ACTION_FORBIDDEN') return new ForbiddenException(body);
  if (code === 'CASE_NOT_FOUND') return new NotFoundException(body);
  if (code === 'INVALID_RECEIPT') return new InternalServerErrorException(body);
  return new ConflictException(body);
};

@Injectable()
export class CaseArchiveService {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: AccessControlService,
  ) {}

  archive(actor: ActorContext, caseId: string, input: ArchiveCaseInput) {
    return this.execute(actor, caseId, input, 'ARCHIVE');
  }
  correct(actor: ActorContext, caseId: string, input: CorrectCaseArchiveInput) {
    return this.execute(actor, caseId, input, 'CORRECT');
  }

  private async execute(
    actor: ActorContext,
    caseId: string,
    input: ArchiveCaseInput | CorrectCaseArchiveInput,
    command: 'ARCHIVE' | 'CORRECT',
  ): Promise<CaseArchiveResult> {
    this.validate(input, command);
    if (
      actor.clientCustomerId !== undefined ||
      actor.notaryOfficeId !== undefined
    )
      throw failure('ACTION_FORBIDDEN');
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify({
          caseId,
          command,
          expectedVersion: input.expectedVersion,
          expectedClosureVersionId: input.expectedClosureVersionId,
          expectedArchiveVersionId:
            'expectedArchiveVersionId' in input
              ? input.expectedArchiveVersionId
              : null,
          archiveAt: input.archiveAt,
          archiveType: input.archiveType,
          archiveReason: input.archiveReason,
          correctionReason:
            'correctionReason' in input ? input.correctionReason : null,
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
            if (locked.length !== 1) throw failure('CASE_NOT_FOUND');
            const record = await tx.case.findFirst({
              where: { id: caseId, departmentId: actor.departmentId },
              select: {
                departmentId: true,
                responsibleUserId: true,
                responsibleMembership: { select: { teamId: true } },
                stage: true,
                version: true,
                currentTrialRoundId: true,
                currentJudgmentNextStepId: true,
                currentSecondInstanceResultId: true,
                currentExecutionSubmissionId: true,
                currentJudgmentNextStep: {
                  select: {
                    id: true,
                    trialRoundId: true,
                    next: true,
                    revocation: { select: { id: true } },
                  },
                },
                currentSecondInstanceResult: {
                  select: {
                    id: true,
                    choiceId: true,
                    trialRoundId: true,
                    result: true,
                    revocation: { select: { id: true } },
                  },
                },
                currentExecutionSubmission: {
                  select: {
                    id: true,
                    trialRoundId: true,
                    judgmentNextStepId: true,
                    secondInstanceResultId: true,
                    toVersion: true,
                  },
                },
                executionConfirmation: {
                  select: {
                    id: true,
                    submissionId: true,
                    fromVersion: true,
                    toVersion: true,
                  },
                },
                executionMailing: {
                  select: {
                    id: true,
                    confirmationId: true,
                    fromVersion: true,
                    toVersion: true,
                  },
                },
                executionFiling: {
                  select: {
                    id: true,
                    mailingId: true,
                    fromVersion: true,
                    toVersion: true,
                  },
                },
                executionFinish: {
                  select: {
                    id: true,
                    filingId: true,
                    fromVersion: true,
                    toVersion: true,
                  },
                },
                archive: {
                  include: { versions: { orderBy: { fromVersion: 'asc' } } },
                },
                closure: {
                  select: {
                    id: true,
                    finishId: true,
                    currentVersionId: true,
                    currentVersion: { select: { id: true, toVersion: true } },
                    versions: {
                      orderBy: { fromVersion: 'asc' },
                      select: {
                        id: true,
                        finishId: true,
                        priorVersionId: true,
                        kind: true,
                        fromVersion: true,
                        toVersion: true,
                      },
                    },
                  },
                },
              },
            });
            if (record === null) throw failure('CASE_NOT_FOUND');
            const account = await tx.userAccount.findUnique({
              where: { id: actor.userId },
              select: { active: true, accountType: true },
            });
            if (!account?.active) throw failure('ACTION_FORBIDDEN');
            let lawyerBindingId: string | undefined;
            if (account.accountType === 'LAWYER' && command === 'ARCHIVE')
              lawyerBindingId = await currentLawyerBindingId(
                tx,
                actor,
                caseId,
                true,
              );
            else if (
              account.accountType === 'INTERNAL' &&
              actor.lawyerAccountId === undefined
            ) {
              try {
                await this.access.authorizeCase(
                  actor,
                  command === 'ARCHIVE'
                    ? 'case.archive'
                    : 'case.archive.correct',
                  {
                    departmentId: record.departmentId,
                    responsibleUserId: record.responsibleUserId,
                    ...(record.responsibleMembership.teamId
                      ? { teamId: record.responsibleMembership.teamId }
                      : {}),
                  },
                  tx,
                );
              } catch (cause) {
                if (cause instanceof ForbiddenException)
                  throw failure('ACTION_FORBIDDEN');
                throw cause;
              }
            } else throw failure('ACTION_FORBIDDEN');
            const priorReceipt = await tx.caseArchiveReceipt.findUnique({
              where: {
                departmentId_actorUserId_command_idempotencyKey: {
                  departmentId: actor.departmentId,
                  actorUserId: actor.userId,
                  command,
                  idempotencyKey: input.idempotencyKey,
                },
              },
            });
            if (priorReceipt !== null) {
              if (
                priorReceipt.caseId !== caseId ||
                priorReceipt.requestFingerprint !== fingerprint
              )
                throw failure('IDEMPOTENCY_CONFLICT');
              return this.receipt(priorReceipt.resultSnapshot, caseId);
            }
            if (record.version !== input.expectedVersion)
              throw failure('VERSION_CONFLICT');
            const finish = record.executionFinish;
            const closure = record.closure;
            const filing = record.executionFiling;
            const mailing = record.executionMailing;
            const confirmation = record.executionConfirmation;
            const submission = record.currentExecutionSubmission;
            const choice = record.currentJudgmentNextStep;
            const archive = record.archive;
            if (
              finish === null ||
              closure === null ||
              closure.finishId !== finish.id ||
              closure.currentVersion === null ||
              closure.currentVersionId !== input.expectedClosureVersionId ||
              closure.currentVersion.id !== input.expectedClosureVersionId ||
              (command === 'ARCHIVE'
                ? record.stage !== 'WAITING_ARCHIVE' ||
                  archive !== null ||
                  closure.currentVersion.toVersion !== input.expectedVersion
                : record.stage !== 'ARCHIVED' ||
                  archive === null ||
                  archive.closureId !== closure.id ||
                  archive.closureVersionId !== input.expectedClosureVersionId ||
                  !('expectedArchiveVersionId' in input) ||
                  archive.currentVersionId !==
                    input.expectedArchiveVersionId) ||
              filing === null ||
              filing.id !== finish.filingId ||
              filing.toVersion !== finish.fromVersion ||
              finish.toVersion !== finish.fromVersion + 1 ||
              mailing === null ||
              filing.mailingId !== mailing.id ||
              filing.fromVersion !== mailing.toVersion ||
              confirmation === null ||
              mailing.confirmationId !== confirmation.id ||
              mailing.fromVersion !== confirmation.toVersion ||
              submission === null ||
              confirmation.submissionId !== submission.id ||
              confirmation.fromVersion !== submission.toVersion ||
              record.currentExecutionSubmissionId !== submission.id ||
              record.currentTrialRoundId !== submission.trialRoundId ||
              record.currentJudgmentNextStepId !==
                submission.judgmentNextStepId ||
              record.currentSecondInstanceResultId !==
                submission.secondInstanceResultId ||
              choice === null ||
              choice.id !== submission.judgmentNextStepId ||
              choice.trialRoundId !== submission.trialRoundId ||
              choice.revocation !== null
            )
              throw failure('INVALID_STATE');
            if (choice.next === 'EXECUTION') {
              if (submission.secondInstanceResultId !== null)
                throw failure('INVALID_STATE');
            } else if (choice.next === 'APPEAL') {
              const result = record.currentSecondInstanceResult;
              if (
                result === null ||
                result.id !== submission.secondInstanceResultId ||
                result.choiceId !== choice.id ||
                result.trialRoundId !== submission.trialRoundId ||
                !['CHANGE', 'AFFIRM'].includes(result.result) ||
                result.revocation !== null
              )
                throw failure('INVALID_STATE');
            } else throw failure('INVALID_STATE');
            // Verify both immutable chains from the exact finish, never a >= terminal shortcut.
            let terminal = finish.toVersion;
            let prior: string | null = null;
            for (const v of closure.versions) {
              if (
                v.finishId !== finish.id ||
                v.fromVersion !== terminal ||
                v.toVersion !== terminal + 1 ||
                v.priorVersionId !== prior ||
                v.kind !== (prior === null ? 'REGISTER' : 'CORRECT')
              )
                throw failure('INVALID_STATE');
              terminal = v.toVersion;
              prior = v.id;
            }
            if (
              prior !== closure.currentVersionId ||
              terminal !== closure.currentVersion.toVersion
            )
              throw failure('INVALID_STATE');
            prior = null;
            for (const v of archive?.versions ?? []) {
              if (
                v.closureVersionId !== input.expectedClosureVersionId ||
                v.fromVersion !== terminal ||
                v.toVersion !== terminal + 1 ||
                v.priorVersionId !== prior ||
                v.kind !== (prior === null ? 'ARCHIVE' : 'CORRECT')
              )
                throw failure('INVALID_STATE');
              terminal = v.toVersion;
              prior = v.id;
            }
            if (
              terminal !== input.expectedVersion ||
              (archive !== null &&
                (prior === null || prior !== archive.currentVersionId))
            )
              throw failure('INVALID_STATE');
            const archiveId = archive?.id ?? randomUUID();
            const archiveVersionId = randomUUID();
            const auditEventId = randomUUID();
            const recordedAt = new Date();
            const priorVersionId = archive?.currentVersionId ?? null;
            await tx.auditEvent.create({
              data: {
                id: auditEventId,
                departmentId: actor.departmentId,
                actorUserId: actor.userId,
                ...(lawyerBindingId === undefined
                  ? { internalActorUserId: actor.userId }
                  : { lawyerAccountBindingId: lawyerBindingId }),
                resourceType: 'CASE',
                resourceId: caseId,
                action:
                  command === 'ARCHIVE'
                    ? 'case.archived'
                    : 'case.archive.corrected',
                details: {
                  archiveId,
                  archiveVersionId,
                  closureId: closure.id,
                  closureVersionId: input.expectedClosureVersionId,
                  priorVersionId,
                  fromVersion: input.expectedVersion,
                  toVersion: input.expectedVersion + 1,
                  archiveAt: input.archiveAt,
                  archiveType: input.archiveType,
                  archiveReason: input.archiveReason,
                  correctionReason:
                    'correctionReason' in input ? input.correctionReason : null,
                },
              },
            });
            if (archive === null)
              await tx.caseArchive.create({
                data: {
                  id: archiveId,
                  caseId,
                  departmentId: actor.departmentId,
                  closureId: closure.id,
                  closureVersionId: input.expectedClosureVersionId,
                },
              });
            await tx.caseArchiveVersion.create({
              data: {
                id: archiveVersionId,
                archiveId,
                caseId,
                departmentId: actor.departmentId,
                closureVersionId: input.expectedClosureVersionId,
                kind: command,
                priorVersionId,
                fromVersion: input.expectedVersion,
                toVersion: input.expectedVersion + 1,
                archiveAt: new Date(input.archiveAt + 'T00:00:00.000Z'),
                archiveType: input.archiveType,
                archiveReason: input.archiveReason,
                correctionReason:
                  'correctionReason' in input ? input.correctionReason : null,
                recordedAt,
                recordedByUserId: actor.userId,
                auditEventId,
              },
            });
            const updated = await tx.case.updateMany({
              where: {
                id: caseId,
                departmentId: actor.departmentId,
                stage: command === 'ARCHIVE' ? 'WAITING_ARCHIVE' : 'ARCHIVED',
                version: input.expectedVersion,
                currentTrialRoundId: submission.trialRoundId,
                currentJudgmentNextStepId: choice.id,
                currentSecondInstanceResultId:
                  submission.secondInstanceResultId,
                currentExecutionSubmissionId: submission.id,
                executionFinish: {
                  is: { id: finish.id, fromVersion: filing.toVersion },
                },
                closure: {
                  is: {
                    id: closure.id,
                    currentVersionId: input.expectedClosureVersionId,
                  },
                },
                archive: {
                  is: {
                    id: archiveId,
                    closureVersionId: input.expectedClosureVersionId,
                    currentVersionId: priorVersionId,
                  },
                },
              },
              data: { stage: 'ARCHIVED', version: { increment: 1 } },
            });
            if (updated.count !== 1) throw failure('VERSION_CONFLICT');
            const head = await tx.caseArchive.updateMany({
              where: {
                id: archiveId,
                caseId,
                departmentId: actor.departmentId,
                closureId: closure.id,
                closureVersionId: input.expectedClosureVersionId,
                currentVersionId: priorVersionId,
              },
              data: { currentVersionId: archiveVersionId },
            });
            if (head.count !== 1) throw failure('VERSION_CONFLICT');
            const response: CaseArchiveResult = {
              id: caseId,
              archiveId,
              archiveVersionId,
              closureId: closure.id,
              closureVersionId: input.expectedClosureVersionId,
              stage: 'ARCHIVED',
              version: input.expectedVersion + 1,
              recordedAt: recordedAt.toISOString(),
            };
            await tx.caseArchiveReceipt.create({
              data: {
                departmentId: actor.departmentId,
                actorUserId: actor.userId,
                caseId,
                command,
                idempotencyKey: input.idempotencyKey,
                requestFingerprint: fingerprint,
                resultSnapshot: { ...response },
              },
            });
            return response;
          },
          { isolationLevel: 'Serializable' },
        );
      } catch (cause) {
        if (this.hasCode(cause, 'P2034') || this.hasCode(cause, '40001')) {
          if (attempt < 2) continue;
          throw failure('VERSION_CONFLICT');
        }
        if (this.hasCode(cause, 'P2002')) {
          const target =
            typeof cause === 'object' &&
            cause !== null &&
            'meta' in cause &&
            typeof cause.meta === 'object' &&
            cause.meta !== null &&
            'target' in cause.meta
              ? cause.meta.target
              : null;
          const receiptConflict =
            Array.isArray(target) &&
            [
              'department_id',
              'actor_user_id',
              'command',
              'idempotency_key',
            ].every((field) => target.includes(field));
          if (receiptConflict) {
            if (attempt < 2) continue;
            throw failure('IDEMPOTENCY_CONFLICT');
          }
          throw failure('VERSION_CONFLICT');
        }
        throw cause;
      }
    }
    throw failure('VERSION_CONFLICT');
  }

  private validate(
    input: ArchiveCaseInput | CorrectCaseArchiveInput,
    command: 'ARCHIVE' | 'CORRECT',
  ): void {
    const keys = [
      'expectedVersion',
      'idempotencyKey',
      'expectedClosureVersionId',
      'archiveAt',
      'archiveType',
      'archiveReason',
      ...(command === 'CORRECT'
        ? ['expectedArchiveVersionId', 'correctionReason']
        : []),
    ];
    if (
      !input ||
      typeof input !== 'object' ||
      Array.isArray(input) ||
      Object.keys(input).length !== keys.length ||
      Object.keys(input).some((key) => !keys.includes(key)) ||
      !Number.isSafeInteger(input.expectedVersion) ||
      input.expectedVersion < 1 ||
      typeof input.idempotencyKey !== 'string' ||
      input.idempotencyKey.trim() !== input.idempotencyKey ||
      input.idempotencyKey.length < 1 ||
      input.idempotencyKey.length > 128 ||
      typeof input.expectedClosureVersionId !== 'string' ||
      !uuid.test(input.expectedClosureVersionId) ||
      ![
        'VOIDED',
        'SETTLEMENT',
        'MEDIATION',
        'JUDGMENT_PERFORMED',
        'EXECUTION_COLLECTED',
        'EXECUTION_CLOSED',
      ].includes(input.archiveType) ||
      typeof input.archiveReason !== 'string' ||
      !/\S/u.test(input.archiveReason) ||
      input.archiveReason.length > 2000 ||
      (command === 'CORRECT' &&
        (!('expectedArchiveVersionId' in input) ||
          typeof input.expectedArchiveVersionId !== 'string' ||
          !uuid.test(input.expectedArchiveVersionId) ||
          !('correctionReason' in input) ||
          typeof input.correctionReason !== 'string' ||
          !/\S/u.test(input.correctionReason) ||
          input.correctionReason.length > 500))
    )
      throw failure('VALIDATION_ERROR');
    if (
      typeof input.archiveAt !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/u.test(input.archiveAt)
    )
      throw failure('VALIDATION_ERROR');
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
      throw failure('VALIDATION_ERROR');
  }
  private receipt(value: unknown, caseId: string): CaseArchiveResult {
    if (
      typeof value !== 'object' ||
      value === null ||
      Array.isArray(value) ||
      Object.keys(value).length !== 8 ||
      !('id' in value) ||
      value.id !== caseId ||
      !('closureId' in value) ||
      typeof value.closureId !== 'string' ||
      !uuid.test(value.closureId) ||
      !('closureVersionId' in value) ||
      typeof value.closureVersionId !== 'string' ||
      !uuid.test(value.closureVersionId) ||
      !('archiveId' in value) ||
      typeof value.archiveId !== 'string' ||
      !uuid.test(value.archiveId) ||
      !('archiveVersionId' in value) ||
      typeof value.archiveVersionId !== 'string' ||
      !uuid.test(value.archiveVersionId) ||
      !('stage' in value) ||
      value.stage !== 'ARCHIVED' ||
      !('version' in value) ||
      typeof value.version !== 'number' ||
      !Number.isSafeInteger(value.version) ||
      value.version < 2 ||
      !('recordedAt' in value) ||
      typeof value.recordedAt !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(
        value.recordedAt,
      ) ||
      Number.isNaN(Date.parse(value.recordedAt)) ||
      new Date(value.recordedAt).toISOString() !== value.recordedAt
    )
      throw failure('INVALID_RECEIPT');
    return {
      id: caseId,
      archiveId: value.archiveId,
      archiveVersionId: value.archiveVersionId,
      closureId: value.closureId,
      closureVersionId: value.closureVersionId,
      stage: value.stage,
      version: value.version,
      recordedAt: value.recordedAt,
    };
  }
  private hasCode(cause: unknown, code: string): boolean {
    if (cause === null || typeof cause !== 'object') return false;
    const value = cause as {
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
