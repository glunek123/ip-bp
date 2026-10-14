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
  SubmitExecutionRequestDto,
  SubmitExecutionResultDto,
} from './case-execution-submission.dto';

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
type Submission = {
  expectedVersion: number;
  idempotencyKey: string;
  trialRoundId: string;
  judgmentNextStepId: string | null;
  secondInstanceResultId: string | null;
  expectedSubmissionId: string | null;
  executionApplicationContentVersionIds: string[];
  changeReason: string | null;
};

@Injectable()
export class CaseExecutionSubmissionService {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: AccessControlService,
    private readonly materials: MaterialService,
  ) {}

  async submit(
    actor: ActorContext,
    caseId: string,
    input: SubmitExecutionRequestDto,
  ): Promise<SubmitExecutionResultDto> {
    const value = this.normalize(input);
    if (
      actor.clientCustomerId !== undefined ||
      actor.notaryOfficeId !== undefined
    )
      throw this.forbidden();
    const fingerprint = createHash('sha256')
      .update(JSON.stringify({ caseId, ...value }))
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
                    externalEntryId: true,
                    result: true,
                    revocation: { select: { id: true } },
                  },
                },
                currentExecutionSubmissionId: true,
                currentExecutionSubmission: {
                  select: {
                    id: true,
                    versions: { select: { contentVersionId: true } },
                  },
                },
                responsibleUserId: true,
                responsibleMembership: { select: { teamId: true } },
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
                  'case.execution.submit',
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
            const prior = await tx.caseExecutionSubmissionReceipt.findUnique({
              where: {
                departmentId_actorUserId_idempotencyKey: {
                  departmentId: actor.departmentId,
                  actorUserId: actor.userId,
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
            if (record.version !== value.expectedVersion)
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
            const choice = record.currentJudgmentNextStep;
            if (
              record.currentTrialRoundId !== value.trialRoundId ||
              record.currentJudgmentNextStepId !== value.judgmentNextStepId ||
              (choice === null
                ? value.judgmentNextStepId !== null ||
                  !(
                    (isEntryStartingAt(source, 'WAITING_EXECUTION_DOCUMENTS') &&
                      value.secondInstanceResultId === null &&
                      record.currentSecondInstanceResultId === null) ||
                    (isEntryStartingAt(source, 'SECOND_INSTANCE') &&
                      record.currentSecondInstanceResult !== null &&
                      record.currentSecondInstanceResult.externalEntryId ===
                        source.entryId &&
                      record.currentSecondInstanceResult.id ===
                        value.secondInstanceResultId &&
                      record.currentSecondInstanceResult.choiceId === null &&
                      record.currentSecondInstanceResult.trialRoundId ===
                        value.trialRoundId &&
                      ['CHANGE', 'AFFIRM'].includes(
                        record.currentSecondInstanceResult.result,
                      ) &&
                      record.currentSecondInstanceResult.revocation === null)
                  )
                : choice.id !== value.judgmentNextStepId ||
                  choice.trialRoundId !== value.trialRoundId ||
                  choice.revocation !== null)
            )
              throw this.invalidState();
            if (choice === null) {
              // An imported execution stage or a real imported-appeal result anchors the absent choice.
            } else if (choice.next === 'EXECUTION') {
              if (
                value.secondInstanceResultId !== null ||
                record.currentSecondInstanceResultId !== null
              )
                throw this.invalidState();
            } else if (choice.next === 'APPEAL') {
              const result = record.currentSecondInstanceResult;
              if (
                result === null ||
                result.id !== value.secondInstanceResultId ||
                result.id !== record.currentSecondInstanceResultId ||
                result.trialRoundId !== value.trialRoundId ||
                result.choiceId !== value.judgmentNextStepId ||
                (result.result !== 'CHANGE' && result.result !== 'AFFIRM') ||
                result.revocation !== null
              )
                throw this.invalidState();
            } else throw this.invalidState();
            if (value.expectedSubmissionId === null) {
              if (
                record.stage !== 'WAITING_EXECUTION_DOCUMENTS' ||
                record.currentExecutionSubmissionId !== null ||
                value.changeReason !== null
              )
                throw this.invalidState();
            } else {
              if (
                record.stage !== 'WAITING_EXECUTION_CONFIRMATION' ||
                record.currentExecutionSubmissionId !==
                  value.expectedSubmissionId ||
                record.currentExecutionSubmission?.id !==
                  value.expectedSubmissionId ||
                value.changeReason === null
              )
                throw this.invalidState();
              const oldIds = record.currentExecutionSubmission.versions
                .map((version) => version.contentVersionId)
                .sort();
              if (
                JSON.stringify(oldIds) ===
                JSON.stringify(value.executionApplicationContentVersionIds)
              )
                throw this.invalidState();
            }
            const facts = await this.materials.assertAvailableVersions(
              tx,
              actor,
              {
                ownerType: 'CASE',
                ownerId: caseId,
                category: 'EXECUTION_APPLICATION',
                contentVersionIds: value.executionApplicationContentVersionIds,
                minCount: 1,
                maxCount: 10,
              },
            );
            const submissionId = randomUUID();
            const auditId = randomUUID();
            const submittedAt = new Date();
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
                action: 'case.execution.submitted',
                details: {
                  submissionId,
                  trialRoundId: value.trialRoundId,
                  judgmentNextStepId: value.judgmentNextStepId,
                  secondInstanceResultId: value.secondInstanceResultId,
                  priorSubmissionId: value.expectedSubmissionId,
                  changeReason: value.changeReason,
                  fromVersion: value.expectedVersion,
                  toVersion: value.expectedVersion + 1,
                  executionApplicationContentVersionIds:
                    value.executionApplicationContentVersionIds,
                },
              },
            });
            await tx.caseExecutionSubmission.create({
              data: {
                id: submissionId,
                caseId,
                departmentId: actor.departmentId,
                trialRoundId: value.trialRoundId,
                judgmentNextStepId: value.judgmentNextStepId,
                externalEntryId:
                  source.kind === 'EXTERNAL_ENTRY' ? source.entryId : null,
                secondInstanceResultId: value.secondInstanceResultId,
                priorSubmissionId: value.expectedSubmissionId,
                changeReason: value.changeReason,
                fromVersion: value.expectedVersion,
                toVersion: value.expectedVersion + 1,
                submittedAt,
                submittedByUserId: actor.userId,
                auditEventId: auditId,
              },
            });
            const updated = await tx.case.updateMany({
              where: {
                id: caseId,
                departmentId: actor.departmentId,
                stage: record.stage,
                version: value.expectedVersion,
                currentTrialRoundId: value.trialRoundId,
                currentJudgmentNextStepId: value.judgmentNextStepId,
                currentSecondInstanceResultId: value.secondInstanceResultId,
                currentExecutionSubmissionId: value.expectedSubmissionId,
              },
              data: {
                stage: 'WAITING_EXECUTION_CONFIRMATION',
                version: { increment: 1 },
                currentExecutionSubmissionId: submissionId,
              },
            });
            if (updated.count !== 1) throw this.versionConflict();
            await this.materials.freezeCaseExecutionSubmissionReferences(
              tx,
              actor,
              caseId,
              submissionId,
              facts,
              auditId,
            );
            const response: SubmitExecutionResultDto = {
              id: caseId,
              submissionId,
              stage: 'WAITING_EXECUTION_CONFIRMATION',
              version: value.expectedVersion + 1,
              submittedAt: submittedAt.toISOString(),
            };
            await tx.caseExecutionSubmissionReceipt.create({
              data: {
                departmentId: actor.departmentId,
                actorUserId: actor.userId,
                caseId,
                idempotencyKey: value.idempotencyKey,
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
        if (this.hasCode(error, 'P2002') && this.isReceiptKeyConflict(error))
          throw this.idempotencyConflict();
        throw error;
      }
    }
    throw this.versionConflict();
  }

  private normalize(input: SubmitExecutionRequestDto): Submission {
    if (
      !input ||
      typeof input !== 'object' ||
      Array.isArray(input) ||
      Object.keys(input).some(
        (key) =>
          ![
            'expectedVersion',
            'idempotencyKey',
            'trialRoundId',
            'judgmentNextStepId',
            'secondInstanceResultId',
            'expectedSubmissionId',
            'executionApplicationContentVersionIds',
            'changeReason',
          ].includes(key),
      ) ||
      !Number.isSafeInteger(input.expectedVersion) ||
      input.expectedVersion < 1 ||
      typeof input.idempotencyKey !== 'string' ||
      input.idempotencyKey.length < 1 ||
      input.idempotencyKey.length > 128 ||
      !uuid.test(input.trialRoundId) ||
      (input.judgmentNextStepId !== null &&
        !uuid.test(input.judgmentNextStepId)) ||
      (input.secondInstanceResultId !== null &&
        !uuid.test(input.secondInstanceResultId)) ||
      (input.expectedSubmissionId !== null &&
        !uuid.test(input.expectedSubmissionId)) ||
      !Array.isArray(input.executionApplicationContentVersionIds) ||
      input.executionApplicationContentVersionIds.length < 1 ||
      input.executionApplicationContentVersionIds.length > 10 ||
      input.executionApplicationContentVersionIds.some(
        (id) => typeof id !== 'string' || !uuid.test(id),
      ) ||
      new Set(input.executionApplicationContentVersionIds).size !==
        input.executionApplicationContentVersionIds.length
    )
      throw this.validation();
    const reason = input.changeReason;
    if (
      reason !== undefined &&
      (typeof reason !== 'string' ||
        reason.trim().length < 1 ||
        reason.trim().length > 500)
    )
      throw this.validation();
    return {
      expectedVersion: input.expectedVersion,
      idempotencyKey: input.idempotencyKey,
      trialRoundId: input.trialRoundId,
      judgmentNextStepId: input.judgmentNextStepId,
      secondInstanceResultId: input.secondInstanceResultId,
      expectedSubmissionId: input.expectedSubmissionId,
      executionApplicationContentVersionIds: [
        ...input.executionApplicationContentVersionIds,
      ].sort(),
      changeReason: reason?.trim() ?? null,
    };
  }

  private receipt(snapshot: unknown, caseId: string): SubmitExecutionResultDto {
    if (
      typeof snapshot !== 'object' ||
      snapshot === null ||
      Array.isArray(snapshot) ||
      !('id' in snapshot) ||
      snapshot.id !== caseId ||
      !('submissionId' in snapshot) ||
      typeof snapshot.submissionId !== 'string' ||
      !uuid.test(snapshot.submissionId) ||
      !('stage' in snapshot) ||
      snapshot.stage !== 'WAITING_EXECUTION_CONFIRMATION' ||
      !('version' in snapshot) ||
      !Number.isSafeInteger(snapshot.version) ||
      !('submittedAt' in snapshot) ||
      typeof snapshot.submittedAt !== 'string'
    )
      throw new InternalServerErrorException({
        code: 'INVALID_RECEIPT',
        message: '提交回执不可用',
      });
    return snapshot as SubmitExecutionResultDto;
  }

  private validation() {
    return new BadRequestException({
      code: 'VALIDATION_ERROR',
      message: '执行提交参数无效',
    });
  }
  private forbidden() {
    return new ForbiddenException({
      code: 'ACTION_FORBIDDEN',
      message: '无权提交执行材料',
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
      message: '案件状态或提交材料已变化',
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
      message: '请求键已被使用',
    });
  }
  private hasCode(error: unknown, code: string): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === code
    );
  }
  private isReceiptKeyConflict(error: unknown): boolean {
    if (typeof error !== 'object' || error === null || !('meta' in error))
      return false;
    const meta = error.meta;
    if (
      typeof meta !== 'object' ||
      meta === null ||
      !('target' in meta) ||
      !Array.isArray(meta.target)
    )
      return false;
    const target: unknown[] = meta.target;
    return ['department_id', 'actor_user_id', 'idempotency_key'].every(
      (field) => target.includes(field),
    );
  }
}
