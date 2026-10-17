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
import { currentLawyerBindingId } from '../../access-control/lawyer-case-access';
import { DatabaseService } from '../../database/database.service';
import type { Prisma } from '../../generated/prisma/client';
import { MaterialService } from '../materials';
import {
  CaseExecutionFilingFollowupCommands,
  RecordExecutionFilingFeedbackInput,
  CorrectExecutionFilingFeedbackInput,
  SubmitExecutionFilingSupplementInput,
  CorrectExecutionFilingSupplementInput,
  executionFilingFollowupPermissions,
} from './case-execution-filing-followup.contract';
import {
  RecordExecutionFilingFeedbackDto,
  CorrectExecutionFilingFeedbackDto,
  SubmitExecutionFilingSupplementDto,
  CorrectExecutionFilingSupplementDto,
  ExecutionFilingFeedbackResultDto,
  ExecutionFilingSupplementResultDto,
} from './case-execution-filing-followup.dto';

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
type Command = keyof typeof executionFilingFollowupPermissions;
type FeedbackValue = {
  command: 'FEEDBACK_RECORD' | 'FEEDBACK_CORRECT';
  filingId: string;
  feedbackId: string;
  expectedRevision: number;
  idempotencyKey: string;
  feedbackOn: string | null;
  courtCaseNo: string | null;
  content: string;
  correctionReason: string | null;
};
type SupplementValue = {
  command: 'SUPPLEMENT_SUBMIT' | 'SUPPLEMENT_CORRECT';
  filingId: string;
  supplementId: string;
  expectedRevision: number;
  idempotencyKey: string;
  submittedOn: string | null;
  note: string | null;
  contentVersionIds: string[];
  correctionReason: string | null;
};
const events = {
  FEEDBACK_RECORD: 'case.execution.feedback.recorded',
  FEEDBACK_CORRECT: 'case.execution.feedback.corrected',
  SUPPLEMENT_SUBMIT: 'case.execution.supplement.submitted',
  SUPPLEMENT_CORRECT: 'case.execution.supplement.corrected',
} as const;
const isoDay = (value: Date | null) =>
  value === null ? null : value.toISOString().slice(0, 10);

/** Independent immutable followup facts; the original execution filing and workflow stay unchanged. */
@Injectable()
export class CaseExecutionFilingFollowupService implements CaseExecutionFilingFollowupCommands {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: AccessControlService,
    private readonly materials: MaterialService,
  ) {}

  async recordFeedback(
    actor: ActorContext,
    caseId: string,
    input: RecordExecutionFilingFeedbackInput,
  ): Promise<ExecutionFilingFeedbackResultDto> {
    const { filingId, ...body } = this.object(input);
    const value = this.validate(RecordExecutionFilingFeedbackDto, body);
    return this.feedback(actor, this.id(caseId), {
      ...value,
      filingId: this.id(filingId),
      feedbackId: this.id(value.feedbackId),
      command: 'FEEDBACK_RECORD',
      correctionReason: null,
    });
  }

  async correctFeedback(
    actor: ActorContext,
    caseId: string,
    input: CorrectExecutionFilingFeedbackInput,
  ): Promise<ExecutionFilingFeedbackResultDto> {
    const { filingId, feedbackId, ...body } = this.object(input);
    const value = this.validate(CorrectExecutionFilingFeedbackDto, body);
    return this.feedback(actor, this.id(caseId), {
      ...value,
      filingId: this.id(filingId),
      feedbackId: this.id(feedbackId),
      command: 'FEEDBACK_CORRECT',
    });
  }

  async submitSupplement(
    actor: ActorContext,
    caseId: string,
    input: SubmitExecutionFilingSupplementInput,
  ): Promise<ExecutionFilingSupplementResultDto> {
    const { filingId, ...body } = this.object(input);
    const value = this.validate(SubmitExecutionFilingSupplementDto, body);
    return this.supplement(actor, this.id(caseId), {
      ...value,
      filingId: this.id(filingId),
      supplementId: this.id(value.supplementId),
      contentVersionIds: this.files(value.contentVersionIds),
      command: 'SUPPLEMENT_SUBMIT',
      correctionReason: null,
    });
  }

  async correctSupplement(
    actor: ActorContext,
    caseId: string,
    input: CorrectExecutionFilingSupplementInput,
  ): Promise<ExecutionFilingSupplementResultDto> {
    const { filingId, supplementId, ...body } = this.object(input);
    const value = this.validate(CorrectExecutionFilingSupplementDto, body);
    return this.supplement(actor, this.id(caseId), {
      ...value,
      filingId: this.id(filingId),
      supplementId: this.id(supplementId),
      contentVersionIds: this.files(value.contentVersionIds),
      command: 'SUPPLEMENT_CORRECT',
    });
  }

  private feedback(
    actor: ActorContext,
    caseId: string,
    value: FeedbackValue,
  ): Promise<ExecutionFilingFeedbackResultDto> {
    const fingerprint = this.fingerprint(caseId, value);
    return this.transaction(async (tx) => {
      const authorization = await this.lockAndAuthorize(
        tx,
        actor,
        caseId,
        value.command,
      );
      const prior = await this.prior(tx, actor, caseId, value, fingerprint);
      if (prior !== null) return this.feedbackReceipt(prior, value);
      await this.assertFiling(
        tx,
        actor,
        caseId,
        value.filingId,
        authorization.stage,
      );
      await this.lockTarget(tx, value.feedbackId);
      const scope = {
        caseId,
        departmentId: actor.departmentId,
        filingId: value.filingId,
      };
      const initial = value.command === 'FEEDBACK_RECORD';
      if (initial)
        await this.assertUnusedTarget(
          tx,
          actor,
          caseId,
          value.filingId,
          value.feedbackId,
          'FEEDBACK',
        );
      else {
        const root = await tx.caseExecutionFilingFeedback.findFirst({
          where: {
            ...scope,
            id: value.feedbackId,
            feedbackId: value.feedbackId,
            fromRevision: 0,
            toRevision: 1,
          },
          select: { id: true },
        });
        if (root === null) throw this.conflict('INVALID_STATE');
      }
      const head = initial
        ? null
        : await tx.caseExecutionFilingFeedback.findFirst({
            where: { ...scope, feedbackId: value.feedbackId },
            orderBy: { toRevision: 'desc' },
          });
      if ((head?.toRevision ?? 0) !== value.expectedRevision)
        throw this.conflict('VERSION_CONFLICT');
      const before =
        head === null
          ? null
          : {
              feedbackOn: isoDay(head.feedbackOn),
              courtCaseNo: head.courtCaseNo,
              content: head.content,
            };
      const after = {
        feedbackOn: value.feedbackOn,
        courtCaseNo: value.courtCaseNo,
        content: value.content,
      };
      if (before !== null && JSON.stringify(before) === JSON.stringify(after))
        throw this.invalid('反馈内容没有变化');
      const versionId = initial ? value.feedbackId : randomUUID();
      const recordedAt = new Date();
      const auditEventId = randomUUID();
      const revision = value.expectedRevision + 1;
      await tx.auditEvent.create({
        data: {
          id: auditEventId,
          departmentId: actor.departmentId,
          actorUserId: actor.userId,
          ...authorization.actorFields,
          resourceType: 'CASE',
          resourceId: caseId,
          action: events[value.command],
          details: {
            versionId,
            filingId: value.filingId,
            feedbackId: value.feedbackId,
            fromRevision: value.expectedRevision,
            toRevision: revision,
            correctionReason: value.correctionReason,
            before,
            after,
          },
        },
      });
      await tx.caseExecutionFilingFeedback.create({
        data: {
          id: versionId,
          feedbackId: value.feedbackId,
          priorVersionId: head?.id ?? null,
          ...scope,
          fromRevision: value.expectedRevision,
          toRevision: revision,
          feedbackOn: this.date(value.feedbackOn),
          courtCaseNo: value.courtCaseNo,
          content: value.content,
          correctionReason: value.correctionReason,
          actorType: authorization.actorType,
          recordedByUserId: actor.userId,
          ...authorization.actorFields,
          auditEventId,
          recordedAt,
        },
      });
      const result: ExecutionFilingFeedbackResultDto = {
        id: versionId,
        filingId: value.filingId,
        feedbackId: value.feedbackId,
        revision,
        recordedAt: recordedAt.toISOString(),
      };
      await tx.caseExecutionFilingFollowupReceipt.create({
        data: {
          ...scope,
          actorUserId: actor.userId,
          command: value.command,
          idempotencyKey: value.idempotencyKey,
          requestFingerprint: fingerprint,
          feedbackVersionId: versionId,
          supplementVersionId: null,
          resultSnapshot: { ...result },
        },
      });
      return result;
    });
  }

  private supplement(
    actor: ActorContext,
    caseId: string,
    value: SupplementValue,
  ): Promise<ExecutionFilingSupplementResultDto> {
    const fingerprint = this.fingerprint(caseId, value);
    return this.transaction(async (tx) => {
      const authorization = await this.lockAndAuthorize(
        tx,
        actor,
        caseId,
        value.command,
      );
      const prior = await this.prior(tx, actor, caseId, value, fingerprint);
      if (prior !== null) return this.supplementReceipt(prior, value);
      await this.assertFiling(
        tx,
        actor,
        caseId,
        value.filingId,
        authorization.stage,
      );
      await this.lockTarget(tx, value.supplementId);
      const scope = {
        caseId,
        departmentId: actor.departmentId,
        filingId: value.filingId,
      };
      const initial = value.command === 'SUPPLEMENT_SUBMIT';
      if (initial)
        await this.assertUnusedTarget(
          tx,
          actor,
          caseId,
          value.filingId,
          value.supplementId,
          'SUPPLEMENT',
        );
      else {
        const root = await tx.caseExecutionFilingSupplement.findFirst({
          where: {
            ...scope,
            id: value.supplementId,
            supplementId: value.supplementId,
            fromRevision: 0,
            toRevision: 1,
          },
          select: { id: true },
        });
        if (root === null) throw this.conflict('INVALID_STATE');
      }
      const head = initial
        ? null
        : await tx.caseExecutionFilingSupplement.findFirst({
            where: { ...scope, supplementId: value.supplementId },
            orderBy: { toRevision: 'desc' },
            include: { documents: true },
          });
      if ((head?.toRevision ?? 0) !== value.expectedRevision)
        throw this.conflict('VERSION_CONFLICT');
      const before =
        head === null
          ? null
          : {
              submittedOn: isoDay(head.submittedOn),
              note: head.note,
              contentVersionIds: head.documents
                .map((file) => file.contentVersionId)
                .sort(),
            };
      const after = {
        submittedOn: value.submittedOn,
        note: value.note,
        contentVersionIds: value.contentVersionIds,
      };
      if (before !== null && JSON.stringify(before) === JSON.stringify(after))
        throw this.invalid('补交资料没有变化');
      const target = {
        filingId: value.filingId,
        supplementId: value.supplementId,
        expectedRevision: value.expectedRevision,
      };
      const facts = await this.materials.assertExecutionSupplementVersions(
        tx,
        actor,
        caseId,
        target,
        value.contentVersionIds,
      );
      const versionId = initial ? value.supplementId : randomUUID();
      const recordedAt = new Date();
      const auditEventId = randomUUID();
      const revision = value.expectedRevision + 1;
      await tx.auditEvent.create({
        data: {
          id: auditEventId,
          departmentId: actor.departmentId,
          actorUserId: actor.userId,
          ...authorization.actorFields,
          resourceType: 'CASE',
          resourceId: caseId,
          action: events[value.command],
          details: {
            versionId,
            filingId: value.filingId,
            supplementId: value.supplementId,
            fromRevision: value.expectedRevision,
            toRevision: revision,
            correctionReason: value.correctionReason,
            before,
            after,
          },
        },
      });
      await tx.caseExecutionFilingSupplement.create({
        data: {
          id: versionId,
          supplementId: value.supplementId,
          priorVersionId: head?.id ?? null,
          ...scope,
          fromRevision: value.expectedRevision,
          toRevision: revision,
          submittedOn: this.date(value.submittedOn),
          note: value.note,
          correctionReason: value.correctionReason,
          actorType: authorization.actorType,
          recordedByUserId: actor.userId,
          ...authorization.actorFields,
          auditEventId,
          recordedAt,
        },
      });
      await this.materials.freezeCaseExecutionSupplementReferences(
        tx,
        actor,
        caseId,
        { ...target, versionId },
        facts,
        auditEventId,
      );
      const result: ExecutionFilingSupplementResultDto = {
        id: versionId,
        filingId: value.filingId,
        supplementId: value.supplementId,
        revision,
        recordedAt: recordedAt.toISOString(),
      };
      await tx.caseExecutionFilingFollowupReceipt.create({
        data: {
          ...scope,
          actorUserId: actor.userId,
          command: value.command,
          idempotencyKey: value.idempotencyKey,
          requestFingerprint: fingerprint,
          feedbackVersionId: null,
          supplementVersionId: versionId,
          resultSnapshot: { ...result },
        },
      });
      return result;
    });
  }

  private async lockAndAuthorize(
    tx: Prisma.TransactionClient,
    actor: ActorContext,
    caseId: string,
    command: Command,
  ) {
    if (
      actor.clientCustomerId !== undefined ||
      actor.notaryOfficeId !== undefined
    )
      throw this.forbidden();
    const locked = await tx.$queryRawUnsafe<Array<{ id: string }>>(
      'SELECT "id" FROM "cases" WHERE "id"=$1::uuid AND "department_id"=$2::uuid FOR UPDATE',
      caseId,
      actor.departmentId,
    );
    if (locked.length !== 1) throw this.notFound();
    const record = await tx.case.findFirst({
      where: { id: caseId, departmentId: actor.departmentId },
      select: {
        stage: true,
        departmentId: true,
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
    if (account.accountType === 'LAWYER') {
      const lawyerAccountBindingId = await currentLawyerBindingId(
        tx,
        actor,
        caseId,
        true,
      );
      return {
        stage: record.stage,
        actorType: 'LAWYER' as const,
        actorFields: { lawyerAccountBindingId },
      };
    }
    if (
      account.accountType !== 'INTERNAL' ||
      actor.lawyerAccountId !== undefined
    )
      throw this.forbidden();
    try {
      await this.access.authorizeCase(
        actor,
        executionFilingFollowupPermissions[command],
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
    return {
      stage: record.stage,
      actorType: 'INTERNAL' as const,
      actorFields: { internalActorUserId: actor.userId },
    };
  }

  private async assertFiling(
    tx: Prisma.TransactionClient,
    actor: ActorContext,
    caseId: string,
    filingId: string,
    stage: string,
  ) {
    if (stage !== 'EXECUTING') throw this.conflict('INVALID_STATE');
    const filing = await tx.caseExecutionFiling.findFirst({
      where: { id: filingId, caseId, departmentId: actor.departmentId },
      select: { id: true },
    });
    if (filing === null) throw this.conflict('INVALID_STATE');
  }

  private async lockTarget(tx: Prisma.TransactionClient, targetId: string) {
    await tx.$executeRawUnsafe(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      `execution-filing-followup-target:${targetId}`,
    );
  }

  private async assertUnusedTarget(
    tx: Prisma.TransactionClient,
    actor: ActorContext,
    caseId: string,
    filingId: string,
    targetId: string,
    kind: 'FEEDBACK' | 'SUPPLEMENT',
  ) {
    const [feedback, supplement, drafts] = await Promise.all([
      tx.caseExecutionFilingFeedback.findFirst({
        where: { OR: [{ id: targetId }, { feedbackId: targetId }] },
        select: { id: true },
      }),
      tx.caseExecutionFilingSupplement.findFirst({
        where: { OR: [{ id: targetId }, { supplementId: targetId }] },
        select: { id: true },
      }),
      tx.uploadDraft.findMany({
        where: { executionSupplementTargetId: targetId },
        select: {
          ownerType: true,
          ownerId: true,
          departmentId: true,
          executionSupplementFilingId: true,
          executionSupplementRevision: true,
        },
      }),
    ]);
    if (
      feedback !== null ||
      supplement !== null ||
      drafts.some(
        (draft) =>
          kind === 'FEEDBACK' ||
          draft.ownerType !== 'CASE' ||
          draft.ownerId !== caseId ||
          draft.departmentId !== actor.departmentId ||
          draft.executionSupplementFilingId !== filingId ||
          draft.executionSupplementRevision !== 0,
      )
    )
      throw this.conflict('VERSION_CONFLICT');
  }

  private async prior(
    tx: Prisma.TransactionClient,
    actor: ActorContext,
    caseId: string,
    value: FeedbackValue | SupplementValue,
    fingerprint: string,
  ) {
    const prior = await tx.caseExecutionFilingFollowupReceipt.findUnique({
      where: {
        departmentId_actorUserId_idempotencyKey: {
          departmentId: actor.departmentId,
          actorUserId: actor.userId,
          idempotencyKey: value.idempotencyKey,
        },
      },
    });
    if (
      prior !== null &&
      (prior.caseId !== caseId ||
        prior.filingId !== value.filingId ||
        prior.command !== value.command ||
        prior.requestFingerprint !== fingerprint)
    )
      throw this.conflict('IDEMPOTENCY_CONFLICT');
    return prior;
  }

  private feedbackReceipt(
    prior: {
      resultSnapshot: Prisma.JsonValue;
      feedbackVersionId: string | null;
      supplementVersionId: string | null;
    },
    value: FeedbackValue,
  ): ExecutionFilingFeedbackResultDto {
    const snapshot = this.receipt(prior.resultSnapshot, value, 'feedbackId');
    if (
      prior.feedbackVersionId !== snapshot.id ||
      prior.supplementVersionId !== null
    )
      throw this.corrupt();
    return {
      id: snapshot.id,
      filingId: value.filingId,
      feedbackId: value.feedbackId,
      revision: value.expectedRevision + 1,
      recordedAt: snapshot.recordedAt,
    };
  }

  private supplementReceipt(
    prior: {
      resultSnapshot: Prisma.JsonValue;
      feedbackVersionId: string | null;
      supplementVersionId: string | null;
    },
    value: SupplementValue,
  ): ExecutionFilingSupplementResultDto {
    const snapshot = this.receipt(prior.resultSnapshot, value, 'supplementId');
    if (
      prior.supplementVersionId !== snapshot.id ||
      prior.feedbackVersionId !== null
    )
      throw this.corrupt();
    return {
      id: snapshot.id,
      filingId: value.filingId,
      supplementId: value.supplementId,
      revision: value.expectedRevision + 1,
      recordedAt: snapshot.recordedAt,
    };
  }

  private receipt(
    snapshot: Prisma.JsonValue,
    value: FeedbackValue | SupplementValue,
    target: 'feedbackId' | 'supplementId',
  ) {
    const targetId =
      'feedbackId' in value ? value.feedbackId : value.supplementId;
    if (
      snapshot === null ||
      typeof snapshot !== 'object' ||
      Array.isArray(snapshot) ||
      Object.keys(snapshot).sort().join() !==
        ['id', 'filingId', target, 'revision', 'recordedAt'].sort().join() ||
      typeof snapshot.id !== 'string' ||
      !uuid.test(snapshot.id) ||
      snapshot.filingId !== value.filingId ||
      snapshot[target] !== targetId ||
      snapshot.revision !== value.expectedRevision + 1 ||
      typeof snapshot.recordedAt !== 'string' ||
      !Number.isFinite(Date.parse(snapshot.recordedAt))
    )
      throw this.corrupt();
    return { id: snapshot.id, recordedAt: snapshot.recordedAt };
  }

  private object<T extends object>(input: T): T {
    if (input === null || typeof input !== 'object' || Array.isArray(input))
      throw this.invalid();
    return input;
  }
  private validate<T extends { expectedRevision: number }>(
    dto: new () => T,
    input: object,
  ): T {
    const result = plainToInstance(dto, input);
    if (
      validateSync(result, { whitelist: true, forbidNonWhitelisted: true })
        .length > 0 ||
      result.expectedRevision >= 2147483647
    )
      throw this.invalid();
    return result;
  }
  private id(value: string): string {
    if (typeof value !== 'string' || !uuid.test(value)) throw this.invalid();
    return value.toLowerCase();
  }
  private files(ids: string[]) {
    const result = ids.map((id) => this.id(id)).sort();
    if (new Set(result).size !== result.length) throw this.invalid();
    return result;
  }
  private date(value: string | null) {
    return value === null ? null : new Date(`${value}T00:00:00.000Z`);
  }
  private fingerprint(caseId: string, value: FeedbackValue | SupplementValue) {
    const business =
      'feedbackId' in value
        ? {
            feedbackId: value.feedbackId,
            feedbackOn: value.feedbackOn,
            courtCaseNo: value.courtCaseNo,
            content: value.content,
          }
        : {
            supplementId: value.supplementId,
            submittedOn: value.submittedOn,
            note: value.note,
            contentVersionIds: value.contentVersionIds,
          };
    return createHash('sha256')
      .update(
        JSON.stringify({
          caseId,
          command: value.command,
          filingId: value.filingId,
          expectedRevision: value.expectedRevision,
          idempotencyKey: value.idempotencyKey,
          correctionReason: value.correctionReason,
          ...business,
        }),
      )
      .digest('hex');
  }
  private async transaction<T>(
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.database.$transaction(operation, {
          isolationLevel: 'Serializable',
        });
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
  private hasCode(cause: unknown, code: string): boolean {
    if (cause === null || typeof cause !== 'object') return false;
    if (
      ['code', 'originalCode', 'sqlState'].some(
        (key) => key in cause && Reflect.get(cause, key) === code,
      )
    )
      return true;
    return ['cause', 'meta', 'driverAdapterError'].some(
      (key) => key in cause && this.hasCode(Reflect.get(cause, key), code),
    );
  }
  private invalid(message = '执行申请后续资料输入无效') {
    return new BadRequestException({ code: 'VALIDATION_ERROR', message });
  }
  private conflict(code: string) {
    return new ConflictException({
      code,
      message: '执行申请后续资料冲突，请刷新后重试',
    });
  }
  private forbidden() {
    return new ForbiddenException({
      code: 'ACTION_FORBIDDEN',
      message: '无权办理执行申请后续资料',
    });
  }
  private notFound() {
    return new NotFoundException({
      code: 'CASE_NOT_FOUND',
      message: '案件不存在',
    });
  }
  private corrupt() {
    return new InternalServerErrorException({
      code: 'INVALID_RECEIPT',
      message: '执行申请后续资料回执不完整',
    });
  }
}
