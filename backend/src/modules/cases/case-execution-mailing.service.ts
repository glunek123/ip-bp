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
import {
  MailCaseExecutionDto,
  MailCaseExecutionResponseDto,
} from './case-execution-mailing.dto';

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const error = (
  status: 'bad' | 'forbidden' | 'missing' | 'conflict' | 'internal',
  code: string,
) => {
  const body = { code, message: '执行邮寄登记失败' };
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
export class CaseExecutionMailingService {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: AccessControlService,
    private readonly materials: MaterialService,
  ) {}

  async mail(
    actor: ActorContext,
    caseId: string,
    input: MailCaseExecutionDto,
  ): Promise<MailCaseExecutionResponseDto> {
    this.validate(input);
    if (actor.notaryOfficeId !== undefined)
      throw error('forbidden', 'ACTION_FORBIDDEN');
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify({
          caseId,
          expectedVersion: input.expectedVersion,
          expectedConfirmationId: input.expectedConfirmationId,
          mailedAt: input.mailedAt,
          mailReceiptContentVersionIds: input.mailReceiptContentVersionIds,
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
                customerId: true,
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
                  select: { id: true, submissionId: true, toVersion: true },
                },
                executionMailing: { select: { id: true } },
              },
            });
            if (record === null) throw error('missing', 'CASE_NOT_FOUND');
            let customerBindingId: string | null = null;
            let lawyerBindingId: string | undefined;
            if (actor.clientCustomerId !== undefined) {
              if (record.customerId !== actor.clientCustomerId)
                throw error('missing', 'CASE_NOT_FOUND');
              const binding = await tx.customerAccountBinding.findFirst({
                where: {
                  userId: actor.userId,
                  customerId: actor.clientCustomerId,
                  departmentId: actor.departmentId,
                  active: true,
                  user: { active: true, accountType: 'CLIENT' },
                  customer: { profileStatus: 'ADMITTED' },
                },
                select: { id: true },
              });
              if (binding === null)
                throw error('forbidden', 'ACTION_FORBIDDEN');
              customerBindingId = binding.id;
            } else {
              const account = await tx.userAccount.findUnique({
                where: { id: actor.userId },
                select: { active: true, accountType: true },
              });
              if (!account?.active)
                throw error('forbidden', 'ACTION_FORBIDDEN');
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
                    'case.execution.mail',
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
            }
            const prior = await tx.caseExecutionMailingReceipt.findUnique({
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
            const confirmation = record.executionConfirmation;
            const submission = record.currentExecutionSubmission;
            const choice = record.currentJudgmentNextStep;
            if (
              record.stage !== 'WAITING_EXECUTION_STAMP' ||
              confirmation === null ||
              confirmation.id !== input.expectedConfirmationId ||
              confirmation.toVersion !== input.expectedVersion ||
              record.executionMailing !== null ||
              submission === null ||
              confirmation.submissionId !== submission.id ||
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
              throw error('conflict', 'INVALID_STATE');
            if (choice.next === 'EXECUTION') {
              if (submission.secondInstanceResultId !== null)
                throw error('conflict', 'INVALID_STATE');
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
                throw error('conflict', 'INVALID_STATE');
            } else throw error('conflict', 'INVALID_STATE');
            const facts = await this.materials.assertAvailableVersions(
              tx,
              actor,
              {
                ownerType: 'CASE',
                ownerId: caseId,
                category: 'MAIL_RECEIPT',
                contentVersionIds: input.mailReceiptContentVersionIds,
                minCount: 1,
                maxCount: 10,
              },
            );
            const mailingId = randomUUID();
            const auditEventId = randomUUID();
            const recordedAt = new Date();
            const actorType =
              lawyerBindingId !== undefined
                ? 'LAWYER'
                : customerBindingId !== null
                  ? 'CLIENT'
                  : 'INTERNAL';
            await tx.auditEvent.create({
              data: {
                id: auditEventId,
                departmentId: actor.departmentId,
                actorUserId: actor.userId,
                ...(actorType === 'INTERNAL'
                  ? { internalActorUserId: actor.userId }
                  : {}),
                ...(customerBindingId === null
                  ? {}
                  : { customerAccountBindingId: customerBindingId }),
                ...(lawyerBindingId === undefined
                  ? {}
                  : { lawyerAccountBindingId: lawyerBindingId }),
                resourceType: 'CASE',
                resourceId: caseId,
                action: 'case.execution.mailed',
                details: {
                  mailingId,
                  confirmationId: confirmation.id,
                  fromVersion: input.expectedVersion,
                  toVersion: input.expectedVersion + 1,
                  mailedAt: input.mailedAt,
                  mailReceiptContentVersionIds:
                    input.mailReceiptContentVersionIds,
                  actorType,
                },
              },
            });
            await tx.caseExecutionMailing.create({
              data: {
                id: mailingId,
                caseId,
                departmentId: actor.departmentId,
                confirmationId: confirmation.id,
                fromVersion: input.expectedVersion,
                toVersion: input.expectedVersion + 1,
                mailedAt: new Date(`${input.mailedAt}T00:00:00.000Z`),
                recordedAt,
                recordedByUserId: actor.userId,
                actorType,
                customerAccountBindingId: customerBindingId,
                lawyerAccountBindingId: lawyerBindingId,
                auditEventId,
              },
            });
            const updated = await tx.case.updateMany({
              where: {
                id: caseId,
                departmentId: actor.departmentId,
                stage: 'WAITING_EXECUTION_STAMP',
                version: input.expectedVersion,
                currentTrialRoundId: submission.trialRoundId,
                currentJudgmentNextStepId: submission.judgmentNextStepId,
                currentSecondInstanceResultId:
                  submission.secondInstanceResultId,
                currentExecutionSubmissionId: submission.id,
              },
              data: {
                stage: 'WAITING_EXECUTION_FILING',
                version: { increment: 1 },
              },
            });
            if (updated.count !== 1)
              throw error('conflict', 'VERSION_CONFLICT');
            await this.materials.freezeCaseExecutionMailingReferences(
              tx,
              actor,
              caseId,
              mailingId,
              facts,
              auditEventId,
            );
            const response: MailCaseExecutionResponseDto = {
              id: caseId,
              mailingId,
              confirmationId: confirmation.id,
              stage: 'WAITING_EXECUTION_FILING',
              version: input.expectedVersion + 1,
              mailedAt: input.mailedAt,
              recordedAt: recordedAt.toISOString(),
            };
            await tx.caseExecutionMailingReceipt.create({
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

  private validate(input: MailCaseExecutionDto): void {
    if (
      input === null ||
      typeof input !== 'object' ||
      Array.isArray(input) ||
      Object.keys(input).some(
        (key) =>
          ![
            'expectedVersion',
            'idempotencyKey',
            'expectedConfirmationId',
            'mailedAt',
            'mailReceiptContentVersionIds',
          ].includes(key),
      ) ||
      !Number.isSafeInteger(input.expectedVersion) ||
      input.expectedVersion < 1 ||
      typeof input.idempotencyKey !== 'string' ||
      input.idempotencyKey.trim() !== input.idempotencyKey ||
      input.idempotencyKey.length < 1 ||
      input.idempotencyKey.length > 128 ||
      typeof input.expectedConfirmationId !== 'string' ||
      !uuid.test(input.expectedConfirmationId) ||
      typeof input.mailedAt !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/u.test(input.mailedAt) ||
      !Array.isArray(input.mailReceiptContentVersionIds) ||
      input.mailReceiptContentVersionIds.length < 1 ||
      input.mailReceiptContentVersionIds.length > 10 ||
      new Set(input.mailReceiptContentVersionIds).size !==
        input.mailReceiptContentVersionIds.length ||
      input.mailReceiptContentVersionIds.some(
        (id) => typeof id !== 'string' || !uuid.test(id),
      )
    )
      throw error('bad', 'VALIDATION_ERROR');
    const date = new Date(`${input.mailedAt}T00:00:00.000Z`);
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    if (
      Number.isNaN(date.getTime()) ||
      date.toISOString().slice(0, 10) !== input.mailedAt ||
      input.mailedAt > today
    )
      throw error('bad', 'VALIDATION_ERROR');
  }

  private receipt(
    snapshot: unknown,
    caseId: string,
  ): MailCaseExecutionResponseDto {
    if (
      typeof snapshot !== 'object' ||
      snapshot === null ||
      Array.isArray(snapshot) ||
      !('id' in snapshot) ||
      snapshot.id !== caseId ||
      !('mailingId' in snapshot) ||
      typeof snapshot.mailingId !== 'string' ||
      !uuid.test(snapshot.mailingId) ||
      !('confirmationId' in snapshot) ||
      typeof snapshot.confirmationId !== 'string' ||
      !uuid.test(snapshot.confirmationId) ||
      !('stage' in snapshot) ||
      snapshot.stage !== 'WAITING_EXECUTION_FILING' ||
      !('version' in snapshot) ||
      !Number.isSafeInteger(snapshot.version) ||
      !('mailedAt' in snapshot) ||
      typeof snapshot.mailedAt !== 'string' ||
      !('recordedAt' in snapshot) ||
      typeof snapshot.recordedAt !== 'string'
    )
      throw error('internal', 'INVALID_RECEIPT');
    return snapshot as MailCaseExecutionResponseDto;
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
