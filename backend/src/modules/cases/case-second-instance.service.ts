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
import { Prisma } from '../../generated/prisma/client';
import { MaterialService } from '../materials';
import {
  CaseSourceAnchor,
  isEntryStartingAt,
  readCaseSourceAnchor,
} from './case-entry-source';
import {
  KnownMoneyDto,
  RegisterSecondInstanceResultDto,
  RevokeSecondInstanceResultDto,
  SaveSecondInstanceDto,
  SecondInstanceCommandResultDto,
} from './case-second-instance.dto';

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
type Action = 'SAVE' | 'RESULT' | 'REVOKE';
type Progress = {
  hearingAt: string | null;
  hearingPlace: string | null;
  judgeName: string | null;
  documentContentVersionIds: string[];
  serviceContentVersionIds: string[];
};
type Anchor = {
  expectedVersion: number;
  idempotencyKey: string;
  trialRoundId: string;
  choiceId: string | null;
  expectedProgressId: string | null;
};
type SaveValue = Anchor & { progress: Progress };
type ResultValue = SaveValue & {
  result: 'REMAND' | 'CHANGE' | 'AFFIRM';
  resultReceivedAt: string;
  judgmentContentVersionIds: string[];
  paidLitigationFee: { state: 'KNOWN' | 'PENDING'; amount: string | null };
  judgmentAmount: { state: 'KNOWN' | 'PENDING'; amount: string | null } | null;
};
type RevokeValue = {
  expectedVersion: number;
  idempotencyKey: string;
  trialRoundId: string;
  resultId: string;
  reason: string;
};
type LockedCase = {
  departmentId: string;
  stage: string;
  version: number;
  courtCaseNo: string | null;
  currentTrialRoundId: string | null;
  currentAcceptanceId: string | null;
  currentHearingArrangementId: string | null;
  currentHearingAdvanceId: string | null;
  currentJudgmentId: string | null;
  currentJudgmentNextStepId: string | null;
  currentSecondInstanceProgressId: string | null;
  currentSecondInstanceResultId: string | null;
  currentTrialRound: {
    origin: 'NORMAL' | 'EXTERNAL_CURRENT';
    externalEntryId: string | null;
    sourceResultId: string | null;
    revokedAt: Date | null;
  } | null;
  acceptance: { acceptedAt: Date; corrections: { acceptedAt: Date }[] } | null;
  currentJudgment: {
    trialRoundId: string;
    externalEntryId: string | null;
    judgmentReceivedAt: Date;
    judgmentAmountState: 'KNOWN' | 'PENDING';
    judgmentAmount: Prisma.Decimal | null;
    recordCorrections: { judgmentReceivedAt: Date }[];
  } | null;
  currentJudgmentNextStep: {
    id: string;
    judgmentId: string | null;
    trialRoundId: string;
    next: 'APPEAL' | 'EXECUTION';
  } | null;
  currentSecondInstanceResult: {
    id: string;
    result: 'REMAND' | 'CHANGE' | 'AFFIRM';
    trialRoundId: string;
    choiceId: string | null;
    externalEntryId: string | null;
    progressId: string | null;
  } | null;
  responsibleUserId: string;
  responsibleMembership: { teamId: string | null };
};

@Injectable()
export class CaseSecondInstanceService {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: AccessControlService,
    private readonly materials: MaterialService,
  ) {}

  save(
    actor: ActorContext,
    caseId: string,
    input: SaveSecondInstanceDto,
  ): Promise<SecondInstanceCommandResultDto> {
    return this.command('SAVE', actor, caseId, this.normalizeSave(input));
  }

  registerResult(
    actor: ActorContext,
    caseId: string,
    input: RegisterSecondInstanceResultDto,
  ): Promise<SecondInstanceCommandResultDto> {
    return this.command('RESULT', actor, caseId, this.normalizeResult(input));
  }

  revokeResult(
    actor: ActorContext,
    caseId: string,
    input: RevokeSecondInstanceResultDto,
  ): Promise<SecondInstanceCommandResultDto> {
    return this.command('REVOKE', actor, caseId, this.normalizeRevoke(input));
  }

  private async command(
    action: Action,
    actor: ActorContext,
    caseId: string,
    value: SaveValue | ResultValue | RevokeValue,
  ): Promise<SecondInstanceCommandResultDto> {
    if (
      actor.clientCustomerId !== undefined ||
      actor.notaryOfficeId !== undefined
    )
      throw this.forbidden();
    const fingerprint = createHash('sha256')
      .update(JSON.stringify({ action, caseId, ...value }))
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
                courtCaseNo: true,
                currentTrialRoundId: true,
                currentTrialRound: {
                  select: {
                    origin: true,
                    externalEntryId: true,
                    sourceResultId: true,
                    revokedAt: true,
                  },
                },
                currentAcceptanceId: true,
                currentHearingArrangementId: true,
                currentHearingAdvanceId: true,
                currentJudgmentId: true,
                currentJudgmentNextStepId: true,
                currentSecondInstanceProgressId: true,
                currentSecondInstanceResultId: true,
                acceptance: {
                  select: {
                    acceptedAt: true,
                    corrections: {
                      orderBy: { toRevision: 'desc' },
                      take: 1,
                      select: { acceptedAt: true },
                    },
                  },
                },
                currentJudgment: {
                  select: {
                    trialRoundId: true,
                    externalEntryId: true,
                    judgmentReceivedAt: true,
                    judgmentAmountState: true,
                    judgmentAmount: true,
                    recordCorrections: {
                      orderBy: { toRevision: 'desc' },
                      take: 1,
                      select: { judgmentReceivedAt: true },
                    },
                  },
                },
                currentJudgmentNextStep: {
                  select: {
                    id: true,
                    judgmentId: true,
                    trialRoundId: true,
                    next: true,
                  },
                },
                currentSecondInstanceResult: {
                  select: {
                    id: true,
                    result: true,
                    trialRoundId: true,
                    choiceId: true,
                    externalEntryId: true,
                    progressId: true,
                  },
                },
                responsibleUserId: true,
                responsibleMembership: { select: { teamId: true } },
              },
            });
            if (record === null) throw this.notFound();
            const source = await readCaseSourceAnchor(
              tx,
              caseId,
              actor.departmentId,
            );
            const entryId =
              source.kind === 'EXTERNAL_ENTRY' ? source.entryId : null;
            const round = record.currentTrialRound;
            if (
              (source.kind === 'EXTERNAL_ENTRY' &&
                (round === null ||
                  round.revokedAt !== null ||
                  round.externalEntryId !== entryId ||
                  (round.origin !== 'EXTERNAL_CURRENT' &&
                    round.sourceResultId === null))) ||
              (source.kind === 'NORMAL' && round?.origin === 'EXTERNAL_CURRENT')
            )
              throw this.invalidState();
            const account = await tx.userAccount.findUnique({
              where: { id: actor.userId },
              select: { active: true, accountType: true },
            });
            if (!account?.active) throw this.forbidden();
            let lawyerBindingId: string | undefined;
            if (action !== 'REVOKE' && account.accountType === 'LAWYER') {
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
                  action === 'SAVE'
                    ? 'case.second_instance.save'
                    : action === 'RESULT'
                      ? 'case.second_instance.result'
                      : 'case.second_instance.result.revoke',
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
            const prior = await tx.caseSecondInstanceReceipt.findUnique({
              where: {
                departmentId_actorUserId_action_idempotencyKey: {
                  departmentId: actor.departmentId,
                  actorUserId: actor.userId,
                  action,
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
            if (action === 'REVOKE')
              return this.revokeLocked(
                tx,
                actor,
                caseId,
                value as RevokeValue,
                record,
                source,
                fingerprint,
              );
            return this.saveOrResultLocked(
              tx,
              actor,
              caseId,
              action,
              value as SaveValue | ResultValue,
              record,
              source,
              lawyerBindingId,
              fingerprint,
            );
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

  private async saveOrResultLocked(
    tx: Prisma.TransactionClient,
    actor: ActorContext,
    caseId: string,
    action: 'SAVE' | 'RESULT',
    value: SaveValue | ResultValue,
    record: LockedCase,
    source: CaseSourceAnchor,
    lawyerBindingId: string | undefined,
    fingerprint: string,
  ): Promise<SecondInstanceCommandResultDto> {
    const entryId = source.kind === 'EXTERNAL_ENTRY' ? source.entryId : null;
    const directEntry =
      isEntryStartingAt(source, 'SECOND_INSTANCE') &&
      record.currentTrialRound?.origin === 'EXTERNAL_CURRENT' &&
      record.currentTrialRound.externalEntryId === source.entryId &&
      value.choiceId === null &&
      record.currentJudgmentNextStepId === null &&
      record.currentJudgmentId === null &&
      record.acceptance === null;
    const realAppeal =
      value.choiceId !== null &&
      record.currentJudgmentNextStepId === value.choiceId &&
      record.currentJudgmentId !== null &&
      (record.acceptance !== null ||
        (source.kind === 'EXTERNAL_ENTRY' &&
          (source.initialStage === 'WAITING_JUDGMENT' ||
            source.initialStage === 'WAITING_HEARING'))) &&
      (source.kind !== 'EXTERNAL_ENTRY' ||
        (record.currentJudgment?.trialRoundId === value.trialRoundId &&
          record.currentJudgment.externalEntryId === entryId)) &&
      record.currentJudgmentNextStep?.next === 'APPEAL' &&
      record.currentJudgmentNextStep.trialRoundId === value.trialRoundId &&
      record.currentJudgmentNextStep.judgmentId === record.currentJudgmentId;
    if (
      record.stage !== 'SECOND_INSTANCE' ||
      record.currentTrialRoundId !== value.trialRoundId ||
      record.currentSecondInstanceResultId !== null ||
      (!directEntry && !realAppeal)
    )
      throw this.invalidState();
    if (record.currentSecondInstanceProgressId !== value.expectedProgressId)
      throw this.versionConflict();
    const secondAcceptance =
      await tx.caseSecondInstanceAcceptanceChange.findFirst({
        where: {
          caseId,
          departmentId: actor.departmentId,
          choiceId: value.choiceId,
          externalEntryId: entryId,
        },
        orderBy: { toRevision: 'desc' },
        select: { acceptedAt: true },
      });
    const firstAcceptanceDate = record.acceptance
      ? (
          record.acceptance.corrections[0]?.acceptedAt ??
          record.acceptance.acceptedAt
        )
          .toISOString()
          .slice(0, 10)
      : source.kind === 'EXTERNAL_ENTRY'
        ? source.known.acceptedOn
        : null;
    const secondAcceptanceDate = secondAcceptance?.acceptedAt
      ? secondAcceptance.acceptedAt.toISOString().slice(0, 10)
      : source.kind === 'EXTERNAL_ENTRY'
        ? source.known.secondInstanceAcceptedOn
        : null;
    const stageFloor =
      directEntry && source.kind === 'EXTERNAL_ENTRY'
        ? source.stageReachedOn
        : null;
    const judgmentDate = realAppeal
      ? (
          record.currentJudgment?.recordCorrections[0]?.judgmentReceivedAt ??
          record.currentJudgment?.judgmentReceivedAt
        )
          ?.toISOString()
          .slice(0, 10)
      : null;
    if (
      value.progress.hearingAt !== null &&
      ((firstAcceptanceDate !== null &&
        value.progress.hearingAt < firstAcceptanceDate) ||
        (secondAcceptanceDate !== null &&
          value.progress.hearingAt < secondAcceptanceDate) ||
        (stageFloor !== null && value.progress.hearingAt < stageFloor) ||
        (judgmentDate !== null &&
          judgmentDate !== undefined &&
          value.progress.hearingAt < judgmentDate))
    )
      throw this.validation();
    const current =
      record.currentSecondInstanceProgressId === null
        ? null
        : await tx.caseSecondInstanceProgress.findFirst({
            where: {
              id: record.currentSecondInstanceProgressId,
              caseId,
              departmentId: actor.departmentId,
              trialRoundId: value.trialRoundId,
              choiceId: value.choiceId,
              externalEntryId: entryId,
            },
            select: {
              id: true,
              hearingAt: true,
              hearingPlace: true,
              judgeName: true,
              versions: { select: { category: true, contentVersionId: true } },
            },
          });
    if (record.currentSecondInstanceProgressId !== null && current === null)
      throw this.invalidState();
    const changed = !this.sameProgress(value.progress, current);
    const recordedAt = new Date();
    let version = value.expectedVersion;
    let progressId = record.currentSecondInstanceProgressId;
    if (changed) {
      const documents = await this.materials.assertAvailableVersions(
        tx,
        actor,
        {
          ownerType: 'CASE',
          ownerId: caseId,
          category: 'SECOND_INSTANCE_DOCUMENT',
          contentVersionIds: value.progress.documentContentVersionIds,
          minCount: 0,
          maxCount: 10,
        },
      );
      const services = await this.materials.assertAvailableVersions(tx, actor, {
        ownerType: 'CASE',
        ownerId: caseId,
        category: 'SECOND_INSTANCE_SERVICE',
        contentVersionIds: value.progress.serviceContentVersionIds,
        minCount: 0,
        maxCount: 10,
      });
      progressId = randomUUID();
      const audit = await tx.auditEvent.create({
        data: {
          departmentId: actor.departmentId,
          actorUserId: actor.userId,
          ...(lawyerBindingId === undefined
            ? { internalActorUserId: actor.userId }
            : { lawyerAccountBindingId: lawyerBindingId }),
          resourceType: 'CASE',
          resourceId: caseId,
          action: 'case.second_instance.save',
          details: {
            progressId,
            trialRoundId: value.trialRoundId,
            choiceId: value.choiceId,
            priorProgressId: value.expectedProgressId,
            fromVersion: version,
            toVersion: version + 1,
            sourceAction: action,
            ...value.progress,
          },
        },
        select: { id: true },
      });
      await tx.caseSecondInstanceProgress.create({
        data: {
          id: progressId,
          caseId,
          departmentId: actor.departmentId,
          trialRoundId: value.trialRoundId,
          choiceId: value.choiceId,
          externalEntryId: entryId,
          priorProgressId: value.expectedProgressId,
          hearingAt:
            value.progress.hearingAt === null
              ? null
              : new Date(`${value.progress.hearingAt}T00:00:00.000Z`),
          hearingPlace: value.progress.hearingPlace,
          judgeName: value.progress.judgeName,
          fromVersion: version,
          toVersion: version + 1,
          recordedAt,
          recordedByUserId: actor.userId,
          auditEventId: audit.id,
        },
      });
      await this.materials.freezeCaseSecondInstanceReferences(
        tx,
        actor,
        caseId,
        progressId,
        [...documents, ...services],
        audit.id,
        'PROGRESS',
      );
      const update = await tx.case.updateMany({
        where: {
          id: caseId,
          departmentId: actor.departmentId,
          stage: 'SECOND_INSTANCE',
          version,
          currentTrialRoundId: value.trialRoundId,
          currentJudgmentNextStepId: value.choiceId,
          currentSecondInstanceProgressId: value.expectedProgressId,
          currentSecondInstanceResultId: null,
        },
        data: {
          stage: 'SECOND_INSTANCE',
          version: { increment: 1 },
          currentSecondInstanceProgressId: progressId,
        },
      });
      if (update.count !== 1) throw this.versionConflict();
      version++;
    }
    if (action === 'SAVE') {
      const response: SecondInstanceCommandResultDto = {
        id: caseId,
        stage: 'SECOND_INSTANCE',
        version,
        currentTrialRoundId: value.trialRoundId,
        progressId,
        resultId: null,
        recordedAt: recordedAt.toISOString(),
      };
      await this.saveReceipt(
        tx,
        actor,
        caseId,
        action,
        value.idempotencyKey,
        fingerprint,
        response,
      );
      return response;
    }
    const input = value as ResultValue;
    if (
      input.result === 'AFFIRM' &&
      (directEntry
        ? input.judgmentAmount === null
        : input.judgmentAmount !== null)
    )
      throw this.validation();
    if (
      (firstAcceptanceDate !== null &&
        input.resultReceivedAt < firstAcceptanceDate) ||
      (secondAcceptanceDate !== null &&
        input.resultReceivedAt < secondAcceptanceDate) ||
      (stageFloor !== null && input.resultReceivedAt < stageFloor) ||
      (judgmentDate !== null &&
        judgmentDate !== undefined &&
        input.resultReceivedAt < judgmentDate) ||
      (input.progress.hearingAt !== null &&
        input.resultReceivedAt < input.progress.hearingAt)
    )
      throw this.validation();
    const judgmentFiles = await this.materials.assertAvailableVersions(
      tx,
      actor,
      {
        ownerType: 'CASE',
        ownerId: caseId,
        category: 'SECOND_INSTANCE_JUDGMENT',
        contentVersionIds: input.judgmentContentVersionIds,
        minCount: 1,
        maxCount: 10,
      },
    );
    const resultId = randomUUID();
    const childRoundId = input.result === 'REMAND' ? randomUUID() : null;
    const amount =
      input.result === 'AFFIRM'
        ? directEntry
          ? input.judgmentAmount
          : {
              state: record.currentJudgment!.judgmentAmountState,
              amount:
                record.currentJudgment!.judgmentAmount?.toString() ?? null,
            }
        : input.judgmentAmount;
    if (
      input.result === 'AFFIRM' &&
      amount?.state === 'KNOWN' &&
      amount.amount !== null
    )
      amount.amount = new Prisma.Decimal(amount.amount).toFixed(2);
    const stage =
      input.result === 'REMAND'
        ? 'WAITING_FORMAL_ACCEPTANCE'
        : 'WAITING_EXECUTION_DOCUMENTS';
    const audit = await tx.auditEvent.create({
      data: {
        departmentId: actor.departmentId,
        actorUserId: actor.userId,
        ...(lawyerBindingId === undefined
          ? { internalActorUserId: actor.userId }
          : { lawyerAccountBindingId: lawyerBindingId }),
        resourceType: 'CASE',
        resourceId: caseId,
        action: 'case.second_instance.result',
        details: {
          resultId,
          trialRoundId: value.trialRoundId,
          choiceId: value.choiceId,
          externalEntryId: entryId,
          judgmentId: record.currentJudgmentId,
          progressId,
          childRoundId,
          result: input.result,
          resultReceivedAt: input.resultReceivedAt,
          judgmentAmountState: amount?.state ?? null,
          judgmentAmount: amount?.amount ?? null,
          paidLitigationFeeState: input.paidLitigationFee.state,
          paidLitigationFee: input.paidLitigationFee.amount,
          judgmentContentVersionIds: input.judgmentContentVersionIds,
          fromVersion: version,
          toVersion: version + 1,
        },
      },
      select: { id: true },
    });
    await tx.caseSecondInstanceResult.create({
      data: {
        id: resultId,
        caseId,
        departmentId: actor.departmentId,
        trialRoundId: value.trialRoundId,
        choiceId: value.choiceId,
        externalEntryId: entryId,
        judgmentId: record.currentJudgmentId,
        progressId,
        result: input.result,
        resultReceivedAt: new Date(`${input.resultReceivedAt}T00:00:00.000Z`),
        judgmentAmountState: amount?.state ?? null,
        judgmentAmount: amount?.amount ?? null,
        paidLitigationFeeState: input.paidLitigationFee.state,
        paidLitigationFee: input.paidLitigationFee.amount,
        fromVersion: version,
        toVersion: version + 1,
        recordedAt,
        recordedByUserId: actor.userId,
        auditEventId: audit.id,
      },
    });
    await this.materials.freezeCaseSecondInstanceReferences(
      tx,
      actor,
      caseId,
      resultId,
      judgmentFiles,
      audit.id,
      'RESULT',
    );
    if (childRoundId !== null) {
      const latest = await tx.caseTrialRound.findFirst({
        where: { caseId, departmentId: actor.departmentId },
        orderBy: { sequence: 'desc' },
        select: { sequence: true },
      });
      await tx.caseTrialRound.create({
        data: {
          id: childRoundId,
          caseId,
          departmentId: actor.departmentId,
          sequence: (latest?.sequence ?? 0) + 1,
          sourceResultId: resultId,
          origin: 'NORMAL',
          externalEntryId: entryId,
        },
      });
    }
    const updated = await tx.case.updateMany({
      where: {
        id: caseId,
        departmentId: actor.departmentId,
        stage: 'SECOND_INSTANCE',
        version,
        currentTrialRoundId: value.trialRoundId,
        currentJudgmentNextStepId: value.choiceId,
        currentSecondInstanceProgressId: progressId,
        currentSecondInstanceResultId: null,
      },
      data: {
        stage,
        version: { increment: 1 },
        currentSecondInstanceResultId: resultId,
        ...(childRoundId === null
          ? {}
          : {
              currentTrialRoundId: childRoundId,
              currentAcceptanceId: null,
              currentHearingArrangementId: null,
              currentHearingAdvanceId: null,
              currentJudgmentId: null,
              currentJudgmentNextStepId: null,
              currentSecondInstanceProgressId: null,
              courtCaseNo: null,
            }),
      },
    });
    if (updated.count !== 1) throw this.versionConflict();
    const response: SecondInstanceCommandResultDto = {
      id: caseId,
      stage,
      version: version + 1,
      currentTrialRoundId: childRoundId ?? value.trialRoundId,
      progressId,
      resultId,
      recordedAt: recordedAt.toISOString(),
    };
    await this.saveReceipt(
      tx,
      actor,
      caseId,
      action,
      value.idempotencyKey,
      fingerprint,
      response,
    );
    return response;
  }

  private async revokeLocked(
    tx: Prisma.TransactionClient,
    actor: ActorContext,
    caseId: string,
    value: RevokeValue,
    record: LockedCase,
    source: CaseSourceAnchor,
    fingerprint: string,
  ): Promise<SecondInstanceCommandResultDto> {
    const result = record.currentSecondInstanceResult;
    const entryId = source.kind === 'EXTERNAL_ENTRY' ? source.entryId : null;
    if (
      result === null ||
      result.id !== value.resultId ||
      (result.externalEntryId ?? null) !== entryId ||
      result.trialRoundId !== value.trialRoundId ||
      record.currentSecondInstanceResultId !== value.resultId ||
      record.stage !==
        (result.result === 'REMAND'
          ? 'WAITING_FORMAL_ACCEPTANCE'
          : 'WAITING_EXECUTION_DOCUMENTS')
    )
      throw this.invalidState();
    if (
      (await tx.caseExecutionSubmission.count({
        where: {
          caseId,
          departmentId: actor.departmentId,
          secondInstanceResultId: value.resultId,
        },
      })) > 0
    )
      throw this.invalidState();
    let childRoundId: string | null = null;
    if (result.result === 'REMAND') {
      const child = await tx.caseTrialRound.findFirst({
        where: {
          sourceResultId: result.id,
          caseId,
          departmentId: actor.departmentId,
        },
        select: { id: true, revokedAt: true },
      });
      if (
        child === null ||
        child.revokedAt !== null ||
        child.id !== record.currentTrialRoundId
      )
        throw this.invalidState();
      const [acceptance, hearing, advance, judgment, choice] =
        await Promise.all([
          tx.caseAcceptance.findFirst({
            where: {
              trialRoundId: child.id,
              caseId,
              departmentId: actor.departmentId,
            },
            select: { id: true },
          }),
          tx.caseHearingArrangement.findFirst({
            where: {
              trialRoundId: child.id,
              caseId,
              departmentId: actor.departmentId,
            },
            select: { id: true },
          }),
          tx.caseHearingAdvance.findFirst({
            where: {
              trialRoundId: child.id,
              caseId,
              departmentId: actor.departmentId,
            },
            select: { id: true },
          }),
          tx.caseJudgmentFact.findFirst({
            where: {
              trialRoundId: child.id,
              caseId,
              departmentId: actor.departmentId,
            },
            select: { id: true },
          }),
          tx.caseJudgmentNextStep.findFirst({
            where: {
              trialRoundId: child.id,
              caseId,
              departmentId: actor.departmentId,
            },
            select: { id: true },
          }),
        ]);
      if (acceptance || hearing || advance || judgment || choice)
        throw this.invalidState();
      childRoundId = child.id;
    }
    const sourceRound = await tx.caseTrialRound.findFirst({
      where: {
        id: result.trialRoundId,
        caseId,
        departmentId: actor.departmentId,
        revokedAt: null,
      },
      select: { id: true, origin: true, externalEntryId: true },
    });
    if (sourceRound === null) throw this.invalidState();
    const directEntry =
      isEntryStartingAt(source, 'SECOND_INSTANCE') &&
      result.choiceId === null &&
      sourceRound.origin === 'EXTERNAL_CURRENT' &&
      sourceRound.externalEntryId === source.entryId;
    const sourceChoice =
      result.choiceId === null
        ? null
        : await tx.caseJudgmentNextStep.findFirst({
            where: {
              id: result.choiceId,
              caseId,
              departmentId: actor.departmentId,
              trialRoundId: result.trialRoundId,
              externalEntryId: entryId,
              next: 'APPEAL',
              revocation: { is: null },
            },
            select: { id: true, judgmentId: true },
          });
    const sourceAcceptance = await tx.caseAcceptance.findFirst({
      where: {
        trialRoundId: result.trialRoundId,
        caseId,
        departmentId: actor.departmentId,
      },
      select: {
        id: true,
        courtCaseNo: true,
        corrections: {
          orderBy: { toRevision: 'desc' },
          take: 1,
          select: { courtCaseNo: true },
        },
      },
    });
    const sourceHearing = await tx.caseHearingArrangement.findFirst({
      where: {
        trialRoundId: result.trialRoundId,
        caseId,
        departmentId: actor.departmentId,
      },
      orderBy: [{ toVersion: 'desc' }, { id: 'desc' }],
      select: { id: true },
    });
    const sourceAdvance = await tx.caseHearingAdvance.findFirst({
      where: {
        trialRoundId: result.trialRoundId,
        caseId,
        departmentId: actor.departmentId,
      },
      orderBy: [{ toVersion: 'desc' }, { id: 'desc' }],
      select: { id: true },
    });
    const unacceptedExternalAppeal =
      source.kind === 'EXTERNAL_ENTRY' &&
      (source.initialStage === 'WAITING_HEARING' ||
        source.initialStage === 'WAITING_JUDGMENT') &&
      sourceRound.origin === 'EXTERNAL_CURRENT' &&
      sourceRound.externalEntryId === source.entryId &&
      result.choiceId !== null &&
      sourceChoice?.judgmentId !== null &&
      sourceChoice?.judgmentId !== undefined &&
      sourceAcceptance === null &&
      (await tx.caseJudgmentFact.findFirst({
        where: {
          id: sourceChoice.judgmentId,
          caseId,
          departmentId: actor.departmentId,
          trialRoundId: result.trialRoundId,
          externalEntryId: source.entryId,
        },
        select: { id: true },
      })) !== null;
    if (
      !directEntry &&
      (sourceChoice === null ||
        (sourceAcceptance === null && !unacceptedExternalAppeal))
    )
      throw this.invalidState();
    const revocationId = randomUUID();
    const recordedAt = new Date();
    const audit = await tx.auditEvent.create({
      data: {
        departmentId: actor.departmentId,
        actorUserId: actor.userId,
        internalActorUserId: actor.userId,
        resourceType: 'CASE',
        resourceId: caseId,
        action: 'case.second_instance.result.revoke',
        details: {
          resultId: value.resultId,
          trialRoundId: value.trialRoundId,
          childRoundId,
          revocationId,
          reason: value.reason,
          fromVersion: value.expectedVersion,
          toVersion: value.expectedVersion + 1,
        },
      },
      select: { id: true },
    });
    await tx.caseSecondInstanceResultRevocation.create({
      data: {
        id: revocationId,
        resultId: value.resultId,
        caseId,
        departmentId: actor.departmentId,
        reason: value.reason,
        fromVersion: value.expectedVersion,
        toVersion: value.expectedVersion + 1,
        recordedAt,
        recordedByUserId: actor.userId,
        auditEventId: audit.id,
      },
    });
    if (childRoundId !== null)
      await tx.caseTrialRound.update({
        where: { id: childRoundId },
        data: { revokedAt: recordedAt },
      });
    const updated = await tx.case.updateMany({
      where: {
        id: caseId,
        departmentId: actor.departmentId,
        stage: record.stage as
          'WAITING_FORMAL_ACCEPTANCE' | 'WAITING_EXECUTION_DOCUMENTS',
        version: value.expectedVersion,
        currentTrialRoundId: record.currentTrialRoundId,
        currentSecondInstanceResultId: value.resultId,
      },
      data: {
        stage: 'SECOND_INSTANCE',
        version: { increment: 1 },
        currentSecondInstanceResultId: null,
        currentSecondInstanceProgressId: result.progressId,
        ...(childRoundId === null
          ? {}
          : {
              currentTrialRoundId: result.trialRoundId,
              currentAcceptanceId: sourceAcceptance?.id ?? null,
              currentHearingArrangementId: sourceHearing?.id ?? null,
              currentHearingAdvanceId: sourceAdvance?.id ?? null,
              currentJudgmentId: sourceChoice?.judgmentId ?? null,
              currentJudgmentNextStepId: sourceChoice?.id ?? null,
              courtCaseNo:
                sourceAcceptance?.corrections[0]?.courtCaseNo ??
                sourceAcceptance?.courtCaseNo ??
                (source.kind === 'EXTERNAL_ENTRY'
                  ? source.known.courtCaseNo
                  : null),
            }),
      },
    });
    if (updated.count !== 1) throw this.versionConflict();
    const response: SecondInstanceCommandResultDto = {
      id: caseId,
      stage: 'SECOND_INSTANCE',
      version: value.expectedVersion + 1,
      currentTrialRoundId: result.trialRoundId,
      progressId: result.progressId,
      resultId: null,
      revocationId,
      recordedAt: recordedAt.toISOString(),
    };
    await this.saveReceipt(
      tx,
      actor,
      caseId,
      'REVOKE',
      value.idempotencyKey,
      fingerprint,
      response,
    );
    return response;
  }

  private sameProgress(
    input: Progress,
    current: {
      hearingAt: Date | null;
      hearingPlace: string | null;
      judgeName: string | null;
      versions: { category: string; contentVersionId: string }[];
    } | null,
  ): boolean {
    if (current === null)
      return (
        input.hearingAt === null &&
        input.hearingPlace === null &&
        input.judgeName === null &&
        input.documentContentVersionIds.length === 0 &&
        input.serviceContentVersionIds.length === 0
      );
    return (
      input.hearingAt ===
        (current.hearingAt?.toISOString().slice(0, 10) ?? null) &&
      input.hearingPlace === current.hearingPlace &&
      input.judgeName === current.judgeName &&
      JSON.stringify(input.documentContentVersionIds) ===
        JSON.stringify(
          current.versions
            .filter((v) => v.category === 'SECOND_INSTANCE_DOCUMENT')
            .map((v) => v.contentVersionId)
            .sort(),
        ) &&
      JSON.stringify(input.serviceContentVersionIds) ===
        JSON.stringify(
          current.versions
            .filter((v) => v.category === 'SECOND_INSTANCE_SERVICE')
            .map((v) => v.contentVersionId)
            .sort(),
        )
    );
  }

  private normalizeSave(input: SaveSecondInstanceDto): SaveValue {
    if (
      !Number.isInteger(input.expectedVersion) ||
      input.expectedVersion < 1 ||
      !this.key(input.idempotencyKey) ||
      typeof input.trialRoundId !== 'string' ||
      !uuid.test(input.trialRoundId) ||
      (input.choiceId !== null &&
        (typeof input.choiceId !== 'string' || !uuid.test(input.choiceId))) ||
      (input.expectedProgressId !== null &&
        (typeof input.expectedProgressId !== 'string' ||
          !uuid.test(input.expectedProgressId)))
    )
      throw this.validation();
    const p = input.progress;
    if (
      p === null ||
      typeof p !== 'object' ||
      (p.hearingAt !== null && !this.date(p.hearingAt, false)) ||
      !this.text(p.hearingPlace, 500) ||
      !this.text(p.judgeName, 200) ||
      !this.ids(p.documentContentVersionIds, 0) ||
      !this.ids(p.serviceContentVersionIds, 0)
    )
      throw this.validation();
    return {
      expectedVersion: input.expectedVersion,
      idempotencyKey: input.idempotencyKey,
      trialRoundId: input.trialRoundId,
      choiceId: input.choiceId,
      expectedProgressId: input.expectedProgressId,
      progress: {
        hearingAt: p.hearingAt,
        hearingPlace: p.hearingPlace?.trim() || null,
        judgeName: p.judgeName?.trim() || null,
        documentContentVersionIds: [...p.documentContentVersionIds].sort(),
        serviceContentVersionIds: [...p.serviceContentVersionIds].sort(),
      },
    };
  }
  private normalizeResult(input: RegisterSecondInstanceResultDto): ResultValue {
    const value = this.normalizeSave(input);
    if (
      !['REMAND', 'CHANGE', 'AFFIRM'].includes(input.result) ||
      !this.date(input.resultReceivedAt, true) ||
      !this.ids(input.judgmentContentVersionIds, 1) ||
      (input.result === 'CHANGE' && input.judgmentAmount === undefined) ||
      (input.result === 'REMAND' && input.judgmentAmount !== undefined)
    )
      throw this.validation();
    return {
      ...value,
      result: input.result,
      resultReceivedAt: input.resultReceivedAt,
      judgmentContentVersionIds: [...input.judgmentContentVersionIds].sort(),
      paidLitigationFee: this.money(input.paidLitigationFee),
      judgmentAmount:
        input.result === 'CHANGE' || input.judgmentAmount !== undefined
          ? this.money(input.judgmentAmount!)
          : null,
    };
  }
  private normalizeRevoke(input: RevokeSecondInstanceResultDto): RevokeValue {
    if (
      !Number.isInteger(input.expectedVersion) ||
      input.expectedVersion < 1 ||
      !this.key(input.idempotencyKey) ||
      typeof input.trialRoundId !== 'string' ||
      !uuid.test(input.trialRoundId) ||
      typeof input.resultId !== 'string' ||
      !uuid.test(input.resultId) ||
      typeof input.reason !== 'string' ||
      input.reason.trim().length < 1 ||
      input.reason.trim().length > 500
    )
      throw this.validation();
    return {
      expectedVersion: input.expectedVersion,
      idempotencyKey: input.idempotencyKey,
      trialRoundId: input.trialRoundId,
      resultId: input.resultId,
      reason: input.reason.trim(),
    };
  }
  private money(input: KnownMoneyDto): {
    state: 'KNOWN' | 'PENDING';
    amount: string | null;
  } {
    if (input?.state === 'PENDING' && input.amount === null)
      return { state: 'PENDING', amount: null };
    if (
      input?.state === 'KNOWN' &&
      typeof input.amount === 'string' &&
      /^(?:0|[1-9]\d{0,13})(?:\.\d{1,2})?$/u.test(input.amount)
    )
      return {
        state: 'KNOWN',
        amount: new Prisma.Decimal(input.amount).toFixed(2),
      };
    throw this.validation();
  }
  private key(value: unknown): value is string {
    return (
      typeof value === 'string' &&
      value.length > 0 &&
      value.length <= 128 &&
      value.trim() === value
    );
  }
  private ids(value: unknown, minimum: number): value is string[] {
    return (
      Array.isArray(value) &&
      value.length >= minimum &&
      value.length <= 10 &&
      value.every((id) => typeof id === 'string' && uuid.test(id)) &&
      new Set(value).size === value.length
    );
  }
  private text(value: unknown, max: number): value is string | null {
    return (
      value === null ||
      (typeof value === 'string' && value.trim().length <= max)
    );
  }
  private date(value: unknown, pastOnly: boolean): value is string {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value))
      return false;
    const parsed = new Date(`${value}T00:00:00.000Z`);
    if (
      Number.isNaN(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== value
    )
      return false;
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    return !pastOnly || value <= today;
  }
  private async saveReceipt(
    tx: Prisma.TransactionClient,
    actor: ActorContext,
    caseId: string,
    action: Action,
    key: string,
    fingerprint: string,
    response: SecondInstanceCommandResultDto,
  ) {
    await tx.caseSecondInstanceReceipt.create({
      data: {
        departmentId: actor.departmentId,
        actorUserId: actor.userId,
        caseId,
        action,
        idempotencyKey: key,
        requestFingerprint: fingerprint,
        resultSnapshot: { ...response },
      },
    });
  }
  private receipt(
    snapshot: Prisma.JsonValue,
    caseId: string,
  ): SecondInstanceCommandResultDto {
    if (
      snapshot === null ||
      typeof snapshot !== 'object' ||
      Array.isArray(snapshot) ||
      snapshot.id !== caseId ||
      ![
        'SECOND_INSTANCE',
        'WAITING_FORMAL_ACCEPTANCE',
        'WAITING_EXECUTION_DOCUMENTS',
      ].includes(String(snapshot.stage)) ||
      typeof snapshot.version !== 'number' ||
      !Number.isInteger(snapshot.version) ||
      typeof snapshot.currentTrialRoundId !== 'string' ||
      !uuid.test(snapshot.currentTrialRoundId) ||
      (snapshot.progressId !== null &&
        (typeof snapshot.progressId !== 'string' ||
          !uuid.test(snapshot.progressId))) ||
      (snapshot.resultId !== null &&
        (typeof snapshot.resultId !== 'string' ||
          !uuid.test(snapshot.resultId))) ||
      typeof snapshot.recordedAt !== 'string'
    )
      throw new InternalServerErrorException({
        code: 'RECEIPT_CORRUPT',
        message: '二审回执不可用',
      });
    return {
      id: caseId,
      stage: snapshot.stage as SecondInstanceCommandResultDto['stage'],
      version: snapshot.version,
      currentTrialRoundId: snapshot.currentTrialRoundId,
      progressId: snapshot.progressId as string | null,
      resultId: snapshot.resultId as string | null,
      ...(typeof snapshot.revocationId === 'string'
        ? { revocationId: snapshot.revocationId }
        : {}),
      recordedAt: snapshot.recordedAt,
    };
  }
  private validation() {
    return new BadRequestException({
      code: 'VALIDATION_ERROR',
      message: '二审参数无效',
    });
  }
  private forbidden() {
    return new ForbiddenException({
      code: 'ACTION_FORBIDDEN',
      message: '无权办理二审',
    });
  }
  private notFound() {
    return new NotFoundException({
      code: 'RESOURCE_NOT_FOUND',
      message: '案件不存在或不可访问',
    });
  }
  private invalidState() {
    return new ConflictException({
      code: 'INVALID_STATE',
      message: '案件当前不能办理二审',
    });
  }
  private versionConflict() {
    return new ConflictException({
      code: 'VERSION_CONFLICT',
      message: '案件状态或版本已变化',
    });
  }
  private idempotencyConflict() {
    return new ConflictException({
      code: 'IDEMPOTENCY_CONFLICT',
      message: '幂等键已用于其他二审请求',
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
    if (error === null || typeof error !== 'object') return false;
    const value = error as {
      meta?: {
        target?: unknown;
        driverAdapterError?: {
          cause?: { constraint?: unknown; constraintName?: unknown };
        };
      };
      cause?: unknown;
    };
    const target =
      value.meta?.target ??
      value.meta?.driverAdapterError?.cause?.constraint ??
      value.meta?.driverAdapterError?.cause?.constraintName;
    if (target === 'case_second_instance_receipts_actor_key') return true;
    if (Array.isArray(target)) {
      const fields = target.map(String).sort().join(',');
      return (
        fields ===
          ['departmentId', 'actorUserId', 'action', 'idempotencyKey']
            .sort()
            .join(',') ||
        fields ===
          ['department_id', 'actor_user_id', 'action', 'idempotency_key']
            .sort()
            .join(',')
      );
    }
    return this.isReceiptKeyConflict(value.cause);
  }
}
