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
import { MaterialService } from '../materials';
import { readCaseSourceAnchor } from './case-entry-source';
import { assertExecutionSourceChain } from './case-execution-source';
import {
  FinishCaseExecutionDto,
  FinishCaseExecutionResponseDto,
} from './case-execution-finish.dto';

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const error = (
  status: 'bad' | 'forbidden' | 'missing' | 'conflict' | 'internal',
  code: string,
) => {
  const body = { code, message: '登记执行结束失败' };
  switch (status) {
    case 'bad':
      return new BadRequestException(body);
    case 'forbidden':
      return new ForbiddenException(body);
    case 'missing':
      return new NotFoundException(body);
    case 'internal':
      return new InternalServerErrorException(body);
    default:
      return new ConflictException(body);
  }
};

@Injectable()
export class CaseExecutionFinishService {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: AccessControlService,
    private readonly materials: MaterialService,
  ) {}

  async finish(
    actor: ActorContext,
    caseId: string,
    input: FinishCaseExecutionDto,
  ): Promise<FinishCaseExecutionResponseDto> {
    this.validate(input);
    if (
      actor.clientCustomerId !== undefined ||
      actor.notaryOfficeId !== undefined
    )
      throw error('forbidden', 'ACTION_FORBIDDEN');
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify({
          caseId,
          expectedVersion: input.expectedVersion,
          expectedFilingId: input.expectedFilingId,
          finishedAt: input.finishedAt,
          reason: input.reason,
          basisNote: input.basisNote,
          basisContentVersionIds: input.basisContentVersionIds,
        }),
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
            if (locked.length !== 1) throw error('missing', 'CASE_NOT_FOUND');
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
                currentJudgmentNextStep: {
                  select: {
                    id: true,
                    trialRoundId: true,
                    next: true,
                    revocation: { select: { id: true } },
                  },
                },
                currentSecondInstanceResultId: true,
                currentSecondInstanceResult: {
                  select: {
                    id: true,
                    trialRoundId: true,
                    choiceId: true,
                    result: true,
                    revocation: { select: { id: true } },
                  },
                },
                currentExecutionSubmissionId: true,
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
                executionFinish: { select: { id: true } },
              },
            });
            if (record === null) throw error('missing', 'CASE_NOT_FOUND');
            const account = await tx.userAccount.findUnique({
              where: { id: actor.userId },
              select: { active: true, accountType: true },
            });
            if (!account?.active) throw error('forbidden', 'ACTION_FORBIDDEN');
            let lawyerBindingId: string | undefined;
            if (account.accountType === 'LAWYER') {
              lawyerBindingId = await currentLawyerBindingId(
                tx,
                actor,
                caseId,
                true,
              );
            } else if (
              account.accountType === 'INTERNAL' &&
              actor.lawyerAccountId === undefined
            ) {
              try {
                await this.access.authorizeCase(
                  actor,
                  'case.execution.finish',
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
                  throw error('forbidden', 'ACTION_FORBIDDEN');
                throw cause;
              }
            } else throw error('forbidden', 'ACTION_FORBIDDEN');
            const prior = await tx.caseExecutionFinishReceipt.findUnique({
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
                throw error('conflict', 'IDEMPOTENCY_CONFLICT');
              return this.receipt(prior.resultSnapshot, caseId);
            }
            if (record.version !== input.expectedVersion)
              throw error('conflict', 'VERSION_CONFLICT');
            const source = await readCaseSourceAnchor(
              tx,
              caseId,
              actor.departmentId,
            );
            await assertExecutionSourceChain(
              tx,
              caseId,
              actor.departmentId,
              source,
            );
            const filing = record.executionFiling;
            if (
              record.stage !== 'EXECUTING' ||
              record.executionFinish !== null ||
              (filing === null
                ? source.kind !== 'EXTERNAL_ENTRY' ||
                  source.initialStage !== 'EXECUTING' ||
                  input.expectedFilingId !== null ||
                  record.currentExecutionSubmissionId !== null ||
                  record.currentJudgmentNextStepId !== null ||
                  record.currentSecondInstanceResultId !== null
                : filing.id !== input.expectedFilingId ||
                  filing.toVersion !== input.expectedVersion) ||
              (source.kind === 'EXTERNAL_ENTRY' &&
                input.finishedAt < source.stageReachedOn)
            )
              throw error('conflict', 'INVALID_STATE');
            const facts =
              input.basisContentVersionIds.length === 0
                ? []
                : await this.materials.assertAvailableVersions(tx, actor, {
                    ownerType: 'CASE',
                    ownerId: caseId,
                    category: 'EXECUTION_FINISH_BASIS',
                    contentVersionIds: input.basisContentVersionIds,
                    minCount: 1,
                    maxCount: 10,
                  });
            const finishId = randomUUID();
            const auditEventId = randomUUID();
            const recordedAt = new Date();
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
                action: 'case.execution.finished',
                details: {
                  finishId,
                  filingId: filing?.id ?? null,
                  reason: input.reason,
                  basisNote: input.basisNote,
                  fromVersion: input.expectedVersion,
                  toVersion: input.expectedVersion + 1,
                  finishedAt: input.finishedAt,
                  basisContentVersionIds: input.basisContentVersionIds,
                },
              },
            });
            await tx.caseExecutionFinish.create({
              data: {
                id: finishId,
                caseId,
                departmentId: actor.departmentId,
                filingId: filing?.id ?? null,
                externalEntryId:
                  source.kind === 'EXTERNAL_ENTRY' ? source.entryId : null,
                reason: input.reason,
                basisNote: input.basisNote,
                fromVersion: input.expectedVersion,
                toVersion: input.expectedVersion + 1,
                finishedAt: new Date(`${input.finishedAt}T00:00:00.000Z`),
                recordedAt,
                recordedByUserId: actor.userId,
                auditEventId,
              },
            });
            const updated = await tx.case.updateMany({
              where: {
                id: caseId,
                departmentId: actor.departmentId,
                stage: 'EXECUTING',
                version: input.expectedVersion,
                currentTrialRoundId: record.currentTrialRoundId,
                currentJudgmentNextStepId: record.currentJudgmentNextStepId,
                currentSecondInstanceResultId:
                  record.currentSecondInstanceResultId,
                currentExecutionSubmissionId:
                  record.currentExecutionSubmissionId,
                ...(filing === null
                  ? { executionFiling: { is: null } }
                  : {
                      executionFiling: {
                        is: { id: filing.id, toVersion: input.expectedVersion },
                      },
                    }),
              },
              data: { stage: 'WAITING_ARCHIVE', version: { increment: 1 } },
            });
            if (updated.count !== 1)
              throw error('conflict', 'VERSION_CONFLICT');
            if (facts.length > 0)
              await this.materials.freezeCaseExecutionFinishReferences(
                tx,
                actor,
                caseId,
                finishId,
                facts,
                auditEventId,
              );
            const response: FinishCaseExecutionResponseDto = {
              id: caseId,
              finishId,
              filingId: filing?.id ?? null,
              stage: 'WAITING_ARCHIVE',
              version: input.expectedVersion + 1,
              finishedAt: input.finishedAt,
              recordedAt: recordedAt.toISOString(),
            };
            await tx.caseExecutionFinishReceipt.create({
              data: {
                departmentId: actor.departmentId,
                actorUserId: actor.userId,
                caseId,
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
          throw error('conflict', 'VERSION_CONFLICT');
        }
        if (this.hasCode(cause, 'P2002')) {
          if (this.isReceiptKeyConflict(cause)) {
            if (attempt < 2) continue;
            throw error('conflict', 'IDEMPOTENCY_CONFLICT');
          }
          throw error('conflict', 'VERSION_CONFLICT');
        }
        throw cause;
      }
    }
    throw error('conflict', 'VERSION_CONFLICT');
  }

  private validate(input: FinishCaseExecutionDto): void {
    if (
      input === null ||
      typeof input !== 'object' ||
      Array.isArray(input) ||
      Object.keys(input).some(
        (key) =>
          ![
            'expectedVersion',
            'idempotencyKey',
            'expectedFilingId',
            'finishedAt',
            'reason',
            'basisNote',
            'basisContentVersionIds',
          ].includes(key),
      ) ||
      !Number.isSafeInteger(input.expectedVersion) ||
      input.expectedVersion < 1 ||
      typeof input.idempotencyKey !== 'string' ||
      input.idempotencyKey.trim() !== input.idempotencyKey ||
      input.idempotencyKey.length < 1 ||
      input.idempotencyKey.length > 128 ||
      (input.expectedFilingId !== null &&
        (typeof input.expectedFilingId !== 'string' ||
          !uuid.test(input.expectedFilingId))) ||
      typeof input.finishedAt !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/u.test(input.finishedAt) ||
      typeof input.reason !== 'string' ||
      input.reason.trim().length === 0 ||
      input.reason.length > 2000 ||
      !(
        input.basisNote === null ||
        (typeof input.basisNote === 'string' &&
          input.basisNote.trim().length > 0 &&
          input.basisNote.length <= 2000)
      ) ||
      !Array.isArray(input.basisContentVersionIds) ||
      input.basisContentVersionIds.length > 10 ||
      (input.basisNote === null && input.basisContentVersionIds.length === 0) ||
      new Set(input.basisContentVersionIds).size !==
        input.basisContentVersionIds.length ||
      input.basisContentVersionIds.some(
        (id) => typeof id !== 'string' || !uuid.test(id),
      )
    )
      throw error('bad', 'VALIDATION_ERROR');
    const date = new Date(`${input.finishedAt}T00:00:00.000Z`);
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    if (
      Number.isNaN(date.getTime()) ||
      date.toISOString().slice(0, 10) !== input.finishedAt ||
      input.finishedAt > today
    )
      throw error('bad', 'VALIDATION_ERROR');
  }

  private receipt(
    snapshot: unknown,
    caseId: string,
  ): FinishCaseExecutionResponseDto {
    if (
      typeof snapshot !== 'object' ||
      snapshot === null ||
      Array.isArray(snapshot) ||
      Object.keys(snapshot).length !== 7 ||
      !('id' in snapshot) ||
      snapshot.id !== caseId ||
      !('filingId' in snapshot) ||
      (snapshot.filingId !== null &&
        (typeof snapshot.filingId !== 'string' ||
          !uuid.test(snapshot.filingId))) ||
      !('finishId' in snapshot) ||
      typeof snapshot.finishId !== 'string' ||
      !uuid.test(snapshot.finishId) ||
      !('stage' in snapshot) ||
      snapshot.stage !== 'WAITING_ARCHIVE' ||
      !('version' in snapshot) ||
      !Number.isSafeInteger(snapshot.version) ||
      typeof snapshot.version !== 'number' ||
      snapshot.version < 2 ||
      !('finishedAt' in snapshot) ||
      typeof snapshot.finishedAt !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/u.test(snapshot.finishedAt) ||
      !('recordedAt' in snapshot) ||
      typeof snapshot.recordedAt !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(
        snapshot.recordedAt,
      ) ||
      Number.isNaN(Date.parse(snapshot.recordedAt))
    )
      throw error('internal', 'INVALID_RECEIPT');
    return snapshot as FinishCaseExecutionResponseDto;
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

  private isReceiptKeyConflict(cause: unknown): boolean {
    if (typeof cause !== 'object' || cause === null || !('meta' in cause))
      return false;
    const meta = cause.meta;
    if (typeof meta !== 'object' || meta === null || !('target' in meta))
      return false;
    const target = meta.target;
    return (
      Array.isArray(target) &&
      ['department_id', 'actor_user_id', 'idempotency_key'].every((field) =>
        target.includes(field),
      )
    );
  }
}
