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
import { Prisma } from '../../generated/prisma/client';
import { MaterialService } from '../materials';
import { readCaseSourceAnchor } from './case-entry-source';
import { assertExecutionSourceChain } from './case-execution-source';
import {
  CaseClosureResult,
  CorrectCaseClosureInput,
  RecordCaseClosureInput,
} from './case-closure.dto';

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const failure = (code: string) => {
  const body = { code, message: '保存结案资料失败' };
  if (code === 'VALIDATION_ERROR') return new BadRequestException(body);
  if (code === 'ACTION_FORBIDDEN') return new ForbiddenException(body);
  if (code === 'CASE_NOT_FOUND') return new NotFoundException(body);
  if (code === 'INVALID_RECEIPT') return new InternalServerErrorException(body);
  return new ConflictException(body);
};

@Injectable()
export class CaseClosureService {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: AccessControlService,
    private readonly materials: MaterialService,
  ) {}

  record(actor: ActorContext, caseId: string, input: RecordCaseClosureInput) {
    return this.execute(actor, caseId, input, 'RECORD');
  }
  correct(actor: ActorContext, caseId: string, input: CorrectCaseClosureInput) {
    return this.execute(actor, caseId, input, 'CORRECT');
  }

  private async execute(
    actor: ActorContext,
    caseId: string,
    input: RecordCaseClosureInput | CorrectCaseClosureInput,
    command: 'RECORD' | 'CORRECT',
  ): Promise<CaseClosureResult> {
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
          expectedFinishId: input.expectedFinishId,
          expectedClosureVersionId:
            'expectedClosureVersionId' in input
              ? input.expectedClosureVersionId
              : null,
          closeAt: input.closeAt,
          closeAmountState: input.closeAmountState,
          closeAmt: input.closeAmt,
          note: input.note,
          correctionReason:
            'correctionReason' in input ? input.correctionReason : null,
          closeContentVersionIds: input.closeContentVersionIds,
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
                closure: {
                  select: {
                    id: true,
                    finishId: true,
                    currentVersionId: true,
                    currentVersion: { select: { id: true, toVersion: true } },
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
            if (account.accountType === 'LAWYER' && command === 'RECORD')
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
                  command === 'RECORD'
                    ? 'case.closure.record'
                    : 'case.closure.correct',
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
            const priorReceipt = await tx.caseClosureReceipt.findUnique({
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
            const finish = record.executionFinish;
            const closure = record.closure;
            if (
              record.stage !== 'WAITING_ARCHIVE' ||
              (finish === null
                ? source.kind !== 'EXTERNAL_ENTRY' ||
                  source.initialStage !== 'WAITING_ARCHIVE' ||
                  input.expectedFinishId !== null ||
                  record.currentExecutionSubmissionId !== null ||
                  record.currentJudgmentNextStepId !== null ||
                  record.currentSecondInstanceResultId !== null
                : finish.id !== input.expectedFinishId) ||
              (command === 'RECORD'
                ? closure !== null ||
                  (finish !== null &&
                    finish.toVersion !== input.expectedVersion)
                : closure === null ||
                  closure.finishId !== (finish?.id ?? null) ||
                  closure.currentVersion === null ||
                  closure.currentVersion.toVersion !== input.expectedVersion ||
                  !('expectedClosureVersionId' in input) ||
                  closure.currentVersionId !==
                    input.expectedClosureVersionId) ||
              (source.kind === 'EXTERNAL_ENTRY' &&
                input.closeAt !== null &&
                input.closeAt < source.stageReachedOn)
            )
              throw failure('INVALID_STATE');
            const facts =
              input.closeContentVersionIds.length === 0
                ? []
                : await this.materials.assertAvailableVersions(tx, actor, {
                    ownerType: 'CASE',
                    ownerId: caseId,
                    category: 'CASE_CLOSURE_DOCUMENT',
                    contentVersionIds: input.closeContentVersionIds,
                    minCount: 1,
                    maxCount: 10,
                  });
            if (
              new Set(facts.map((fact) => fact.materialId)).size !==
              facts.length
            )
              throw failure('VALIDATION_ERROR');
            const closureId = closure?.id ?? randomUUID();
            const closureVersionId = randomUUID();
            const auditEventId = randomUUID();
            const recordedAt = new Date();
            const priorVersionId = closure?.currentVersionId ?? null;
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
                  command === 'RECORD'
                    ? 'case.closure.recorded'
                    : 'case.closure.corrected',
                details: {
                  closureId,
                  closureVersionId,
                  finishId: finish?.id ?? null,
                  priorVersionId,
                  fromVersion: input.expectedVersion,
                  toVersion: input.expectedVersion + 1,
                  closeAt: input.closeAt,
                  closeAmountState: input.closeAmountState,
                  closeAmt:
                    input.closeAmt === null
                      ? null
                      : new Prisma.Decimal(input.closeAmt).toFixed(2),
                  note: input.note,
                  correctionReason:
                    'correctionReason' in input ? input.correctionReason : null,
                  closeContentVersionIds: input.closeContentVersionIds,
                },
              },
            });
            if (closure === null)
              await tx.caseClosure.create({
                data: {
                  id: closureId,
                  caseId,
                  departmentId: actor.departmentId,
                  finishId: finish?.id ?? null,
                  externalEntryId:
                    source.kind === 'EXTERNAL_ENTRY' ? source.entryId : null,
                },
              });
            await tx.caseClosureVersion.create({
              data: {
                id: closureVersionId,
                closureId,
                caseId,
                departmentId: actor.departmentId,
                finishId: finish?.id ?? null,
                externalEntryId:
                  source.kind === 'EXTERNAL_ENTRY' ? source.entryId : null,
                kind: command === 'RECORD' ? 'REGISTER' : 'CORRECT',
                priorVersionId,
                fromVersion: input.expectedVersion,
                toVersion: input.expectedVersion + 1,
                closeAt:
                  input.closeAt === null
                    ? null
                    : new Date(`${input.closeAt}T00:00:00.000Z`),
                closeAmountState: input.closeAmountState,
                closeAmt: input.closeAmt,
                note: input.note,
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
                stage: 'WAITING_ARCHIVE',
                version: input.expectedVersion,
                currentTrialRoundId: record.currentTrialRoundId,
                currentJudgmentNextStepId: record.currentJudgmentNextStepId,
                currentSecondInstanceResultId:
                  record.currentSecondInstanceResultId,
                currentExecutionSubmissionId:
                  record.currentExecutionSubmissionId,
                ...(finish === null
                  ? { executionFinish: { is: null } }
                  : { executionFinish: { is: { id: finish.id } } }),
                closure: {
                  is: { id: closureId, currentVersionId: priorVersionId },
                },
              },
              data: { version: { increment: 1 } },
            });
            if (updated.count !== 1) throw failure('VERSION_CONFLICT');
            const head = await tx.caseClosure.updateMany({
              where: {
                id: closureId,
                caseId,
                departmentId: actor.departmentId,
                finishId: finish?.id ?? null,
                currentVersionId: priorVersionId,
              },
              data: { currentVersionId: closureVersionId },
            });
            if (head.count !== 1) throw failure('VERSION_CONFLICT');
            if (facts.length > 0)
              await this.materials.freezeCaseClosureReferences(
                tx,
                actor,
                caseId,
                closureVersionId,
                facts,
                auditEventId,
              );
            const response: CaseClosureResult = {
              id: caseId,
              closureId,
              closureVersionId,
              finishId: finish?.id ?? null,
              stage: 'WAITING_ARCHIVE',
              version: input.expectedVersion + 1,
              recordedAt: recordedAt.toISOString(),
            };
            await tx.caseClosureReceipt.create({
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
    input: RecordCaseClosureInput | CorrectCaseClosureInput,
    command: 'RECORD' | 'CORRECT',
  ): void {
    const keys = [
      'expectedVersion',
      'idempotencyKey',
      'expectedFinishId',
      'closeAt',
      'closeAmountState',
      'closeAmt',
      'note',
      'closeContentVersionIds',
      ...(command === 'CORRECT'
        ? ['expectedClosureVersionId', 'correctionReason']
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
      (input.expectedFinishId !== null &&
        (typeof input.expectedFinishId !== 'string' ||
          !uuid.test(input.expectedFinishId))) ||
      !['KNOWN', 'PENDING'].includes(input.closeAmountState) ||
      (input.closeAmountState === 'KNOWN'
        ? typeof input.closeAmt !== 'string' ||
          !/^\d{1,14}(?:\.\d{1,2})?$/u.test(input.closeAmt)
        : input.closeAmt !== null) ||
      !(
        input.note === null ||
        (typeof input.note === 'string' &&
          /\S/u.test(input.note) &&
          input.note.length <= 2000)
      ) ||
      !Array.isArray(input.closeContentVersionIds) ||
      input.closeContentVersionIds.length > 10 ||
      new Set(
        input.closeContentVersionIds.map((id) =>
          typeof id === 'string' ? id.toLowerCase() : id,
        ),
      ).size !== input.closeContentVersionIds.length ||
      input.closeContentVersionIds.some(
        (id) => typeof id !== 'string' || !uuid.test(id),
      ) ||
      (command === 'CORRECT' &&
        (!('expectedClosureVersionId' in input) ||
          typeof input.expectedClosureVersionId !== 'string' ||
          !uuid.test(input.expectedClosureVersionId) ||
          !('correctionReason' in input) ||
          typeof input.correctionReason !== 'string' ||
          !/\S/u.test(input.correctionReason) ||
          input.correctionReason.length > 500))
    )
      throw failure('VALIDATION_ERROR');
    if (input.closeAt !== null) {
      if (
        typeof input.closeAt !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}$/u.test(input.closeAt)
      )
        throw failure('VALIDATION_ERROR');
      const date = new Date(`${input.closeAt}T00:00:00.000Z`);
      const today = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date());
      if (
        Number.isNaN(date.getTime()) ||
        date.getUTCFullYear() < 1 ||
        date.toISOString().slice(0, 10) !== input.closeAt ||
        input.closeAt > today
      )
        throw failure('VALIDATION_ERROR');
    }
  }
  private receipt(value: unknown, caseId: string): CaseClosureResult {
    if (
      typeof value !== 'object' ||
      value === null ||
      Array.isArray(value) ||
      Object.keys(value).length !== 7 ||
      !('id' in value) ||
      value.id !== caseId ||
      !('closureId' in value) ||
      typeof value.closureId !== 'string' ||
      !uuid.test(value.closureId) ||
      !('closureVersionId' in value) ||
      typeof value.closureVersionId !== 'string' ||
      !uuid.test(value.closureVersionId) ||
      !('finishId' in value) ||
      (value.finishId !== null &&
        (typeof value.finishId !== 'string' || !uuid.test(value.finishId))) ||
      !('stage' in value) ||
      value.stage !== 'WAITING_ARCHIVE' ||
      !('version' in value) ||
      typeof value.version !== 'number' ||
      !Number.isSafeInteger(value.version) ||
      value.version < 2 ||
      !('recordedAt' in value) ||
      typeof value.recordedAt !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(
        value.recordedAt,
      ) ||
      Number.isNaN(Date.parse(value.recordedAt))
    )
      throw failure('INVALID_RECEIPT');
    return {
      id: caseId,
      closureId: value.closureId,
      closureVersionId: value.closureVersionId,
      finishId: value.finishId,
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
