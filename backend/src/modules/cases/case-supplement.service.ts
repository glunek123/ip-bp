import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type { ActorContext } from '../../access-control/actor-context';
import { AccessControlService } from '../../access-control/access-control.service';
import { DatabaseService } from '../../database/database.service';
import {
  CaseSupplementKind,
  MaterialCategory,
  Prisma,
} from '../../generated/prisma/client';
import { CreateCaseSupplementDto } from './case-supplement.dto';

const documentCategories: Partial<
  Record<CaseSupplementKind, MaterialCategory>
> = {
  COURT_DISCLOSURE: 'CASE_COURT_DISCLOSURE_ATTACHMENT',
  RECORD_RETRIEVAL_DOCUMENT: 'CASE_RECORD_RETRIEVAL_DOCUMENT',
  PRESERVATION_DOCUMENT: 'CASE_PRESERVATION_DOCUMENT',
  EXECUTION_FORMAL_ACCEPTANCE: 'EXECUTION_FORMAL_DOCUMENT',
};

const allowedFields: Record<
  CaseSupplementKind,
  readonly (keyof CreateCaseSupplementDto)[]
> = {
  COURT_PREPAYMENT_NOTICE: ['trialRoundId', 'amount'],
  COURT_DISCLOSURE: ['trialRoundId', 'text', 'materialId', 'contentVersionId'],
  RECORD_RETRIEVAL_DOCUMENT: ['materialId', 'contentVersionId'],
  PRESERVATION_DOCUMENT: ['materialId', 'contentVersionId'],
  EXECUTION_FORMAL_ACCEPTANCE: [
    'eventDate',
    'courtCaseNo',
    'sourceType',
    'sourceId',
    'materialId',
    'contentVersionId',
  ],
  REFUND_SOURCE_LINK: [
    'sourceType',
    'sourceId',
    'inventoryVersionId',
    'inventoryItemId',
  ],
  MANUAL_ANNOTATION: ['text'],
};

@Injectable()
export class CaseSupplementService {
  constructor(
    private readonly db: DatabaseService,
    private readonly access: AccessControlService,
  ) {}

  private async authorize(
    actor: ActorContext,
    caseId: string,
    tx: Prisma.TransactionClient,
  ) {
    if (actor.clientCustomerId || actor.notaryOfficeId || actor.lawyerAccountId)
      throw new ForbiddenException({ code: 'ACTION_FORBIDDEN' });
    const account = await tx.userAccount.findUnique({
      where: { id: actor.userId },
      select: { active: true, accountType: true },
    });
    if (!account?.active || account.accountType !== 'INTERNAL')
      throw new ForbiddenException({ code: 'ACTION_FORBIDDEN' });
    await this.access.authorizeDepartmentAction(actor, 'case.read', tx);
    const item = await tx.case.findFirst({
      where: { id: caseId, departmentId: actor.departmentId },
      select: { id: true, responsibleUserId: true },
    });
    if (!item) throw new NotFoundException({ code: 'CASE_NOT_FOUND' });
    let canEdit = item.responsibleUserId === actor.userId;
    if (!canEdit) {
      try {
        await this.access.authorizeDepartmentAction(
          actor,
          'case.routine.edit',
          tx,
        );
        canEdit = true;
      } catch (error) {
        if (!(error instanceof ForbiddenException)) throw error;
      }
    }
    return canEdit;
  }

  private present(entry: {
    id: string;
    priorEntryId: string | null;
    kind: CaseSupplementKind;
    trialRoundId: string | null;
    amount: Prisma.Decimal | null;
    text: string | null;
    eventDate: Date | null;
    courtCaseNo: string | null;
    sourceType: string | null;
    sourceId: string | null;
    inventoryVersionId: string | null;
    inventoryItemId: string | null;
    materialId: string | null;
    contentVersionId: string | null;
    reason: string;
    recordedByUserId: string;
    recordedAt: Date;
  }) {
    return {
      ...entry,
      amount: entry.amount?.toFixed(2) ?? null,
      eventDate: entry.eventDate?.toISOString().slice(0, 10) ?? null,
      recordedAt: entry.recordedAt.toISOString(),
    };
  }

  async get(actor: ActorContext, caseId: string) {
    return this.db.$transaction(
      async (tx) => {
        const canEdit = await this.authorize(actor, caseId, tx);
        const entries = await tx.caseSupplementEntry.findMany({
          where: { caseId, departmentId: actor.departmentId },
          orderBy: [{ recordedAt: 'asc' }, { id: 'asc' }],
        });
        const [
          filing,
          trialRounds,
          judgments,
          secondResults,
          materials,
          refundItems,
        ] = await Promise.all([
          tx.caseExecutionFiling.findFirst({
            where: { caseId, departmentId: actor.departmentId },
            select: { id: true, submittedAt: true },
          }),
          tx.caseTrialRound.findMany({
            where: {
              caseId,
              departmentId: actor.departmentId,
              revokedAt: null,
            },
            select: { id: true, sequence: true },
            orderBy: { sequence: 'asc' },
          }),
          tx.caseJudgmentFact.findMany({
            where: { caseId, departmentId: actor.departmentId },
            select: { id: true, trialRoundId: true, judgmentReceivedAt: true },
            orderBy: { recordedAt: 'asc' },
          }),
          tx.caseSecondInstanceResult.findMany({
            where: { caseId, departmentId: actor.departmentId },
            select: { id: true, trialRoundId: true, resultReceivedAt: true },
            orderBy: { recordedAt: 'asc' },
          }),
          tx.material.findMany({
            where: {
              departmentId: actor.departmentId,
              ownerType: 'CASE',
              ownerId: caseId,
              status: 'ACTIVE',
              category: {
                in: Object.values(documentCategories) as MaterialCategory[],
              },
            },
            select: {
              id: true,
              category: true,
              contentVersions: {
                where: { status: 'AVAILABLE' },
                select: {
                  id: true,
                  originalFilename: true,
                  sourceUploadDraft: {
                    select: {
                      caseSupplementReason: true,
                      actorUserId: true,
                      createdAt: true,
                    },
                  },
                  materialReferences: {
                    where: { resourceType: 'CASE_SUPPLEMENT_ENTRY' },
                    select: { id: true },
                  },
                },
                orderBy: { createdAt: 'desc' },
              },
            },
            orderBy: { createdAt: 'desc' },
          }),
          tx.$queryRaw<
            Array<{
              inventoryVersionId: string;
              inventoryItemId: string;
              description: string;
            }>
          >`SELECT i.inventory_version_id AS "inventoryVersionId", i.item_id AS "inventoryItemId", i.description FROM case_refund_inventory_items i JOIN case_refund_inventory_versions v ON v.id=i.inventory_version_id WHERE i.case_id=${caseId}::uuid AND i.department_id=${actor.departmentId}::uuid AND NOT EXISTS (SELECT 1 FROM case_refund_inventory_versions newer WHERE newer.case_id=v.case_id AND newer.department_id=v.department_id AND newer.revision>v.revision) ORDER BY i.item_id`,
        ]);
        const audits = await tx.auditEvent.findMany({
          where: {
            departmentId: actor.departmentId,
            resourceType: { in: ['CASE', 'case'] },
            resourceId: caseId,
          },
          select: { actorUserId: true },
        });
        const recorderIds = [
          ...new Set([
            ...entries.map((entry) => entry.recordedByUserId),
            ...audits
              .map((row) => row.actorUserId)
              .filter((id): id is string => id !== null),
          ]),
        ];
        const recorders = await tx.userAccount.findMany({
          where: { id: { in: recorderIds } },
          select: { id: true, displayName: true },
          orderBy: { id: 'asc' },
        });
        return {
          canEdit,
          entries: entries.map((entry) => this.present(entry)),
          recorders,
          sources: {
            executionFiling: filing
              ? {
                  id: filing.id,
                  submittedOn: filing.submittedAt.toISOString().slice(0, 10),
                }
              : null,
            trialRounds,
            judgments: judgments.map((row) => ({
              id: row.id,
              trialRoundId: row.trialRoundId,
              receivedOn: row.judgmentReceivedAt.toISOString().slice(0, 10),
            })),
            secondResults: secondResults.map((row) => ({
              id: row.id,
              trialRoundId: row.trialRoundId,
              receivedOn: row.resultReceivedAt.toISOString().slice(0, 10),
            })),
            refundItems,
            materials: materials.flatMap((row) =>
              row.contentVersions.map((version) => ({
                materialId: row.id,
                contentVersionId: version.id,
                category: row.category,
                filename: version.originalFilename,
                linked: version.materialReferences.length > 0,
                uploadReason:
                  version.sourceUploadDraft?.caseSupplementReason ?? null,
                uploadedByUserId:
                  version.sourceUploadDraft?.actorUserId ?? null,
                uploadedAt:
                  version.sourceUploadDraft?.createdAt.toISOString() ?? null,
              })),
            ),
          },
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }

  async getRequest(actor: ActorContext, caseId: string, key: string) {
    return this.db.$transaction(
      async (tx) => {
        await this.authorize(actor, caseId, tx);
        const entry = await tx.caseSupplementEntry.findUnique({
          where: {
            departmentId_recordedByUserId_idempotencyKey: {
              departmentId: actor.departmentId,
              recordedByUserId: actor.userId,
              idempotencyKey: key,
            },
          },
        });
        if (!entry || entry.caseId !== caseId)
          throw new NotFoundException({
            code: 'CASE_SUPPLEMENT_REQUEST_NOT_FOUND',
          });
        return this.present(entry);
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }

  private validate(input: CreateCaseSupplementDto) {
    const fail = () => {
      throw new BadRequestException({ code: 'INVALID_CASE_SUPPLEMENT' });
    };
    if (
      !input ||
      !Object.values(CaseSupplementKind).includes(input.kind) ||
      !input.reason?.trim() ||
      !input.idempotencyKey?.trim()
    )
      fail();
    const allowed = new Set([
      'kind',
      'reason',
      'idempotencyKey',
      'expectedHeadId',
      ...allowedFields[input.kind],
    ]);
    if (
      Object.entries(input).some(
        ([key, value]) => value !== undefined && !allowed.has(key),
      )
    )
      fail();
    if (
      (input.kind === 'COURT_PREPAYMENT_NOTICE' ||
        input.kind === 'COURT_DISCLOSURE') &&
      !input.trialRoundId
    )
      fail();
    if (
      input.kind === 'COURT_PREPAYMENT_NOTICE' &&
      (!input.amount || !/^(0|[1-9]\d{0,13})\.\d{2}$/u.test(input.amount))
    )
      fail();
    if (
      input.kind === 'COURT_DISCLOSURE' &&
      !input.text?.trim() &&
      !input.materialId
    )
      fail();
    if (input.kind === 'MANUAL_ANNOTATION' && !input.text?.trim()) fail();
    if (
      (input.kind === 'RECORD_RETRIEVAL_DOCUMENT' ||
        input.kind === 'PRESERVATION_DOCUMENT') &&
      (!input.materialId || !input.contentVersionId)
    )
      fail();
    if (
      (input.kind === 'COURT_DISCLOSURE' ||
        input.kind === 'EXECUTION_FORMAL_ACCEPTANCE') &&
      Boolean(input.materialId) !== Boolean(input.contentVersionId)
    )
      fail();
    if (input.kind === 'EXECUTION_FORMAL_ACCEPTANCE') {
      if (
        input.sourceType !== 'EXECUTION_FILING' ||
        !input.sourceId ||
        (!input.eventDate && !input.courtCaseNo?.trim() && !input.materialId)
      )
        fail();
      if (
        input.eventDate &&
        (!/^\d{4}-\d{2}-\d{2}$/u.test(input.eventDate) ||
          Number.isNaN(Date.parse(`${input.eventDate}T00:00:00Z`)) ||
          new Date(`${input.eventDate}T00:00:00Z`)
            .toISOString()
            .slice(0, 10) !== input.eventDate)
      )
        fail();
    }
    if (
      input.kind === 'REFUND_SOURCE_LINK' &&
      (!['JUDGMENT', 'SECOND_INSTANCE_RESULT'].includes(
        input.sourceType ?? '',
      ) ||
        !input.sourceId ||
        !input.inventoryVersionId ||
        !input.inventoryItemId)
    )
      fail();
  }

  async create(
    actor: ActorContext,
    caseId: string,
    input: CreateCaseSupplementDto,
  ) {
    this.validate(input);
    const fingerprint = createHash('sha256')
      .update(JSON.stringify({ caseId, ...input }))
      .digest('hex');
    try {
      return await this.db.$transaction(
        async (tx) => {
          const canEdit = await this.authorize(actor, caseId, tx);
          if (!canEdit)
            throw new ForbiddenException({ code: 'ACTION_FORBIDDEN' });
          const old = await tx.caseSupplementEntry.findUnique({
            where: {
              departmentId_recordedByUserId_idempotencyKey: {
                departmentId: actor.departmentId,
                recordedByUserId: actor.userId,
                idempotencyKey: input.idempotencyKey,
              },
            },
          });
          if (old) {
            if (old.caseId !== caseId || old.requestFingerprint !== fingerprint)
              throw new ConflictException({ code: 'IDEMPOTENCY_CONFLICT' });
            return this.present(old);
          }
          if (input.expectedHeadId) {
            const head = await tx.caseSupplementEntry.findFirst({
              where: {
                id: input.expectedHeadId,
                caseId,
                departmentId: actor.departmentId,
                kind: input.kind,
              },
              select: {
                id: true,
                trialRoundId: true,
                sourceType: true,
                sourceId: true,
                inventoryItemId: true,
                corrections: { select: { id: true } },
              },
            });
            if (
              !head ||
              head.corrections.length ||
              head.trialRoundId !== (input.trialRoundId ?? null) ||
              head.sourceId !== (input.sourceId ?? null) ||
              head.inventoryItemId !== (input.inventoryItemId ?? null)
            )
              throw new ConflictException({
                code: 'CASE_SUPPLEMENT_HEAD_CHANGED',
              });
          }
          if (input.trialRoundId) {
            const round = await tx.caseTrialRound.findFirst({
              where: {
                id: input.trialRoundId,
                caseId,
                departmentId: actor.departmentId,
                revokedAt: null,
              },
              select: { id: true },
            });
            if (!round)
              throw new BadRequestException({
                code: 'CASE_SUPPLEMENT_SOURCE_MISMATCH',
              });
          }
          const category = documentCategories[input.kind];
          if (input.materialId && input.contentVersionId) {
            const material = await tx.material.findFirst({
              where: {
                id: input.materialId,
                departmentId: actor.departmentId,
                ownerType: 'CASE',
                ownerId: caseId,
                category,
                status: 'ACTIVE',
                contentVersions: {
                  some: { id: input.contentVersionId, status: 'AVAILABLE' },
                },
              },
              select: { id: true },
            });
            if (!material)
              throw new BadRequestException({
                code: 'CASE_SUPPLEMENT_MATERIAL_MISMATCH',
              });
          }
          if (input.kind === 'EXECUTION_FORMAL_ACCEPTANCE') {
            const filing = await tx.caseExecutionFiling.findFirst({
              where: {
                id: input.sourceId,
                caseId,
                departmentId: actor.departmentId,
              },
              select: { id: true },
            });
            if (!filing)
              throw new BadRequestException({
                code: 'CASE_SUPPLEMENT_SOURCE_MISMATCH',
              });
          }
          if (input.kind === 'REFUND_SOURCE_LINK') {
            const source =
              input.sourceType === 'JUDGMENT'
                ? await tx.caseJudgmentFact.findFirst({
                    where: {
                      id: input.sourceId,
                      caseId,
                      departmentId: actor.departmentId,
                    },
                    select: { id: true },
                  })
                : await tx.caseSecondInstanceResult.findFirst({
                    where: {
                      id: input.sourceId,
                      caseId,
                      departmentId: actor.departmentId,
                    },
                    select: { id: true },
                  });
            const inventory = await tx.$queryRaw<
              Array<{ id: string }>
            >`SELECT i.item_id AS id FROM case_refund_inventory_items i JOIN case_refund_inventory_versions v ON v.id=i.inventory_version_id WHERE i.inventory_version_id=${input.inventoryVersionId}::uuid AND i.item_id=${input.inventoryItemId}::uuid AND i.case_id=${caseId}::uuid AND i.department_id=${actor.departmentId}::uuid AND NOT EXISTS (SELECT 1 FROM case_refund_inventory_versions newer WHERE newer.case_id=v.case_id AND newer.department_id=v.department_id AND newer.revision>v.revision) FOR SHARE`;
            if (!source || inventory.length !== 1)
              throw new BadRequestException({
                code: 'CASE_SUPPLEMENT_SOURCE_MISMATCH',
              });
          }
          const id = randomUUID();
          const recordedAt = new Date();
          const auditEventId = randomUUID();
          await tx.auditEvent.create({
            data: {
              id: auditEventId,
              departmentId: actor.departmentId,
              actorKind: 'HUMAN',
              actorUserId: actor.userId,
              internalActorUserId: actor.userId,
              resourceType: 'CASE_SUPPLEMENT_ENTRY',
              resourceId: id,
              action: 'CASE_SUPPLEMENT_APPEND',
              details: { kind: input.kind, reason: input.reason.trim() },
            },
          });
          const entry = await tx.caseSupplementEntry.create({
            data: {
              id,
              priorEntryId: input.expectedHeadId ?? null,
              caseId,
              departmentId: actor.departmentId,
              kind: input.kind,
              trialRoundId: input.trialRoundId ?? null,
              amount: input.amount ? new Prisma.Decimal(input.amount) : null,
              text: input.text?.trim() ?? null,
              eventDate: input.eventDate
                ? new Date(`${input.eventDate}T00:00:00Z`)
                : null,
              courtCaseNo: input.courtCaseNo?.trim() ?? null,
              sourceType: input.sourceType ?? null,
              sourceId: input.sourceId ?? null,
              inventoryVersionId: input.inventoryVersionId ?? null,
              inventoryItemId: input.inventoryItemId ?? null,
              materialId: input.materialId ?? null,
              contentVersionId: input.contentVersionId ?? null,
              reason: input.reason.trim(),
              recordedByUserId: actor.userId,
              recordedAt,
              idempotencyKey: input.idempotencyKey,
              requestFingerprint: fingerprint,
              auditEventId,
            },
          });
          if (input.materialId && input.contentVersionId && category)
            await tx.materialReference.create({
              data: {
                departmentId: actor.departmentId,
                resourceType: 'CASE_SUPPLEMENT_ENTRY',
                resourceId: id,
                purpose: category,
                materialId: input.materialId,
                contentVersionId: input.contentVersionId,
                actionEventId: auditEventId,
              },
            });
          return this.present(entry);
        },
        { isolationLevel: 'Serializable' },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const old = await this.db.caseSupplementEntry.findUnique({
          where: {
            departmentId_recordedByUserId_idempotencyKey: {
              departmentId: actor.departmentId,
              recordedByUserId: actor.userId,
              idempotencyKey: input.idempotencyKey,
            },
          },
        });
        if (old?.caseId === caseId && old.requestFingerprint === fingerprint)
          return this.present(old);
        throw new ConflictException({
          code: old ? 'IDEMPOTENCY_CONFLICT' : 'CASE_SUPPLEMENT_HEAD_CHANGED',
        });
      }
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2034'
      )
        throw new ConflictException({ code: 'CASE_SUPPLEMENT_HEAD_CHANGED' });
      throw error;
    }
  }
}
