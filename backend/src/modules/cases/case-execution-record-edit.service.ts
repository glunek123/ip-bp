import { createHash, randomUUID } from 'node:crypto';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
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
import { DatabaseService } from '../../database/database.service';
import type { Prisma } from '../../generated/prisma/client';
import { MaterialService } from '../materials';
import { readCaseSourceAnchor } from './case-entry-source';
import { assertExecutionSourceChain } from './case-execution-source';
import {
  CorrectExecutionMailingRecordDto,
  CorrectExecutionFilingRecordDto,
  CorrectExecutionFinishRecordDto,
  ExecutionMailingRecordCorrectionResultDto,
  ExecutionFilingRecordCorrectionResultDto,
  ExecutionFinishRecordCorrectionResultDto,
} from './case-section-record-edit.dto';

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const day = (date: Date) => date.toISOString().slice(0, 10);
type Kind = 'MAILING' | 'FILING' | 'FINISH';
type Result =
  | ExecutionMailingRecordCorrectionResultDto
  | ExecutionFilingRecordCorrectionResultDto
  | ExecutionFinishRecordCorrectionResultDto;
type Value = {
  kind: Kind;
  targetId: string;
  revision: number;
  date: string;
  correctionReason: string;
  idempotencyKey: string;
  contentVersionIds: string[];
  businessReason: string | null;
  basisNote: string | null;
};
const config = {
  MAILING: {
    action: 'case.execution.mailing.correct',
    event: 'case.execution.mailing.record-corrected',
    command: 'EXECUTION_MAILING_CORRECTION',
    material: 'EXECUTION_MAILING',
    category: 'MAIL_RECEIPT',
    target: 'mailingId',
    revision: 'mailingRevision',
    date: 'mailedAt',
  },
  FILING: {
    action: 'case.execution.filing.correct',
    event: 'case.execution.filing.record-corrected',
    command: 'EXECUTION_FILING_CORRECTION',
    material: 'EXECUTION_FILING',
    category: 'EXECUTION_FILING_PROOF',
    target: 'filingId',
    revision: 'filingRevision',
    date: 'submittedAt',
  },
  FINISH: {
    action: 'case.execution.finish.correct',
    event: 'case.execution.finish.record-corrected',
    command: 'EXECUTION_FINISH_CORRECTION',
    material: 'EXECUTION_FINISH',
    category: 'EXECUTION_FINISH_BASIS',
    target: 'finishId',
    revision: 'finishRevision',
    date: 'finishedAt',
  },
} as const;

/** Append corrections to existing facts. Workflow roots, evidence and receipts stay frozen. */
@Injectable()
export class CaseExecutionRecordEditService {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: AccessControlService,
    private readonly materials: MaterialService,
  ) {}

  async correctMailing(
    actor: ActorContext,
    caseId: string,
    input: CorrectExecutionMailingRecordDto,
  ): Promise<ExecutionMailingRecordCorrectionResultDto> {
    this.validate(CorrectExecutionMailingRecordDto, input);
    const value = this.value(
      'MAILING',
      input.mailingId,
      input.expectedMailingRevision,
      input.mailedAt,
      input.reason,
      input.idempotencyKey,
      input.mailReceiptContentVersionIds,
    );
    return this.mailingResult(await this.correct(actor, caseId, value));
  }

  async correctFiling(
    actor: ActorContext,
    caseId: string,
    input: CorrectExecutionFilingRecordDto,
  ): Promise<ExecutionFilingRecordCorrectionResultDto> {
    this.validate(CorrectExecutionFilingRecordDto, input);
    const value = this.value(
      'FILING',
      input.filingId,
      input.expectedFilingRevision,
      input.submittedAt,
      input.reason,
      input.idempotencyKey,
      input.executionFilingProofContentVersionIds,
    );
    return this.filingResult(await this.correct(actor, caseId, value));
  }

  async correctFinish(
    actor: ActorContext,
    caseId: string,
    input: CorrectExecutionFinishRecordDto,
  ): Promise<ExecutionFinishRecordCorrectionResultDto> {
    this.validate(CorrectExecutionFinishRecordDto, input);
    const value = this.value(
      'FINISH',
      input.finishId,
      input.expectedFinishRevision,
      input.finishedAt,
      input.correctionReason,
      input.idempotencyKey,
      input.basisContentVersionIds,
      input.reason,
      input.basisNote,
    );
    return this.finishResult(await this.correct(actor, caseId, value));
  }

  private async correct(
    actor: ActorContext,
    caseIdInput: string,
    value: Value,
  ): Promise<Result> {
    if (!uuid.test(caseIdInput)) throw this.invalid();
    const caseId = caseIdInput.toLowerCase();
    const definition = config[value.kind];
    const fingerprint = createHash('sha256')
      .update(JSON.stringify({ caseId, ...value }))
      .digest('hex');
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.database.$transaction(
          async (tx) => {
            await this.lockAndAuthorize(tx, actor, caseId, definition.action);
            const receiptKey = {
              departmentId: actor.departmentId,
              actorUserId: actor.userId,
              command: definition.command,
              idempotencyKey: value.idempotencyKey,
            };
            const prior = await tx.caseSectionRecordEditReceipt.findUnique({
              where: {
                departmentId_actorUserId_command_idempotencyKey: receiptKey,
              },
            });
            if (prior !== null) {
              if (
                prior.caseId !== caseId ||
                prior.requestFingerprint !== fingerprint
              )
                throw this.conflict('IDEMPOTENCY_CONFLICT');
              return this.receipt(prior.resultSnapshot, caseId, value);
            }
            const scope = { caseId, departmentId: actor.departmentId };
            const targetScope = { ...scope, id: value.targetId };
            const [original, head] =
              value.kind === 'MAILING'
                ? await Promise.all([
                    tx.caseExecutionMailing.findFirst({
                      where: targetScope,
                      include: { versions: true },
                    }),
                    tx.caseExecutionMailingRecordCorrection.findFirst({
                      where: { ...scope, mailingId: value.targetId },
                      orderBy: { toRevision: 'desc' },
                      include: { documents: true },
                    }),
                  ])
                : value.kind === 'FILING'
                  ? await Promise.all([
                      tx.caseExecutionFiling.findFirst({
                        where: targetScope,
                        include: { versions: true },
                      }),
                      tx.caseExecutionFilingRecordCorrection.findFirst({
                        where: { ...scope, filingId: value.targetId },
                        orderBy: { toRevision: 'desc' },
                        include: { documents: true },
                      }),
                    ])
                  : await Promise.all([
                      tx.caseExecutionFinish.findFirst({
                        where: targetScope,
                        include: { versions: true },
                      }),
                      tx.caseExecutionFinishRecordCorrection.findFirst({
                        where: { ...scope, finishId: value.targetId },
                        orderBy: { toRevision: 'desc' },
                        include: { documents: true },
                      }),
                    ]);
            if (original === null) throw this.conflict('INVALID_STATE');
            if ((head?.toRevision ?? 0) !== value.revision)
              throw this.conflict('VERSION_CONFLICT');
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
            if (
              (original.externalEntryId ?? null) !==
              (source.kind === 'EXTERNAL_ENTRY' ? source.entryId : null)
            )
              throw this.conflict('INVALID_STATE');
            if (
              source.kind === 'EXTERNAL_ENTRY' &&
              value.date < source.stageReachedOn
            )
              throw this.invalid('日期不得早于本案明确外部阶段来源日期');
            const beforeFiles = (head?.documents ?? original.versions)
              .map((file) => file.contentVersionId)
              .sort();
            const effective = head ?? original;
            let before: Prisma.InputJsonObject;
            if (value.kind === 'MAILING' && 'mailedAt' in effective)
              before = {
                mailedAt: day(effective.mailedAt),
                contentVersionIds: beforeFiles,
              };
            else if (value.kind === 'FILING' && 'submittedAt' in effective)
              before = {
                submittedAt: day(effective.submittedAt),
                contentVersionIds: beforeFiles,
              };
            else if (value.kind === 'FINISH' && 'finishedAt' in effective)
              before = {
                finishedAt: day(effective.finishedAt),
                reason:
                  'businessReason' in effective
                    ? effective.businessReason
                    : effective.reason,
                basisNote: effective.basisNote,
                contentVersionIds: beforeFiles,
              };
            else throw this.conflict('INVALID_STATE');
            const after: Prisma.InputJsonObject =
              value.kind === 'FINISH'
                ? {
                    finishedAt: value.date,
                    reason: value.businessReason,
                    basisNote: value.basisNote,
                    contentVersionIds: value.contentVersionIds,
                  }
                : {
                    [definition.date]: value.date,
                    contentVersionIds: value.contentVersionIds,
                  };
            if (JSON.stringify(before) === JSON.stringify(after))
              throw this.invalid('资料没有变化');
            const facts = await this.materials.assertAvailableVersions(
              tx,
              actor,
              {
                ownerType: 'CASE',
                ownerId: caseId,
                category: definition.category,
                sectionRecordKind: definition.material,
                sectionRecordTarget: {
                  kind: definition.material,
                  targetId: value.targetId,
                  expectedRevision: value.revision,
                },
                contentVersionIds: value.contentVersionIds,
                minCount: value.kind === 'FINISH' ? 0 : 1,
                maxCount: 10,
              },
            );
            const correctionId = randomUUID();
            const auditEventId = randomUUID();
            const recordedAt = new Date();
            await tx.auditEvent.create({
              data: {
                id: auditEventId,
                departmentId: actor.departmentId,
                actorUserId: actor.userId,
                internalActorUserId: actor.userId,
                resourceType: 'CASE',
                resourceId: caseId,
                action: definition.event,
                details: {
                  correctionId,
                  [definition.target]: value.targetId,
                  priorCorrectionId: head?.id ?? null,
                  fromRevision: value.revision,
                  toRevision: value.revision + 1,
                  correctionReason: value.correctionReason,
                  before,
                  after,
                },
              },
            });
            const common = {
              id: correctionId,
              ...scope,
              priorCorrectionId: head?.id ?? null,
              fromRevision: value.revision,
              toRevision: value.revision + 1,
              correctionReason: value.correctionReason,
              recordedAt,
              recordedByUserId: actor.userId,
              auditEventId,
            };
            if (value.kind === 'MAILING')
              await tx.caseExecutionMailingRecordCorrection.create({
                data: {
                  ...common,
                  mailingId: value.targetId,
                  mailedAt: new Date(`${value.date}T00:00:00.000Z`),
                },
              });
            else if (value.kind === 'FILING')
              await tx.caseExecutionFilingRecordCorrection.create({
                data: {
                  ...common,
                  filingId: value.targetId,
                  submittedAt: new Date(`${value.date}T00:00:00.000Z`),
                },
              });
            else
              await tx.caseExecutionFinishRecordCorrection.create({
                data: {
                  ...common,
                  finishId: value.targetId,
                  finishedAt: new Date(`${value.date}T00:00:00.000Z`),
                  businessReason: value.businessReason!,
                  basisNote: value.basisNote,
                },
              });
            await this.materials.freezeCaseSectionRecordCorrectionReferences(
              tx,
              actor,
              caseId,
              { kind: definition.material, correctionId },
              facts,
              auditEventId,
            );
            const result = this.result(
              caseId,
              correctionId,
              recordedAt.toISOString(),
              value,
            );
            await tx.caseSectionRecordEditReceipt.create({
              data: {
                ...receiptKey,
                caseId,
                requestFingerprint: fingerprint,
                resultSnapshot: { ...result },
              },
            });
            return result;
          },
          { isolationLevel: 'Serializable' },
        );
      } catch (cause) {
        if (
          this.hasCode(cause, 'P2034') ||
          this.hasCode(cause, '40001') ||
          this.hasCode(cause, 'P2002')
        ) {
          if (attempt < 2) continue;
          throw this.conflict('VERSION_CONFLICT');
        }
        throw cause;
      }
    }
    throw this.conflict('VERSION_CONFLICT');
  }

  private async lockAndAuthorize(
    tx: Prisma.TransactionClient,
    actor: ActorContext,
    caseId: string,
    action: (typeof config)[Kind]['action'],
  ) {
    if (
      actor.clientCustomerId !== undefined ||
      actor.lawyerAccountId !== undefined ||
      actor.notaryOfficeId !== undefined
    )
      throw this.forbidden();
    const locked = await tx.$queryRawUnsafe<Array<{ id: string }>>(
      'SELECT "id" FROM "cases" WHERE "id"=$1::uuid AND "department_id"=$2::uuid FOR UPDATE',
      caseId,
      actor.departmentId,
    );
    if (locked.length !== 1)
      throw new NotFoundException({
        code: 'CASE_NOT_FOUND',
        message: '案件不存在',
      });
    const record = await tx.case.findFirst({
      where: { id: caseId, departmentId: actor.departmentId },
      select: {
        departmentId: true,
        responsibleUserId: true,
        responsibleMembership: { select: { teamId: true } },
        currentTrialRoundId: true,
        currentJudgmentNextStepId: true,
        currentSecondInstanceResult: { select: { choiceId: true } },
        currentExecutionSubmission: { select: { trialRoundId: true } },
      },
    });
    if (record === null)
      throw new NotFoundException({
        code: 'CASE_NOT_FOUND',
        message: '案件不存在',
      });
    const account = await tx.userAccount.findUnique({
      where: { id: actor.userId },
      select: { active: true, accountType: true },
    });
    if (!account?.active || account.accountType !== 'INTERNAL')
      throw this.forbidden();
    try {
      await this.access.authorizeCase(
        actor,
        action,
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
      if (cause instanceof ForbiddenException) throw this.forbidden();
      throw cause;
    }
    return record;
  }

  private validate<T extends object>(dto: new () => T, input: T) {
    if (
      input === null ||
      typeof input !== 'object' ||
      Array.isArray(input) ||
      validateSync(plainToInstance(dto, input), {
        whitelist: true,
        forbidNonWhitelisted: true,
      }).length > 0
    )
      throw this.invalid();
  }
  private value(
    kind: Kind,
    targetId: string,
    revision: number,
    date: string,
    correctionReason: string,
    idempotencyKey: string,
    files: string[],
    businessReason: string | null = null,
    basisNote: string | null = null,
  ): Value {
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    const parsed = new Date(`${date}T00:00:00.000Z`);
    if (
      Number.isNaN(parsed.getTime()) ||
      day(parsed) !== date ||
      date > today ||
      revision >= 2147483647 ||
      idempotencyKey.trim() !== idempotencyKey
    )
      throw this.invalid();
    const contentVersionIds = files.map((id) => id.toLowerCase()).sort();
    if (new Set(contentVersionIds).size !== contentVersionIds.length)
      throw this.invalid();
    return {
      kind,
      targetId: targetId.toLowerCase(),
      revision,
      date,
      correctionReason: correctionReason.trim(),
      idempotencyKey,
      contentVersionIds,
      businessReason,
      basisNote,
    };
  }
  private result(
    caseId: string,
    correctionId: string,
    recordedAt: string,
    value: Value,
  ): Result {
    const common = { caseId, correctionId, recordedAt };
    if (value.kind === 'MAILING')
      return {
        ...common,
        mailingId: value.targetId,
        mailingRevision: value.revision + 1,
        mailedAt: value.date,
      };
    if (value.kind === 'FILING')
      return {
        ...common,
        filingId: value.targetId,
        filingRevision: value.revision + 1,
        submittedAt: value.date,
      };
    return {
      ...common,
      finishId: value.targetId,
      finishRevision: value.revision + 1,
      finishedAt: value.date,
    };
  }
  private receipt(
    snapshot: Prisma.JsonValue,
    caseId: string,
    value: Value,
  ): Result {
    const definition = config[value.kind];
    if (
      snapshot === null ||
      typeof snapshot !== 'object' ||
      Array.isArray(snapshot) ||
      Object.keys(snapshot).sort().join() !==
        [
          'caseId',
          'correctionId',
          'recordedAt',
          definition.target,
          definition.revision,
          definition.date,
        ]
          .sort()
          .join() ||
      snapshot.caseId !== caseId ||
      snapshot[definition.target] !== value.targetId ||
      snapshot[definition.revision] !== value.revision + 1 ||
      snapshot[definition.date] !== value.date ||
      typeof snapshot.correctionId !== 'string' ||
      !uuid.test(snapshot.correctionId) ||
      typeof snapshot.recordedAt !== 'string' ||
      !Number.isFinite(Date.parse(snapshot.recordedAt))
    )
      throw new InternalServerErrorException({
        code: 'INVALID_RECEIPT',
        message: '资料更正回执不完整',
      });
    return this.result(
      caseId,
      snapshot.correctionId,
      snapshot.recordedAt,
      value,
    );
  }
  private mailingResult(
    result: Result,
  ): ExecutionMailingRecordCorrectionResultDto {
    if (!('mailingId' in result)) throw this.conflict('INVALID_STATE');
    return result;
  }
  private filingResult(
    result: Result,
  ): ExecutionFilingRecordCorrectionResultDto {
    if (!('filingId' in result)) throw this.conflict('INVALID_STATE');
    return result;
  }
  private finishResult(
    result: Result,
  ): ExecutionFinishRecordCorrectionResultDto {
    if (!('finishId' in result)) throw this.conflict('INVALID_STATE');
    return result;
  }
  private invalid(message = '资料更正输入无效') {
    return new BadRequestException({ code: 'VALIDATION_ERROR', message });
  }
  private conflict(code: string) {
    return new ConflictException({
      code,
      message: '资料更正冲突，请刷新后重试',
    });
  }
  private forbidden() {
    return new ForbiddenException({
      code: 'ACTION_FORBIDDEN',
      message: '无权更正资料',
    });
  }
  private hasCode(cause: unknown, code: string): boolean {
    if (cause === null || typeof cause !== 'object') return false;
    if ('code' in cause && cause.code === code) return true;
    if ('originalCode' in cause && cause.originalCode === code) return true;
    if ('sqlState' in cause && cause.sqlState === code) return true;
    return ['cause', 'meta', 'driverAdapterError'].some(
      (key) => key in cause && this.hasCode(Reflect.get(cause, key), code),
    );
  }
}
