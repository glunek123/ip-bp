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
  SubmitCaseExecutionFilingDto,
  SubmitCaseExecutionFilingResponseDto,
} from './case-execution-filing.dto';

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const error = (
  status: 'bad' | 'forbidden' | 'missing' | 'conflict' | 'internal',
  code: string,
) => {
  const body = { code, message: '执行立案提交失败' };
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
export class CaseExecutionFilingService {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: AccessControlService,
    private readonly materials: MaterialService,
  ) {}

  async submit(
    actor: ActorContext,
    caseId: string,
    input: SubmitCaseExecutionFilingDto,
  ): Promise<SubmitCaseExecutionFilingResponseDto> {
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
          expectedMailingId: input.expectedMailingId,
          submittedAt: input.submittedAt,
          executionFilingProofContentVersionIds:
            input.executionFilingProofContentVersionIds,
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
                  },
                },
                executionConfirmation: {
                  select: { id: true, submissionId: true },
                },
                executionMailing: {
                  select: { id: true, confirmationId: true, toVersion: true },
                },
                executionFiling: { select: { id: true } },
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
                  'case.execution.filing.submit',
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
            const prior = await tx.caseExecutionFilingReceipt.findUnique({
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
            const mailing = record.executionMailing;
            if (
              record.stage !== 'WAITING_EXECUTION_FILING' ||
              record.executionFiling !== null ||
              (mailing === null
                ? source.kind !== 'EXTERNAL_ENTRY' ||
                  source.initialStage !== 'WAITING_EXECUTION_FILING' ||
                  input.expectedMailingId !== null ||
                  record.currentExecutionSubmissionId !== null ||
                  record.currentJudgmentNextStepId !== null ||
                  record.currentSecondInstanceResultId !== null
                : mailing.id !== input.expectedMailingId ||
                  mailing.toVersion !== input.expectedVersion) ||
              (source.kind === 'EXTERNAL_ENTRY' &&
                input.submittedAt < source.stageReachedOn)
            )
              throw error('conflict', 'INVALID_STATE');
            const facts = await this.materials.assertAvailableVersions(
              tx,
              actor,
              {
                ownerType: 'CASE',
                ownerId: caseId,
                category: 'EXECUTION_FILING_PROOF',
                contentVersionIds: input.executionFilingProofContentVersionIds,
                minCount: 1,
                maxCount: 10,
              },
            );
            const filingId = randomUUID();
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
                action: 'case.execution.filing.submitted',
                details: {
                  filingId,
                  mailingId: mailing?.id ?? null,
                  fromVersion: input.expectedVersion,
                  toVersion: input.expectedVersion + 1,
                  submittedAt: input.submittedAt,
                  executionFilingProofContentVersionIds:
                    input.executionFilingProofContentVersionIds,
                },
              },
            });
            await tx.caseExecutionFiling.create({
              data: {
                id: filingId,
                caseId,
                departmentId: actor.departmentId,
                mailingId: mailing?.id ?? null,
                externalEntryId:
                  source.kind === 'EXTERNAL_ENTRY' ? source.entryId : null,
                fromVersion: input.expectedVersion,
                toVersion: input.expectedVersion + 1,
                submittedAt: new Date(`${input.submittedAt}T00:00:00.000Z`),
                recordedAt,
                submittedByUserId: actor.userId,
                auditEventId,
              },
            });
            const updated = await tx.case.updateMany({
              where: {
                id: caseId,
                departmentId: actor.departmentId,
                stage: 'WAITING_EXECUTION_FILING',
                version: input.expectedVersion,
                currentTrialRoundId: record.currentTrialRoundId,
                currentJudgmentNextStepId: record.currentJudgmentNextStepId,
                currentSecondInstanceResultId:
                  record.currentSecondInstanceResultId,
                currentExecutionSubmissionId:
                  record.currentExecutionSubmissionId,
              },
              data: { stage: 'EXECUTING', version: { increment: 1 } },
            });
            if (updated.count !== 1)
              throw error('conflict', 'VERSION_CONFLICT');
            await this.materials.freezeCaseExecutionFilingReferences(
              tx,
              actor,
              caseId,
              filingId,
              facts,
              auditEventId,
            );
            const response: SubmitCaseExecutionFilingResponseDto = {
              id: caseId,
              filingId,
              mailingId: mailing?.id ?? null,
              stage: 'EXECUTING',
              version: input.expectedVersion + 1,
              submittedAt: input.submittedAt,
              recordedAt: recordedAt.toISOString(),
            };
            await tx.caseExecutionFilingReceipt.create({
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

  private validate(input: SubmitCaseExecutionFilingDto): void {
    if (
      input === null ||
      typeof input !== 'object' ||
      Array.isArray(input) ||
      Object.keys(input).some(
        (key) =>
          ![
            'expectedVersion',
            'idempotencyKey',
            'expectedMailingId',
            'submittedAt',
            'executionFilingProofContentVersionIds',
          ].includes(key),
      ) ||
      !Number.isSafeInteger(input.expectedVersion) ||
      input.expectedVersion < 1 ||
      typeof input.idempotencyKey !== 'string' ||
      input.idempotencyKey.trim() !== input.idempotencyKey ||
      input.idempotencyKey.length < 1 ||
      input.idempotencyKey.length > 128 ||
      (input.expectedMailingId !== null &&
        (typeof input.expectedMailingId !== 'string' ||
          !uuid.test(input.expectedMailingId))) ||
      typeof input.submittedAt !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/u.test(input.submittedAt) ||
      !Array.isArray(input.executionFilingProofContentVersionIds) ||
      input.executionFilingProofContentVersionIds.length < 1 ||
      input.executionFilingProofContentVersionIds.length > 10 ||
      new Set(input.executionFilingProofContentVersionIds).size !==
        input.executionFilingProofContentVersionIds.length ||
      input.executionFilingProofContentVersionIds.some(
        (id) => typeof id !== 'string' || !uuid.test(id),
      )
    )
      throw error('bad', 'VALIDATION_ERROR');
    const date = new Date(`${input.submittedAt}T00:00:00.000Z`);
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    if (
      Number.isNaN(date.getTime()) ||
      date.toISOString().slice(0, 10) !== input.submittedAt ||
      input.submittedAt > today
    )
      throw error('bad', 'VALIDATION_ERROR');
  }

  private receipt(
    snapshot: unknown,
    caseId: string,
  ): SubmitCaseExecutionFilingResponseDto {
    if (
      typeof snapshot !== 'object' ||
      snapshot === null ||
      Array.isArray(snapshot) ||
      !('id' in snapshot) ||
      snapshot.id !== caseId ||
      !('filingId' in snapshot) ||
      typeof snapshot.filingId !== 'string' ||
      !uuid.test(snapshot.filingId) ||
      !('mailingId' in snapshot) ||
      (snapshot.mailingId !== null &&
        (typeof snapshot.mailingId !== 'string' ||
          !uuid.test(snapshot.mailingId))) ||
      !('stage' in snapshot) ||
      snapshot.stage !== 'EXECUTING' ||
      !('version' in snapshot) ||
      !Number.isSafeInteger(snapshot.version) ||
      !('submittedAt' in snapshot) ||
      typeof snapshot.submittedAt !== 'string' ||
      !('recordedAt' in snapshot) ||
      typeof snapshot.recordedAt !== 'string'
    )
      throw error('internal', 'INVALID_RECEIPT');
    return snapshot as SubmitCaseExecutionFilingResponseDto;
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
