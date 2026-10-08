import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AccessControlService } from '../../access-control/access-control.service';
import { ActorContext } from '../../access-control/actor-context';
import { DatabaseService } from '../../database/database.service';
import { Prisma } from '../../generated/prisma/client';
import { MaterialService } from '../materials';

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
      | 'WAITING_JUDGMENT',
  ) {
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
      ...(stage ? { stage } : {}),
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
          createdAt: true,
          responsibleUserId: true,
          owner: { select: { id: true, displayName: true } },
          responsibleMembership: { select: { teamId: true } },
          sourceLead: { select: { id: true, businessNo: true } },
          sourceNotaryMatter: { select: { id: true, businessNo: true } },
        },
      }),
      this.database.case.count({ where }),
      this.database.case.groupBy({
        by: ['stage'],
        where: baseWhere,
        _count: { _all: true },
      }),
    ]);
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
                owner: item.owner,
                sourceLead: item.sourceLead,
                sourceNotaryMatter: item.sourceNotaryMatter,
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
            (await this.access.canAuthorizeCase(actor, 'case.hearing.correct', {
              departmentId: actor.departmentId,
              responsibleUserId: item.responsibleUserId,
              ...(item.responsibleMembership.teamId
                ? { teamId: item.responsibleMembership.teamId }
                : {}),
            })),
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
      },
    };
  }

  async get(actor: ActorContext, id: string) {
    const principal = await this.scope(actor);
    const record = await this.database.case.findFirst({
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
            acceptedAt: true,
            courtCaseNo: true,
            recordedAt: true,
            recordedByUserId: true,
          },
        },
        currentHearingAdvanceId: true,
        currentHearingArrangement: {
          select: {
            id: true,
            hearingAt: true,
            source: true,
            recordedAt: true,
            recordedByUserId: true,
          },
        },
        currentHearingAdvance: {
          select: {
            id: true,
            arrangementId: true,
            dueAt: true,
            executedAt: true,
          },
        },
        hearingArrangements: {
          orderBy: [{ recordedAt: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
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
              select: { id: true, fullName: true, lawFirm: true, phone: true },
            },
          },
        },
        courtCaseNo: true,
        owner: { select: { id: true, displayName: true } },
        department: { select: { id: true, name: true } },
        customer: { select: { id: true, name: true } },
        rightsHolder: { select: { id: true, name: true } },
        sourceLead: { select: { id: true, businessNo: true } },
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
    });
    if (record === null)
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: '案件不存在或不可访问',
      });
    const frozen = await this.materials.listFrozenCertificateFiles(
      actor,
      record.sourceNotaryMatter.id,
      record.certificate.id,
    );
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
    const sample = record.sourceNotaryMatter.evidence;
    const arrangement = (
      value: (typeof record.hearingArrangements)[number],
    ) => ({
      id: value.id,
      hearingAt: value.hearingAt?.toISOString().slice(0, 10) ?? null,
      source: value.source,
      recordedAt: value.recordedAt.toISOString(),
      ...(principal === 'INTERNAL'
        ? { recordedByUserId: value.recordedByUserId }
        : {}),
    });
    const advance = (value: (typeof record.hearingAdvances)[number]) => ({
      id: value.id,
      arrangementId: value.arrangementId,
      dueAt: value.dueAt.toISOString(),
      executedAt: value.executedAt.toISOString(),
    });
    const detail = {
      id: record.id,
      businessNo: record.businessNo,
      stage: record.stage,
      version: record.version,
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
      matchedAt: record.matchedAt?.toISOString() ?? null,
      matchedOn: record.matchedOn?.toISOString().slice(0, 10) ?? null,
      defendants: record.defendants,
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
        (await this.access.canAuthorizeCase(actor, 'case.hearing.correct', {
          departmentId: actor.departmentId,
          responsibleUserId: record.responsibleUserId,
          ...(record.responsibleMembership.teamId
            ? { teamId: record.responsibleMembership.teamId }
            : {}),
        })),
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
              acceptedAt: record.acceptance.acceptedAt
                .toISOString()
                .slice(0, 10),
              courtCaseNo: record.acceptance.courtCaseNo,
              recordedAt: record.acceptance.recordedAt.toISOString(),
              recordedByUserId: record.acceptance.recordedByUserId,
            },
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
      sourceLead: {
        id: record.sourceLead.id,
        businessNo: record.sourceLead.businessNo,
      },
      sourceNotaryMatter: {
        id: record.sourceNotaryMatter.id,
        businessNo: record.sourceNotaryMatter.businessNo,
      },
      certificate: {
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
      fees: [
        ...record.certificate.fees.map((fee) => ({
          category: fee.category,
          state: fee.state,
          amount:
            fee.amount === null
              ? null
              : new Prisma.Decimal(fee.amount.toString()).toFixed(2),
          sourceType: 'NOTARY_CERTIFICATE_FEE' as const,
          sourceId: record.certificate.id,
        })),
        {
          category: 'SAMPLE' as const,
          state: sample?.sampleFeeState ?? 'PENDING',
          amount:
            sample?.sampleFeeAmount === null || sample === null
              ? null
              : new Prisma.Decimal(sample.sampleFeeAmount.toString()).toFixed(
                  2,
                ),
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
      return {
        id: detail.id,
        businessNo: detail.businessNo,
        stage: detail.stage,
        version: detail.version,
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
        hearing: detail.hearing,
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
                acceptedAt: detail.acceptance.acceptedAt,
                courtCaseNo: detail.acceptance.courtCaseNo,
                recordedAt: detail.acceptance.recordedAt,
              },
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
