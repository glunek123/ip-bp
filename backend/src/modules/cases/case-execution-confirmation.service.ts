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
import { isEntryStartingAt, readCaseSourceAnchor } from './case-entry-source';
import { assertExecutionSourceChain } from './case-execution-source';
import {
  ConfirmExecutionRequestDto,
  ConfirmExecutionResultDto,
} from './case-execution-confirmation.dto';

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

@Injectable()
export class CaseExecutionConfirmationService {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: AccessControlService,
    private readonly materials: MaterialService,
  ) {}

  async confirm(
    actor: ActorContext,
    caseId: string,
    input: ConfirmExecutionRequestDto,
  ): Promise<ConfirmExecutionResultDto> {
    if (
      input === null ||
      typeof input !== 'object' ||
      Array.isArray(input) ||
      Object.keys(input).some(
        (key) =>
          ![
            'expectedVersion',
            'idempotencyKey',
            'expectedSubmissionId',
            'executionApplicationContentVersionIds',
          ].includes(key),
      ) ||
      !Number.isSafeInteger(input.expectedVersion) ||
      input.expectedVersion < 1 ||
      typeof input.idempotencyKey !== 'string' ||
      input.idempotencyKey.trim() !== input.idempotencyKey ||
      input.idempotencyKey.length < 1 ||
      input.idempotencyKey.length > 128 ||
      (input.expectedSubmissionId !== null &&
        (typeof input.expectedSubmissionId !== 'string' ||
          !uuid.test(input.expectedSubmissionId))) ||
      (input.expectedSubmissionId === null
        ? !Array.isArray(input.executionApplicationContentVersionIds) ||
          input.executionApplicationContentVersionIds.length < 1 ||
          input.executionApplicationContentVersionIds.length > 10 ||
          new Set(input.executionApplicationContentVersionIds).size !==
            input.executionApplicationContentVersionIds.length ||
          input.executionApplicationContentVersionIds.some(
            (id) => typeof id !== 'string' || !uuid.test(id),
          )
        : input.executionApplicationContentVersionIds !== undefined)
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
          caseId,
          expectedVersion: input.expectedVersion,
          expectedSubmissionId: input.expectedSubmissionId,
          ...(input.expectedSubmissionId === null
            ? {
                executionApplicationContentVersionIds:
                  input.executionApplicationContentVersionIds,
              }
            : {}),
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
            if (locked.length !== 1) throw this.notFound();
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
                    externalEntryId: true,
                    toVersion: true,
                    versions: { select: { contentVersionId: true } },
                  },
                },
                executionConfirmation: { select: { id: true } },
              },
            });
            if (record === null) throw this.notFound();
            const account = await tx.userAccount.findUnique({
              where: { id: actor.userId },
              select: { active: true, accountType: true },
            });
            if (!account?.active) throw this.forbidden();
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
                  'case.execution.confirm',
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
            } else throw this.forbidden();
            const prior = await tx.caseExecutionConfirmationReceipt.findUnique({
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
                throw this.idempotencyConflict();
              return this.receipt(prior.resultSnapshot, caseId);
            }
            if (record.version !== input.expectedVersion)
              throw this.versionConflict();
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
            const submission = record.currentExecutionSubmission;
            const choice = record.currentJudgmentNextStep;
            if (
              record.stage !== 'WAITING_EXECUTION_CONFIRMATION' ||
              record.currentExecutionSubmissionId !==
                input.expectedSubmissionId ||
              record.executionConfirmation !== null ||
              (submission === null
                ? input.expectedSubmissionId !== null ||
                  !isEntryStartingAt(
                    source,
                    'WAITING_EXECUTION_CONFIRMATION',
                  ) ||
                  record.currentJudgmentNextStepId !== null ||
                  record.currentSecondInstanceResultId !== null ||
                  choice !== null
                : submission.id !== input.expectedSubmissionId ||
                  submission.toVersion !== input.expectedVersion ||
                  submission.versions.length < 1 ||
                  submission.versions.length > 10 ||
                  (submission.externalEntryId ?? null) !==
                    (source.kind === 'EXTERNAL_ENTRY'
                      ? source.entryId
                      : null) ||
                  record.currentTrialRoundId !== submission.trialRoundId ||
                  record.currentJudgmentNextStepId !==
                    submission.judgmentNextStepId ||
                  record.currentSecondInstanceResultId !==
                    submission.secondInstanceResultId ||
                  (choice === null
                    ? submission.judgmentNextStepId !== null
                    : choice.id !== submission.judgmentNextStepId ||
                      choice.trialRoundId !== submission.trialRoundId ||
                      choice.revocation !== null))
            )
              throw this.invalidState();
            if (choice === null) {
              // The source chain check already verified the exact imported root.
            } else if (submission === null) {
              throw this.invalidState();
            } else if (choice.next === 'EXECUTION') {
              if (submission.secondInstanceResultId !== null)
                throw this.invalidState();
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
                throw this.invalidState();
            } else throw this.invalidState();
            let directFacts: Awaited<
              ReturnType<MaterialService['assertAvailableVersions']>
            > | null = null;
            if (submission !== null)
              await this.materials.assertAvailableVersions(tx, actor, {
                ownerType: 'CASE',
                ownerId: caseId,
                category: 'EXECUTION_APPLICATION',
                contentVersionIds: submission.versions.map(
                  (version) => version.contentVersionId,
                ),
                minCount: 1,
                maxCount: 10,
              });
            else
              directFacts =
                await this.materials.assertCompleteCurrentCaseExecutionApplicationBundle(
                  tx,
                  actor,
                  caseId,
                  input.executionApplicationContentVersionIds ?? [],
                );
            const confirmationId = randomUUID();
            const auditId = randomUUID();
            const confirmedAt = new Date();
            await tx.auditEvent.create({
              data: {
                id: auditId,
                departmentId: actor.departmentId,
                actorUserId: actor.userId,
                ...(lawyerBindingId === undefined
                  ? { internalActorUserId: actor.userId }
                  : { lawyerAccountBindingId: lawyerBindingId }),
                resourceType: 'CASE',
                resourceId: caseId,
                action: 'case.execution.confirmed',
                details: {
                  confirmationId,
                  submissionId: submission?.id ?? null,
                  ...(submission === null
                    ? {
                        executionApplicationContentVersionIds:
                          input.executionApplicationContentVersionIds,
                      }
                    : {}),
                  fromVersion: input.expectedVersion,
                  toVersion: input.expectedVersion + 1,
                },
              },
            });
            await tx.caseExecutionConfirmation.create({
              data: {
                id: confirmationId,
                caseId,
                departmentId: actor.departmentId,
                submissionId: submission?.id ?? null,
                externalEntryId:
                  source.kind === 'EXTERNAL_ENTRY' ? source.entryId : null,
                fromVersion: input.expectedVersion,
                toVersion: input.expectedVersion + 1,
                confirmedAt,
                confirmedByUserId: actor.userId,
                auditEventId: auditId,
              },
            });
            const updated = await tx.case.updateMany({
              where: {
                id: caseId,
                departmentId: actor.departmentId,
                stage: 'WAITING_EXECUTION_CONFIRMATION',
                version: input.expectedVersion,
                currentTrialRoundId: record.currentTrialRoundId,
                currentJudgmentNextStepId: record.currentJudgmentNextStepId,
                currentSecondInstanceResultId:
                  record.currentSecondInstanceResultId,
                currentExecutionSubmissionId: submission?.id ?? null,
              },
              data: {
                stage: 'WAITING_EXECUTION_STAMP',
                version: { increment: 1 },
              },
            });
            if (updated.count !== 1) throw this.versionConflict();
            if (directFacts !== null)
              await this.materials.freezeCaseExecutionConfirmationReferences(
                tx,
                actor,
                caseId,
                confirmationId,
                directFacts,
                auditId,
              );
            const response: ConfirmExecutionResultDto = {
              id: caseId,
              confirmationId,
              submissionId: submission?.id ?? null,
              stage: 'WAITING_EXECUTION_STAMP',
              version: input.expectedVersion + 1,
              confirmedAt: confirmedAt.toISOString(),
            };
            await tx.caseExecutionConfirmationReceipt.create({
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
      } catch (error) {
        if (this.hasCode(error, 'P2034') || this.hasCode(error, '40001')) {
          if (attempt < 2) continue;
          throw this.versionConflict();
        }
        if (this.hasCode(error, 'P2002')) {
          if (this.isReceiptKeyConflict(error))
            throw this.idempotencyConflict();
          throw this.versionConflict();
        }
        throw error;
      }
    }
    throw this.versionConflict();
  }

  private receipt(
    snapshot: unknown,
    caseId: string,
  ): ConfirmExecutionResultDto {
    if (
      typeof snapshot !== 'object' ||
      snapshot === null ||
      Array.isArray(snapshot) ||
      !('id' in snapshot) ||
      snapshot.id !== caseId ||
      !('confirmationId' in snapshot) ||
      typeof snapshot.confirmationId !== 'string' ||
      !uuid.test(snapshot.confirmationId) ||
      !('submissionId' in snapshot) ||
      (snapshot.submissionId !== null &&
        (typeof snapshot.submissionId !== 'string' ||
          !uuid.test(snapshot.submissionId))) ||
      !('stage' in snapshot) ||
      snapshot.stage !== 'WAITING_EXECUTION_STAMP' ||
      !('version' in snapshot) ||
      !Number.isSafeInteger(snapshot.version) ||
      !('confirmedAt' in snapshot) ||
      typeof snapshot.confirmedAt !== 'string'
    )
      throw new InternalServerErrorException({
        code: 'INVALID_RECEIPT',
        message: '执行确认回执损坏',
      });
    return snapshot as ConfirmExecutionResultDto;
  }
  private validation() {
    return new BadRequestException({
      code: 'VALIDATION_ERROR',
      message: '执行确认参数无效',
    });
  }
  private forbidden() {
    return new ForbiddenException({
      code: 'ACTION_FORBIDDEN',
      message: '无权确认执行材料',
    });
  }
  private notFound() {
    return new NotFoundException({
      code: 'CASE_NOT_FOUND',
      message: '案件不存在',
    });
  }
  private invalidState() {
    return new ConflictException({
      code: 'INVALID_STATE',
      message: '执行提交或来源已变化',
    });
  }
  private versionConflict() {
    return new ConflictException({
      code: 'VERSION_CONFLICT',
      message: '案件版本已变化',
    });
  }
  private idempotencyConflict() {
    return new ConflictException({
      code: 'IDEMPOTENCY_CONFLICT',
      message: '幂等键已使用',
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
  private isReceiptKeyConflict(error: unknown): boolean {
    if (typeof error !== 'object' || error === null || !('meta' in error))
      return false;
    const meta = error.meta;
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
