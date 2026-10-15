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
import { DatabaseService } from '../../database/database.service';
import { Prisma } from '../../generated/prisma/client';
import { MaterialService } from '../materials';
import {
  CorrectHearingRecordDto,
  CorrectJudgmentRecordDto,
  CorrectClosureRecordDto,
  HearingRecordCorrectionResultDto,
  JudgmentRecordCorrectionResultDto,
  ClosureRecordCorrectionResultDto,
} from './case-section-record-edit.dto';
import { readCaseSourceAnchor } from './case-entry-source';

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const day = (date: Date | null) =>
  date === null ? null : date.toISOString().slice(0, 10);
const dateValue = (date: string | null) =>
  date === null ? null : new Date(`${date}T00:00:00.000Z`);
const today = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
type Kind = 'HEARING' | 'JUDGMENT' | 'CLOSURE';
type Result =
  | HearingRecordCorrectionResultDto
  | JudgmentRecordCorrectionResultDto
  | ClosureRecordCorrectionResultDto;
type Scope = { caseId: string; departmentId: string };
const failure = (code: string) => {
  const body = { code, message: '资料更正未保存，请核对当前资料' };
  if (code === 'VALIDATION_ERROR') return new BadRequestException(body);
  if (code === 'ACTION_FORBIDDEN') return new ForbiddenException(body);
  if (code === 'RESOURCE_NOT_FOUND') return new NotFoundException(body);
  if (code === 'INVALID_RECEIPT') return new InternalServerErrorException(body);
  return new ConflictException(body);
};

@Injectable()
export class CaseHistoricalRecordEditService {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: AccessControlService,
    private readonly materials: MaterialService,
  ) {}

  correctHearing(
    actor: ActorContext,
    caseId: string,
    input: CorrectHearingRecordDto,
  ): Promise<HearingRecordCorrectionResultDto> {
    this.keys(input, [
      'arrangementId',
      'trialRoundId',
      'expectedHearingRevision',
      'idempotencyKey',
      'reason',
      'hearingAt',
    ]);
    const value = {
      arrangementId: this.id(input.arrangementId),
      trialRoundId: this.id(input.trialRoundId),
      expectedHearingRevision: this.revision(input.expectedHearingRevision),
      idempotencyKey: this.key(input.idempotencyKey),
      reason: this.text(input.reason, 500),
      hearingAt: this.date(input.hearingAt, true, true),
    };
    return this.run(
      'HEARING',
      actor,
      caseId,
      value,
      async (tx, scope) => {
        const target = await tx.caseHearingArrangement.findFirst({
          where: {
            ...scope,
            id: value.arrangementId,
            trialRoundId: value.trialRoundId,
          },
          include: { advances: { select: { id: true } } },
        });
        if (target === null) throw failure('RESOURCE_NOT_FOUND');
        const head = await tx.caseHearingRecordCorrection.findFirst({
          where: {
            ...scope,
            arrangementId: target.id,
            trialRoundId: target.trialRoundId,
          },
          orderBy: { toRevision: 'desc' },
        });
        this.compareRevision(head, value.expectedHearingRevision);
        await this.trialDates(
          tx,
          scope,
          target.trialRoundId,
          'HEARING',
          value.hearingAt,
          target.advances.length > 0,
        );
        const before = {
          hearingAt: day(head === null ? target.hearingAt : head.hearingAt),
        };
        const after = { hearingAt: value.hearingAt };
        this.changed(before, after);
        const stamp = await this.audit(
          tx,
          actor,
          scope,
          'HEARING',
          target.id,
          head,
          value.reason,
          before,
          after,
          { trialRoundId: target.trialRoundId },
        );
        await tx.caseHearingRecordCorrection.create({
          data: {
            ...scope,
            ...stamp.data,
            arrangementId: target.id,
            trialRoundId: target.trialRoundId,
            hearingAt: dateValue(value.hearingAt),
          },
        });
        return {
          ...stamp.result,
          arrangementId: target.id,
          trialRoundId: target.trialRoundId,
          hearingRevision: stamp.data.toRevision,
          hearingAt: value.hearingAt,
        };
      },
      (value): value is HearingRecordCorrectionResultDto =>
        'arrangementId' in value,
    );
  }

  correctJudgment(
    actor: ActorContext,
    caseId: string,
    input: CorrectJudgmentRecordDto,
  ): Promise<JudgmentRecordCorrectionResultDto> {
    this.keys(input, [
      'judgmentId',
      'trialRoundId',
      'expectedJudgmentRevision',
      'idempotencyKey',
      'reason',
      'judgmentReceivedAt',
      'judgmentAmountState',
      'judgmentAmount',
      'paidLitigationFeeState',
      'paidLitigationFee',
      'judgmentContentVersionIds',
    ]);
    const value = {
      judgmentId: this.id(input.judgmentId),
      trialRoundId: this.id(input.trialRoundId),
      expectedJudgmentRevision: this.revision(input.expectedJudgmentRevision),
      idempotencyKey: this.key(input.idempotencyKey),
      reason: this.text(input.reason, 500),
      judgmentReceivedAt: this.date(input.judgmentReceivedAt, false, false)!,
      judgmentAmountState: input.judgmentAmountState,
      judgmentAmount: this.amount(
        input.judgmentAmountState,
        input.judgmentAmount,
      ),
      paidLitigationFeeState: input.paidLitigationFeeState,
      paidLitigationFee: this.amount(
        input.paidLitigationFeeState,
        input.paidLitigationFee,
      ),
      judgmentContentVersionIds: this.ids(input.judgmentContentVersionIds, 1),
    };
    return this.run(
      'JUDGMENT',
      actor,
      caseId,
      value,
      async (tx, scope) => {
        const target = await tx.caseJudgmentFact.findFirst({
          where: {
            ...scope,
            id: value.judgmentId,
            trialRoundId: value.trialRoundId,
          },
          include: { versions: true },
        });
        if (target === null) throw failure('RESOURCE_NOT_FOUND');
        const head = await tx.caseJudgmentRecordCorrection.findFirst({
          where: {
            ...scope,
            judgmentId: target.id,
            trialRoundId: target.trialRoundId,
          },
          orderBy: { toRevision: 'desc' },
          include: { documents: true },
        });
        this.compareRevision(head, value.expectedJudgmentRevision);
        await this.trialDates(
          tx,
          scope,
          target.trialRoundId,
          'JUDGMENT',
          value.judgmentReceivedAt,
          true,
        );
        const effective = head ?? target;
        const before = {
          judgmentReceivedAt: day(effective.judgmentReceivedAt),
          judgmentAmountState: effective.judgmentAmountState,
          judgmentAmount: effective.judgmentAmount?.toFixed(2) ?? null,
          paidLitigationFeeState: effective.paidLitigationFeeState,
          paidLitigationFee: effective.paidLitigationFee?.toFixed(2) ?? null,
          contentVersionIds: (head?.documents ?? target.versions)
            .map((v) => v.contentVersionId)
            .sort(),
        };
        const after = {
          judgmentReceivedAt: value.judgmentReceivedAt,
          judgmentAmountState: value.judgmentAmountState,
          judgmentAmount: value.judgmentAmount,
          paidLitigationFeeState: value.paidLitigationFeeState,
          paidLitigationFee: value.paidLitigationFee,
          contentVersionIds: value.judgmentContentVersionIds,
        };
        this.changed(before, after);
        const facts = await this.materials.assertAvailableVersions(tx, actor, {
          ownerType: 'CASE',
          ownerId: scope.caseId,
          category: 'JUDGMENT',
          sectionRecordKind: 'JUDGMENT',
          contentVersionIds: value.judgmentContentVersionIds,
          minCount: 1,
          maxCount: 10,
        });
        this.uniqueMaterials(facts);
        const stamp = await this.audit(
          tx,
          actor,
          scope,
          'JUDGMENT',
          target.id,
          head,
          value.reason,
          before,
          after,
          { trialRoundId: target.trialRoundId },
        );
        await tx.caseJudgmentRecordCorrection.create({
          data: {
            ...scope,
            ...stamp.data,
            judgmentId: target.id,
            trialRoundId: target.trialRoundId,
            judgmentReceivedAt: dateValue(value.judgmentReceivedAt)!,
            judgmentAmountState: value.judgmentAmountState,
            judgmentAmount: value.judgmentAmount,
            paidLitigationFeeState: value.paidLitigationFeeState,
            paidLitigationFee: value.paidLitigationFee,
          },
        });
        await this.materials.freezeCaseSectionRecordCorrectionReferences(
          tx,
          actor,
          scope.caseId,
          { kind: 'JUDGMENT', correctionId: stamp.data.id },
          facts,
          stamp.data.auditEventId,
        );
        return {
          ...stamp.result,
          judgmentId: target.id,
          trialRoundId: target.trialRoundId,
          judgmentRevision: stamp.data.toRevision,
          judgmentReceivedAt: value.judgmentReceivedAt,
        };
      },
      (value): value is JudgmentRecordCorrectionResultDto =>
        'judgmentId' in value,
    );
  }

  correctClosure(
    actor: ActorContext,
    caseId: string,
    input: CorrectClosureRecordDto,
  ): Promise<ClosureRecordCorrectionResultDto> {
    this.keys(input, [
      'closureId',
      'expectedClosureVersionId',
      'expectedClosureRevision',
      'idempotencyKey',
      'correctionReason',
      'closeAt',
      'closeAmountState',
      'closeAmt',
      'note',
      'closeContentVersionIds',
    ]);
    const value = {
      closureId: this.id(input.closureId),
      expectedClosureVersionId: this.id(input.expectedClosureVersionId),
      expectedClosureRevision: this.revision(input.expectedClosureRevision),
      idempotencyKey: this.key(input.idempotencyKey),
      correctionReason: this.text(input.correctionReason, 500),
      closeAt: this.date(input.closeAt, true, false),
      closeAmountState: input.closeAmountState,
      closeAmt: this.amount(input.closeAmountState, input.closeAmt),
      note: input.note === null ? null : this.text(input.note, 2000),
      closeContentVersionIds: this.ids(input.closeContentVersionIds, 0),
    };
    return this.run(
      'CLOSURE',
      actor,
      caseId,
      value,
      async (tx, scope) => {
        const target = await tx.caseClosure.findFirst({
          where: { ...scope, id: value.closureId },
        });
        if (target === null) throw failure('RESOURCE_NOT_FOUND');
        // Both the pointer and real scoped version must match, independently of the edit revision.
        if (
          target.currentVersionId?.toLowerCase() !==
          value.expectedClosureVersionId
        )
          throw failure('VERSION_CONFLICT');
        const version = await tx.caseClosureVersion.findFirst({
          where: {
            ...scope,
            closureId: target.id,
            id: value.expectedClosureVersionId,
          },
          include: { documents: true },
        });
        if (
          version === null ||
          version.id.toLowerCase() !== value.expectedClosureVersionId
        )
          throw failure('VERSION_CONFLICT');
        const head = await tx.caseClosureRecordCorrection.findFirst({
          where: { ...scope, closureId: target.id },
          orderBy: { toRevision: 'desc' },
          include: { documents: true },
        });
        this.compareRevision(head, value.expectedClosureRevision);
        if (
          head !== null &&
          head.sourceClosureVersionId.toLowerCase() !==
            value.expectedClosureVersionId
        )
          throw failure('VERSION_CONFLICT');
        await this.closureDates(tx, scope, value.closeAt);
        const effective = head ?? version;
        const before = {
          closeAt: day(effective.closeAt),
          closeAmountState: effective.closeAmountState,
          closeAmt: effective.closeAmt?.toFixed(2) ?? null,
          note: effective.note,
          contentVersionIds: effective.documents
            .map((v) => v.contentVersionId)
            .sort(),
        };
        const after = {
          closeAt: value.closeAt,
          closeAmountState: value.closeAmountState,
          closeAmt: value.closeAmt,
          note: value.note,
          contentVersionIds: value.closeContentVersionIds,
        };
        this.changed(before, after);
        const facts =
          value.closeContentVersionIds.length === 0
            ? []
            : await this.materials.assertAvailableVersions(tx, actor, {
                ownerType: 'CASE',
                ownerId: scope.caseId,
                category: 'CASE_CLOSURE_DOCUMENT',
                sectionRecordKind: 'CLOSURE',
                contentVersionIds: value.closeContentVersionIds,
                minCount: 1,
                maxCount: 10,
              });
        this.uniqueMaterials(facts);
        const stamp = await this.audit(
          tx,
          actor,
          scope,
          'CLOSURE',
          target.id,
          head,
          value.correctionReason,
          before,
          after,
          { sourceClosureVersionId: value.expectedClosureVersionId },
        );
        await tx.caseClosureRecordCorrection.create({
          data: {
            ...scope,
            ...stamp.data,
            closureId: target.id,
            sourceClosureVersionId: value.expectedClosureVersionId,
            closeAt: dateValue(value.closeAt),
            closeAmountState: value.closeAmountState,
            closeAmt: value.closeAmt,
            note: value.note,
          },
        });
        await this.materials.freezeCaseSectionRecordCorrectionReferences(
          tx,
          actor,
          scope.caseId,
          { kind: 'CLOSURE', correctionId: stamp.data.id },
          facts,
          stamp.data.auditEventId,
        );
        return {
          ...stamp.result,
          closureId: target.id,
          closureRevision: stamp.data.toRevision,
          closeAt: value.closeAt,
        };
      },
      (value): value is ClosureRecordCorrectionResultDto =>
        'closureId' in value,
    );
  }

  private async run<T extends Result>(
    kind: Kind,
    actor: ActorContext,
    rawCaseId: string,
    value: { idempotencyKey: string },
    write: (tx: Prisma.TransactionClient, scope: Scope) => Promise<T>,
    isResult: (value: Result) => value is T,
  ): Promise<T> {
    const caseId = this.id(rawCaseId);
    if (
      actor.clientCustomerId !== undefined ||
      actor.notaryOfficeId !== undefined ||
      actor.lawyerAccountId !== undefined
    )
      throw failure('ACTION_FORBIDDEN');
    const command = `${kind}_RECORD_CORRECTION` as const;
    const action = {
      HEARING: 'case.hearing.correct',
      JUDGMENT: 'case.judgment.correct',
      CLOSURE: 'case.closure.correct',
    } as const;
    const fingerprint = createHash('sha256')
      .update(JSON.stringify({ caseId, command, ...value }))
      .digest('hex');
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.database.$transaction(
          async (tx) => {
            const scope = { caseId, departmentId: actor.departmentId };
            const locked = await tx.$queryRawUnsafe<Array<{ id: string }>>(
              'SELECT "id" FROM "cases" WHERE "id" = $1::uuid AND "department_id" = $2::uuid FOR UPDATE',
              caseId,
              actor.departmentId,
            );
            if (locked.length !== 1) throw failure('RESOURCE_NOT_FOUND');
            const record = await tx.case.findFirst({
              where: { id: caseId, departmentId: actor.departmentId },
              select: {
                departmentId: true,
                responsibleUserId: true,
                responsibleMembership: { select: { teamId: true } },
              },
            });
            if (record === null) throw failure('RESOURCE_NOT_FOUND');
            const account = await tx.userAccount.findUnique({
              where: { id: actor.userId },
              select: { active: true, accountType: true },
            });
            if (!account?.active || account.accountType !== 'INTERNAL')
              throw failure('ACTION_FORBIDDEN');
            await this.access.authorizeCase(
              actor,
              action[kind],
              {
                departmentId: record.departmentId,
                responsibleUserId: record.responsibleUserId,
                ...(record.responsibleMembership.teamId
                  ? { teamId: record.responsibleMembership.teamId }
                  : {}),
              },
              tx,
            );
            const prior = await tx.caseSectionRecordEditReceipt.findUnique({
              where: {
                departmentId_actorUserId_command_idempotencyKey: {
                  departmentId: actor.departmentId,
                  actorUserId: actor.userId,
                  command,
                  idempotencyKey: value.idempotencyKey,
                },
              },
            });
            if (prior !== null) {
              if (
                prior.caseId !== caseId ||
                prior.requestFingerprint !== fingerprint
              )
                throw failure('IDEMPOTENCY_CONFLICT');
              const result = this.receipt(prior.resultSnapshot, caseId, kind);
              if (!isResult(result)) throw failure('INVALID_RECEIPT');
              return result;
            }
            const result = await write(tx, scope);
            await tx.caseSectionRecordEditReceipt.create({
              data: {
                ...scope,
                actorUserId: actor.userId,
                command,
                idempotencyKey: value.idempotencyKey,
                requestFingerprint: fingerprint,
                resultSnapshot: { ...result },
              },
            });
            return result;
          },
          { isolationLevel: 'Serializable' },
        );
      } catch (error) {
        if (
          this.hasCode(error, 'P2034') ||
          this.hasCode(error, '40001') ||
          this.hasCode(error, 'P2002')
        ) {
          if (attempt < 2) continue;
          throw failure('VERSION_CONFLICT');
        }
        throw error;
      }
    }
    throw failure('VERSION_CONFLICT');
  }

  private async audit(
    tx: Prisma.TransactionClient,
    actor: ActorContext,
    scope: Scope,
    kind: Kind,
    targetId: string,
    head: { id: string; toRevision: number } | null,
    correctionReason: string,
    before: Prisma.InputJsonObject,
    after: Prisma.InputJsonObject,
    extra: Prisma.InputJsonObject,
  ) {
    const id = randomUUID();
    const auditEventId = randomUUID();
    const recordedAt = new Date();
    const fromRevision = head?.toRevision ?? 0;
    const targetKey = {
      HEARING: 'arrangementId',
      JUDGMENT: 'judgmentId',
      CLOSURE: 'closureId',
    }[kind];
    await tx.auditEvent.create({
      data: {
        id: auditEventId,
        departmentId: scope.departmentId,
        actorUserId: actor.userId,
        internalActorUserId: actor.userId,
        resourceType: 'CASE',
        resourceId: scope.caseId,
        action: `case.${kind.toLowerCase()}.record-corrected`,
        details: {
          correctionId: id,
          [targetKey]: targetId,
          fromRevision,
          toRevision: fromRevision + 1,
          correctionReason,
          before,
          after,
          ...extra,
        },
      },
    });
    return {
      data: {
        id,
        priorCorrectionId: head?.id ?? null,
        fromRevision,
        toRevision: fromRevision + 1,
        correctionReason,
        recordedAt,
        recordedByUserId: actor.userId,
        auditEventId,
      },
      result: {
        caseId: scope.caseId,
        correctionId: id,
        recordedAt: recordedAt.toISOString(),
      },
    };
  }

  private compareRevision(
    head: { toRevision: number } | null,
    expected: number,
  ) {
    if ((head?.toRevision ?? 0) !== expected) throw failure('VERSION_CONFLICT');
  }
  private changed(
    before: Prisma.InputJsonObject,
    after: Prisma.InputJsonObject,
  ) {
    if (JSON.stringify(before) === JSON.stringify(after))
      throw failure('NO_CHANGE');
  }
  private uniqueMaterials(facts: readonly { materialId: string }[]) {
    if (new Set(facts.map((f) => f.materialId)).size !== facts.length)
      throw failure('VALIDATION_ERROR');
  }

  private async trialDates(
    tx: Prisma.TransactionClient,
    scope: Scope,
    trialRoundId: string,
    kind: 'HEARING' | 'JUDGMENT',
    value: string | null,
    advanced: boolean,
  ) {
    const round = await tx.caseTrialRound.findFirst({
      where: { ...scope, id: trialRoundId },
      select: {
        revokedAt: true,
        externalEntryId: true,
        sourceResult: { select: { resultReceivedAt: true } },
        acceptances: {
          select: {
            acceptedAt: true,
            corrections: {
              orderBy: { toRevision: 'desc' },
              take: 1,
              select: { acceptedAt: true },
            },
          },
        },
        advances: {
          select: {
            arrangement: {
              select: {
                hearingAt: true,
                recordCorrections: {
                  orderBy: { toRevision: 'desc' },
                  take: 1,
                  select: { hearingAt: true },
                },
              },
            },
          },
        },
      },
    });
    if (round === null || round.revokedAt !== null)
      throw failure('INVALID_STATE');
    const source = await readCaseSourceAnchor(
      tx,
      scope.caseId,
      scope.departmentId,
    );
    const lower: Array<Date | null> = [
      round.sourceResult?.resultReceivedAt ?? null,
      ...round.acceptances.map(
        (a) => a.corrections[0]?.acceptedAt ?? a.acceptedAt,
      ),
    ];
    if (kind === 'JUDGMENT')
      lower.push(
        ...round.advances.map((a) =>
          a.arrangement.recordCorrections.length > 0
            ? a.arrangement.recordCorrections[0]!.hearingAt
            : a.arrangement.hearingAt,
        ),
      );
    if (
      round.externalEntryId !== null &&
      source.kind === 'EXTERNAL_ENTRY' &&
      round.externalEntryId === source.entryId &&
      round.sourceResult === null
    ) {
      lower.push(dateValue(source.stageReachedOn));
      if (round.acceptances.length === 0)
        lower.push(dateValue(source.known.acceptedOn));
    }
    // Follow real REMAND parent links; stage names/sequence numbers cannot express ancestry.
    const roundIds = new Set([trialRoundId]);
    let frontier = [trialRoundId];
    while (frontier.length > 0) {
      const children = await tx.caseTrialRound.findMany({
        where: {
          ...scope,
          sourceResult: { is: { trialRoundId: { in: frontier } } },
        },
        select: { id: true },
      });
      frontier = children
        .filter((child) => !roundIds.has(child.id))
        .map((child) => child.id);
      frontier.forEach((id) => roundIds.add(id));
    }
    const descendants = [...roundIds];
    const record = await tx.case.findFirst({
      where: { id: scope.caseId, departmentId: scope.departmentId },
      select: {
        judgmentFacts: {
          where: { trialRoundId: { in: descendants } },
          select: {
            judgmentReceivedAt: true,
            recordCorrections: {
              orderBy: { toRevision: 'desc' },
              take: 1,
              select: { judgmentReceivedAt: true },
            },
          },
        },
        secondInstanceProgresses: {
          where: { trialRoundId: { in: descendants } },
          select: { hearingAt: true },
        },
        secondInstanceResults: {
          where: { trialRoundId: { in: descendants } },
          select: { resultReceivedAt: true },
        },
        secondInstanceAcceptanceChanges: {
          where: { trialRoundId: { in: descendants } },
          orderBy: { toRevision: 'desc' },
          distinct: ['choiceId', 'trialRoundId'],
          select: { acceptedAt: true },
        },
        acceptances: {
          where: {
            trialRoundId: {
              in: descendants.filter((id) => id !== trialRoundId),
            },
          },
          select: {
            acceptedAt: true,
            corrections: {
              orderBy: { toRevision: 'desc' },
              take: 1,
              select: { acceptedAt: true },
            },
          },
        },
      },
    });
    if (record === null) throw failure('RESOURCE_NOT_FOUND');
    const upper: Array<Date | null> = [
      ...(kind === 'HEARING'
        ? record.judgmentFacts.map(
            (j) =>
              j.recordCorrections[0]?.judgmentReceivedAt ??
              j.judgmentReceivedAt,
          )
        : []),
      ...record.secondInstanceProgresses.map((p) => p.hearingAt),
      ...record.secondInstanceResults.map((r) => r.resultReceivedAt),
      ...record.secondInstanceAcceptanceChanges.map((a) => a.acceptedAt),
      ...record.acceptances.map(
        (a) => a.corrections[0]?.acceptedAt ?? a.acceptedAt,
      ),
    ];
    const hasDownstream = advanced || upper.some((date) => date !== null);
    if (value === null) {
      if (hasDownstream) throw failure('VALIDATION_ERROR');
      return;
    }
    if (
      (hasDownstream && value > today()) ||
      lower.some((date) => date !== null && value < day(date)!) ||
      upper.some((date) => date !== null && value > day(date)!)
    )
      throw failure('VALIDATION_ERROR');
  }

  private async closureDates(
    tx: Prisma.TransactionClient,
    scope: Scope,
    value: string | null,
  ) {
    if (value === null) return;
    const source = await readCaseSourceAnchor(
      tx,
      scope.caseId,
      scope.departmentId,
    );
    if (source.kind === 'EXTERNAL_ENTRY' && value < source.stageReachedOn)
      throw failure('VALIDATION_ERROR');
  }

  private keys(value: object, keys: string[]) {
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Object.keys(value).length !== keys.length ||
      Object.keys(value).some((key) => !keys.includes(key))
    )
      throw failure('VALIDATION_ERROR');
  }
  private id(value: string): string {
    if (typeof value !== 'string' || !uuid.test(value))
      throw failure('VALIDATION_ERROR');
    return value.toLowerCase();
  }
  private revision(value: number) {
    if (
      !Number.isSafeInteger(value) ||
      value < 0 ||
      value === Number.MAX_SAFE_INTEGER
    )
      throw failure('VALIDATION_ERROR');
    return value;
  }
  private key(value: string) {
    if (
      typeof value !== 'string' ||
      value.trim() !== value ||
      value.length < 1 ||
      value.length > 128
    )
      throw failure('VALIDATION_ERROR');
    return value;
  }
  private text(value: string, max: number) {
    if (
      typeof value !== 'string' ||
      value.trim().length < 1 ||
      value.trim().length > max
    )
      throw failure('VALIDATION_ERROR');
    return value.trim();
  }
  private date(value: string | null, nullable: boolean, future: boolean) {
    if (value === null && nullable) return null;
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value))
      throw failure('VALIDATION_ERROR');
    const parsed = dateValue(value)!;
    if (
      Number.isNaN(parsed.getTime()) ||
      parsed.getUTCFullYear() < 1 ||
      day(parsed) !== value ||
      (!future && value > today())
    )
      throw failure('VALIDATION_ERROR');
    return value;
  }
  private amount(state: 'KNOWN' | 'PENDING', value: string | null) {
    if (state === 'PENDING' && value === null) return null;
    if (
      state !== 'KNOWN' ||
      typeof value !== 'string' ||
      !/^(0|[1-9]\d{0,13})(\.\d{1,2})?$/u.test(value)
    )
      throw failure('VALIDATION_ERROR');
    return new Prisma.Decimal(value).toFixed(2);
  }
  private ids(value: string[], min: number) {
    if (!Array.isArray(value) || value.length < min || value.length > 10)
      throw failure('VALIDATION_ERROR');
    const result = value.map((id) => this.id(id)).sort();
    if (new Set(result).size !== result.length)
      throw failure('VALIDATION_ERROR');
    return result;
  }
  private receipt(value: Prisma.JsonValue, caseId: string, kind: Kind): Result {
    if (
      value === null ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      value.caseId !== caseId ||
      typeof value.correctionId !== 'string' ||
      !uuid.test(value.correctionId) ||
      typeof value.recordedAt !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(
        value.recordedAt,
      ) ||
      Number.isNaN(Date.parse(value.recordedAt))
    )
      throw failure('INVALID_RECEIPT');
    const base = {
      caseId,
      correctionId: value.correctionId,
      recordedAt: value.recordedAt,
    };
    const validRevision = (v: Prisma.JsonValue | undefined): v is number =>
      typeof v === 'number' && Number.isSafeInteger(v) && v >= 1;
    const validDay = (
      v: Prisma.JsonValue | undefined,
      nullable: boolean,
    ): v is string | null =>
      v === null
        ? nullable
        : typeof v === 'string' &&
          /^\d{4}-\d{2}-\d{2}$/u.test(v) &&
          !Number.isNaN(Date.parse(v)) &&
          day(new Date(v)) === v;
    if (
      kind === 'CLOSURE' &&
      Object.keys(value).length === 6 &&
      typeof value.closureId === 'string' &&
      uuid.test(value.closureId) &&
      validRevision(value.closureRevision) &&
      validDay(value.closeAt, true)
    )
      return {
        ...base,
        closureId: value.closureId,
        closureRevision: value.closureRevision,
        closeAt: value.closeAt,
      };
    if (
      typeof value.trialRoundId !== 'string' ||
      !uuid.test(value.trialRoundId) ||
      Object.keys(value).length !== 7
    )
      throw failure('INVALID_RECEIPT');
    if (
      kind === 'HEARING' &&
      typeof value.arrangementId === 'string' &&
      uuid.test(value.arrangementId) &&
      validRevision(value.hearingRevision) &&
      validDay(value.hearingAt, true)
    )
      return {
        ...base,
        trialRoundId: value.trialRoundId,
        arrangementId: value.arrangementId,
        hearingRevision: value.hearingRevision,
        hearingAt: value.hearingAt,
      };
    if (
      kind === 'JUDGMENT' &&
      typeof value.judgmentId === 'string' &&
      uuid.test(value.judgmentId) &&
      validRevision(value.judgmentRevision) &&
      typeof value.judgmentReceivedAt === 'string' &&
      validDay(value.judgmentReceivedAt, false)
    )
      return {
        ...base,
        trialRoundId: value.trialRoundId,
        judgmentId: value.judgmentId,
        judgmentRevision: value.judgmentRevision,
        judgmentReceivedAt: value.judgmentReceivedAt,
      };
    throw failure('INVALID_RECEIPT');
  }
  private hasCode(error: unknown, code: string): boolean {
    if (error === null || typeof error !== 'object') return false;
    if ('code' in error && error.code === code) return true;
    if ('cause' in error && this.hasCode(error.cause, code)) return true;
    if (
      'meta' in error &&
      error.meta !== null &&
      typeof error.meta === 'object' &&
      'driverAdapterError' in error.meta
    )
      return this.hasCode(error.meta.driverAdapterError, code);
    return (
      ('originalCode' in error && error.originalCode === code) ||
      ('sqlState' in error && error.sqlState === code)
    );
  }
}
