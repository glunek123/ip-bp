import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AccessControlService } from '../../access-control/access-control.service';
import { ActorContext } from '../../access-control/actor-context';
import { DatabaseService } from '../../database/database.service';
import { Prisma } from '../../generated/prisma/client';
import { MaterialService } from '../materials';
import {
  caseListDisplay,
  caseListDisplaySelect,
} from './case-list-display-read';

const isoDate = (value: Date) => value.toISOString().slice(0, 10);

@Injectable()
export class CaseReadService {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: AccessControlService,
    private readonly materials: MaterialService,
  ) {}

  private async scope(actor: ActorContext): Promise<'INTERNAL' | 'LAWYER'> {
    if (
      actor.notaryOfficeId !== undefined ||
      actor.clientCustomerId !== undefined
    )
      throw this.forbidden();
    const account = await this.database.userAccount.findUnique({
      where: { id: actor.userId },
      select: { accountType: true, active: true },
    });
    if (!account?.active) throw this.forbidden();
    if (account.accountType === 'LAWYER') {
      if (actor.lawyerAccountId !== actor.userId) throw this.forbidden();
      const binding = await this.database.lawyerAccountBinding.findFirst({
        where: {
          userId: actor.userId,
          departmentId: actor.departmentId,
          active: true,
        },
        select: { id: true },
      });
      if (binding === null) throw this.forbidden();
      return 'LAWYER';
    }
    if (
      account.accountType !== 'INTERNAL' ||
      actor.lawyerAccountId !== undefined
    )
      throw this.forbidden();
    try {
      await this.access.authorizeDepartmentAction(actor, 'case.read');
    } catch (error) {
      if (error instanceof ForbiddenException) throw this.forbidden();
      throw error;
    }
    return 'INTERNAL';
  }

  private lawyerWhere(actor: ActorContext): Prisma.CaseWhereInput {
    return {
      lawyers: {
        some: {
          role: 'PRIMARY',
          endedAt: null,
          lawyer: {
            accountBinding: {
              is: {
                userId: actor.userId,
                departmentId: actor.departmentId,
                active: true,
                user: { active: true, accountType: 'LAWYER' },
              },
            },
          },
        },
      },
    };
  }

  async list(
    actor: ActorContext,
    page: number,
    pageSize: number,
    view: 'mine' | 'department' = 'department',
    stage?:
      | 'PENDING_MATCH'
      | 'WAITING_COMPLAINT'
      | 'WAITING_COMPLAINT_CONFIRMATION'
      | 'WAITING_COMPLAINT_STAMP'
      | 'WAITING_FILING'
      | 'WAITING_FORMAL_ACCEPTANCE'
      | 'WAITING_HEARING'
      | 'WAITING_JUDGMENT'
      | 'SECOND_INSTANCE'
      | 'WAITING_EXECUTION_DOCUMENTS'
      | 'WAITING_EXECUTION_CONFIRMATION'
      | 'WAITING_EXECUTION_STAMP'
      | 'WAITING_EXECUTION_FILING'
      | 'EXECUTING'
      | 'WAITING_ARCHIVE'
      | 'ARCHIVED',
    stageGroup?: 'COMPLAINT_PREPARATION' | 'EXECUTION_PREPARATION',
  ) {
    if (stage !== undefined && stageGroup !== undefined)
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: '阶段与阶段组不能同时筛选',
      });
    const principal = await this.scope(actor);
    const baseWhere: Prisma.CaseWhereInput = {
      departmentId: actor.departmentId,
      ...(principal === 'LAWYER'
        ? this.lawyerWhere(actor)
        : view === 'mine'
          ? { responsibleUserId: actor.userId }
          : {}),
    };
    const where: Prisma.CaseWhereInput = {
      ...baseWhere,
      ...(stage
        ? { stage }
        : stageGroup === 'COMPLAINT_PREPARATION'
          ? {
              stage: {
                in: [
                  'WAITING_COMPLAINT',
                  'WAITING_COMPLAINT_CONFIRMATION',
                  'WAITING_COMPLAINT_STAMP',
                ],
              },
            }
          : stageGroup === 'EXECUTION_PREPARATION'
            ? {
                stage: {
                  in: [
                    'WAITING_EXECUTION_DOCUMENTS',
                    'WAITING_EXECUTION_CONFIRMATION',
                    'WAITING_EXECUTION_STAMP',
                  ],
                },
              }
            : {}),
    };
    const [items, total, grouped] = await Promise.all([
      this.database.case.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          businessNo: true,
          stage: true,
          version: true,
          currentHearingAdvanceId: true,
          currentJudgmentId: true,
          currentJudgmentNextStepId: true,
          currentJudgmentNextStep: {
            select: {
              id: true,
              trialRoundId: true,
              judgmentId: true,
              next: true,
            },
          },
          currentTrialRoundId: true,
          currentSecondInstanceResultId: true,
          currentExecutionSubmissionId: true,
          executionConfirmation: { select: { id: true } },
          executionMailing: { select: { id: true } },
          executionFiling: { select: { id: true, toVersion: true } },
          executionFinish: { select: { id: true, toVersion: true } },
          archive: {
            select: {
              id: true,
              currentVersion: { select: { id: true, toVersion: true } },
            },
          },
          closure: {
            select: {
              id: true,
              currentVersion: { select: { id: true, toVersion: true } },
            },
          },
          currentSecondInstanceResult: {
            select: {
              id: true,
              result: true,
              trialRoundId: true,
              choiceId: true,
              revocation: { select: { id: true } },
              childRound: {
                select: {
                  id: true,
                  revokedAt: true,
                  _count: {
                    select: {
                      acceptances: true,
                      hearings: true,
                      advances: true,
                      judgments: true,
                      choices: true,
                    },
                  },
                },
              },
            },
          },
          secondInstanceProgresses: { select: { choiceId: true } },
          secondInstanceResults: { select: { choiceId: true } },
          secondInstanceAcceptanceChanges: { select: { choiceId: true } },
          createdAt: true,
          responsibleUserId: true,
          owner: { select: { id: true, displayName: true } },
          responsibleMembership: { select: { teamId: true } },
          sourceLead: { select: { id: true, businessNo: true } },
          sourceNotaryMatter: { select: { id: true, businessNo: true } },
          externalEntry: {
            select: {
              id: true,
              entryKind: true,
              initialStage: true,
              stageReachedOn: true,
              source: true,
              reason: true,
              recordedAt: true,
              recordedByUserId: true,
              known: true,
            },
          },
        },
      }),
      this.database.case.count({ where }),
      this.database.case.groupBy({
        by: ['stage'],
        where: baseWhere,
        _count: { _all: true },
      }),
    ]);
    const displayRecords =
      principal === 'INTERNAL' && items.length > 0
        ? await this.database.case.findMany({
            where: { ...baseWhere, id: { in: items.map((item) => item.id) } },
            select: caseListDisplaySelect,
          })
        : [];
    const displays = new Map(
      displayRecords.map((item) => [item.id, caseListDisplay(item)]),
    );
    return {
      items: await Promise.all(
        items.map(async (item) => ({
          id: item.id,
          businessNo: item.businessNo,
          stage: item.stage,
          version: item.version,
          ...(principal === 'LAWYER'
            ? {}
            : {
                displaySummary:
                  displays.get(item.id) ??
                  (() => {
                    throw new NotFoundException({
                      code: 'CASE_NOT_FOUND',
                      message: '案件不存在',
                    });
                  })(),
                owner: item.owner,
                sourceLead: item.sourceLead,
                sourceNotaryMatter: item.sourceNotaryMatter,
                origin:
                  item.externalEntry === null
                    ? { kind: 'NOTARY' as const }
                    : {
                        kind: 'EXTERNAL_ENTRY' as const,
                        entryId: item.externalEntry.id,
                        entryKind: item.externalEntry.entryKind,
                        initialStage: item.externalEntry.initialStage,
                        stageReachedOn: item.externalEntry.stageReachedOn
                          .toISOString()
                          .slice(0, 10),
                        source: item.externalEntry.source,
                        reason: item.externalEntry.reason,
                        recordedAt: item.externalEntry.recordedAt.toISOString(),
                        recordedByUserId: item.externalEntry.recordedByUserId,
                        known: item.externalEntry.known,
                      },
              }),
          canMatch:
            principal === 'INTERNAL' &&
            item.stage === 'PENDING_MATCH' &&
            (await this.access.canAuthorizeCase(actor, 'case.match', {
              departmentId: actor.departmentId,
              responsibleUserId: item.responsibleUserId,
              ...(item.responsibleMembership.teamId
                ? { teamId: item.responsibleMembership.teamId }
                : {}),
            })),
          canSubmitComplaint:
            item.stage === 'WAITING_COMPLAINT' &&
            (principal === 'LAWYER' ||
              (await this.access.canAuthorizeCase(
                actor,
                'case.complaint.submit',
                {
                  departmentId: actor.departmentId,
                  responsibleUserId: item.responsibleUserId,
                  ...(item.responsibleMembership.teamId
                    ? { teamId: item.responsibleMembership.teamId }
                    : {}),
                },
              ))),
          canConfirmComplaint:
            item.stage === 'WAITING_COMPLAINT_CONFIRMATION' &&
            (principal === 'LAWYER' ||
              (await this.access.canAuthorizeCase(
                actor,
                'case.complaint.confirm',
                {
                  departmentId: actor.departmentId,
                  responsibleUserId: item.responsibleUserId,
                  ...(item.responsibleMembership.teamId
                    ? { teamId: item.responsibleMembership.teamId }
                    : {}),
                },
              ))),
          canMailComplaint:
            item.stage === 'WAITING_COMPLAINT_STAMP' &&
            (principal === 'LAWYER' ||
              (await this.access.canAuthorizeCase(
                actor,
                'case.complaint.mail',
                {
                  departmentId: actor.departmentId,
                  responsibleUserId: item.responsibleUserId,
                  ...(item.responsibleMembership.teamId
                    ? { teamId: item.responsibleMembership.teamId }
                    : {}),
                },
              ))),
          canSubmitFiling:
            item.stage === 'WAITING_FILING' &&
            (principal === 'LAWYER' ||
              (await this.access.canAuthorizeCase(actor, 'case.filing.submit', {
                departmentId: actor.departmentId,
                responsibleUserId: item.responsibleUserId,
                ...(item.responsibleMembership.teamId
                  ? { teamId: item.responsibleMembership.teamId }
                  : {}),
              }))),
          canRegisterAcceptance:
            item.stage === 'WAITING_FORMAL_ACCEPTANCE' &&
            (principal === 'LAWYER' ||
              (await this.access.canAuthorizeCase(
                actor,
                'case.acceptance.register',
                {
                  departmentId: actor.departmentId,
                  responsibleUserId: item.responsibleUserId,
                  ...(item.responsibleMembership.teamId
                    ? { teamId: item.responsibleMembership.teamId }
                    : {}),
                },
              ))),
          canUploadAcceptanceMaterials:
            (item.stage === 'WAITING_FORMAL_ACCEPTANCE' ||
              item.stage === 'WAITING_HEARING') &&
            (principal === 'LAWYER' ||
              (await this.access.canAuthorizeCase(
                actor,
                'case.acceptance.register',
                {
                  departmentId: actor.departmentId,
                  responsibleUserId: item.responsibleUserId,
                  ...(item.responsibleMembership.teamId
                    ? { teamId: item.responsibleMembership.teamId }
                    : {}),
                },
              ))),
          canScheduleHearing:
            item.stage === 'WAITING_HEARING' &&
            (principal === 'LAWYER' ||
              (await this.access.canAuthorizeCase(
                actor,
                'case.hearing.schedule',
                {
                  departmentId: actor.departmentId,
                  responsibleUserId: item.responsibleUserId,
                  ...(item.responsibleMembership.teamId
                    ? { teamId: item.responsibleMembership.teamId }
                    : {}),
                },
              ))),
          canCorrectHearing:
            principal === 'INTERNAL' &&
            item.stage === 'WAITING_JUDGMENT' &&
            item.currentHearingAdvanceId !== null &&
            item.currentJudgmentId === null &&
            (await this.access.canAuthorizeCase(actor, 'case.hearing.correct', {
              departmentId: actor.departmentId,
              responsibleUserId: item.responsibleUserId,
              ...(item.responsibleMembership.teamId
                ? { teamId: item.responsibleMembership.teamId }
                : {}),
            })),
          canRegisterJudgment:
            item.stage === 'WAITING_JUDGMENT' &&
            item.currentJudgmentId === null &&
            (principal === 'LAWYER' ||
              (await this.access.canAuthorizeCase(
                actor,
                'case.judgment.register',
                {
                  departmentId: actor.departmentId,
                  responsibleUserId: item.responsibleUserId,
                  ...(item.responsibleMembership.teamId
                    ? { teamId: item.responsibleMembership.teamId }
                    : {}),
                },
              ))),
          canCorrectJudgment:
            principal === 'INTERNAL' &&
            item.stage === 'WAITING_JUDGMENT' &&
            item.currentJudgmentId !== null &&
            item.currentJudgmentNextStepId === null &&
            (await this.access.canAuthorizeCase(
              actor,
              'case.judgment.correct',
              {
                departmentId: actor.departmentId,
                responsibleUserId: item.responsibleUserId,
                ...(item.responsibleMembership.teamId
                  ? { teamId: item.responsibleMembership.teamId }
                  : {}),
              },
            )),
          canChooseJudgmentNextStep:
            item.stage === 'WAITING_JUDGMENT' &&
            item.currentJudgmentId !== null &&
            item.currentJudgmentNextStepId === null &&
            (principal === 'LAWYER' ||
              (await this.access.canAuthorizeCase(
                actor,
                'case.judgment.next_step',
                {
                  departmentId: actor.departmentId,
                  responsibleUserId: item.responsibleUserId,
                  ...(item.responsibleMembership.teamId
                    ? { teamId: item.responsibleMembership.teamId }
                    : {}),
                },
              ))),
          canRevokeJudgmentNextStep:
            principal === 'INTERNAL' &&
            (item.stage === 'SECOND_INSTANCE' ||
              item.stage === 'WAITING_EXECUTION_DOCUMENTS') &&
            item.currentJudgmentNextStepId !== null &&
            item.currentJudgmentNextStep?.next ===
              (item.stage === 'SECOND_INSTANCE' ? 'APPEAL' : 'EXECUTION') &&
            (item.currentJudgmentNextStep.next !== 'APPEAL' ||
              (!item.secondInstanceProgresses.some(
                (progress) =>
                  progress.choiceId === item.currentJudgmentNextStepId,
              ) &&
                !item.secondInstanceResults.some(
                  (result) =>
                    result.choiceId === item.currentJudgmentNextStepId,
                ) &&
                !(item.secondInstanceAcceptanceChanges ?? []).some(
                  (change) =>
                    change.choiceId === item.currentJudgmentNextStepId,
                ))) &&
            (await this.access.canAuthorizeCase(
              actor,
              'case.judgment.next_step.revoke',
              {
                departmentId: actor.departmentId,
                responsibleUserId: item.responsibleUserId,
                ...(item.responsibleMembership.teamId
                  ? { teamId: item.responsibleMembership.teamId }
                  : {}),
              },
            )),
          canSaveSecondInstance:
            item.stage === 'SECOND_INSTANCE' &&
            item.currentTrialRoundId !== null &&
            ((item.externalEntry?.initialStage === 'SECOND_INSTANCE' &&
              item.currentJudgmentNextStepId === null) ||
              (item.currentJudgmentNextStepId !== null &&
                item.currentJudgmentNextStep?.next === 'APPEAL' &&
                item.currentJudgmentNextStep.trialRoundId ===
                  item.currentTrialRoundId &&
                item.currentJudgmentNextStep.judgmentId ===
                  item.currentJudgmentId)) &&
            item.currentSecondInstanceResultId === null &&
            (principal === 'LAWYER' ||
              (await this.access.canAuthorizeCase(
                actor,
                'case.second_instance.save',
                {
                  departmentId: actor.departmentId,
                  responsibleUserId: item.responsibleUserId,
                  ...(item.responsibleMembership.teamId
                    ? { teamId: item.responsibleMembership.teamId }
                    : {}),
                },
              ))),
          canRegisterSecondInstanceResult:
            item.stage === 'SECOND_INSTANCE' &&
            item.currentTrialRoundId !== null &&
            ((item.externalEntry?.initialStage === 'SECOND_INSTANCE' &&
              item.currentJudgmentNextStepId === null) ||
              (item.currentJudgmentNextStepId !== null &&
                item.currentJudgmentNextStep?.next === 'APPEAL' &&
                item.currentJudgmentNextStep.trialRoundId ===
                  item.currentTrialRoundId &&
                item.currentJudgmentNextStep.judgmentId ===
                  item.currentJudgmentId)) &&
            item.currentSecondInstanceResultId === null &&
            (principal === 'LAWYER' ||
              (await this.access.canAuthorizeCase(
                actor,
                'case.second_instance.result',
                {
                  departmentId: actor.departmentId,
                  responsibleUserId: item.responsibleUserId,
                  ...(item.responsibleMembership.teamId
                    ? { teamId: item.responsibleMembership.teamId }
                    : {}),
                },
              ))),
          canRevokeSecondInstanceResult:
            principal === 'INTERNAL' &&
            item.currentSecondInstanceResultId !== null &&
            item.currentSecondInstanceResult?.id ===
              item.currentSecondInstanceResultId &&
            item.currentSecondInstanceResult.revocation === null &&
            (item.currentSecondInstanceResult.result === 'REMAND'
              ? item.stage === 'WAITING_FORMAL_ACCEPTANCE' &&
                item.currentSecondInstanceResult.childRound?.id ===
                  item.currentTrialRoundId &&
                item.currentSecondInstanceResult.childRound.revokedAt ===
                  null &&
                Object.values(
                  item.currentSecondInstanceResult.childRound._count,
                ).every((count) => count === 0)
              : item.stage === 'WAITING_EXECUTION_DOCUMENTS') &&
            (await this.access.canAuthorizeCase(
              actor,
              'case.second_instance.result.revoke',
              {
                departmentId: actor.departmentId,
                responsibleUserId: item.responsibleUserId,
                ...(item.responsibleMembership.teamId
                  ? { teamId: item.responsibleMembership.teamId }
                  : {}),
              },
            )),
          canSubmitExecution:
            (item.stage === 'WAITING_EXECUTION_DOCUMENTS' ||
              item.stage === 'WAITING_EXECUTION_CONFIRMATION') &&
            item.currentTrialRoundId !== null &&
            ((item.externalEntry?.initialStage ===
              'WAITING_EXECUTION_DOCUMENTS' &&
              item.currentJudgmentNextStepId === null &&
              item.currentSecondInstanceResultId === null) ||
              (item.externalEntry?.initialStage === 'SECOND_INSTANCE' &&
                item.currentJudgmentNextStepId === null &&
                item.currentSecondInstanceResult?.id ===
                  item.currentSecondInstanceResultId &&
                item.currentSecondInstanceResult?.choiceId === null &&
                item.currentSecondInstanceResult?.trialRoundId ===
                  item.currentTrialRoundId &&
                (item.currentSecondInstanceResult?.result === 'CHANGE' ||
                  item.currentSecondInstanceResult?.result === 'AFFIRM') &&
                item.currentSecondInstanceResult?.revocation === null) ||
              (item.currentJudgmentNextStepId !== null &&
                item.currentJudgmentNextStep?.trialRoundId ===
                  item.currentTrialRoundId &&
                (item.currentJudgmentNextStep.next === 'EXECUTION'
                  ? item.currentSecondInstanceResultId === null
                  : item.currentJudgmentNextStep.next === 'APPEAL' &&
                    item.currentSecondInstanceResult?.id ===
                      item.currentSecondInstanceResultId &&
                    item.currentSecondInstanceResult?.choiceId ===
                      item.currentJudgmentNextStepId &&
                    item.currentSecondInstanceResult?.trialRoundId ===
                      item.currentTrialRoundId &&
                    (item.currentSecondInstanceResult?.result === 'CHANGE' ||
                      item.currentSecondInstanceResult?.result === 'AFFIRM') &&
                    item.currentSecondInstanceResult?.revocation === null))) &&
            (item.stage === 'WAITING_EXECUTION_DOCUMENTS'
              ? item.currentExecutionSubmissionId === null
              : item.currentExecutionSubmissionId !== null) &&
            (principal === 'LAWYER' ||
              (await this.access.canAuthorizeCase(
                actor,
                'case.execution.submit',
                {
                  departmentId: actor.departmentId,
                  responsibleUserId: item.responsibleUserId,
                  ...(item.responsibleMembership.teamId
                    ? { teamId: item.responsibleMembership.teamId }
                    : {}),
                },
              ))),
          canConfirmExecution:
            item.stage === 'WAITING_EXECUTION_CONFIRMATION' &&
            (item.currentExecutionSubmissionId !== null ||
              item.externalEntry?.initialStage ===
                'WAITING_EXECUTION_CONFIRMATION') &&
            item.executionConfirmation === null &&
            (principal === 'LAWYER' ||
              (await this.access.canAuthorizeCase(
                actor,
                'case.execution.confirm',
                {
                  departmentId: actor.departmentId,
                  responsibleUserId: item.responsibleUserId,
                  ...(item.responsibleMembership.teamId
                    ? { teamId: item.responsibleMembership.teamId }
                    : {}),
                },
              ))),
          canMailExecution:
            item.stage === 'WAITING_EXECUTION_STAMP' &&
            (item.executionConfirmation !== null ||
              item.externalEntry?.initialStage === 'WAITING_EXECUTION_STAMP') &&
            item.executionMailing === null &&
            (principal === 'LAWYER' ||
              (await this.access.canAuthorizeCase(
                actor,
                'case.execution.mail',
                {
                  departmentId: actor.departmentId,
                  responsibleUserId: item.responsibleUserId,
                  ...(item.responsibleMembership.teamId
                    ? { teamId: item.responsibleMembership.teamId }
                    : {}),
                },
              ))),
          canArchive:
            item.stage === 'WAITING_ARCHIVE' &&
            item.archive == null &&
            item.closure?.currentVersion?.toVersion === item.version &&
            (principal === 'LAWYER' ||
              (await this.access.canAuthorizeCase(actor, 'case.archive', {
                departmentId: actor.departmentId,
                responsibleUserId: item.responsibleUserId,
                ...(item.responsibleMembership.teamId
                  ? { teamId: item.responsibleMembership.teamId }
                  : {}),
              }))),
          canCorrectArchive:
            principal === 'INTERNAL' &&
            item.stage === 'ARCHIVED' &&
            item.archive?.currentVersion?.toVersion === item.version &&
            (await this.access.canAuthorizeCase(actor, 'case.archive.correct', {
              departmentId: actor.departmentId,
              responsibleUserId: item.responsibleUserId,
              ...(item.responsibleMembership.teamId
                ? { teamId: item.responsibleMembership.teamId }
                : {}),
            })),
          canRecordClosure:
            item.stage === 'WAITING_ARCHIVE' &&
            ((item.executionFinish != null &&
              item.executionFinish.toVersion === item.version) ||
              (item.externalEntry?.initialStage === 'WAITING_ARCHIVE' &&
                item.executionFinish == null)) &&
            item.closure == null &&
            (principal === 'LAWYER' ||
              (await this.access.canAuthorizeCase(
                actor,
                'case.closure.record',
                {
                  departmentId: actor.departmentId,
                  responsibleUserId: item.responsibleUserId,
                  ...(item.responsibleMembership.teamId
                    ? { teamId: item.responsibleMembership.teamId }
                    : {}),
                },
              ))),
          canCorrectClosure:
            principal === 'INTERNAL' &&
            item.stage === 'WAITING_ARCHIVE' &&
            item.closure?.currentVersion?.toVersion === item.version &&
            (await this.access.canAuthorizeCase(actor, 'case.closure.correct', {
              departmentId: actor.departmentId,
              responsibleUserId: item.responsibleUserId,
              ...(item.responsibleMembership.teamId
                ? { teamId: item.responsibleMembership.teamId }
                : {}),
            })),
          canFinishExecution:
            item.stage === 'EXECUTING' &&
            ((item.executionFiling != null &&
              item.executionFiling.toVersion === item.version) ||
              (item.externalEntry?.initialStage === 'EXECUTING' &&
                item.executionFiling == null)) &&
            item.executionFinish == null &&
            (principal === 'LAWYER' ||
              (await this.access.canAuthorizeCase(
                actor,
                'case.execution.finish',
                {
                  departmentId: actor.departmentId,
                  responsibleUserId: item.responsibleUserId,
                  ...(item.responsibleMembership.teamId
                    ? { teamId: item.responsibleMembership.teamId }
                    : {}),
                },
              ))),
          canSubmitExecutionFiling:
            item.stage === 'WAITING_EXECUTION_FILING' &&
            (item.executionMailing !== null ||
              item.externalEntry?.initialStage ===
                'WAITING_EXECUTION_FILING') &&
            item.executionFiling === null &&
            (principal === 'LAWYER' ||
              (await this.access.canAuthorizeCase(
                actor,
                'case.execution.filing.submit',
                {
                  departmentId: actor.departmentId,
                  responsibleUserId: item.responsibleUserId,
                  ...(item.responsibleMembership.teamId
                    ? { teamId: item.responsibleMembership.teamId }
                    : {}),
                },
              ))),
          createdAt: item.createdAt.toISOString(),
        })),
      ),
      total,
      page,
      pageSize,
      counts: {
        PENDING_MATCH:
          grouped.find((row) => row.stage === 'PENDING_MATCH')?._count._all ??
          0,
        WAITING_COMPLAINT:
          grouped.find((row) => row.stage === 'WAITING_COMPLAINT')?._count
            ._all ?? 0,
        WAITING_COMPLAINT_CONFIRMATION:
          grouped.find((row) => row.stage === 'WAITING_COMPLAINT_CONFIRMATION')
            ?._count._all ?? 0,
        WAITING_COMPLAINT_STAMP:
          grouped.find((row) => row.stage === 'WAITING_COMPLAINT_STAMP')?._count
            ._all ?? 0,
        WAITING_FILING:
          grouped.find((row) => row.stage === 'WAITING_FILING')?._count._all ??
          0,
        WAITING_FORMAL_ACCEPTANCE:
          grouped.find((row) => row.stage === 'WAITING_FORMAL_ACCEPTANCE')
            ?._count._all ?? 0,
        WAITING_HEARING:
          grouped.find((row) => row.stage === 'WAITING_HEARING')?._count._all ??
          0,
        WAITING_JUDGMENT:
          grouped.find((row) => row.stage === 'WAITING_JUDGMENT')?._count
            ._all ?? 0,
        SECOND_INSTANCE:
          grouped.find((row) => row.stage === 'SECOND_INSTANCE')?._count._all ??
          0,
        WAITING_EXECUTION_DOCUMENTS:
          grouped.find((row) => row.stage === 'WAITING_EXECUTION_DOCUMENTS')
            ?._count._all ?? 0,
        WAITING_EXECUTION_CONFIRMATION:
          grouped.find((row) => row.stage === 'WAITING_EXECUTION_CONFIRMATION')
            ?._count._all ?? 0,
        WAITING_EXECUTION_STAMP:
          grouped.find((row) => row.stage === 'WAITING_EXECUTION_STAMP')?._count
            ._all ?? 0,
        WAITING_EXECUTION_FILING:
          grouped.find((row) => row.stage === 'WAITING_EXECUTION_FILING')
            ?._count._all ?? 0,
        ARCHIVED:
          grouped.find((row) => row.stage === 'ARCHIVED')?._count._all ?? 0,
        WAITING_ARCHIVE:
          grouped.find((row) => row.stage === 'WAITING_ARCHIVE')?._count._all ??
          0,
        EXECUTING:
          grouped.find((row) => row.stage === 'EXECUTING')?._count._all ?? 0,
      },
    };
  }

  async get(actor: ActorContext, id: string) {
    const principal = await this.scope(actor);
    const detailQuery = {
      where: {
        id,
        departmentId: actor.departmentId,
        ...(principal === 'LAWYER' ? this.lawyerWhere(actor) : {}),
      },
      select: {
        id: true,
        businessNo: true,
        stage: true,
        version: true,
        matchedAt: true,
        matchedOn: true,
        complaintAmountState: true,
        complaintAmount: true,
        complaintPendingReason: true,
        complaintSubmittedAt: true,
        complaintSubmittedByUserId: true,
        complaintConfirmation: {
          select: {
            confirmedComplaintContentVersionId: true,
            amountState: true,
            amount: true,
            pendingReason: true,
            changeNote: true,
            confirmDisclose: true,
            confirmedAt: true,
            confirmedByUserId: true,
          },
        },
        complaintMailing: {
          select: {
            mailedAt: true,
            recordedAt: true,
            recordedByUserId: true,
            actorType: true,
          },
        },
        filingSubmission: {
          select: {
            courtId: true,
            courtName: true,
            submittedAt: true,
            recordedAt: true,
            recordedByUserId: true,
            mediationNo: true,
          },
        },
        acceptance: {
          select: {
            id: true,
            trialRoundId: true,
            court: { select: { id: true, name: true } },
            acceptedAt: true,
            courtCaseNo: true,
            recordedAt: true,
            recordedByUserId: true,
            corrections: {
              orderBy: { toRevision: 'asc' },
              select: {
                id: true,
                priorCorrectionId: true,
                fromRevision: true,
                toRevision: true,
                acceptedAt: true,
                courtCaseNo: true,
                reason: true,
                recordedAt: true,
                recordedByUserId: true,
              },
            },
            versions: {
              select: {
                category: true,
                materialId: true,
                contentVersionId: true,
                contentVersion: {
                  select: { originalFilename: true, mimeType: true },
                },
              },
            },
          },
        },
        acceptances: {
          orderBy: [{ recordedAt: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            trialRoundId: true,
            court: { select: { id: true, name: true } },
            acceptedAt: true,
            courtCaseNo: true,
            recordedAt: true,
            recordedByUserId: true,
            corrections: {
              orderBy: { toRevision: 'asc' },
              select: {
                id: true,
                priorCorrectionId: true,
                fromRevision: true,
                toRevision: true,
                acceptedAt: true,
                courtCaseNo: true,
                reason: true,
                recordedAt: true,
                recordedByUserId: true,
              },
            },
            versions: {
              select: {
                category: true,
                materialId: true,
                contentVersionId: true,
                contentVersion: {
                  select: { originalFilename: true, mimeType: true },
                },
              },
            },
          },
        },
        currentHearingAdvanceId: true,
        currentJudgmentId: true,
        currentJudgmentNextStepId: true,
        currentTrialRoundId: true,
        currentSecondInstanceProgressId: true,
        currentSecondInstanceResultId: true,
        currentExecutionSubmissionId: true,
        executionConfirmation: {
          select: {
            id: true,
            submissionId: true,
            confirmedAt: true,
            confirmedByUserId: true,
            versions: {
              select: {
                materialId: true,
                contentVersionId: true,
                contentVersion: {
                  select: {
                    originalFilename: true,
                    mimeType: true,
                    createdAt: true,
                  },
                },
              },
            },
          },
        },
        executionMailing: {
          select: {
            id: true,
            confirmationId: true,
            mailedAt: true,
            recordedAt: true,
          },
        },
        executionFinish: {
          select: {
            toVersion: true,
            id: true,
            filingId: true,
            finishedAt: true,
            reason: true,
            basisNote: true,
            recordedAt: true,
          },
        },
        closure: { include: { versions: { orderBy: { fromVersion: 'asc' } } } },
        archive: { include: { versions: { orderBy: { fromVersion: 'asc' } } } },
        executionFiling: {
          select: {
            toVersion: true,
            id: true,
            mailingId: true,
            submittedAt: true,
            recordedAt: true,
          },
        },
        executionSubmissions: {
          orderBy: [{ toVersion: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            trialRoundId: true,
            judgmentNextStepId: true,
            secondInstanceResultId: true,
            priorSubmissionId: true,
            changeReason: true,
            fromVersion: true,
            toVersion: true,
            submittedAt: true,
            versions: {
              select: {
                materialId: true,
                contentVersionId: true,
                contentVersion: {
                  select: {
                    originalFilename: true,
                    mimeType: true,
                    createdAt: true,
                  },
                },
              },
            },
          },
        },
        trialRounds: {
          orderBy: [{ sequence: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            sequence: true,
            sourceResultId: true,
            revokedAt: true,
          },
        },
        secondInstanceProgresses: {
          orderBy: [{ toVersion: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            trialRoundId: true,
            choiceId: true,
            priorProgressId: true,
            hearingAt: true,
            hearingPlace: true,
            judgeName: true,
            fromVersion: true,
            toVersion: true,
            recordedAt: true,
            recordedByUserId: true,
            versions: {
              select: {
                category: true,
                materialId: true,
                contentVersionId: true,
                contentVersion: {
                  select: { originalFilename: true, mimeType: true },
                },
              },
            },
          },
        },
        secondInstanceResults: {
          orderBy: [{ toVersion: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            trialRoundId: true,
            choiceId: true,
            judgmentId: true,
            progressId: true,
            result: true,
            resultReceivedAt: true,
            judgmentAmountState: true,
            judgmentAmount: true,
            paidLitigationFeeState: true,
            paidLitigationFee: true,
            fromVersion: true,
            toVersion: true,
            recordedAt: true,
            recordedByUserId: true,
            childRound: {
              select: {
                id: true,
                revokedAt: true,
                _count: {
                  select: {
                    acceptances: true,
                    hearings: true,
                    advances: true,
                    judgments: true,
                    choices: true,
                  },
                },
              },
            },
            revocation: {
              select: {
                id: true,
                reason: true,
                fromVersion: true,
                toVersion: true,
                recordedAt: true,
                recordedByUserId: true,
              },
            },
            versions: {
              select: {
                materialId: true,
                contentVersionId: true,
                contentVersion: {
                  select: { originalFilename: true, mimeType: true },
                },
              },
            },
          },
        },
        secondInstanceAcceptanceChanges: {
          orderBy: [{ toRevision: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            choiceId: true,
            trialRoundId: true,
            priorChangeId: true,
            fromRevision: true,
            toRevision: true,
            acceptedAt: true,
            courtCaseNo: true,
            reason: true,
            recordedAt: true,
            recordedByUserId: true,
          },
        },
        judgmentNextSteps: {
          orderBy: [{ toVersion: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            trialRoundId: true,
            judgmentId: true,
            next: true,
            plaintiffRightsHolderId: true,
            plaintiffName: true,
            executionReadinessConfirmed: true,
            fromVersion: true,
            toVersion: true,
            recordedAt: true,
            recordedByUserId: true,
            defendants: {
              orderBy: { defendantId: 'asc' },
              select: { defendantId: true, nameSnapshot: true },
            },
          },
        },
        judgmentNextStepRevocations: {
          orderBy: [{ toVersion: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            choiceId: true,
            reason: true,
            fromVersion: true,
            toVersion: true,
            recordedAt: true,
            recordedByUserId: true,
          },
        },
        judgmentFacts: {
          orderBy: [{ toVersion: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            trialRoundId: true,
            kind: true,
            priorFactId: true,
            judgmentReceivedAt: true,
            judgmentAmountState: true,
            judgmentAmount: true,
            paidLitigationFeeState: true,
            paidLitigationFee: true,
            reason: true,
            recordedAt: true,
            recordedByUserId: true,
            fromVersion: true,
            toVersion: true,
            versions: {
              select: {
                materialId: true,
                contentVersionId: true,
                contentVersion: {
                  select: { originalFilename: true, mimeType: true },
                },
              },
            },
          },
        },
        currentHearingArrangement: {
          select: {
            id: true,
            trialRoundId: true,
            hearingAt: true,
            source: true,
            recordedAt: true,
            recordedByUserId: true,
          },
        },
        currentHearingAdvance: {
          select: {
            id: true,
            trialRoundId: true,
            arrangementId: true,
            dueAt: true,
            executedAt: true,
          },
        },
        hearingArrangements: {
          orderBy: [{ recordedAt: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            trialRoundId: true,
            hearingAt: true,
            source: true,
            recordedAt: true,
            recordedByUserId: true,
          },
        },
        hearingAdvances: {
          orderBy: [{ executedAt: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            trialRoundId: true,
            arrangementId: true,
            dueAt: true,
            executedAt: true,
          },
        },
        hearingCorrections: {
          orderBy: [{ recordedAt: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            priorArrangementId: true,
            priorAdvanceId: true,
            newArrangementId: true,
            resultStage: true,
            recordedAt: true,
            recordedByUserId: true,
            reason: true,
          },
        },
        createdAt: true,
        responsibleUserId: true,
        responsibleMembership: { select: { teamId: true } },
        defendants: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            kind: true,
            name: true,
            idNo: true,
            phone: true,
            address: true,
            contactRevision: true,
            contactChanges: {
              orderBy: { toRevision: 'asc' },
              select: {
                id: true,
                fromRevision: true,
                toRevision: true,
                beforePhone: true,
                beforeAddress: true,
                phone: true,
                address: true,
                recordedAt: true,
                recordedByUserId: true,
              },
            },
          },
        },
        lawyers: {
          orderBy: { startedAt: 'asc' },
          select: {
            id: true,
            role: true,
            startedAt: true,
            endedAt: true,
            lawyer: {
              select: {
                id: true,
                fullName: true,
                lawFirm: true,
                phone: true,
              },
            },
          },
        },
        courtCaseNo: true,
        owner: { select: { id: true, displayName: true } },
        department: { select: { id: true, name: true } },
        customer: { select: { id: true, name: true } },
        rightsHolder: { select: { id: true, name: true } },
        sourceLead: { select: { id: true, businessNo: true } },
        externalEntry: {
          select: {
            id: true,
            entryKind: true,
            initialStage: true,
            stageReachedOn: true,
            source: true,
            reason: true,
            recordedAt: true,
            recordedByUserId: true,
            known: true,
          },
        },
        sourceNotaryMatter: {
          select: {
            id: true,
            businessNo: true,
            evidence: {
              select: {
                matterId: true,
                sampleFeeState: true,
                sampleFeeAmount: true,
              },
            },
          },
        },
        certificate: {
          select: {
            id: true,
            certificateNo: true,
            certificateDate: true,
            issuedAt: true,
            needDisclose: true,
            fees: { select: { category: true, state: true, amount: true } },
          },
        },
      },
    } satisfies Prisma.CaseFindFirstArgs;
    const snapshot = await this.database.$transaction(
      async (transaction) => {
        const record = await transaction.case.findFirst(detailQuery);
        const judgmentMaterials =
          record === null
            ? []
            : await transaction.material.findMany({
                where: {
                  departmentId: actor.departmentId,
                  ownerType: 'CASE',
                  ownerId: id,
                  category: 'JUDGMENT',
                  status: 'ACTIVE',
                },
                select: {
                  id: true,
                  currentVersionId: true,
                  contentVersions: {
                    where: { status: 'AVAILABLE' },
                    select: {
                      id: true,
                      originalFilename: true,
                      mimeType: true,
                    },
                  },
                },
              });
        const executionMaterials =
          record === null
            ? []
            : await transaction.material.findMany({
                where: {
                  departmentId: actor.departmentId,
                  ownerType: 'CASE',
                  ownerId: id,
                  category: 'EXECUTION_APPLICATION',
                  status: 'ACTIVE',
                },
                select: {
                  id: true,
                  currentVersionId: true,
                  contentVersions: {
                    where: { status: 'AVAILABLE' },
                    select: {
                      id: true,
                      originalFilename: true,
                      mimeType: true,
                      createdAt: true,
                    },
                  },
                },
              });
        return { record, judgmentMaterials, executionMaterials };
      },
      { isolationLevel: 'RepeatableRead' },
    );
    const { record, judgmentMaterials, executionMaterials } = snapshot;
    if (record === null)
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: '案件不存在或不可访问',
      });
    const externalEntry = record.externalEntry;
    const normalSource =
      record.sourceLead !== null &&
      record.sourceNotaryMatter !== null &&
      record.certificate !== null &&
      externalEntry === null;
    const externalSource =
      record.sourceLead === null &&
      record.sourceNotaryMatter === null &&
      record.certificate === null &&
      externalEntry !== null;
    if (!normalSource && !externalSource)
      throw new NotFoundException({
        code: 'CASE_NOT_FOUND',
        message: 'Invalid case source',
      });
    const frozen =
      normalSource &&
      record.sourceNotaryMatter !== null &&
      record.certificate !== null
        ? await this.materials.listFrozenCertificateFiles(
            actor,
            record.sourceNotaryMatter.id,
            record.certificate.id,
          )
        : [];
    const complaintFiles = record.complaintSubmittedAt
      ? await this.materials.listFrozenCaseComplaintFiles(actor, id)
      : [];
    const confirmationFile =
      record.complaintConfirmation === null ||
      record.complaintConfirmation === undefined
        ? null
        : await this.materials.listFrozenCaseComplaintConfirmationFile(
            actor,
            id,
          );
    const receiptFiles =
      record.complaintMailing == null
        ? []
        : await this.materials.listFrozenCaseComplaintMailingFiles(actor, id);
    const filingFiles =
      record.filingSubmission == null
        ? []
        : await this.materials.listFrozenCaseFilingFiles(actor, id);
    const executionMailingFiles =
      record.executionMailing == null
        ? []
        : await this.materials.listFrozenCaseExecutionMailingFiles(actor, id);
    const closureRecord = record.closure ?? null;
    const closureHistory =
      closureRecord === null
        ? []
        : await Promise.all(
            closureRecord.versions.map(async (version) => ({
              id: version.id,
              kind: version.kind,
              priorVersionId: version.priorVersionId,
              finishId: version.finishId,
              fromVersion: version.fromVersion,
              toVersion: version.toVersion,
              closeAt: version.closeAt?.toISOString().slice(0, 10) ?? null,
              closeAmountState: version.closeAmountState,
              closeAmt: version.closeAmt?.toFixed(2) ?? null,
              note: version.note,
              correctionReason: version.correctionReason,
              recordedAt: version.recordedAt.toISOString(),
              recordedByUserId: version.recordedByUserId,
              files: await this.materials.listFrozenCaseClosureFiles(
                actor,
                id,
                version.id,
              ),
            })),
          );
    const currentClosure = closureHistory.find(
      (version) => version.id === closureRecord?.currentVersionId,
    );
    const archiveRecord = record.archive ?? null;
    const archiveHistory =
      archiveRecord?.versions.map((v) => ({
        id: v.id,
        kind: v.kind,
        priorVersionId: v.priorVersionId,
        closureVersionId: v.closureVersionId,
        fromVersion: v.fromVersion,
        toVersion: v.toVersion,
        archiveAt: v.archiveAt.toISOString().slice(0, 10),
        archiveType: v.archiveType,
        archiveReason: v.archiveReason,
        correctionReason: v.correctionReason,
        recordedAt: v.recordedAt.toISOString(),
        recordedByUserId: v.recordedByUserId,
      })) ?? [];
    const currentArchive = archiveHistory.find(
      (v) => v.id === archiveRecord?.currentVersionId,
    );
    const invalidSource = () =>
      new NotFoundException({
        code: 'CASE_NOT_FOUND',
        message: '案件归档来源不完整',
      });
    if (
      closureRecord !== null &&
      (currentClosure === undefined ||
        closureHistory.at(-1)?.id !== currentClosure.id ||
        (archiveRecord === null && currentClosure.toVersion !== record.version))
    )
      throw invalidSource();
    if (archiveRecord !== null) {
      if (
        record.stage !== 'ARCHIVED' ||
        closureRecord === null ||
        currentClosure === undefined ||
        record.executionFinish == null ||
        archiveRecord.closureId !== closureRecord.id ||
        archiveRecord.closureVersionId !== currentClosure.id ||
        currentArchive === undefined ||
        archiveHistory.at(-1)?.id !== currentArchive.id
      )
        throw invalidSource();
      let terminal = record.executionFinish.toVersion;
      let prior: string | null = null;
      for (const v of closureHistory) {
        if (
          v.finishId !== record.executionFinish.id ||
          v.fromVersion !== terminal ||
          v.toVersion !== terminal + 1 ||
          v.priorVersionId !== prior ||
          v.kind !== (prior === null ? 'REGISTER' : 'CORRECT')
        )
          throw invalidSource();
        terminal = v.toVersion;
        prior = v.id;
      }
      if (prior !== currentClosure.id) throw invalidSource();
      prior = null;
      for (const v of archiveHistory) {
        if (
          v.closureVersionId !== currentClosure.id ||
          v.fromVersion !== terminal ||
          v.toVersion !== terminal + 1 ||
          v.priorVersionId !== prior ||
          v.kind !== (prior === null ? 'ARCHIVE' : 'CORRECT')
        )
          throw invalidSource();
        terminal = v.toVersion;
        prior = v.id;
      }
      if (terminal !== record.version) throw invalidSource();
    } else if (record.stage === 'ARCHIVED') throw invalidSource();
    const archive =
      archiveRecord === null
        ? null
        : {
            id: archiveRecord.id,
            closureId: archiveRecord.closureId,
            closureVersionId: archiveRecord.closureVersionId,
            current: currentArchive!,
            history: archiveHistory,
          };
    const closure =
      closureRecord === null
        ? null
        : {
            id: closureRecord.id,
            finishId: closureRecord.finishId,
            current: currentClosure!,
            history: closureHistory,
          };
    const executionFinishFiles =
      record.executionFinish == null
        ? []
        : await this.materials.listFrozenCaseExecutionFinishFiles(actor, id);
    const executionFilingFiles =
      record.executionFiling == null
        ? []
        : await this.materials.listFrozenCaseExecutionFilingFiles(actor, id);
    const acceptanceFrozen =
      record.acceptance == null
        ? []
        : await this.materials.listFrozenCaseAcceptanceFiles(actor, id);
    const acceptanceOwned =
      record.stage === 'WAITING_FORMAL_ACCEPTANCE' || record.acceptance != null
        ? await this.materials.listOwnerMaterials(actor, 'CASE', id)
        : { items: [] };
    const acceptanceFrozenIds = new Set(
      acceptanceFrozen.map((reference) => reference.contentVersionId),
    );
    const file = (ref: (typeof frozen)[number]) => ({
      materialId: ref.materialId,
      contentVersionId: ref.contentVersionId,
      originalFilename: ref.originalFilename,
      mimeType: ref.mimeType,
    });
    const judgmentHistory = record.judgmentFacts.map((fact) => ({
      id: fact.id,
      trialRoundId: fact.trialRoundId,
      kind: fact.kind,
      priorFactId: fact.priorFactId,
      judgmentReceivedAt: fact.judgmentReceivedAt.toISOString().slice(0, 10),
      judgmentAmountState: fact.judgmentAmountState,
      judgmentAmount:
        fact.judgmentAmount === null
          ? null
          : new Prisma.Decimal(fact.judgmentAmount.toString()).toFixed(2),
      paidLitigationFeeState: fact.paidLitigationFeeState,
      paidLitigationFee:
        fact.paidLitigationFee === null
          ? null
          : new Prisma.Decimal(fact.paidLitigationFee.toString()).toFixed(2),
      fromVersion: fact.fromVersion,
      toVersion: fact.toVersion,
      recordedAt: fact.recordedAt.toISOString(),
      ...(principal === 'INTERNAL'
        ? { reason: fact.reason, recordedByUserId: fact.recordedByUserId }
        : {}),
      files: fact.versions.map((version) => ({
        materialId: version.materialId,
        contentVersionId: version.contentVersionId,
        originalFilename: version.contentVersion.originalFilename,
        mimeType: version.contentVersion.mimeType,
      })),
    }));
    const frozenJudgmentIds = new Set(
      judgmentHistory.flatMap((fact) =>
        fact.files.map((version) => version.contentVersionId),
      ),
    );
    const nextStepHistory = (record.judgmentNextSteps ?? []).map((choice) => ({
      id: choice.id,
      trialRoundId: choice.trialRoundId,
      judgmentId: choice.judgmentId,
      next: choice.next,
      plaintiffRightsHolderId: choice.plaintiffRightsHolderId,
      plaintiffName: choice.plaintiffName,
      defendants: choice.defendants,
      executionReadinessConfirmed: choice.executionReadinessConfirmed,
      fromVersion: choice.fromVersion,
      toVersion: choice.toVersion,
      recordedAt: choice.recordedAt.toISOString(),
      ...(principal === 'INTERNAL'
        ? { recordedByUserId: choice.recordedByUserId }
        : {}),
    }));
    const secondAcceptanceChanges =
      record.secondInstanceAcceptanceChanges ?? [];
    const secondAcceptanceChoices = (record.judgmentNextSteps ?? []).filter(
      (choice) => choice.next === 'APPEAL',
    );
    const secondAcceptanceEligible = (choiceId: string) =>
      !record.judgmentNextStepRevocations.some(
        (revocation) => revocation.choiceId === choiceId,
      ) &&
      (record.currentJudgmentNextStepId === choiceId ||
        record.secondInstanceProgresses.some(
          (progress) => progress.choiceId === choiceId,
        ) ||
        record.secondInstanceResults.some(
          (result) => result.choiceId === choiceId,
        ) ||
        secondAcceptanceChanges.some((change) => change.choiceId === choiceId));
    const canSaveSecondAcceptance =
      principal === 'INTERNAL' &&
      secondAcceptanceChoices.some((choice) =>
        secondAcceptanceEligible(choice.id),
      ) &&
      (await this.access.canAuthorizeCase(
        actor,
        'case.second-instance-acceptance.update',
        {
          departmentId: actor.departmentId,
          responsibleUserId: record.responsibleUserId,
          ...(record.responsibleMembership.teamId
            ? { teamId: record.responsibleMembership.teamId }
            : {}),
        },
      ));
    const secondProgresses = record.secondInstanceProgresses.map(
      (progress) => ({
        id: progress.id,
        trialRoundId: progress.trialRoundId,
        choiceId: progress.choiceId,
        priorProgressId: progress.priorProgressId,
        hearingAt: progress.hearingAt?.toISOString().slice(0, 10) ?? null,
        hearingPlace: progress.hearingPlace,
        judgeName: progress.judgeName,
        fromVersion: progress.fromVersion,
        toVersion: progress.toVersion,
        recordedAt: progress.recordedAt.toISOString(),
        ...(principal === 'INTERNAL'
          ? { recordedByUserId: progress.recordedByUserId }
          : {}),
        documentFiles: progress.versions
          .filter((version) => version.category === 'SECOND_INSTANCE_DOCUMENT')
          .map((version) => ({
            materialId: version.materialId,
            contentVersionId: version.contentVersionId,
            originalFilename: version.contentVersion.originalFilename,
            mimeType: version.contentVersion.mimeType,
          })),
        serviceFiles: progress.versions
          .filter((version) => version.category === 'SECOND_INSTANCE_SERVICE')
          .map((version) => ({
            materialId: version.materialId,
            contentVersionId: version.contentVersionId,
            originalFilename: version.contentVersion.originalFilename,
            mimeType: version.contentVersion.mimeType,
          })),
      }),
    );
    const secondResults = record.secondInstanceResults.map((result) => ({
      id: result.id,
      trialRoundId: result.trialRoundId,
      choiceId: result.choiceId,
      judgmentId: result.judgmentId,
      progressId: result.progressId,
      result: result.result,
      resultReceivedAt: result.resultReceivedAt.toISOString().slice(0, 10),
      judgmentAmountState: result.judgmentAmountState,
      judgmentAmount:
        result.judgmentAmount === null
          ? null
          : new Prisma.Decimal(result.judgmentAmount.toString()).toFixed(2),
      paidLitigationFeeState: result.paidLitigationFeeState,
      paidLitigationFee:
        result.paidLitigationFee === null
          ? null
          : new Prisma.Decimal(result.paidLitigationFee.toString()).toFixed(2),
      fromVersion: result.fromVersion,
      toVersion: result.toVersion,
      recordedAt: result.recordedAt.toISOString(),
      ...(principal === 'INTERNAL'
        ? { recordedByUserId: result.recordedByUserId }
        : {}),
      files: result.versions.map((version) => ({
        materialId: version.materialId,
        contentVersionId: version.contentVersionId,
        originalFilename: version.contentVersion.originalFilename,
        mimeType: version.contentVersion.mimeType,
      })),
      childTrialRoundId: result.childRound?.id ?? null,
      revocationId: result.revocation?.id ?? null,
    }));
    const judgmentAvailableFiles = judgmentMaterials.flatMap((material) =>
      material.contentVersions
        .filter(
          (version) =>
            version.id === material.currentVersionId ||
            frozenJudgmentIds.has(version.id),
        )
        .map((version) => ({
          materialId: material.id,
          contentVersionId: version.id,
          originalFilename: version.originalFilename,
          mimeType: version.mimeType,
        })),
    );
    const executionSubmissions = (record.executionSubmissions ?? []).map(
      (submission) => ({
        id: submission.id,
        trialRoundId: submission.trialRoundId,
        judgmentNextStepId: submission.judgmentNextStepId,
        secondInstanceResultId: submission.secondInstanceResultId,
        priorSubmissionId: submission.priorSubmissionId,
        changeReason: submission.changeReason,
        fromVersion: submission.fromVersion,
        toVersion: submission.toVersion,
        submittedAt: submission.submittedAt.toISOString(),
        files: submission.versions.map((version) => ({
          materialId: version.materialId,
          contentVersionId: version.contentVersionId,
          originalFilename: version.contentVersion.originalFilename,
          mimeType: version.contentVersion.mimeType,
          uploadedAt: version.contentVersion.createdAt.toISOString(),
        })),
      }),
    );
    const executionFrozenIds = new Set(
      executionSubmissions.flatMap((submission) =>
        submission.files.map((file) => file.contentVersionId),
      ),
    );
    const executionAvailableFiles = executionMaterials.flatMap((material) =>
      material.contentVersions
        .filter(
          (version) =>
            version.id === material.currentVersionId &&
            !executionFrozenIds.has(version.id),
        )
        .map((version) => ({
          materialId: material.id,
          contentVersionId: version.id,
          originalFilename: version.originalFilename,
          mimeType: version.mimeType,
          uploadedAt: version.createdAt.toISOString(),
        })),
    );
    const confirmedSubmission = executionSubmissions.find(
      (submission) =>
        submission.id === record.executionConfirmation?.submissionId,
    );
    const sample = record.sourceNotaryMatter?.evidence ?? null;
    const arrangement = (
      value: (typeof record.hearingArrangements)[number],
    ) => ({
      id: value.id,
      trialRoundId: value.trialRoundId,
      hearingAt: value.hearingAt?.toISOString().slice(0, 10) ?? null,
      source: value.source,
      recordedAt: value.recordedAt.toISOString(),
      ...(principal === 'INTERNAL'
        ? { recordedByUserId: value.recordedByUserId }
        : {}),
    });
    const advance = (value: (typeof record.hearingAdvances)[number]) => ({
      id: value.id,
      trialRoundId: value.trialRoundId,
      arrangementId: value.arrangementId,
      dueAt: value.dueAt.toISOString(),
      executedAt: value.executedAt.toISOString(),
    });
    const detail = {
      id: record.id,
      businessNo: record.businessNo,
      stage: record.stage,
      version: record.version,
      executionSubmission: {
        current:
          executionSubmissions.find(
            (submission) =>
              submission.id === record.currentExecutionSubmissionId,
          ) ?? null,
        submissions: executionSubmissions,
        availableFiles: executionAvailableFiles,
      },
      executionConfirmation:
        record.executionConfirmation == null
          ? null
          : {
              id: record.executionConfirmation.id,
              submissionId: record.executionConfirmation.submissionId,
              confirmedAt:
                record.executionConfirmation.confirmedAt.toISOString(),
              confirmedByUserId: record.executionConfirmation.confirmedByUserId,
              files:
                confirmedSubmission?.files ??
                record.executionConfirmation.versions.map((version) => ({
                  materialId: version.materialId,
                  contentVersionId: version.contentVersionId,
                  originalFilename: version.contentVersion.originalFilename,
                  mimeType: version.contentVersion.mimeType,
                  uploadedAt: version.contentVersion.createdAt.toISOString(),
                })),
            },
      executionMailing:
        record.executionMailing == null
          ? null
          : {
              id: record.executionMailing.id,
              confirmationId: record.executionMailing.confirmationId,
              mailedAt: record.executionMailing.mailedAt
                .toISOString()
                .slice(0, 10),
              recordedAt: record.executionMailing.recordedAt.toISOString(),
              files: executionMailingFiles,
            },
      closure,
      archive,
      canArchive:
        record.stage === 'WAITING_ARCHIVE' &&
        record.archive == null &&
        closure?.current.toVersion === record.version &&
        (principal === 'LAWYER' ||
          (await this.access.canAuthorizeCase(actor, 'case.archive', {
            departmentId: actor.departmentId,
            responsibleUserId: record.responsibleUserId,
            ...(record.responsibleMembership.teamId
              ? { teamId: record.responsibleMembership.teamId }
              : {}),
          }))),
      canCorrectArchive:
        principal === 'INTERNAL' &&
        record.stage === 'ARCHIVED' &&
        archive?.current.toVersion === record.version &&
        (await this.access.canAuthorizeCase(actor, 'case.archive.correct', {
          departmentId: actor.departmentId,
          responsibleUserId: record.responsibleUserId,
          ...(record.responsibleMembership.teamId
            ? { teamId: record.responsibleMembership.teamId }
            : {}),
        })),
      canRecordClosure:
        record.stage === 'WAITING_ARCHIVE' &&
        closure === null &&
        ((record.executionFinish != null &&
          record.executionFinish.toVersion === record.version) ||
          (record.externalEntry?.initialStage === 'WAITING_ARCHIVE' &&
            record.executionFinish == null)) &&
        (principal === 'LAWYER' ||
          (await this.access.canAuthorizeCase(actor, 'case.closure.record', {
            departmentId: actor.departmentId,
            responsibleUserId: record.responsibleUserId,
            ...(record.responsibleMembership.teamId
              ? { teamId: record.responsibleMembership.teamId }
              : {}),
          }))),
      canCorrectClosure:
        principal === 'INTERNAL' &&
        record.stage === 'WAITING_ARCHIVE' &&
        closure !== null &&
        (await this.access.canAuthorizeCase(actor, 'case.closure.correct', {
          departmentId: actor.departmentId,
          responsibleUserId: record.responsibleUserId,
          ...(record.responsibleMembership.teamId
            ? { teamId: record.responsibleMembership.teamId }
            : {}),
        })),
      executionFinish:
        record.executionFinish == null
          ? null
          : {
              id: record.executionFinish.id,
              filingId: record.executionFinish.filingId,
              finishedAt: record.executionFinish.finishedAt
                .toISOString()
                .slice(0, 10),
              reason: record.executionFinish.reason,
              basisNote: record.executionFinish.basisNote,
              recordedAt: record.executionFinish.recordedAt.toISOString(),
              files: executionFinishFiles,
            },
      executionFiling:
        record.executionFiling == null
          ? null
          : {
              id: record.executionFiling.id,
              mailingId: record.executionFiling.mailingId,
              submittedAt: record.executionFiling.submittedAt
                .toISOString()
                .slice(0, 10),
              recordedAt: record.executionFiling.recordedAt.toISOString(),
              files: executionFilingFiles,
            },
      hearing: {
        currentArrangement:
          record.currentHearingArrangement === null
            ? null
            : arrangement(record.currentHearingArrangement),
        currentAdvance:
          record.currentHearingAdvance === null
            ? null
            : advance(record.currentHearingAdvance),
        arrangements: record.hearingArrangements.map(arrangement),
        advances: record.hearingAdvances.map(advance),
        corrections: record.hearingCorrections.map((value) => ({
          id: value.id,
          priorArrangementId: value.priorArrangementId,
          priorAdvanceId: value.priorAdvanceId,
          newArrangementId: value.newArrangementId,
          resultStage: value.resultStage,
          recordedAt: value.recordedAt.toISOString(),
          ...(principal === 'INTERNAL'
            ? { reason: value.reason, recordedByUserId: value.recordedByUserId }
            : {}),
        })),
      },
      judgment: {
        current:
          judgmentHistory.find(
            (fact) => fact.id === record.currentJudgmentId,
          ) ?? null,
        history: judgmentHistory,
        availableFiles: judgmentAvailableFiles,
      },
      judgmentNextStep: {
        current:
          nextStepHistory.find(
            (choice) => choice.id === record.currentJudgmentNextStepId,
          ) ?? null,
        history: nextStepHistory,
        revocations: (record.judgmentNextStepRevocations ?? []).map(
          (revocation) => ({
            id: revocation.id,
            choiceId: revocation.choiceId,
            fromVersion: revocation.fromVersion,
            toVersion: revocation.toVersion,
            recordedAt: revocation.recordedAt.toISOString(),
            ...(principal === 'INTERNAL'
              ? {
                  reason: revocation.reason,
                  recordedByUserId: revocation.recordedByUserId,
                }
              : {}),
          }),
        ),
      },
      secondInstance: {
        currentTrialRoundId: record.currentTrialRoundId,
        acceptances: secondAcceptanceChoices.flatMap((choice) => {
          const latest = secondAcceptanceChanges
            .filter((change) => change.choiceId === choice.id)
            .at(-1);
          return latest === undefined
            ? []
            : [
                {
                  choiceId: choice.id,
                  trialRoundId: choice.trialRoundId,
                  acceptedAt:
                    latest.acceptedAt === null
                      ? null
                      : isoDate(latest.acceptedAt),
                  courtCaseNo: latest.courtCaseNo,
                  recordedAt: latest.recordedAt.toISOString(),
                },
              ];
        }),
        currentProgress:
          secondProgresses.find(
            (progress) =>
              progress.id === record.currentSecondInstanceProgressId,
          ) ?? null,
        currentResult:
          secondResults.find(
            (result) => result.id === record.currentSecondInstanceResultId,
          ) ?? null,
        rounds: record.trialRounds.map((round) => ({
          id: round.id,
          sequence: round.sequence,
          sourceResultId: round.sourceResultId,
          revokedAt: round.revokedAt?.toISOString() ?? null,
        })),
        progresses: secondProgresses,
        results: secondResults,
        revocations: record.secondInstanceResults.flatMap((result) =>
          result.revocation === null
            ? []
            : [
                {
                  id: result.revocation.id,
                  resultId: result.id,
                  fromVersion: result.revocation.fromVersion,
                  toVersion: result.revocation.toVersion,
                  recordedAt: result.revocation.recordedAt.toISOString(),
                  ...(principal === 'INTERNAL'
                    ? {
                        reason: result.revocation.reason,
                        recordedByUserId: result.revocation.recordedByUserId,
                      }
                    : {}),
                },
              ],
        ),
      },
      matchedAt: record.matchedAt?.toISOString() ?? null,
      matchedOn: record.matchedOn?.toISOString().slice(0, 10) ?? null,
      defendants: record.defendants.map((defendant) => ({
        id: defendant.id,
        kind: defendant.kind,
        name: defendant.name,
        idNo: defendant.idNo,
        phone: defendant.phone,
        address: defendant.address,
      })),
      ...(principal === 'INTERNAL'
        ? {
            recordEdits: {
              canSaveSecondInstanceAcceptance: canSaveSecondAcceptance,
              secondInstanceAcceptances: secondAcceptanceChoices.map(
                (choice) => {
                  const changes = secondAcceptanceChanges.filter(
                    (change) => change.choiceId === choice.id,
                  );
                  const latest = changes.at(-1);
                  return {
                    choiceId: choice.id,
                    trialRoundId: choice.trialRoundId,
                    acceptanceRevision: latest?.toRevision ?? 0,
                    acceptedAt: latest?.acceptedAt
                      ? isoDate(latest.acceptedAt)
                      : null,
                    courtCaseNo: latest?.courtCaseNo ?? null,
                    canEdit:
                      canSaveSecondAcceptance &&
                      secondAcceptanceEligible(choice.id),
                    history: changes.map((change) => ({
                      id: change.id,
                      priorChangeId: change.priorChangeId,
                      fromRevision: change.fromRevision,
                      toRevision: change.toRevision,
                      acceptedAt:
                        change.acceptedAt === null
                          ? null
                          : isoDate(change.acceptedAt),
                      courtCaseNo: change.courtCaseNo,
                      reason: change.reason,
                      recordedAt: change.recordedAt.toISOString(),
                      recordedByUserId: change.recordedByUserId,
                    })),
                  };
                },
              ),
              canUpdateDefendantContact:
                record.defendants.length > 0 &&
                (await this.access.canAuthorizeCase(
                  actor,
                  'case.defendant-contact.update',
                  {
                    departmentId: actor.departmentId,
                    responsibleUserId: record.responsibleUserId,
                    ...(record.responsibleMembership.teamId
                      ? { teamId: record.responsibleMembership.teamId }
                      : {}),
                  },
                )),
              canCorrectAcceptance:
                record.acceptances.length > 0 &&
                (await this.access.canAuthorizeCase(
                  actor,
                  'case.acceptance.correct',
                  {
                    departmentId: actor.departmentId,
                    responsibleUserId: record.responsibleUserId,
                    ...(record.responsibleMembership.teamId
                      ? { teamId: record.responsibleMembership.teamId }
                      : {}),
                  },
                )),
              defendantContacts: record.defendants.map((defendant) => ({
                defendantId: defendant.id,
                contactRevision: defendant.contactRevision,
                history: defendant.contactChanges.map((change) => ({
                  ...change,
                  recordedAt: change.recordedAt.toISOString(),
                })),
              })),
              acceptanceCorrections: record.acceptances.map((acceptance) => ({
                acceptanceId: acceptance.id,
                trialRoundId: acceptance.trialRoundId,
                acceptanceRevision:
                  acceptance.corrections.at(-1)?.toRevision ?? 0,
                originalAcceptedAt: isoDate(acceptance.acceptedAt),
                originalCourtCaseNo: acceptance.courtCaseNo,
                history: acceptance.corrections.map((correction) => ({
                  id: correction.id,
                  priorCorrectionId: correction.priorCorrectionId,
                  fromRevision: correction.fromRevision,
                  toRevision: correction.toRevision,
                  acceptedAt: isoDate(correction.acceptedAt),
                  courtCaseNo: correction.courtCaseNo,
                  reason: correction.reason,
                  recordedAt: correction.recordedAt.toISOString(),
                  recordedByUserId: correction.recordedByUserId,
                })),
              })),
            },
          }
        : {}),
      lawyers: record.lawyers.map((assignment) => ({
        id: assignment.lawyer.id,
        fullName: assignment.lawyer.fullName,
        lawFirm: assignment.lawyer.lawFirm,
        phone: assignment.lawyer.phone,
        role: assignment.role,
        assignedAt: assignment.startedAt.toISOString(),
      })),
      canMatch:
        principal === 'INTERNAL' &&
        record.stage === 'PENDING_MATCH' &&
        (await this.access.canAuthorizeCase(actor, 'case.match', {
          departmentId: actor.departmentId,
          responsibleUserId: record.responsibleUserId,
          ...(record.responsibleMembership.teamId
            ? { teamId: record.responsibleMembership.teamId }
            : {}),
        })),
      canSubmitComplaint:
        record.stage === 'WAITING_COMPLAINT' &&
        (principal === 'LAWYER' ||
          (await this.access.canAuthorizeCase(actor, 'case.complaint.submit', {
            departmentId: actor.departmentId,
            responsibleUserId: record.responsibleUserId,
            ...(record.responsibleMembership.teamId
              ? { teamId: record.responsibleMembership.teamId }
              : {}),
          }))),
      canConfirmComplaint:
        record.stage === 'WAITING_COMPLAINT_CONFIRMATION' &&
        (principal === 'LAWYER' ||
          (await this.access.canAuthorizeCase(actor, 'case.complaint.confirm', {
            departmentId: actor.departmentId,
            responsibleUserId: record.responsibleUserId,
            ...(record.responsibleMembership.teamId
              ? { teamId: record.responsibleMembership.teamId }
              : {}),
          }))),
      canMailComplaint:
        record.stage === 'WAITING_COMPLAINT_STAMP' &&
        (principal === 'LAWYER' ||
          (await this.access.canAuthorizeCase(actor, 'case.complaint.mail', {
            departmentId: actor.departmentId,
            responsibleUserId: record.responsibleUserId,
            ...(record.responsibleMembership.teamId
              ? { teamId: record.responsibleMembership.teamId }
              : {}),
          }))),
      canSubmitFiling:
        record.stage === 'WAITING_FILING' &&
        (principal === 'LAWYER' ||
          (await this.access.canAuthorizeCase(actor, 'case.filing.submit', {
            departmentId: actor.departmentId,
            responsibleUserId: record.responsibleUserId,
            ...(record.responsibleMembership.teamId
              ? { teamId: record.responsibleMembership.teamId }
              : {}),
          }))),
      canRegisterAcceptance:
        record.stage === 'WAITING_FORMAL_ACCEPTANCE' &&
        (principal === 'LAWYER' ||
          (await this.access.canAuthorizeCase(
            actor,
            'case.acceptance.register',
            {
              departmentId: actor.departmentId,
              responsibleUserId: record.responsibleUserId,
              ...(record.responsibleMembership.teamId
                ? { teamId: record.responsibleMembership.teamId }
                : {}),
            },
          ))),
      canUploadAcceptanceMaterials:
        (record.stage === 'WAITING_FORMAL_ACCEPTANCE' ||
          record.stage === 'WAITING_HEARING') &&
        (principal === 'LAWYER' ||
          (await this.access.canAuthorizeCase(
            actor,
            'case.acceptance.register',
            {
              departmentId: actor.departmentId,
              responsibleUserId: record.responsibleUserId,
              ...(record.responsibleMembership.teamId
                ? { teamId: record.responsibleMembership.teamId }
                : {}),
            },
          ))),
      canScheduleHearing:
        record.stage === 'WAITING_HEARING' &&
        (principal === 'LAWYER' ||
          (await this.access.canAuthorizeCase(actor, 'case.hearing.schedule', {
            departmentId: actor.departmentId,
            responsibleUserId: record.responsibleUserId,
            ...(record.responsibleMembership.teamId
              ? { teamId: record.responsibleMembership.teamId }
              : {}),
          }))),
      canCorrectHearing:
        principal === 'INTERNAL' &&
        record.stage === 'WAITING_JUDGMENT' &&
        record.currentHearingAdvanceId !== null &&
        record.currentJudgmentId === null &&
        (await this.access.canAuthorizeCase(actor, 'case.hearing.correct', {
          departmentId: actor.departmentId,
          responsibleUserId: record.responsibleUserId,
          ...(record.responsibleMembership.teamId
            ? { teamId: record.responsibleMembership.teamId }
            : {}),
        })),
      canRegisterJudgment:
        record.stage === 'WAITING_JUDGMENT' &&
        record.currentJudgmentId === null &&
        (principal === 'LAWYER' ||
          (await this.access.canAuthorizeCase(actor, 'case.judgment.register', {
            departmentId: actor.departmentId,
            responsibleUserId: record.responsibleUserId,
            ...(record.responsibleMembership.teamId
              ? { teamId: record.responsibleMembership.teamId }
              : {}),
          }))),
      canCorrectJudgment:
        principal === 'INTERNAL' &&
        record.stage === 'WAITING_JUDGMENT' &&
        record.currentJudgmentId !== null &&
        record.currentJudgmentNextStepId === null &&
        (await this.access.canAuthorizeCase(actor, 'case.judgment.correct', {
          departmentId: actor.departmentId,
          responsibleUserId: record.responsibleUserId,
          ...(record.responsibleMembership.teamId
            ? { teamId: record.responsibleMembership.teamId }
            : {}),
        })),
      canChooseJudgmentNextStep:
        record.stage === 'WAITING_JUDGMENT' &&
        record.currentJudgmentId !== null &&
        record.currentJudgmentNextStepId === null &&
        (principal === 'LAWYER' ||
          (await this.access.canAuthorizeCase(
            actor,
            'case.judgment.next_step',
            {
              departmentId: actor.departmentId,
              responsibleUserId: record.responsibleUserId,
              ...(record.responsibleMembership.teamId
                ? { teamId: record.responsibleMembership.teamId }
                : {}),
            },
          ))),
      canRevokeJudgmentNextStep:
        principal === 'INTERNAL' &&
        (record.stage === 'SECOND_INSTANCE' ||
          record.stage === 'WAITING_EXECUTION_DOCUMENTS') &&
        record.currentJudgmentNextStepId !== null &&
        record.judgmentNextSteps.some(
          (choice) =>
            choice.id === record.currentJudgmentNextStepId &&
            choice.next ===
              (record.stage === 'SECOND_INSTANCE' ? 'APPEAL' : 'EXECUTION'),
        ) &&
        !record.secondInstanceProgresses.some(
          (progress) => progress.choiceId === record.currentJudgmentNextStepId,
        ) &&
        !record.secondInstanceResults.some(
          (result) => result.choiceId === record.currentJudgmentNextStepId,
        ) &&
        !secondAcceptanceChanges.some(
          (change) => change.choiceId === record.currentJudgmentNextStepId,
        ) &&
        (await this.access.canAuthorizeCase(
          actor,
          'case.judgment.next_step.revoke',
          {
            departmentId: actor.departmentId,
            responsibleUserId: record.responsibleUserId,
            ...(record.responsibleMembership.teamId
              ? { teamId: record.responsibleMembership.teamId }
              : {}),
          },
        )),
      canSaveSecondInstance:
        record.stage === 'SECOND_INSTANCE' &&
        record.currentTrialRoundId !== null &&
        ((record.externalEntry?.initialStage === 'SECOND_INSTANCE' &&
          record.currentJudgmentNextStepId === null) ||
          record.judgmentNextSteps.some(
            (choice) =>
              choice.id === record.currentJudgmentNextStepId &&
              choice.next === 'APPEAL' &&
              choice.trialRoundId === record.currentTrialRoundId &&
              choice.judgmentId === record.currentJudgmentId,
          )) &&
        record.currentSecondInstanceResultId === null &&
        (principal === 'LAWYER' ||
          (await this.access.canAuthorizeCase(
            actor,
            'case.second_instance.save',
            {
              departmentId: actor.departmentId,
              responsibleUserId: record.responsibleUserId,
              ...(record.responsibleMembership.teamId
                ? { teamId: record.responsibleMembership.teamId }
                : {}),
            },
          ))),
      canRegisterSecondInstanceResult:
        record.stage === 'SECOND_INSTANCE' &&
        record.currentTrialRoundId !== null &&
        ((record.externalEntry?.initialStage === 'SECOND_INSTANCE' &&
          record.currentJudgmentNextStepId === null) ||
          record.judgmentNextSteps.some(
            (choice) =>
              choice.id === record.currentJudgmentNextStepId &&
              choice.next === 'APPEAL' &&
              choice.trialRoundId === record.currentTrialRoundId &&
              choice.judgmentId === record.currentJudgmentId,
          )) &&
        record.currentSecondInstanceResultId === null &&
        (principal === 'LAWYER' ||
          (await this.access.canAuthorizeCase(
            actor,
            'case.second_instance.result',
            {
              departmentId: actor.departmentId,
              responsibleUserId: record.responsibleUserId,
              ...(record.responsibleMembership.teamId
                ? { teamId: record.responsibleMembership.teamId }
                : {}),
            },
          ))),
      canRevokeSecondInstanceResult:
        principal === 'INTERNAL' &&
        record.currentSecondInstanceResultId !== null &&
        record.secondInstanceResults.some(
          (result) =>
            result.id === record.currentSecondInstanceResultId &&
            result.revocation === null &&
            (result.result === 'REMAND'
              ? record.stage === 'WAITING_FORMAL_ACCEPTANCE' &&
                result.childRound?.id === record.currentTrialRoundId &&
                result.childRound.revokedAt === null &&
                Object.values(result.childRound._count).every(
                  (count) => count === 0,
                )
              : record.stage === 'WAITING_EXECUTION_DOCUMENTS'),
        ) &&
        (await this.access.canAuthorizeCase(
          actor,
          'case.second_instance.result.revoke',
          {
            departmentId: actor.departmentId,
            responsibleUserId: record.responsibleUserId,
            ...(record.responsibleMembership.teamId
              ? { teamId: record.responsibleMembership.teamId }
              : {}),
          },
        )),
      canSubmitExecution:
        (record.stage === 'WAITING_EXECUTION_DOCUMENTS' ||
          record.stage === 'WAITING_EXECUTION_CONFIRMATION') &&
        record.currentTrialRoundId !== null &&
        ((record.externalEntry?.initialStage ===
          'WAITING_EXECUTION_DOCUMENTS' &&
          record.currentJudgmentNextStepId === null &&
          record.currentSecondInstanceResultId === null) ||
          (record.externalEntry?.initialStage === 'SECOND_INSTANCE' &&
            record.currentJudgmentNextStepId === null &&
            record.secondInstanceResults.some(
              (result) =>
                result.id === record.currentSecondInstanceResultId &&
                result.choiceId === null &&
                result.trialRoundId === record.currentTrialRoundId &&
                (result.result === 'CHANGE' || result.result === 'AFFIRM') &&
                result.revocation === null,
            )) ||
          record.judgmentNextSteps.some(
            (choice) =>
              choice.id === record.currentJudgmentNextStepId &&
              choice.trialRoundId === record.currentTrialRoundId &&
              !(record.judgmentNextStepRevocations ?? []).some(
                (revocation) => revocation.choiceId === choice.id,
              ) &&
              (choice.next === 'EXECUTION'
                ? record.currentSecondInstanceResultId === null
                : record.secondInstanceResults.some(
                    (result) =>
                      result.id === record.currentSecondInstanceResultId &&
                      result.choiceId === choice.id &&
                      result.trialRoundId === record.currentTrialRoundId &&
                      (result.result === 'CHANGE' ||
                        result.result === 'AFFIRM') &&
                      result.revocation === null,
                  )),
          )) &&
        (record.stage === 'WAITING_EXECUTION_DOCUMENTS'
          ? record.currentExecutionSubmissionId === null
          : record.currentExecutionSubmissionId !== null) &&
        (principal === 'LAWYER' ||
          (await this.access.canAuthorizeCase(actor, 'case.execution.submit', {
            departmentId: actor.departmentId,
            responsibleUserId: record.responsibleUserId,
            ...(record.responsibleMembership.teamId
              ? { teamId: record.responsibleMembership.teamId }
              : {}),
          }))),
      canConfirmExecution:
        record.stage === 'WAITING_EXECUTION_CONFIRMATION' &&
        (record.currentExecutionSubmissionId !== null ||
          record.externalEntry?.initialStage ===
            'WAITING_EXECUTION_CONFIRMATION') &&
        record.executionConfirmation === null &&
        ((record.externalEntry?.initialStage ===
          'WAITING_EXECUTION_CONFIRMATION' &&
          record.currentExecutionSubmissionId === null) ||
          executionSubmissions.some(
            (submission) =>
              submission.id === record.currentExecutionSubmissionId &&
              submission.toVersion === record.version &&
              submission.files.length > 0,
          )) &&
        (principal === 'LAWYER' ||
          (await this.access.canAuthorizeCase(actor, 'case.execution.confirm', {
            departmentId: actor.departmentId,
            responsibleUserId: record.responsibleUserId,
            ...(record.responsibleMembership.teamId
              ? { teamId: record.responsibleMembership.teamId }
              : {}),
          }))),
      canMailExecution:
        record.stage === 'WAITING_EXECUTION_STAMP' &&
        (record.executionConfirmation !== null ||
          record.externalEntry?.initialStage === 'WAITING_EXECUTION_STAMP') &&
        record.executionMailing === null &&
        (principal === 'LAWYER' ||
          (await this.access.canAuthorizeCase(actor, 'case.execution.mail', {
            departmentId: actor.departmentId,
            responsibleUserId: record.responsibleUserId,
            ...(record.responsibleMembership.teamId
              ? { teamId: record.responsibleMembership.teamId }
              : {}),
          }))),
      canFinishExecution:
        record.stage === 'EXECUTING' &&
        ((record.executionFiling != null &&
          record.executionFiling.toVersion === record.version) ||
          (record.externalEntry?.initialStage === 'EXECUTING' &&
            record.executionFiling == null)) &&
        record.executionFinish == null &&
        (principal === 'LAWYER' ||
          (await this.access.canAuthorizeCase(actor, 'case.execution.finish', {
            departmentId: actor.departmentId,
            responsibleUserId: record.responsibleUserId,
            ...(record.responsibleMembership.teamId
              ? { teamId: record.responsibleMembership.teamId }
              : {}),
          }))),
      canSubmitExecutionFiling:
        record.stage === 'WAITING_EXECUTION_FILING' &&
        (record.executionMailing !== null ||
          record.externalEntry?.initialStage === 'WAITING_EXECUTION_FILING') &&
        record.executionFiling === null &&
        (principal === 'LAWYER' ||
          (await this.access.canAuthorizeCase(
            actor,
            'case.execution.filing.submit',
            {
              departmentId: actor.departmentId,
              responsibleUserId: record.responsibleUserId,
              ...(record.responsibleMembership.teamId
                ? { teamId: record.responsibleMembership.teamId }
                : {}),
            },
          ))),
      complaint:
        record.complaintSubmittedAt == null
          ? null
          : {
              amountState: record.complaintAmountState!,
              amount:
                record.complaintAmount === null
                  ? null
                  : new Prisma.Decimal(
                      record.complaintAmount.toString(),
                    ).toFixed(2),
              pendingReason: record.complaintPendingReason,
              submittedAt: record.complaintSubmittedAt.toISOString(),
              submittedByUserId: record.complaintSubmittedByUserId!,
              complaintFiles: complaintFiles
                .filter((ref) => ref.purpose === 'COMPLAINT')
                .map(file),
              authorizationFiles: complaintFiles
                .filter((ref) => ref.purpose === 'AUTHORIZATION')
                .map(file),
            },
      complaintConfirmation:
        record.complaintConfirmation == null
          ? null
          : {
              confirmedComplaintContentVersionId:
                record.complaintConfirmation.confirmedComplaintContentVersionId,
              amountState: record.complaintConfirmation.amountState,
              amount:
                record.complaintConfirmation.amount === null
                  ? null
                  : new Prisma.Decimal(
                      record.complaintConfirmation.amount.toString(),
                    ).toFixed(2),
              pendingReason: record.complaintConfirmation.pendingReason,
              changeNote: record.complaintConfirmation.changeNote,
              confirmDisclose: record.complaintConfirmation.confirmDisclose,
              confirmedAt:
                record.complaintConfirmation.confirmedAt.toISOString(),
              confirmedByUserId: record.complaintConfirmation.confirmedByUserId,
              complaintFile: confirmationFile,
            },
      complaintMailing:
        record.complaintMailing == null
          ? null
          : {
              mailedAt: record.complaintMailing.mailedAt
                .toISOString()
                .slice(0, 10),
              recordedAt: record.complaintMailing.recordedAt.toISOString(),
              recordedByUserId: record.complaintMailing.recordedByUserId,
              actorType: record.complaintMailing.actorType,
              receiptFiles: receiptFiles.map((ref) => ({
                materialId: ref.materialId,
                contentVersionId: ref.contentVersionId,
                originalFilename: ref.originalFilename,
                mimeType: ref.mimeType,
              })),
            },
      filingSubmission:
        record.filingSubmission == null
          ? null
          : {
              court: {
                id: record.filingSubmission.courtId,
                name: record.filingSubmission.courtName,
              },
              submittedAt: record.filingSubmission.submittedAt
                .toISOString()
                .slice(0, 10),
              recordedAt: record.filingSubmission.recordedAt.toISOString(),
              recordedByUserId: record.filingSubmission.recordedByUserId,
              mediationNo: record.filingSubmission.mediationNo,
              evidenceFiles: filingFiles
                .filter((ref) => ref.purpose === 'FILING_EVIDENCE')
                .map(file),
              screenshotFiles: filingFiles
                .filter((ref) => ref.purpose === 'FILING_SCREENSHOT')
                .map(file),
            },
      acceptance:
        record.acceptance == null
          ? null
          : {
              id: record.acceptance.id,
              trialRoundId: record.acceptance.trialRoundId,
              court:
                record.acceptance.court ??
                (record.filingSubmission === null
                  ? null
                  : {
                      id: record.filingSubmission.courtId,
                      name: record.filingSubmission.courtName,
                    }),
              acceptedAt: (
                record.acceptance.corrections.at(-1)?.acceptedAt ??
                record.acceptance.acceptedAt
              )
                .toISOString()
                .slice(0, 10),
              courtCaseNo:
                record.acceptance.corrections.at(-1)?.courtCaseNo ??
                record.acceptance.courtCaseNo,
              recordedAt: record.acceptance.recordedAt.toISOString(),
              recordedByUserId: record.acceptance.recordedByUserId,
              files: record.acceptance.versions.map((version) => ({
                category: version.category,
                materialId: version.materialId,
                contentVersionId: version.contentVersionId,
                originalFilename: version.contentVersion.originalFilename,
                mimeType: version.contentVersion.mimeType,
              })),
            },
      acceptances: record.acceptances.map((value) => ({
        id: value.id,
        trialRoundId: value.trialRoundId,
        court:
          value.court ??
          (record.filingSubmission == null
            ? null
            : {
                id: record.filingSubmission.courtId,
                name: record.filingSubmission.courtName,
              }),
        acceptedAt: (value.corrections.at(-1)?.acceptedAt ?? value.acceptedAt)
          .toISOString()
          .slice(0, 10),
        courtCaseNo: value.corrections.at(-1)?.courtCaseNo ?? value.courtCaseNo,
        recordedAt: value.recordedAt.toISOString(),
        ...(principal === 'INTERNAL'
          ? { recordedByUserId: value.recordedByUserId }
          : {}),
        files: value.versions.map((version) => ({
          category: version.category,
          materialId: version.materialId,
          contentVersionId: version.contentVersionId,
          originalFilename: version.contentVersion.originalFilename,
          mimeType: version.contentVersion.mimeType,
        })),
      })),
      acceptanceMaterials: Object.fromEntries(
        (
          ['ACCEPTANCE_NOTICE', 'PAYMENT_LIST', 'SERVICE_DOCUMENT'] as const
        ).map((category) => [
          category,
          {
            available: acceptanceOwned.items
              .filter((material) => material.category === category)
              .flatMap((material) =>
                material.contentVersions
                  .filter(
                    (version) =>
                      (record.acceptance == null ||
                        version.createdAt <= record.acceptance.recordedAt) &&
                      !acceptanceFrozenIds.has(version.id),
                  )
                  .map((version) => ({
                    materialId: material.id,
                    contentVersionId: version.id,
                    originalFilename: version.originalFilename,
                    mimeType: version.mimeType,
                  })),
              ),
            frozen: acceptanceFrozen
              .filter((ref) => ref.purpose === category)
              .map(file),
            later:
              record.acceptance == null
                ? []
                : acceptanceOwned.items
                    .filter((material) => material.category === category)
                    .flatMap((material) =>
                      material.contentVersions
                        .filter(
                          (version) =>
                            version.createdAt > record.acceptance!.recordedAt,
                        )
                        .map((version) => ({
                          materialId: material.id,
                          contentVersionId: version.id,
                          originalFilename: version.originalFilename,
                          mimeType: version.mimeType,
                        })),
                    ),
          },
        ]),
      ),
      createdAt: record.createdAt.toISOString(),
      courtCaseNo: record.courtCaseNo,
      department: record.department,
      customer: record.customer,
      rightsHolder: record.rightsHolder,
      owner: record.owner,
      origin:
        externalEntry === null
          ? { kind: 'NOTARY' as const }
          : {
              kind: 'EXTERNAL_ENTRY' as const,
              entryId: externalEntry.id,
              entryKind: externalEntry.entryKind,
              initialStage: externalEntry.initialStage,
              stageReachedOn: externalEntry.stageReachedOn
                .toISOString()
                .slice(0, 10),
              source: externalEntry.source,
              reason: externalEntry.reason,
              recordedAt: externalEntry.recordedAt.toISOString(),
              recordedByUserId: externalEntry.recordedByUserId,
              known: externalEntry.known,
            },
      sourceLead:
        record.sourceLead === null
          ? null
          : {
              id: record.sourceLead.id,
              businessNo: record.sourceLead.businessNo,
            },
      sourceNotaryMatter:
        record.sourceNotaryMatter === null
          ? null
          : {
              id: record.sourceNotaryMatter.id,
              businessNo: record.sourceNotaryMatter.businessNo,
            },
      certificate:
        record.certificate === null
          ? null
          : {
              certificateNo: record.certificate.certificateNo,
              certificateDate: record.certificate.certificateDate
                .toISOString()
                .slice(0, 10),
              issuedAt: record.certificate.issuedAt.toISOString(),
              needDisclose: record.certificate.needDisclose,
              files: frozen
                .filter((ref) => ref.purpose === 'NOTARY_CERTIFICATE')
                .map(file),
              disclosureFiles: frozen
                .filter((ref) => ref.purpose === 'NOTARY_DISCLOSURE')
                .map(file),
            },
      fees:
        record.certificate === null || record.sourceNotaryMatter === null
          ? []
          : [
              ...record.certificate.fees.map((fee) => ({
                category: fee.category,
                state: fee.state,
                amount:
                  fee.amount === null
                    ? null
                    : new Prisma.Decimal(fee.amount.toString()).toFixed(2),
                sourceType: 'NOTARY_CERTIFICATE_FEE' as const,
                sourceId: record.certificate!.id,
              })),
              {
                category: 'SAMPLE' as const,
                state: sample?.sampleFeeState ?? 'PENDING',
                amount:
                  sample?.sampleFeeAmount === null || sample === null
                    ? null
                    : new Prisma.Decimal(
                        sample.sampleFeeAmount.toString(),
                      ).toFixed(2),
                sourceType: 'NOTARY_MATTER_EVIDENCE' as const,
                sourceId: record.sourceNotaryMatter.id,
              },
            ].sort(
              (a, b) =>
                ['NOTARY', 'SAMPLE', 'INVESTIGATION', 'DISCLOSURE'].indexOf(
                  a.category,
                ) -
                ['NOTARY', 'SAMPLE', 'INVESTIGATION', 'DISCLOSURE'].indexOf(
                  b.category,
                ),
            ),
    };
    if (principal === 'LAWYER') {
      const archiveVersion = (
        v: NonNullable<typeof detail.archive>['current'],
      ) => ({
        id: v.id,
        kind: v.kind,
        priorVersionId: v.priorVersionId,
        closureVersionId: v.closureVersionId,
        fromVersion: v.fromVersion,
        toVersion: v.toVersion,
        archiveAt: v.archiveAt,
        archiveType: v.archiveType,
        archiveReason: v.archiveReason,
        recordedAt: v.recordedAt,
      });
      const closureVersion = (
        version: NonNullable<typeof detail.closure>['current'],
      ) => ({
        id: version.id,
        kind: version.kind,
        priorVersionId: version.priorVersionId,
        finishId: version.finishId,
        fromVersion: version.fromVersion,
        toVersion: version.toVersion,
        closeAt: version.closeAt,
        closeAmountState: version.closeAmountState,
        closeAmt: version.closeAmt,
        note: version.note,
        recordedAt: version.recordedAt,
        files: version.files,
      });
      return {
        id: detail.id,
        businessNo: detail.businessNo,
        stage: detail.stage,
        version: detail.version,
        origin:
          externalEntry === null
            ? { kind: 'NOTARY' as const }
            : {
                kind: 'EXTERNAL_ENTRY' as const,
                entryKind: externalEntry.entryKind,
                stageReachedOn: externalEntry.stageReachedOn
                  .toISOString()
                  .slice(0, 10),
              },
        matchedAt: detail.matchedAt,
        matchedOn: detail.matchedOn,
        defendants: detail.defendants,
        lawyers: detail.lawyers.filter((lawyer) => lawyer.role === 'PRIMARY'),
        canMatch: false,
        canSubmitComplaint: detail.canSubmitComplaint,
        canConfirmComplaint: detail.canConfirmComplaint,
        canMailComplaint: detail.canMailComplaint,
        canSubmitFiling: detail.canSubmitFiling,
        canRegisterAcceptance: detail.canRegisterAcceptance,
        canUploadAcceptanceMaterials: detail.canUploadAcceptanceMaterials,
        canScheduleHearing: detail.canScheduleHearing,
        canCorrectHearing: false,
        canRegisterJudgment: detail.canRegisterJudgment,
        canCorrectJudgment: false,
        canChooseJudgmentNextStep: detail.canChooseJudgmentNextStep,
        canRevokeJudgmentNextStep: false,
        canSaveSecondInstance: detail.canSaveSecondInstance,
        canRegisterSecondInstanceResult: detail.canRegisterSecondInstanceResult,
        canRevokeSecondInstanceResult: false,
        canSubmitExecution: detail.canSubmitExecution,
        canConfirmExecution: detail.canConfirmExecution,
        canMailExecution: detail.canMailExecution,
        canSubmitExecutionFiling: detail.canSubmitExecutionFiling,
        canFinishExecution: detail.canFinishExecution,
        canRecordClosure: detail.canRecordClosure,
        canCorrectClosure: false,
        canArchive: detail.canArchive,
        canCorrectArchive: false,
        archive:
          detail.archive === null
            ? null
            : {
                id: detail.archive.id,
                closureId: detail.archive.closureId,
                closureVersionId: detail.archive.closureVersionId,
                current: archiveVersion(detail.archive.current),
                history: detail.archive.history.map(archiveVersion),
              },
        closure:
          detail.closure === null
            ? null
            : {
                id: detail.closure.id,
                finishId: detail.closure.finishId,
                current: closureVersion(detail.closure.current),
                history: detail.closure.history.map(closureVersion),
              },
        hearing: detail.hearing,
        judgment: detail.judgment,
        judgmentNextStep: detail.judgmentNextStep,
        secondInstance: detail.secondInstance,
        executionSubmission: detail.executionSubmission,
        executionConfirmation: detail.executionConfirmation,
        executionMailing: detail.executionMailing,
        executionFiling: detail.executionFiling,
        executionFinish: detail.executionFinish,
        complaint:
          detail.complaint === null
            ? null
            : {
                amountState: detail.complaint.amountState,
                amount: detail.complaint.amount,
                pendingReason: detail.complaint.pendingReason,
                submittedAt: detail.complaint.submittedAt,
                complaintFiles: detail.complaint.complaintFiles,
                authorizationFiles: detail.complaint.authorizationFiles,
              },
        complaintConfirmation:
          detail.complaintConfirmation === null
            ? null
            : {
                confirmedComplaintContentVersionId:
                  detail.complaintConfirmation
                    .confirmedComplaintContentVersionId,
                amountState: detail.complaintConfirmation.amountState,
                amount: detail.complaintConfirmation.amount,
                pendingReason: detail.complaintConfirmation.pendingReason,
                changeNote: detail.complaintConfirmation.changeNote,
                confirmDisclose: detail.complaintConfirmation.confirmDisclose,
                confirmedAt: detail.complaintConfirmation.confirmedAt,
                complaintFile: detail.complaintConfirmation.complaintFile,
              },
        complaintMailing:
          detail.complaintMailing === null
            ? null
            : {
                mailedAt: detail.complaintMailing.mailedAt,
                recordedAt: detail.complaintMailing.recordedAt,
                actorType: detail.complaintMailing.actorType,
                receiptFiles: detail.complaintMailing.receiptFiles,
              },
        filingSubmission:
          detail.filingSubmission === null
            ? null
            : {
                court: detail.filingSubmission.court,
                submittedAt: detail.filingSubmission.submittedAt,
                recordedAt: detail.filingSubmission.recordedAt,
                mediationNo: detail.filingSubmission.mediationNo,
                evidenceFiles: detail.filingSubmission.evidenceFiles,
                screenshotFiles: detail.filingSubmission.screenshotFiles,
              },
        acceptance:
          detail.acceptance === null
            ? null
            : {
                id: detail.acceptance.id,
                trialRoundId: detail.acceptance.trialRoundId,
                court: detail.acceptance.court,
                acceptedAt: detail.acceptance.acceptedAt,
                courtCaseNo: detail.acceptance.courtCaseNo,
                recordedAt: detail.acceptance.recordedAt,
                files: detail.acceptance.files,
              },
        acceptances: detail.acceptances,
        acceptanceMaterials: detail.acceptanceMaterials,
        courtCaseNo: detail.courtCaseNo,
        customer: detail.customer,
        rightsHolder: detail.rightsHolder,
        certificate: detail.certificate,
        createdAt: detail.createdAt,
      };
    }
    return detail;
  }

  private forbidden() {
    return new ForbiddenException({
      code: 'ACTION_FORBIDDEN',
      message: '无权访问案件',
    });
  }
}
