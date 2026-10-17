import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  AccessControlService,
  AccessControlSnapshotReader,
  LeadAction,
} from '../../access-control/access-control.service';
import { ActorContext } from '../../access-control/actor-context';
import { OrganizationService } from '../../access-control/organization.service';
import { lockCustomerActorFacts } from '../../access-control/customer-actor-facts-lock';
import { currentLawyerBindingId } from '../../access-control/lawyer-case-access';
import { DatabaseService } from '../../database/database.service';
import type { Prisma, UploadDraft } from '../../generated/prisma/client';
import type { CaseSectionRecordUploadTarget } from './case-section-record-upload.dto';
import type {
  ExecutionSupplementUploadTarget,
  ExecutionSupplementUploadDraftResultDto,
} from './execution-supplement-upload.dto';
import {
  CreateUploadDraftDto,
  MaterialCategoryValue,
  MaterialPurposeValue,
  OwnerMaterialListDto,
  MaterialOwnerTypeValue,
} from './material.dto';
import {
  BlobNotFoundError,
  BlobStorageUnavailableError,
  BlobValidationError,
  PRIVATE_BLOB_STORAGE,
  PrivateBlobStorage,
} from './private-blob-storage';
import { MaterialStorageKeyCoordinator } from './material-storage-key-coordinator';
import { isFrozenOpeningPhotoVersion } from './frozen-opening-photo';
import { isFrozenCertificateVersion } from './frozen-certificate';

const DAY_MS = 24 * 60 * 60 * 1000;
const RETENTION_MS = 90 * DAY_MS;
export const MATERIAL_SERVICE_CLOCK = Symbol('MATERIAL_SERVICE_CLOCK');
declare const VALIDATED_MATERIAL_VERSION: unique symbol;

export type MaterialTransactionClient = Prisma.TransactionClient;

export type CaseSectionRecordKind =
  | 'EXECUTION_MAILING'
  | 'EXECUTION_FILING'
  | 'EXECUTION_FINISH'
  | 'JUDGMENT'
  | 'CLOSURE';

export type CaseSectionRecordCorrectionReferenceTarget = Readonly<{
  kind: CaseSectionRecordKind;
  correctionId: string;
}>;

const sectionRecordMaterials = {
  EXECUTION_MAILING: {
    category: 'MAIL_RECEIPT',
    actions: [
      'case.execution.mailed',
      'case.execution.mailing.record-corrected',
    ],
  },
  EXECUTION_FILING: {
    category: 'EXECUTION_FILING_PROOF',
    actions: [
      'case.execution.filing.submitted',
      'case.execution.filing.record-corrected',
    ],
  },
  EXECUTION_FINISH: {
    category: 'EXECUTION_FINISH_BASIS',
    actions: [
      'case.execution.finished',
      'case.execution.finish.record-corrected',
    ],
  },
  JUDGMENT: {
    category: 'JUDGMENT',
    actions: [
      'case.judgment.registered',
      'case.judgment.corrected',
      'case.judgment.record-corrected',
    ],
  },
  CLOSURE: {
    category: 'CASE_CLOSURE_DOCUMENT',
    actions: [
      'case.closure.recorded',
      'case.closure.corrected',
      'case.closure.record-corrected',
    ],
  },
} as const;

const sectionRecordUploads = {
  EXECUTION_MAILING: {
    command: 'EXECUTION_MAILING_CORRECTION',
    action: 'case.execution.mailing.correct',
  },
  EXECUTION_FILING: {
    command: 'EXECUTION_FILING_CORRECTION',
    action: 'case.execution.filing.correct',
  },
  EXECUTION_FINISH: {
    command: 'EXECUTION_FINISH_CORRECTION',
    action: 'case.execution.finish.correct',
  },
  JUDGMENT: {
    command: 'JUDGMENT_RECORD_CORRECTION',
    action: 'case.judgment.correct',
  },
  CLOSURE: {
    command: 'CLOSURE_RECORD_CORRECTION',
    action: 'case.closure.correct',
  },
} as const;

export type AssertAvailableVersionsInput = Readonly<{
  ownerType: MaterialOwnerTypeValue;
  ownerId: string;
  category: MaterialCategoryValue;
  contentVersionIds: readonly string[];
  minCount?: number;
  maxCount?: number;
  sectionRecordKind?: CaseSectionRecordKind;
  sectionRecordTarget?: CaseSectionRecordUploadTarget;
  executionSupplementTarget?: ExecutionSupplementUploadTarget;
  leadAction?: Extract<
    LeadAction,
    'lead.read' | 'lead.edit' | 'lead.evidence.decide' | 'notary.unbox.record'
  >;
}>;

type CanonicalMaterialVersionFact = Readonly<{
  departmentId: string;
  materialId: string;
  contentVersionId: string;
  purpose: string;
  mimeType: string;
  ownerType: MaterialOwnerTypeValue;
  ownerId: string;
  category: MaterialCategoryValue;
  sizeBytes: bigint;
}>;

export type ValidatedMaterialVersionFact = CanonicalMaterialVersionFact & {
  [VALIDATED_MATERIAL_VERSION]: true;
};

export type FreezeMaterialReferencesInput = Readonly<{
  departmentId: string;
  resourceType: string;
  resourceId: string;
  facts: readonly ValidatedMaterialVersionFact[];
  actionEventId?: string;
  assetVersionId?: string;
}>;

export type AdoptLeadDraftVersionsInput = Readonly<{
  reservedLeadId: string;
  targetLeadId: string;
  versions: readonly ValidatedMaterialVersionFact[];
}>;

export type CurrentLeadReferenceInput = Readonly<{
  resourceType: 'lead';
  resourceId: string;
  purpose: 'LEAD_SCREENSHOT';
}>;

export type ReplaceCurrentLeadReferencesInput = CurrentLeadReferenceInput &
  Readonly<{
    versions: readonly ValidatedMaterialVersionFact[];
  }>;

export type ReplaceCurrentReferencesResult = Readonly<{
  beforeVersionIds: readonly string[];
  afterVersionIds: readonly string[];
  changed: boolean;
}>;

type MaterialAuthorizationReader = Pick<
  MaterialTransactionClient,
  | 'customer'
  | 'uploadDraft'
  | 'lead'
  | 'case'
  | 'notaryMatter'
  | 'customerAccountBinding'
  | 'notaryOfficeAccountBinding'
  | 'userAccount'
  | 'caseLawyerAssignment'
  | '$queryRawUnsafe'
>;
type MaterialMutationReader = MaterialAuthorizationReader &
  Pick<MaterialTransactionClient, 'material'>;
export type MaterialReferenceReader = MaterialAuthorizationReader &
  AccessControlSnapshotReader &
  Pick<MaterialTransactionClient, 'materialReference'>;
const allowedMimeTypes = {
  FEE_PROOF: new Set(['application/pdf', 'image/jpeg', 'image/png']),
  CUSTOMER_IDENTITY: new Set(['application/pdf', 'image/jpeg', 'image/png']),
  CUSTOMER_RIGHT_EVIDENCE: new Set([
    'application/pdf',
    'image/jpeg',
    'image/png',
  ]),
  CUSTOMER_AGREEMENT: new Set(['application/pdf', 'image/jpeg', 'image/png']),
  LEAD_SCREENSHOT: new Set([
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
  ]),
  NOTARY_OPENING_PHOTO: new Set(['image/jpeg', 'image/png', 'image/webp']),
  NOTARY_CERTIFICATE: new Set(['application/pdf', 'image/jpeg', 'image/png']),
  NOTARY_DISCLOSURE: new Set(['application/pdf', 'image/jpeg', 'image/png']),
  COMPLAINT: new Set([
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ]),
  AUTHORIZATION: new Set([
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ]),
  MAIL_RECEIPT: new Set(['application/pdf', 'image/jpeg', 'image/png']),
  FILING_EVIDENCE: new Set([
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'image/jpeg',
    'image/png',
  ]),
  FILING_SCREENSHOT: new Set(['application/pdf', 'image/jpeg', 'image/png']),
  ACCEPTANCE_NOTICE: new Set(['application/pdf', 'image/jpeg', 'image/png']),
  PAYMENT_LIST: new Set(['application/pdf', 'image/jpeg', 'image/png']),
  SERVICE_DOCUMENT: new Set(['application/pdf', 'image/jpeg', 'image/png']),
  JUDGMENT: new Set(['application/pdf', 'image/jpeg', 'image/png']),
  SECOND_INSTANCE_DOCUMENT: new Set([
    'application/pdf',
    'image/jpeg',
    'image/png',
  ]),
  SECOND_INSTANCE_SERVICE: new Set([
    'application/pdf',
    'image/jpeg',
    'image/png',
  ]),
  SECOND_INSTANCE_JUDGMENT: new Set([
    'application/pdf',
    'image/jpeg',
    'image/png',
  ]),
  EXECUTION_FINISH_BASIS: new Set([
    'application/pdf',
    'image/jpeg',
    'image/png',
  ]),
  CASE_CLOSURE_DOCUMENT: new Set([
    'application/pdf',
    'image/jpeg',
    'image/png',
  ]),
  EXECUTION_FILING_PROOF: new Set([
    'application/pdf',
    'image/jpeg',
    'image/png',
  ]),
  EXECUTION_SUPPLEMENT: new Set(['application/pdf', 'image/jpeg', 'image/png']),
  EXECUTION_APPLICATION: new Set([
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ]),
} as const;

@Injectable()
export class MaterialService {
  private readonly clock: () => Date;
  private readonly validatedVersionFacts = new WeakMap<
    ValidatedMaterialVersionFact,
    {
      transaction: MaterialTransactionClient;
      canonicalFact: CanonicalMaterialVersionFact;
      firstUploadTarget?: CaseSectionRecordUploadTarget;
      sectionFreezeEventId?: string;
      executionSupplementTarget?: ExecutionSupplementUploadTarget;
      supplementFreezeEventId?: string;
    }
  >();

  constructor(
    private readonly database: DatabaseService,
    private readonly accessControl: AccessControlService,
    @Inject(PRIVATE_BLOB_STORAGE)
    private readonly storage: PrivateBlobStorage,
    private readonly storageKeyCoordinator: MaterialStorageKeyCoordinator,
    @Optional()
    @Inject(MATERIAL_SERVICE_CLOCK)
    clock?: () => Date,
    @Optional() private readonly organization?: OrganizationService,
  ) {
    this.clock = clock ?? (() => new Date());
  }

  async createExecutionSupplementUploadDraft(
    actor: ActorContext,
    caseId: string,
    target: ExecutionSupplementUploadTarget,
    file: Readonly<{ originalFilename: string; declaredMimeType: string }>,
  ): Promise<ExecutionSupplementUploadDraftResultDto> {
    const originalFilename = this.normalizeFilename(file.originalFilename);
    const declaredMimeType = normalizeMimeType(file.declaredMimeType);
    if (
      !isMimeAllowedForPurpose(
        'EXECUTION_SUPPLEMENT',
        'EXECUTION_SUPPLEMENT',
        declaredMimeType,
      )
    )
      throw this.invalidVersion();
    const createdAt = this.clock();
    return this.database.$transaction(async (tx) => {
      const bindingId = await this.assertExecutionSupplementTarget(
        tx,
        actor,
        caseId,
        target,
      );
      const draft = await tx.uploadDraft.create({
        data: {
          departmentId: actor.departmentId,
          actorUserId: actor.userId,
          ...(bindingId === undefined
            ? { internalActorUserId: actor.userId }
            : { lawyerAccountBindingId: bindingId }),
          ownerType: 'CASE',
          ownerId: caseId,
          category: 'EXECUTION_SUPPLEMENT',
          purpose: 'EXECUTION_SUPPLEMENT',
          originalFilename,
          declaredMimeType,
          createdAt,
          expiresAt: new Date(createdAt.getTime() + DAY_MS),
          executionSupplementFilingId: target.filingId,
          executionSupplementTargetId: target.supplementId,
          executionSupplementRevision: target.expectedRevision,
        },
      });
      return {
        id: draft.id,
        ownerType: 'CASE',
        ownerId: caseId,
        category: 'EXECUTION_SUPPLEMENT',
        purpose: 'EXECUTION_SUPPLEMENT',
        originalFilename,
        declaredMimeType,
        expiresAt: draft.expiresAt.toISOString(),
        executionSupplement: { ...target },
      };
    });
  }

  private async validateExecutionSupplementUploadDraft(
    tx: MaterialTransactionClient,
    actor: ActorContext,
    draft: UploadDraft,
    pendingStorageKey: string | null,
  ) {
    const original = this.executionSupplementUploadTarget(draft);
    if (original === undefined) throw this.invalidVersion();
    const bindingId = await this.assertExecutionSupplementTarget(
      tx,
      actor,
      draft.ownerId,
      original,
    );
    const current = await tx.uploadDraft.findUnique({
      where: { id: draft.id },
    });
    const target = current && this.executionSupplementUploadTarget(current);
    if (
      !current ||
      !target ||
      !this.sameExecutionSupplementTarget(target, original) ||
      current.departmentId !== actor.departmentId ||
      current.actorUserId !== actor.userId ||
      current.ownerId !== draft.ownerId ||
      current.category !== draft.category ||
      current.purpose !== draft.purpose ||
      current.originalFilename !== draft.originalFilename ||
      current.declaredMimeType !== draft.declaredMimeType ||
      current.internalActorUserId !==
        (bindingId === undefined ? actor.userId : null) ||
      current.lawyerAccountBindingId !== (bindingId ?? null)
    )
      throw this.invalidVersion();
    if (
      current.status !== 'OPEN' ||
      current.expiresAt <= this.clock() ||
      current.pendingStorageKey !== pendingStorageKey
    )
      throw this.versionConflict();
  }

  async createCaseSectionRecordUploadDraft(
    actor: ActorContext,
    caseId: string,
    target: CaseSectionRecordUploadTarget,
    file: Readonly<{ originalFilename: string; declaredMimeType: string }>,
  ) {
    const originalFilename = this.normalizeFilename(file.originalFilename);
    const declaredMimeType = normalizeMimeType(file.declaredMimeType);
    const category = sectionRecordMaterials[target.kind]?.category;
    if (
      !category ||
      !isMimeAllowedForPurpose(category, category, declaredMimeType)
    )
      throw this.invalidVersion();
    const createdAt = this.clock();
    return this.database.$transaction(async (tx) => {
      await this.assertSectionRecordTarget(tx, actor, caseId, target);
      const draft = await tx.uploadDraft.create({
        data: {
          departmentId: actor.departmentId,
          actorUserId: actor.userId,
          internalActorUserId: actor.userId,
          ownerType: 'CASE',
          ownerId: caseId,
          category,
          purpose: category,
          originalFilename,
          declaredMimeType,
          createdAt,
          expiresAt: new Date(createdAt.getTime() + DAY_MS),
          caseSectionRecordCommand: sectionRecordUploads[target.kind].command,
          caseSectionRecordTargetId: target.targetId,
          caseSectionRecordRevision: target.expectedRevision,
          caseSectionRecordTrialRoundId:
            target.kind === 'JUDGMENT' ? target.trialRoundId : null,
          caseSectionRecordClosureVersionId:
            target.kind === 'CLOSURE' ? target.expectedClosureVersionId : null,
        },
      });
      return {
        id: draft.id,
        ownerType: 'CASE' as const,
        ownerId: caseId,
        category,
        purpose: category,
        originalFilename,
        declaredMimeType,
        expiresAt: draft.expiresAt.toISOString(),
        recordCorrection: target,
      };
    });
  }

  private sectionRecordUploadTarget(
    draft: UploadDraft,
  ): CaseSectionRecordUploadTarget | undefined {
    if (draft.caseSectionRecordCommand == null) {
      if (
        draft.caseSectionRecordTargetId != null ||
        draft.caseSectionRecordRevision != null ||
        draft.caseSectionRecordTrialRoundId != null ||
        draft.caseSectionRecordClosureVersionId != null
      )
        throw this.invalidVersion();
      return undefined;
    }
    const kind = (
      Object.keys(sectionRecordUploads) as CaseSectionRecordKind[]
    ).find(
      (key) =>
        sectionRecordUploads[key].command === draft.caseSectionRecordCommand,
    );
    if (
      !kind ||
      !draft.caseSectionRecordTargetId ||
      draft.caseSectionRecordRevision == null ||
      draft.ownerType !== 'CASE' ||
      draft.internalActorUserId !== draft.actorUserId ||
      draft.customerAccountBindingId != null ||
      draft.notaryOfficeAccountBindingId != null ||
      draft.lawyerAccountBindingId != null ||
      draft.category !== sectionRecordMaterials[kind].category ||
      draft.purpose !== draft.category
    )
      throw this.invalidVersion();
    const base = {
      targetId: draft.caseSectionRecordTargetId,
      expectedRevision: draft.caseSectionRecordRevision,
    };
    if (kind === 'JUDGMENT') {
      if (
        !draft.caseSectionRecordTrialRoundId ||
        draft.caseSectionRecordClosureVersionId != null
      )
        throw this.invalidVersion();
      return {
        ...base,
        kind,
        trialRoundId: draft.caseSectionRecordTrialRoundId,
      };
    }
    if (kind === 'CLOSURE') {
      if (
        !draft.caseSectionRecordClosureVersionId ||
        draft.caseSectionRecordTrialRoundId != null
      )
        throw this.invalidVersion();
      return {
        ...base,
        kind,
        expectedClosureVersionId: draft.caseSectionRecordClosureVersionId,
      };
    }
    if (
      draft.caseSectionRecordTrialRoundId != null ||
      draft.caseSectionRecordClosureVersionId != null
    )
      throw this.invalidVersion();
    return { ...base, kind };
  }

  private sameSectionRecordTarget(
    a: CaseSectionRecordUploadTarget,
    b: CaseSectionRecordUploadTarget,
  ): boolean {
    return (
      a.kind === b.kind &&
      a.targetId === b.targetId &&
      a.expectedRevision === b.expectedRevision &&
      (a.kind !== 'JUDGMENT' ||
        (b.kind === 'JUDGMENT' && a.trialRoundId === b.trialRoundId)) &&
      (a.kind !== 'CLOSURE' ||
        (b.kind === 'CLOSURE' &&
          a.expectedClosureVersionId === b.expectedClosureVersionId))
    );
  }

  private async lockSectionRecordCase(
    tx: MaterialTransactionClient,
    actor: ActorContext,
    caseId: string,
  ) {
    if (
      actor.clientCustomerId !== undefined ||
      actor.notaryOfficeId !== undefined ||
      actor.lawyerAccountId !== undefined
    )
      throw this.forbidden();
    const rows = await tx.$queryRawUnsafe<Array<{ id: string }>>(
      'SELECT "id" FROM "cases" WHERE "id"=$1::uuid AND "department_id"=$2::uuid FOR UPDATE',
      caseId,
      actor.departmentId,
    );
    if (rows.length !== 1) throw this.notFound();
  }

  private async assertSectionRecordTarget(
    tx: MaterialTransactionClient,
    actor: ActorContext,
    caseId: string,
    target: CaseSectionRecordUploadTarget,
    lock = true,
  ) {
    if (lock) await this.lockSectionRecordCase(tx, actor, caseId);
    if (
      actor.clientCustomerId !== undefined ||
      actor.notaryOfficeId !== undefined ||
      actor.lawyerAccountId !== undefined
    )
      throw this.forbidden();
    if (
      !Number.isSafeInteger(target.expectedRevision) ||
      target.expectedRevision < 0 ||
      !sectionRecordUploads[target.kind]
    )
      throw this.invalidVersion();
    const record = await tx.case.findFirst({
      where: { id: caseId, departmentId: actor.departmentId },
      select: {
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
    if (!account?.active || account.accountType !== 'INTERNAL')
      throw this.forbidden();
    await this.accessControl.authorizeCase(
      actor,
      sectionRecordUploads[target.kind].action,
      {
        departmentId: record.departmentId,
        responsibleUserId: record.responsibleUserId,
        ...(record.responsibleMembership.teamId
          ? { teamId: record.responsibleMembership.teamId }
          : {}),
      },
      tx,
    );
    const scope = { caseId, departmentId: actor.departmentId };
    const where = { ...scope, id: target.targetId };
    let revision: number;
    switch (target.kind) {
      case 'EXECUTION_MAILING': {
        if (
          (await tx.caseExecutionMailing.findFirst({
            where,
            select: { id: true },
          })) === null
        )
          throw this.notFound();
        revision =
          (
            await tx.caseExecutionMailingRecordCorrection.findFirst({
              where: { ...scope, mailingId: target.targetId },
              orderBy: { toRevision: 'desc' },
              select: { toRevision: true },
            })
          )?.toRevision ?? 0;
        break;
      }
      case 'EXECUTION_FILING': {
        if (
          (await tx.caseExecutionFiling.findFirst({
            where,
            select: { id: true },
          })) === null
        )
          throw this.notFound();
        revision =
          (
            await tx.caseExecutionFilingRecordCorrection.findFirst({
              where: { ...scope, filingId: target.targetId },
              orderBy: { toRevision: 'desc' },
              select: { toRevision: true },
            })
          )?.toRevision ?? 0;
        break;
      }
      case 'EXECUTION_FINISH': {
        if (
          (await tx.caseExecutionFinish.findFirst({
            where,
            select: { id: true },
          })) === null
        )
          throw this.notFound();
        revision =
          (
            await tx.caseExecutionFinishRecordCorrection.findFirst({
              where: { ...scope, finishId: target.targetId },
              orderBy: { toRevision: 'desc' },
              select: { toRevision: true },
            })
          )?.toRevision ?? 0;
        break;
      }
      case 'JUDGMENT': {
        if (
          (await tx.caseJudgmentFact.findFirst({
            where: { ...where, trialRoundId: target.trialRoundId },
            select: { id: true },
          })) === null
        )
          throw this.notFound();
        revision =
          (
            await tx.caseJudgmentRecordCorrection.findFirst({
              where: {
                ...scope,
                judgmentId: target.targetId,
                trialRoundId: target.trialRoundId,
              },
              orderBy: { toRevision: 'desc' },
              select: { toRevision: true },
            })
          )?.toRevision ?? 0;
        break;
      }
      case 'CLOSURE': {
        const closure = await tx.caseClosure.findFirst({
          where,
          select: { currentVersionId: true },
        });
        if (closure === null) throw this.notFound();
        if (
          closure.currentVersionId !== target.expectedClosureVersionId ||
          (await tx.caseClosureVersion.findFirst({
            where: {
              ...scope,
              closureId: target.targetId,
              id: target.expectedClosureVersionId,
            },
            select: { id: true },
          })) === null
        )
          throw this.versionConflict();
        const head = await tx.caseClosureRecordCorrection.findFirst({
          where: { ...scope, closureId: target.targetId },
          orderBy: { toRevision: 'desc' },
          select: { toRevision: true, sourceClosureVersionId: true },
        });
        if (
          head &&
          head.sourceClosureVersionId !== target.expectedClosureVersionId
        )
          throw this.versionConflict();
        revision = head?.toRevision ?? 0;
        break;
      }
    }
    if (revision !== target.expectedRevision) throw this.versionConflict();
  }

  private async hasSectionUploadFirstFreeze(
    tx: MaterialTransactionClient,
    versionId: string,
  ) {
    const rows = await tx.$queryRawUnsafe<Array<{ consumed: boolean }>>(
      'SELECT case_section_upload_has_first_freeze($1::uuid) AS consumed',
      versionId,
    );
    return rows.length === 1 && rows[0]?.consumed === true;
  }

  private async sectionUploadPendingCount(
    tx: MaterialTransactionClient,
    actor: ActorContext,
    draft: UploadDraft,
  ): Promise<number> {
    const rows = await tx.$queryRawUnsafe<Array<{ count: number }>>(
      "SELECT count(*)::integer AS count FROM materials m WHERE m.department_id=$1::uuid AND m.owner_type='CASE' AND m.owner_id=$2::uuid AND m.category=$3::material_category AND m.status='ACTIVE' AND NOT case_section_upload_current_is_frozen(m.id,$2::uuid,$1::uuid,$3::text)",
      actor.departmentId,
      draft.ownerId,
      draft.category,
    );
    const count = rows[0]?.count;
    if (
      rows.length !== 1 ||
      !Number.isSafeInteger(count) ||
      count === undefined ||
      count < 0
    )
      throw this.invalidVersion();
    return count;
  }

  private async validateSectionUploadDraft(
    tx: MaterialTransactionClient,
    actor: ActorContext,
    draft: UploadDraft,
    pendingStorageKey: string | null,
  ) {
    await this.lockSectionRecordCase(tx, actor, draft.ownerId);
    const current = await tx.uploadDraft.findUnique({
      where: { id: draft.id },
    });
    const target = current && this.sectionRecordUploadTarget(current);
    const original = this.sectionRecordUploadTarget(draft);
    if (
      !current ||
      !target ||
      !original ||
      current.departmentId !== actor.departmentId ||
      current.actorUserId !== actor.userId ||
      current.ownerId !== draft.ownerId ||
      !this.sameSectionRecordTarget(original, target)
    )
      throw this.invalidVersion();
    if (
      current.status !== 'OPEN' ||
      current.expiresAt <= this.clock() ||
      current.pendingStorageKey !== pendingStorageKey
    )
      throw this.versionConflict();
    await this.assertSectionRecordTarget(
      tx,
      actor,
      current.ownerId,
      target,
      false,
    );
  }

  async createUploadDraft(actor: ActorContext, input: CreateUploadDraftDto) {
    if (input.category === 'EXECUTION_SUPPLEMENT') throw this.validationError();
    this.assertCategoryPurposeMatrix(input);
    const originalFilename = this.normalizeFilename(input.originalFilename);
    const declaredMimeType = normalizeMimeType(input.declaredMimeType);
    if (
      !isMimeAllowedForPurpose(input.category, input.purpose, declaredMimeType)
    ) {
      throw this.validationError();
    }
    const now = this.clock();
    let expiresAt = new Date(now.getTime() + DAY_MS);
    let ownerId: string;
    let notaryOfficeAccountBindingId: string | undefined;
    let customerAccountBindingId: string | undefined;
    let lawyerAccountBindingId: string | undefined;
    if (input.ownerType === 'CUSTOMER') {
      if (input.ownerId === undefined) throw this.validationError();
      await this.authorizeOwner(
        actor,
        'CUSTOMER',
        input.ownerId,
        'write',
        this.database,
        undefined,
        undefined,
        input.category,
      );
      ownerId = input.ownerId;
    } else if (input.ownerType === 'CASE') {
      if (input.ownerId === undefined) throw this.validationError();
      await this.authorizeOwner(
        actor,
        'CASE',
        input.ownerId,
        'write',
        this.database,
        undefined,
        undefined,
        input.category,
      );
      if (actor.clientCustomerId !== undefined) {
        const binding = await this.database.customerAccountBinding.findFirst({
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
        if (binding === null) throw this.forbidden();
        customerAccountBindingId = binding.id;
      }
      if (actor.lawyerAccountId !== undefined) {
        lawyerAccountBindingId = await currentLawyerBindingId(
          this.database,
          actor,
          input.ownerId,
        );
      }
      ownerId = input.ownerId;
    } else if (input.ownerType === 'NOTARY_MATTER') {
      if (input.ownerId === undefined) throw this.validationError();
      await this.authorizeOwner(
        actor,
        'NOTARY_MATTER',
        input.ownerId,
        'write',
        this.database,
        undefined,
        undefined,
        input.category,
      );
      if (actor.notaryOfficeId !== undefined) {
        const binding =
          await this.database.notaryOfficeAccountBinding.findFirst({
            where: {
              userId: actor.userId,
              departmentId: actor.departmentId,
              notaryOfficeId: actor.notaryOfficeId,
              active: true,
              notaryOffice: { status: 'ACTIVE' },
              user: { active: true, accountType: 'NOTARY' },
            },
            select: { id: true },
          });
        if (binding == null) throw this.forbidden();
        notaryOfficeAccountBindingId = binding.id;
      }
      ownerId = input.ownerId;
    } else {
      if (!(await this.accessControl.canAuthorizeNewLead(actor))) {
        throw this.forbidden();
      }
      if (input.ownerId === undefined) {
        ownerId = randomUUID();
      } else {
        const existing = await this.database.uploadDraft.findFirst({
          where: {
            departmentId: actor.departmentId,
            actorUserId: actor.userId,
            ownerType: 'LEAD_DRAFT',
            ownerId: input.ownerId,
            category: 'LEAD_SCREENSHOT',
            expiresAt: { gt: now },
          },
          select: { id: true, expiresAt: true },
        });
        if (existing === null) throw this.forbidden();
        ownerId = input.ownerId;
        expiresAt = existing.expiresAt;
      }
    }

    const draftData = {
      departmentId: actor.departmentId,
      actorUserId: actor.userId,
      ...(notaryOfficeAccountBindingId === undefined
        ? {}
        : { notaryOfficeAccountBindingId }),
      ...(customerAccountBindingId === undefined
        ? {}
        : { customerAccountBindingId }),
      ...(lawyerAccountBindingId === undefined
        ? {}
        : { lawyerAccountBindingId }),
      ownerType: input.ownerType,
      ownerId,
      category: input.category,
      purpose: input.purpose,
      originalFilename,
      declaredMimeType,
      expiresAt,
    };
    const draft =
      input.ownerType === 'CUSTOMER'
        ? await this.database.$transaction(async (transaction) => {
            if (input.category === 'CUSTOMER_AGREEMENT') {
              if (!this.organization)
                throw new Error('OrganizationService unavailable');
              await lockCustomerActorFacts(
                transaction,
                this.organization,
                actor,
              );
              await this.authorizeOwner(
                actor,
                'CUSTOMER',
                ownerId,
                'write',
                transaction,
                transaction,
                undefined,
                input.category,
              );
            }
            const locked = await transaction.$queryRawUnsafe<
              Array<{ id: string }>
            >(
              'SELECT "id" FROM "customers" WHERE "id" = $1::uuid AND "department_id" = $2::uuid FOR UPDATE',
              ownerId,
              actor.departmentId,
            );
            if (locked.length !== 1) throw this.notFound();
            await this.authorizeOwner(
              actor,
              'CUSTOMER',
              ownerId,
              'write',
              transaction,
              transaction,
              undefined,
              input.category,
            );
            return transaction.uploadDraft.create({ data: draftData });
          })
        : input.category === 'FEE_PROOF'
          ? await this.database.$transaction(
              async (transaction) => {
                await this.lockFeeMaterialActor(transaction, actor);
                await this.authorizeOwner(
                  actor,
                  'CASE',
                  ownerId,
                  'write',
                  transaction,
                  transaction,
                  undefined,
                  'FEE_PROOF',
                );
                return transaction.uploadDraft.create({ data: draftData });
              },
              { isolationLevel: 'Serializable' },
            )
          : await this.database.uploadDraft.create({ data: draftData });
    return {
      id: draft.id,
      ownerType: draft.ownerType,
      ownerId: draft.ownerId,
      ...(input.ownerType === 'LEAD_DRAFT'
        ? { reservedOwnerId: draft.ownerId }
        : {}),
      category: draft.category,
      purpose: input.purpose,
      originalFilename: draft.originalFilename,
      declaredMimeType: draft.declaredMimeType,
      expiresAt: draft.expiresAt.toISOString(),
    };
  }

  async finalizeUpload(
    actor: ActorContext,
    draftId: string,
    source: NodeJS.ReadableStream,
  ) {
    const draft = await this.database.uploadDraft.findUnique({
      where: { id: draftId },
    });
    if (draft === null) throw this.notFound();
    const recordTarget = this.sectionRecordUploadTarget(draft);
    const supplementTarget = this.executionSupplementUploadTarget(draft);
    if (
      draft.departmentId !== actor.departmentId ||
      draft.actorUserId !== actor.userId
    ) {
      throw this.forbidden();
    }
    if (draft.status !== 'OPEN' || draft.expiresAt <= this.clock()) {
      throw this.versionConflict();
    }
    this.assertCategoryPurposeMatrix(draft);
    if (
      actor.notaryOfficeId !== undefined &&
      draft.notaryOfficeAccountBindingId === null
    )
      throw this.forbidden();
    if (actor.clientCustomerId !== undefined) {
      if (
        draft.ownerType !== 'CASE' ||
        draft.category !== 'MAIL_RECEIPT' ||
        draft.customerAccountBindingId == null
      )
        throw this.forbidden();
      const binding = await this.database.customerAccountBinding.findFirst({
        where: {
          id: draft.customerAccountBindingId,
          userId: actor.userId,
          customerId: actor.clientCustomerId,
          departmentId: actor.departmentId,
          active: true,
          user: { active: true, accountType: 'CLIENT' },
          customer: { profileStatus: 'ADMITTED' },
        },
        select: { id: true },
      });
      if (binding === null) throw this.forbidden();
    } else if (draft.customerAccountBindingId != null) {
      throw this.forbidden();
    }
    if (actor.lawyerAccountId !== undefined) {
      if (draft.ownerType !== 'CASE' || draft.lawyerAccountBindingId === null)
        throw this.forbidden();
      const bindingId = await currentLawyerBindingId(
        this.database,
        actor,
        draft.ownerId,
      );
      if (bindingId !== draft.lawyerAccountBindingId) throw this.forbidden();
    } else if (draft.lawyerAccountBindingId !== null) {
      throw this.forbidden();
    }
    if (draft.ownerType === 'CUSTOMER') {
      await this.authorizeOwner(
        actor,
        'CUSTOMER',
        draft.ownerId,
        'write',
        this.database,
        undefined,
        undefined,
        draft.category,
      );
    } else if (draft.ownerType === 'CASE') {
      if (recordTarget === undefined && supplementTarget === undefined)
        await this.authorizeOwner(
          actor,
          'CASE',
          draft.ownerId,
          'write',
          this.database,
          undefined,
          undefined,
          draft.category,
        );
    } else if (draft.ownerType === 'NOTARY_MATTER') {
      await this.authorizeOwner(
        actor,
        'NOTARY_MATTER',
        draft.ownerId,
        'write',
        this.database,
        undefined,
        undefined,
        draft.category,
      );
    } else if (
      draft.ownerType !== 'LEAD_DRAFT' ||
      !(await this.accessControl.canAuthorizeNewLead(actor))
    ) {
      throw this.forbidden();
    }
    const originalFilename = this.normalizeFilename(draft.originalFilename);
    const declaredMimeType = normalizeMimeType(draft.declaredMimeType);
    if (
      !isMimeAllowedForPurpose(draft.category, draft.purpose, declaredMimeType)
    ) {
      throw this.invalidVersion();
    }
    if ((await this.storage.health()) !== 'ready') {
      throw this.storageUnavailable();
    }

    const materialId = randomUUID();
    const contentVersionId = randomUUID();
    const storageKey = `${actor.departmentId}/${materialId}/${contentVersionId}`;
    return this.storageKeyCoordinator.withKey(storageKey, async () => {
      let pendingClaimed = false;
      try {
        const claimInput = {
          where: {
            id: draft.id,
            departmentId: actor.departmentId,
            actorUserId: actor.userId,
            ownerType: draft.ownerType,
            ownerId: draft.ownerId,
            category: draft.category,
            purpose: draft.purpose,
            status: 'OPEN' as const,
            expiresAt: { gt: this.clock() },
            pendingStorageKey: null,
          },
          data: { pendingStorageKey: storageKey },
        };
        const claimed =
          recordTarget === undefined && supplementTarget === undefined
            ? await this.database.uploadDraft.updateMany(claimInput)
            : await this.database.$transaction(async (tx) => {
                if (supplementTarget !== undefined)
                  await this.validateExecutionSupplementUploadDraft(
                    tx,
                    actor,
                    draft,
                    null,
                  );
                else
                  await this.validateSectionUploadDraft(tx, actor, draft, null);
                return tx.uploadDraft.updateMany(claimInput);
              });
        if (claimed.count !== 1) throw this.versionConflict();
        pendingClaimed = true;
        const blob = await this.storage.put(
          storageKey,
          source,
          materialFileLimit(draft.category),
        );
        if (
          blob.detectedMimeType !== declaredMimeType ||
          !isMimeAllowedForPurpose(
            draft.category,
            draft.purpose,
            blob.detectedMimeType,
          )
        ) {
          throw this.invalidVersion();
        }
        await this.database.$transaction(async (transaction) => {
          if (draft.category === 'FEE_PROOF')
            await this.lockFeeMaterialActor(transaction, actor);
          if (draft.ownerType === 'CUSTOMER') {
            if (draft.category === 'CUSTOMER_AGREEMENT') {
              if (!this.organization)
                throw new Error('OrganizationService unavailable');
              await lockCustomerActorFacts(
                transaction,
                this.organization,
                actor,
              );
              await this.authorizeOwner(
                actor,
                'CUSTOMER',
                draft.ownerId,
                'write',
                transaction,
                transaction,
                undefined,
                draft.category,
              );
            }
            const locked = await transaction.$queryRawUnsafe<
              Array<{ id: string }>
            >(
              'SELECT "id" FROM "customers" WHERE "id" = $1::uuid AND "department_id" = $2::uuid FOR UPDATE',
              draft.ownerId,
              actor.departmentId,
            );
            if (locked.length !== 1) throw this.notFound();
            await this.authorizeOwner(
              actor,
              'CUSTOMER',
              draft.ownerId,
              'write',
              transaction,
              transaction,
              undefined,
              draft.category,
            );
          }
          if (draft.ownerType === 'CASE') {
            const locked = await transaction.$queryRawUnsafe<
              Array<{ id: string }>
            >(
              'SELECT "id" FROM "cases" WHERE "id" = $1::uuid AND "department_id" = $2::uuid FOR UPDATE',
              draft.ownerId,
              actor.departmentId,
            );
            if (locked.length !== 1) throw this.notFound();
            if (supplementTarget !== undefined) {
              await this.validateExecutionSupplementUploadDraft(
                transaction,
                actor,
                draft,
                storageKey,
              );
            } else if (recordTarget !== undefined) {
              await this.validateSectionUploadDraft(
                transaction,
                actor,
                draft,
                storageKey,
              );
            } else
              await this.authorizeOwner(
                actor,
                'CASE',
                draft.ownerId,
                'write',
                transaction,
                transaction,
                undefined,
                draft.category,
              );
            if (actor.lawyerAccountId !== undefined) {
              const bindingId = await currentLawyerBindingId(
                transaction,
                actor,
                draft.ownerId,
                true,
              );
              if (bindingId !== draft.lawyerAccountBindingId)
                throw this.forbidden();
            }
          }
          if (actor.notaryOfficeId !== undefined) {
            const locked = await transaction.$queryRawUnsafe<
              Array<{ id: string }>
            >(
              'SELECT "id" FROM "notary_matters" WHERE "id" = $1::uuid AND "department_id" = $2::uuid AND "notary_office_id" = $3::uuid FOR UPDATE',
              draft.ownerId,
              actor.departmentId,
              actor.notaryOfficeId,
            );
            if (locked.length !== 1) throw this.notFound();
            await this.authorizeOwner(
              actor,
              draft.ownerType,
              draft.ownerId,
              'write',
              transaction,
              transaction,
              undefined,
              draft.category,
            );
            const binding =
              await transaction.notaryOfficeAccountBinding.findFirst({
                where: {
                  id: draft.notaryOfficeAccountBindingId ?? undefined,
                  userId: actor.userId,
                  departmentId: actor.departmentId,
                  notaryOfficeId: actor.notaryOfficeId,
                  active: true,
                  notaryOffice: { status: 'ACTIVE' },
                  user: { active: true, accountType: 'NOTARY' },
                },
                select: { id: true },
              });
            if (binding === null) throw this.forbidden();
          }
          await transaction.$executeRawUnsafe(
            'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
            ownerQuotaKey(draft),
          );
          const dedicatedPendingPool =
            recordTarget !== undefined &&
            [
              'EXECUTION_FILING_PROOF',
              'EXECUTION_FINISH_BASIS',
              'CASE_CLOSURE_DOCUMENT',
            ].includes(draft.category);
          const activeCount =
            supplementTarget !== undefined
              ? await this.executionSupplementPendingCount(
                  transaction,
                  actor,
                  draft,
                )
              : dedicatedPendingPool
                ? await this.sectionUploadPendingCount(
                    transaction,
                    actor,
                    draft,
                  )
                : await transaction.material.count({
                    where: {
                      departmentId: actor.departmentId,
                      ownerType: draft.ownerType,
                      ownerId: draft.ownerId,
                      category: draft.category,
                      status: 'ACTIVE',
                      ...(draft.category === 'FEE_PROOF'
                        ? { references: { none: { purpose: 'FEE_PROOF' } } }
                        : {}),
                      ...(draft.category === 'MAIL_RECEIPT'
                        ? {
                            currentVersion: {
                              is: {
                                materialReferences: {
                                  none: {
                                    purpose: 'MAIL_RECEIPT',
                                    actionEventId: { not: null },
                                  },
                                },
                              },
                            },
                          }
                        : draft.category === 'JUDGMENT'
                          ? {
                              contentVersions: {
                                none: {
                                  OR: [
                                    { caseJudgmentVersions: { some: {} } },
                                    { judgmentRecordDocuments: { some: {} } },
                                  ],
                                },
                              },
                            }
                          : draft.category === 'CUSTOMER_RIGHT_EVIDENCE'
                            ? {
                                currentVersion: {
                                  is: {
                                    materialReferences: {
                                      none: { assetVersionId: { not: null } },
                                    },
                                  },
                                },
                              }
                            : draft.category === 'CUSTOMER_AGREEMENT'
                              ? {
                                  currentVersion: {
                                    is: {
                                      materialReferences: {
                                        none: { purpose: 'CUSTOMER_AGREEMENT' },
                                      },
                                    },
                                  },
                                }
                              : {}),
                    },
                  });
          if (activeCount >= materialLimit(draft.category)) {
            throw this.validationError();
          }
          await transaction.material.create({
            data: {
              id: materialId,
              departmentId: actor.departmentId,
              ownerType: draft.ownerType,
              ownerId: draft.ownerId,
              category: draft.category,
              purpose: draft.purpose,
            },
          });
          await transaction.contentVersion.create({
            data: {
              id: contentVersionId,
              materialId,
              storageKey,
              originalFilename,
              mimeType: blob.detectedMimeType,
              sizeBytes: BigInt(blob.sizeBytes),
              sha256: blob.sha256,
              uploadedBy: actor.userId,
              ...(recordTarget === undefined
                ? {}
                : { caseSectionRecordUploadDraftId: draft.id }),
              ...(supplementTarget === undefined
                ? {}
                : { executionSupplementUploadDraftId: draft.id }),
            },
          });
          await transaction.material.update({
            where: { id: materialId },
            data: { currentVersionId: contentVersionId },
          });
          const finalized = await transaction.uploadDraft.updateMany({
            where: {
              id: draft.id,
              departmentId: actor.departmentId,
              actorUserId: actor.userId,
              ownerType: draft.ownerType,
              ownerId: draft.ownerId,
              category: draft.category,
              purpose: draft.purpose,
              status: 'OPEN',
              expiresAt: { gt: this.clock() },
              pendingStorageKey: storageKey,
            },
            data: { status: 'FINALIZED', pendingStorageKey: null },
          });
          if (finalized.count !== 1) throw this.versionConflict();
        });
        return {
          materialId,
          contentVersionId,
          reservedOwnerId:
            draft.ownerType === 'LEAD_DRAFT' ? draft.ownerId : undefined,
          originalFilename,
          purpose: draft.purpose,
          mimeType: blob.detectedMimeType,
          sizeBytes: blob.sizeBytes,
          sha256: blob.sha256,
          ...(recordTarget === undefined
            ? {}
            : { recordCorrection: recordTarget }),
          ...(supplementTarget === undefined
            ? {}
            : { executionSupplement: supplementTarget }),
        };
      } catch (error) {
        let storageIsClean = false;
        if (pendingClaimed) {
          try {
            await this.storage.delete(storageKey);
            storageIsClean = true;
          } catch {
            // Keep the durable pending key for the cleanup service to retry.
          }
        }
        if (pendingClaimed && storageIsClean) {
          await this.database.uploadDraft
            .updateMany({
              where: { id: draft.id, pendingStorageKey: storageKey },
              data: { pendingStorageKey: null },
            })
            .catch(() => undefined);
        }
        if (error instanceof BlobValidationError) throw this.invalidVersion();
        if (error instanceof BlobStorageUnavailableError) {
          throw this.storageUnavailable();
        }
        throw error;
      }
    });
  }

  async assertAvailableVersions(
    transaction: MaterialTransactionClient,
    actor: ActorContext,
    input: AssertAvailableVersionsInput,
  ): Promise<readonly ValidatedMaterialVersionFact[]> {
    const contentVersionIds = [...input.contentVersionIds];
    const minCount = input.minCount ?? 1;
    const maxCount = input.maxCount ?? Number.MAX_SAFE_INTEGER;
    if (input.category === 'EXECUTION_SUPPLEMENT') {
      if (
        input.ownerType !== 'CASE' ||
        !input.executionSupplementTarget ||
        input.sectionRecordKind !== undefined ||
        input.sectionRecordTarget !== undefined ||
        minCount < 1 ||
        maxCount > 10
      )
        throw this.invalidVersion();
      await this.assertExecutionSupplementTarget(
        transaction,
        actor,
        input.ownerId,
        input.executionSupplementTarget,
      );
    } else if (input.executionSupplementTarget !== undefined)
      throw this.invalidVersion();
    if (
      input.sectionRecordKind !== undefined &&
      (input.ownerType !== 'CASE' ||
        actor.clientCustomerId !== undefined ||
        actor.notaryOfficeId !== undefined ||
        actor.lawyerAccountId !== undefined ||
        sectionRecordMaterials[input.sectionRecordKind]?.category !==
          input.category)
    )
      throw this.invalidVersion();
    if (
      input.sectionRecordTarget !== undefined &&
      input.sectionRecordTarget.kind !== input.sectionRecordKind
    )
      throw this.invalidVersion();
    if (
      !Number.isSafeInteger(minCount) ||
      !Number.isSafeInteger(maxCount) ||
      minCount < 0 ||
      maxCount < minCount ||
      contentVersionIds.length < minCount ||
      contentVersionIds.length > maxCount ||
      new Set(contentVersionIds).size !== contentVersionIds.length
    ) {
      throw this.invalidVersion();
    }
    if (
      input.leadAction !== undefined &&
      (input.ownerType === 'LEAD'
        ? !['lead.read', 'lead.edit', 'lead.evidence.decide'].includes(
            input.leadAction,
          )
        : input.ownerType !== 'NOTARY_MATTER' ||
          input.leadAction !== 'notary.unbox.record')
    ) {
      throw this.invalidVersion();
    }

    if (input.executionSupplementTarget === undefined)
      await this.authorizeOwner(
        actor,
        input.ownerType,
        input.ownerId,
        input.category === 'FEE_PROOF' ? 'write' : 'read',
        transaction,
        transaction,
        input.leadAction,
        input.category,
      );
    const materials = await transaction.material.findMany({
      where: {
        departmentId: actor.departmentId,
        ownerType: input.ownerType,
        ownerId: input.ownerId,
        category: input.category,
        status: 'ACTIVE',
      },
      select: {
        id: true,
        departmentId: true,
        ownerType: true,
        ownerId: true,
        category: true,
        purpose: true,
        currentVersionId: true,
        status: true,
        contentVersions: {
          where: {
            id: { in: contentVersionIds },
            status: 'AVAILABLE',
          },
          select: {
            id: true,
            mimeType: true,
            sizeBytes: true,
            status: true,
            uploadedBy: true,
            caseSectionRecordUploadDraft: true,
            executionSupplementUploadDraft: true,
          },
        },
      },
    });

    const facts = new Map<string, ValidatedMaterialVersionFact>();
    for (const material of materials) {
      if (
        material.departmentId !== actor.departmentId ||
        material.ownerType !== input.ownerType ||
        material.ownerId !== input.ownerId ||
        material.category !== input.category ||
        material.status !== 'ACTIVE'
      ) {
        throw this.invalidVersion();
      }
      for (const version of material.contentVersions) {
        const supplementDraft = version.executionSupplementUploadDraft;
        if (supplementDraft != null) {
          const supplementTarget =
            this.executionSupplementUploadTarget(supplementDraft);
          if (
            !supplementTarget ||
            supplementDraft.status !== 'FINALIZED' ||
            supplementDraft.departmentId !== material.departmentId ||
            supplementDraft.ownerId !== material.ownerId ||
            supplementDraft.ownerType !== material.ownerType ||
            supplementDraft.category !== material.category ||
            supplementDraft.purpose !== material.purpose ||
            supplementDraft.actorUserId !== version.uploadedBy
          )
            throw this.invalidVersion();
          if (
            !(await this.hasExecutionSupplementFirstFreeze(
              transaction,
              version.id,
              true,
            )) &&
            (!input.executionSupplementTarget ||
              supplementDraft.actorUserId !== actor.userId ||
              !this.sameExecutionSupplementTarget(
                supplementTarget,
                input.executionSupplementTarget,
              ))
          )
            throw this.invalidVersion();
        } else if (material.category === 'EXECUTION_SUPPLEMENT')
          throw this.invalidVersion();
        let firstUploadTarget: CaseSectionRecordUploadTarget | undefined;
        const uploadDraft = version.caseSectionRecordUploadDraft;
        if (uploadDraft != null) {
          const uploadTarget = this.sectionRecordUploadTarget(uploadDraft);
          if (
            !uploadTarget ||
            uploadDraft.status !== 'FINALIZED' ||
            uploadDraft.departmentId !== material.departmentId ||
            uploadDraft.ownerType !== material.ownerType ||
            uploadDraft.ownerId !== material.ownerId ||
            uploadDraft.category !== material.category ||
            uploadDraft.purpose !== material.purpose ||
            uploadDraft.actorUserId !== version.uploadedBy
          )
            throw this.invalidVersion();
          if (
            !(await this.hasSectionUploadFirstFreeze(transaction, version.id))
          ) {
            if (
              !input.sectionRecordTarget ||
              input.sectionRecordKind !== uploadTarget.kind ||
              uploadDraft.actorUserId !== actor.userId ||
              !this.sameSectionRecordTarget(
                uploadTarget,
                input.sectionRecordTarget,
              )
            )
              throw this.invalidVersion();
            await this.assertSectionRecordTarget(
              transaction,
              actor,
              input.ownerId,
              uploadTarget,
            );
            firstUploadTarget = uploadTarget;
          }
        }
        if (
          version.status !== 'AVAILABLE' ||
          (actor.notaryOfficeId !== undefined &&
            input.category === 'NOTARY_OPENING_PHOTO' &&
            version.uploadedBy !== actor.userId) ||
          facts.has(version.id) ||
          !contentVersionIds.includes(version.id) ||
          (input.ownerType === 'CASE' &&
            material.currentVersionId !== version.id &&
            !(await this.isFrozenCaseVersion(
              transaction,
              input.category,
              input.ownerId,
              actor.departmentId,
              material.id,
              version.id,
              input.sectionRecordKind,
            ))) ||
          (input.ownerType === 'CASE' &&
            input.category === 'MAIL_RECEIPT' &&
            actor.clientCustomerId !== undefined &&
            (version.uploadedBy !== actor.userId ||
              material.currentVersionId !== version.id ||
              (await transaction.materialReference.count({
                where: {
                  departmentId: actor.departmentId,
                  resourceType: 'case',
                  resourceId: input.ownerId,
                  materialId: material.id,
                  contentVersionId: version.id,
                  actionEventId: { not: null },
                },
              })) > 0))
        ) {
          throw this.invalidVersion();
        }
        const canonicalFact = Object.freeze({
          departmentId: material.departmentId,
          materialId: material.id,
          contentVersionId: version.id,
          purpose: material.purpose,
          mimeType: version.mimeType,
          sizeBytes: version.sizeBytes,
          ownerType: material.ownerType,
          ownerId: material.ownerId,
          category: material.category,
        });
        const fact = Object.freeze({
          ...canonicalFact,
        }) as ValidatedMaterialVersionFact;
        this.validatedVersionFacts.set(fact, {
          transaction,
          canonicalFact,
          ...(firstUploadTarget === undefined ? {} : { firstUploadTarget }),
          ...(input.executionSupplementTarget === undefined
            ? {}
            : {
                executionSupplementTarget: Object.freeze({
                  ...input.executionSupplementTarget,
                }),
              }),
        });
        facts.set(version.id, fact);
      }
    }
    if (facts.size !== contentVersionIds.length) {
      throw this.invalidVersion();
    }
    if (
      input.category === 'CUSTOMER_AGREEMENT' &&
      [...facts.values()].some((fact) => fact.purpose !== 'CUSTOMER_AGREEMENT')
    ) {
      throw this.invalidVersion();
    }
    return Object.freeze(
      contentVersionIds.map((contentVersionId) => {
        const fact = facts.get(contentVersionId);
        if (fact === undefined) throw this.invalidVersion();
        return fact;
      }),
    );
  }

  /** Selection and first-consumption validation run before E inserts its version. */
  async assertExecutionSupplementVersions(
    transaction: MaterialTransactionClient,
    actor: ActorContext,
    caseId: string,
    target: ExecutionSupplementUploadTarget,
    contentVersionIds: readonly string[],
  ): Promise<readonly ValidatedMaterialVersionFact[]> {
    return this.assertAvailableVersions(transaction, actor, {
      ownerType: 'CASE',
      ownerId: caseId,
      category: 'EXECUTION_SUPPLEMENT',
      contentVersionIds,
      minCount: 1,
      maxCount: 10,
      executionSupplementTarget: target,
    });
  }

  private sameExecutionSupplementTarget(
    a: ExecutionSupplementUploadTarget,
    b: ExecutionSupplementUploadTarget,
  ) {
    return (
      a.filingId.toLowerCase() === b.filingId.toLowerCase() &&
      a.supplementId.toLowerCase() === b.supplementId.toLowerCase() &&
      a.expectedRevision === b.expectedRevision
    );
  }

  private executionSupplementUploadTarget(
    draft: UploadDraft,
  ): ExecutionSupplementUploadTarget | undefined {
    if (
      draft.executionSupplementFilingId == null &&
      draft.executionSupplementTargetId == null &&
      draft.executionSupplementRevision == null
    )
      return undefined;
    if (
      !draft.executionSupplementFilingId ||
      !draft.executionSupplementTargetId ||
      draft.executionSupplementRevision == null ||
      !Number.isSafeInteger(draft.executionSupplementRevision) ||
      draft.executionSupplementRevision < 0 ||
      draft.ownerType !== 'CASE' ||
      draft.category !== 'EXECUTION_SUPPLEMENT' ||
      draft.purpose !== 'EXECUTION_SUPPLEMENT' ||
      draft.caseSectionRecordCommand != null ||
      draft.caseSectionRecordTargetId != null ||
      draft.caseSectionRecordRevision != null ||
      draft.caseSectionRecordTrialRoundId != null ||
      draft.caseSectionRecordClosureVersionId != null ||
      draft.customerAccountBindingId != null ||
      draft.notaryOfficeAccountBindingId != null ||
      (draft.internalActorUserId === draft.actorUserId &&
        draft.lawyerAccountBindingId == null) ===
        (draft.internalActorUserId == null &&
          draft.lawyerAccountBindingId != null)
    )
      throw this.invalidVersion();
    return {
      filingId: draft.executionSupplementFilingId,
      supplementId: draft.executionSupplementTargetId,
      expectedRevision: draft.executionSupplementRevision,
    };
  }

  private async assertExecutionSupplementTarget(
    tx: MaterialTransactionClient,
    actor: ActorContext,
    caseId: string,
    target: ExecutionSupplementUploadTarget,
    checkRevision: boolean | 'DELETE_PREPARATION' = true,
  ): Promise<string | undefined> {
    if (
      actor.clientCustomerId !== undefined ||
      actor.notaryOfficeId !== undefined
    )
      throw this.forbidden();
    if (
      !Number.isSafeInteger(target.expectedRevision) ||
      target.expectedRevision < 0
    )
      throw this.invalidVersion();
    const locked = await tx.$queryRawUnsafe<Array<{ id: string }>>(
      'SELECT "id" FROM "cases" WHERE "id"=$1::uuid AND "department_id"=$2::uuid FOR UPDATE',
      caseId,
      actor.departmentId,
    );
    if (locked.length !== 1) throw this.notFound();
    const record = await tx.case.findFirst({
      where: { id: caseId, departmentId: actor.departmentId },
      select: {
        departmentId: true,
        stage: true,
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
    let lawyerBindingId: string | undefined;
    if (actor.lawyerAccountId !== undefined && account.accountType === 'LAWYER')
      lawyerBindingId = await currentLawyerBindingId(tx, actor, caseId, true);
    else if (
      actor.lawyerAccountId === undefined &&
      account.accountType === 'INTERNAL'
    )
      await this.accessControl.authorizeCase(
        actor,
        target.expectedRevision === 0
          ? 'case.execution.supplement.submit'
          : 'case.execution.supplement.correct',
        {
          departmentId: record.departmentId,
          responsibleUserId: record.responsibleUserId,
          ...(record.responsibleMembership.teamId
            ? { teamId: record.responsibleMembership.teamId }
            : {}),
        },
        tx,
      );
    else throw this.forbidden();
    if (record.stage !== 'EXECUTING') throw this.versionConflict();
    if (
      (await tx.caseExecutionFiling.findFirst({
        where: {
          id: target.filingId,
          caseId,
          departmentId: actor.departmentId,
        },
        select: { id: true },
      })) === null
    )
      throw this.notFound();
    if (!checkRevision) return lawyerBindingId;
    // UUID claims are serialized across cases; a scoped miss is never proof of a new root.
    await tx.$executeRawUnsafe(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      `execution-filing-followup-target:${target.supplementId.toLowerCase()}`,
    );
    const head = await tx.caseExecutionFilingSupplement.findFirst({
      where: { supplementId: target.supplementId },
      orderBy: { toRevision: 'desc' },
      select: {
        id: true,
        filingId: true,
        caseId: true,
        departmentId: true,
        toRevision: true,
      },
    });
    if (
      target.expectedRevision === 0 &&
      !(checkRevision === 'DELETE_PREPARATION' && head !== null)
    ) {
      const [versionCollision, feedbackCollision, foreignDraft] =
        await Promise.all([
          tx.caseExecutionFilingSupplement.findUnique({
            where: { id: target.supplementId },
            select: { id: true },
          }),
          tx.caseExecutionFilingFeedback.findFirst({
            where: {
              OR: [
                { id: target.supplementId },
                { feedbackId: target.supplementId },
              ],
            },
            select: { id: true },
          }),
          tx.uploadDraft.findFirst({
            where: {
              executionSupplementTargetId: target.supplementId,
              NOT: {
                ownerId: caseId,
                departmentId: actor.departmentId,
                executionSupplementFilingId: target.filingId,
                executionSupplementRevision: 0,
                actorUserId: actor.userId,
              },
            },
            select: { id: true },
          }),
        ]);
      if (
        head !== null ||
        versionCollision !== null ||
        feedbackCollision !== null ||
        foreignDraft !== null
      )
        throw this.versionConflict();
    } else {
      const root = await tx.caseExecutionFilingSupplement.findUnique({
        where: { id: target.supplementId },
        select: {
          id: true,
          supplementId: true,
          filingId: true,
          caseId: true,
          departmentId: true,
          fromRevision: true,
          toRevision: true,
        },
      });
      if (
        root === null ||
        root.id !== root.supplementId ||
        root.fromRevision !== 0 ||
        root.toRevision !== 1 ||
        root.caseId !== caseId ||
        root.departmentId !== actor.departmentId ||
        root.filingId !== target.filingId ||
        head === null ||
        head.caseId !== caseId ||
        head.departmentId !== actor.departmentId ||
        head.filingId !== target.filingId ||
        (checkRevision === 'DELETE_PREPARATION'
          ? head.toRevision < target.expectedRevision
          : head.toRevision !== target.expectedRevision)
      )
        throw this.versionConflict();
    }
    return lawyerBindingId;
  }

  private async hasExecutionSupplementFirstFreeze(
    tx: MaterialTransactionClient,
    versionId: string,
    priorOnly = false,
  ): Promise<boolean> {
    const rows = await tx.$queryRawUnsafe<Array<{ consumed: boolean }>>(
      'SELECT case_execution_supplement_upload_first_freeze_proof($1::uuid,$2::boolean) AS consumed',
      versionId,
      priorOnly,
    );
    return rows.length === 1 && rows[0]?.consumed === true;
  }

  private async executionSupplementPendingCount(
    tx: MaterialTransactionClient,
    actor: ActorContext,
    draft: Pick<UploadDraft, 'ownerId'>,
  ): Promise<number> {
    const rows = await tx.$queryRawUnsafe<Array<{ count: number }>>(
      "SELECT count(*)::integer AS count FROM materials m WHERE m.department_id=$1::uuid AND m.owner_type='CASE' AND m.owner_id=$2::uuid AND m.category='EXECUTION_SUPPLEMENT' AND m.status='ACTIVE' AND NOT case_execution_supplement_upload_first_freeze_proof(m.current_version_id,false)",
      actor.departmentId,
      draft.ownerId,
    );
    const count = rows[0]?.count;
    if (
      rows.length !== 1 ||
      count === undefined ||
      !Number.isSafeInteger(count) ||
      count < 0
    )
      throw this.invalidVersion();
    return count;
  }

  /** E inserts its real version and audit first; only this method writes exact documents and refs. */
  async freezeCaseExecutionSupplementReferences(
    transaction: MaterialTransactionClient,
    actor: ActorContext,
    caseId: string,
    target: ExecutionSupplementUploadTarget & Readonly<{ versionId: string }>,
    facts: readonly ValidatedMaterialVersionFact[],
    auditEventId: string,
  ): Promise<void> {
    if (facts.length < 1 || facts.length > 10) throw this.invalidVersion();
    const bindingId = await this.assertExecutionSupplementTarget(
      transaction,
      actor,
      caseId,
      target,
      false,
    );
    const version = await transaction.caseExecutionFilingSupplement.findFirst({
      where: {
        id: target.versionId,
        filingId: target.filingId,
        supplementId: target.supplementId,
        caseId,
        departmentId: actor.departmentId,
        fromRevision: target.expectedRevision,
        toRevision: target.expectedRevision + 1,
        recordedByUserId: actor.userId,
        auditEventId,
      },
      select: {
        id: true,
        actorType: true,
        internalActorUserId: true,
        lawyerAccountBindingId: true,
        auditEvent: {
          select: {
            actorUserId: true,
            departmentId: true,
            internalActorUserId: true,
            lawyerAccountBindingId: true,
            resourceType: true,
            resourceId: true,
            action: true,
          },
        },
      },
    });
    if (
      version === null ||
      version.actorType !== (bindingId === undefined ? 'INTERNAL' : 'LAWYER') ||
      version.internalActorUserId !==
        (bindingId === undefined ? actor.userId : null) ||
      version.lawyerAccountBindingId !== (bindingId ?? null) ||
      version.auditEvent.actorUserId !== actor.userId ||
      version.auditEvent.departmentId !== actor.departmentId ||
      version.auditEvent.resourceType !== 'CASE' ||
      version.auditEvent.resourceId !== caseId ||
      version.auditEvent.internalActorUserId !== version.internalActorUserId ||
      version.auditEvent.lawyerAccountBindingId !==
        version.lawyerAccountBindingId ||
      version.auditEvent.action !==
        (target.expectedRevision === 0
          ? 'case.execution.supplement.submitted'
          : 'case.execution.supplement.corrected')
    )
      throw this.invalidVersion();
    const canonicalFacts = facts.map((fact) => {
      const validation = this.validatedVersionFacts.get(fact);
      const canonical = validation?.canonicalFact;
      if (
        validation?.transaction !== transaction ||
        !validation.executionSupplementTarget ||
        !this.sameExecutionSupplementTarget(
          validation.executionSupplementTarget,
          target,
        ) ||
        canonical?.departmentId !== actor.departmentId ||
        canonical.ownerType !== 'CASE' ||
        canonical.ownerId !== caseId ||
        canonical.category !== 'EXECUTION_SUPPLEMENT' ||
        canonical.purpose !== 'EXECUTION_SUPPLEMENT' ||
        !allowedMimeTypes.EXECUTION_SUPPLEMENT.has(canonical.mimeType) ||
        canonical.sizeBytes <= 0n ||
        canonical.sizeBytes > BigInt(materialFileLimit('EXECUTION_SUPPLEMENT'))
      )
        throw this.invalidVersion();
      return canonical;
    });
    if (
      new Set(canonicalFacts.map((f) => f.materialId)).size !== facts.length ||
      new Set(canonicalFacts.map((f) => f.contentVersionId)).size !==
        facts.length
    )
      throw this.invalidVersion();
    for (const canonical of canonicalFacts)
      await transaction.caseExecutionFilingSupplementDocument.create({
        data: {
          versionId: target.versionId,
          supplementId: target.supplementId,
          filingId: target.filingId,
          caseId,
          departmentId: actor.departmentId,
          materialId: canonical.materialId,
          contentVersionId: canonical.contentVersionId,
        },
      });
    for (const fact of facts) {
      const validation = this.validatedVersionFacts.get(fact);
      if (validation !== undefined)
        validation.supplementFreezeEventId = auditEventId;
    }
    const inserted = await this.freezeReferences(transaction, {
      departmentId: actor.departmentId,
      resourceType: 'case',
      resourceId: caseId,
      facts,
      actionEventId: auditEventId,
    });
    if (inserted.count !== facts.length) throw this.invalidVersion();
  }

  async assertCompleteCurrentCaseExecutionApplicationBundle(
    transaction: MaterialTransactionClient,
    actor: ActorContext,
    caseId: string,
    requestedContentVersionIds: readonly string[],
  ): Promise<readonly ValidatedMaterialVersionFact[]> {
    const selected = await this.assertAvailableVersions(transaction, actor, {
      ownerType: 'CASE',
      ownerId: caseId,
      category: 'EXECUTION_APPLICATION',
      contentVersionIds: requestedContentVersionIds,
      minCount: 1,
      maxCount: 10,
    });
    if (selected.some((fact) => fact.purpose !== 'EXECUTION_APPLICATION'))
      throw this.invalidVersion();
    // The caller holds the case row lock in a Serializable transaction.
    // Ordered row locks stabilize the currently visible bundle against edits.
    const current = await transaction.$queryRawUnsafe<
      Array<{ content_version_id: string }>
    >(
      `SELECT version."id" AS "content_version_id"
       FROM "materials" material
       JOIN "content_versions" version
         ON version."id"=material."current_version_id" AND version."material_id"=material."id"
       WHERE material."department_id"=$1::uuid AND material."owner_type"='CASE'
         AND material."owner_id"=$2::uuid AND material."category"='EXECUTION_APPLICATION'
         AND material."purpose"='EXECUTION_APPLICATION' AND material."status"='ACTIVE'
         AND version."status"='AVAILABLE'
       ORDER BY material."id" FOR SHARE OF material, version`,
      actor.departmentId,
      caseId,
    );
    if (
      current.length !== selected.length ||
      new Set(current.map((item) => item.content_version_id)).size !==
        current.length ||
      current.some(
        (item) => !requestedContentVersionIds.includes(item.content_version_id),
      )
    )
      throw this.invalidVersion();
    return selected;
  }

  async freezeReferences(
    transaction: MaterialTransactionClient,
    input: FreezeMaterialReferencesInput,
  ) {
    if (
      input.facts.length === 0 ||
      input.departmentId.trim().length === 0 ||
      input.resourceType.trim().length === 0 ||
      input.resourceId.trim().length === 0
    ) {
      throw this.invalidVersion();
    }
    if (
      (input.resourceType === 'right_asset_version') !==
        (input.assetVersionId !== undefined) ||
      (input.assetVersionId !== undefined &&
        input.assetVersionId !== input.resourceId)
    )
      throw this.invalidVersion();

    const canonicalFacts = input.facts.map((fact) => {
      const validation = this.validatedVersionFacts.get(fact);
      if (
        validation === undefined ||
        validation.transaction !== transaction ||
        validation.canonicalFact.departmentId !== input.departmentId ||
        (validation.executionSupplementTarget !== undefined &&
          (validation.supplementFreezeEventId !== input.actionEventId ||
            input.resourceType !== 'case' ||
            input.resourceId !== validation.canonicalFact.ownerId)) ||
        (validation.firstUploadTarget !== undefined &&
          (validation.sectionFreezeEventId !== input.actionEventId ||
            input.resourceType !== 'case' ||
            input.resourceId !== validation.canonicalFact.ownerId))
      ) {
        throw this.invalidVersion();
      }
      return validation.canonicalFact;
    });
    if (
      input.resourceType === 'customer_agreement_version' &&
      canonicalFacts.some(
        (fact) =>
          fact.ownerType !== 'CUSTOMER' ||
          fact.category !== 'CUSTOMER_AGREEMENT' ||
          fact.purpose !== 'CUSTOMER_AGREEMENT' ||
          input.actionEventId === undefined,
      )
    ) {
      throw this.invalidVersion();
    }

    return transaction.materialReference.createMany({
      data: canonicalFacts.map((fact) => ({
        departmentId: input.departmentId,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        purpose: fact.purpose,
        materialId: fact.materialId,
        contentVersionId: fact.contentVersionId,
        ...(input.actionEventId === undefined
          ? {}
          : { actionEventId: input.actionEventId }),
        ...(input.assetVersionId === undefined
          ? {}
          : { assetVersionId: input.assetVersionId }),
      })),
      skipDuplicates: true,
    });
  }

  async listCurrentReferenceVersionIds(
    reader: MaterialReferenceReader,
    actor: ActorContext,
    input: CurrentLeadReferenceInput,
    leadAction: Extract<
      LeadAction,
      'lead.read' | 'lead.edit' | 'lead.evidence.decide'
    > = 'lead.read',
  ): Promise<readonly string[]> {
    this.assertCurrentLeadReferenceInput(input);
    await this.authorizeOwner(
      actor,
      'LEAD',
      input.resourceId,
      'read',
      reader,
      reader,
      leadAction,
    );
    return this.readCurrentReferenceVersionIds(reader, actor, input);
  }

  async replaceCurrentReferences(
    transaction: MaterialTransactionClient,
    actor: ActorContext,
    input: ReplaceCurrentLeadReferencesInput,
  ): Promise<ReplaceCurrentReferencesResult> {
    this.assertCurrentLeadReferenceInput(input);
    await this.authorizeOwner(
      actor,
      'LEAD',
      input.resourceId,
      'read',
      transaction,
      transaction,
      'lead.edit',
    );
    const canonicalFacts = input.versions.map((fact) => {
      const validation = this.validatedVersionFacts.get(fact);
      if (
        validation === undefined ||
        validation.transaction !== transaction ||
        validation.canonicalFact.departmentId !== actor.departmentId ||
        validation.canonicalFact.ownerType !== 'LEAD' ||
        validation.firstUploadTarget !== undefined ||
        validation.canonicalFact.ownerId !== input.resourceId ||
        validation.canonicalFact.category !== 'LEAD_SCREENSHOT' ||
        validation.canonicalFact.purpose !== input.purpose
      ) {
        throw this.invalidVersion();
      }
      return validation.canonicalFact;
    });
    const beforeVersionIds = await this.readCurrentReferenceVersionIds(
      transaction,
      actor,
      input,
    );
    const afterVersionIds = [
      ...new Set(canonicalFacts.map((fact) => fact.contentVersionId)),
    ].sort();
    await transaction.materialReference.deleteMany({
      where: {
        departmentId: actor.departmentId,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        purpose: input.purpose,
        actionEventId: null,
      },
    });
    if (input.versions.length > 0) {
      await this.freezeReferences(transaction, {
        departmentId: actor.departmentId,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        facts: input.versions,
      });
    }
    return {
      beforeVersionIds,
      afterVersionIds,
      changed:
        beforeVersionIds.length !== afterVersionIds.length ||
        beforeVersionIds.some(
          (contentVersionId, index) =>
            contentVersionId !== afterVersionIds[index],
        ),
    };
  }

  async adoptLeadDraftVersions(
    transaction: MaterialTransactionClient,
    input: AdoptLeadDraftVersionsInput,
  ): Promise<void> {
    if (input.targetLeadId !== input.reservedLeadId)
      throw this.invalidVersion();
    const facts = input.versions.map((fact) => {
      const record = this.validatedVersionFacts.get(fact);
      if (
        record === undefined ||
        record.transaction !== transaction ||
        record.canonicalFact.ownerType !== 'LEAD_DRAFT' ||
        record.canonicalFact.ownerId !== input.reservedLeadId ||
        record.canonicalFact.category !== 'LEAD_SCREENSHOT'
      )
        throw this.invalidVersion();
      return record.canonicalFact;
    });
    if (facts.length === 0) return;
    const departmentId = facts[0]!.departmentId;
    if (facts.some((fact) => fact.departmentId !== departmentId))
      throw this.invalidVersion();
    const materialIds = [...new Set(facts.map((fact) => fact.materialId))];
    const changed = await transaction.material.updateMany({
      where: {
        id: { in: materialIds },
        departmentId,
        ownerType: 'LEAD_DRAFT',
        ownerId: input.reservedLeadId,
        category: 'LEAD_SCREENSHOT',
        status: 'ACTIVE',
      },
      data: { ownerType: 'LEAD', ownerId: input.targetLeadId },
    });
    if (changed.count !== materialIds.length) throw this.invalidVersion();
  }

  private assertCurrentLeadReferenceInput(
    input: CurrentLeadReferenceInput,
  ): void {
    if (
      input.resourceType !== 'lead' ||
      input.resourceId.trim().length === 0 ||
      input.purpose !== 'LEAD_SCREENSHOT'
    ) {
      throw this.invalidVersion();
    }
  }

  private async readCurrentReferenceVersionIds(
    reader: MaterialReferenceReader,
    actor: ActorContext,
    input: CurrentLeadReferenceInput,
  ): Promise<readonly string[]> {
    const references = await reader.materialReference.findMany({
      where: {
        departmentId: actor.departmentId,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        purpose: input.purpose,
        actionEventId: null,
      },
      orderBy: { contentVersionId: 'asc' },
      select: { contentVersionId: true },
    });
    return Object.freeze(
      [
        ...new Set(references.map(({ contentVersionId }) => contentVersionId)),
      ].sort(),
    );
  }

  async listOwnerMaterials(
    actor: ActorContext,
    ownerType: MaterialOwnerTypeValue,
    ownerId: string,
  ): Promise<OwnerMaterialListDto> {
    await this.authorizeOwner(actor, ownerType, ownerId, 'read');
    const canViewAgreement =
      ownerType !== 'CUSTOMER' ||
      (await this.hasCustomerAgreementScope(actor, ownerId));
    if (
      ownerType === 'CASE' &&
      (actor.clientCustomerId !== undefined ||
        actor.lawyerAccountId !== undefined)
    ) {
      const allowed =
        actor.lawyerAccountId !== undefined
          ? await this.lawyerCaseVersionWhitelist(actor, ownerId)
          : await this.clientCaseVersionWhitelist(actor, ownerId);
      if (allowed.size === 0) return { items: [], total: 0 };
      const allowedMaterialIds = [...allowed.keys()];
      const allowedVersionIds = [
        ...new Set([...allowed.values()].flatMap((ids) => [...ids])),
      ];
      const materials = await this.database.material.findMany({
        where: {
          departmentId: actor.departmentId,
          ownerType: 'CASE',
          ownerId,
          status: 'ACTIVE',
          id: { in: allowedMaterialIds },
          category: { not: 'FEE_PROOF' },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        select: {
          id: true,
          ownerType: true,
          ownerId: true,
          category: true,
          purpose: true,
          currentVersionId: true,
          status: true,
          version: true,
          deletedAt: true,
          createdAt: true,
          updatedAt: true,
          contentVersions: {
            where: { id: { in: allowedVersionIds }, status: 'AVAILABLE' },
            orderBy: { createdAt: 'desc' },
            select: {
              id: true,
              materialId: true,
              originalFilename: true,
              mimeType: true,
              sizeBytes: true,
              sha256: true,
              status: true,
              createdAt: true,
            },
          },
        },
      });
      const items = materials.flatMap((material) => {
        if (material.category === 'FEE_PROOF') return [];
        const versions = material.contentVersions.filter((version) =>
          allowed.get(material.id)?.has(version.id),
        );
        if (versions.length === 0) return [];
        return [
          {
            id: material.id,
            ownerType: material.ownerType,
            ownerId: material.ownerId,
            category: material.category,
            purpose: toMaterialPurpose(material.purpose),
            currentVersionId:
              actor.lawyerAccountId !== undefined &&
              [
                'SECOND_INSTANCE_DOCUMENT',
                'SECOND_INSTANCE_SERVICE',
                'SECOND_INSTANCE_JUDGMENT',
                'EXECUTION_APPLICATION',
                'EXECUTION_FILING_PROOF',
                'EXECUTION_FINISH_BASIS',
                'CASE_CLOSURE_DOCUMENT',
              ].includes(material.category) &&
              versions.some(
                (version) => version.id === material.currentVersionId,
              )
                ? material.currentVersionId
                : null,
            status: 'ACTIVE' as const,
            version: material.version,
            deletedAt: material.deletedAt,
            createdAt: material.createdAt,
            updatedAt: material.updatedAt,
            contentVersions: versions.map((version) => ({
              id: version.id,
              materialId: version.materialId,
              originalFilename: version.originalFilename,
              mimeType: version.mimeType,
              sizeBytes: Number(version.sizeBytes),
              sha256: version.sha256,
              status: 'AVAILABLE' as const,
              createdAt: version.createdAt,
            })),
          },
        ];
      });
      return { items, total: items.length };
    }
    const notaryMatter =
      actor.notaryOfficeId === undefined
        ? null
        : await this.database.notaryMatter.findFirst({
            where: {
              id: ownerId,
              departmentId: actor.departmentId,
              notaryOfficeId: actor.notaryOfficeId,
            },
            select: { stage: true },
          });
    const notaryCommitted =
      notaryMatter !== null &&
      !['WAITING_UNBOX', 'WAITING_CERTIFICATE'].includes(notaryMatter.stage);
    if (actor.notaryOfficeId !== undefined && notaryMatter === null)
      throw this.notFound();
    const clientReferences =
      actor.clientCustomerId === undefined && !notaryCommitted
        ? null
        : await this.database.materialReference.findMany({
            where: {
              departmentId: actor.departmentId,
              resourceType:
                ownerType === 'NOTARY_MATTER' ? 'notary_matter' : 'lead',
              resourceId: ownerId,
              purpose:
                ownerType === 'NOTARY_MATTER'
                  ? actor.notaryOfficeId !== undefined &&
                    notaryMatter?.stage === 'ARCHIVED'
                    ? { in: ['NOTARY_CERTIFICATE', 'NOTARY_DISCLOSURE'] }
                    : 'NOTARY_OPENING_PHOTO'
                  : 'LEAD_SCREENSHOT',
              actionEventId:
                ownerType === 'NOTARY_MATTER' ? { not: null } : null,
              ...(ownerType === 'NOTARY_MATTER'
                ? {
                    actionEvent: {
                      action:
                        actor.notaryOfficeId !== undefined &&
                        notaryMatter?.stage === 'ARCHIVED'
                          ? 'notary.certificate_issued'
                          : 'notary.opening_recorded',
                      resourceType: 'notary_matter',
                      resourceId: ownerId,
                      departmentId: actor.departmentId,
                    },
                    material: {
                      ownerType: 'NOTARY_MATTER',
                      ownerId,
                      category:
                        actor.notaryOfficeId !== undefined &&
                        notaryMatter?.stage === 'ARCHIVED'
                          ? { in: ['NOTARY_CERTIFICATE', 'NOTARY_DISCLOSURE'] }
                          : 'NOTARY_OPENING_PHOTO',
                      departmentId: actor.departmentId,
                    },
                  }
                : {}),
            },
            select: {
              materialId: true,
              contentVersionId: true,
              purpose: true,
              ...(ownerType === 'NOTARY_MATTER'
                ? { actionEvent: { select: { details: true } } }
                : {}),
            },
          });
    const allowedClientReferences = clientReferences?.filter(
      (reference) =>
        ownerType !== 'NOTARY_MATTER' ||
        ('actionEvent' in reference &&
          (actor.notaryOfficeId !== undefined &&
          notaryMatter?.stage === 'ARCHIVED'
            ? isFrozenCertificateVersion(
                reference.actionEvent?.details,
                reference.purpose,
                reference.contentVersionId,
              )
            : isFrozenOpeningPhotoVersion(
                reference.actionEvent?.details,
                reference.contentVersionId,
              ))),
    );
    if (allowedClientReferences?.length === 0) return { items: [], total: 0 };
    const clientMaterialIds = allowedClientReferences?.map(
      ({ materialId }) => materialId,
    );
    const clientVersionIds = allowedClientReferences?.map(
      ({ contentVersionId }) => contentVersionId,
    );
    const items = await this.database.material.findMany({
      where: {
        departmentId: actor.departmentId,
        ownerType,
        ownerId,
        status: 'ACTIVE',
        ...(ownerType === 'CUSTOMER' && !canViewAgreement
          ? { category: { not: 'CUSTOMER_AGREEMENT' as const } }
          : {}),
        ...(ownerType === 'CASE'
          ? { category: { not: 'FEE_PROOF' as const } }
          : {}),
        ...(ownerType === 'NOTARY_MATTER' &&
        actor.notaryOfficeId === undefined &&
        actor.clientCustomerId === undefined
          ? {
              category: {
                notIn: ['NOTARY_CERTIFICATE', 'NOTARY_DISCLOSURE'] as const,
              },
            }
          : {}),
        ...((actor.clientCustomerId !== undefined ||
          actor.notaryOfficeId !== undefined) &&
        ownerType === 'NOTARY_MATTER'
          ? actor.notaryOfficeId !== undefined &&
            notaryMatter?.stage === 'WAITING_CERTIFICATE'
            ? {
                category: {
                  in: ['NOTARY_CERTIFICATE', 'NOTARY_DISCLOSURE'] as const,
                },
              }
            : actor.notaryOfficeId !== undefined &&
                notaryMatter?.stage === 'ARCHIVED'
              ? {
                  category: {
                    in: ['NOTARY_CERTIFICATE', 'NOTARY_DISCLOSURE'] as const,
                  },
                }
              : { category: 'NOTARY_OPENING_PHOTO' as const }
          : {}),
        ...(clientMaterialIds === undefined
          ? actor.notaryOfficeId !== undefined &&
            notaryMatter?.stage !== 'WAITING_CERTIFICATE'
            ? {
                contentVersions: {
                  some: { uploadedBy: actor.userId, status: 'AVAILABLE' },
                },
              }
            : {}
          : { id: { in: clientMaterialIds } }),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      select: {
        id: true,
        ownerType: true,
        ownerId: true,
        category: true,
        purpose: true,
        currentVersionId: true,
        status: true,
        version: true,
        deletedAt: true,
        createdAt: true,
        updatedAt: true,
        contentVersions: {
          where: {
            status: 'AVAILABLE',
            ...(clientVersionIds === undefined
              ? actor.notaryOfficeId !== undefined &&
                notaryMatter?.stage !== 'WAITING_CERTIFICATE'
                ? { uploadedBy: actor.userId }
                : {}
              : { id: { in: clientVersionIds } }),
          },
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            materialId: true,
            originalFilename: true,
            mimeType: true,
            sizeBytes: true,
            sha256: true,
            status: true,
            createdAt: true,
          },
        },
      },
    });
    return {
      items: items
        .filter((material) => material.category !== 'FEE_PROOF')
        .map((material) => ({
          id: material.id,
          ownerType: material.ownerType,
          ownerId: material.ownerId,
          category: material.category,
          purpose: toMaterialPurpose(material.purpose),
          currentVersionId: material.currentVersionId,
          status: 'ACTIVE' as const,
          version: material.version,
          deletedAt: material.deletedAt,
          createdAt: material.createdAt,
          updatedAt: material.updatedAt,
          contentVersions: material.contentVersions.map((version) => ({
            id: version.id,
            materialId: version.materialId,
            originalFilename: version.originalFilename,
            mimeType: version.mimeType,
            sizeBytes: Number(version.sizeBytes),
            sha256: version.sha256,
            status: 'AVAILABLE' as const,
            createdAt: version.createdAt,
          })),
        })),
      total: items.filter((material) => material.category !== 'FEE_PROOF')
        .length,
    };
  }

  private isInternalMaterialActor(actor: ActorContext): boolean {
    return (
      actor.clientCustomerId === undefined &&
      actor.notaryOfficeId === undefined &&
      actor.lawyerAccountId === undefined
    );
  }

  private async lockFeeMaterialActor(
    tx: MaterialTransactionClient,
    actor: ActorContext,
  ): Promise<void> {
    if (!this.isInternalMaterialActor(actor)) throw this.forbidden();
    if (!this.organization) throw new Error('OrganizationService unavailable');
    await lockCustomerActorFacts(tx, this.organization, actor);
    await this.accessControl.authorizeDepartmentAction(actor, 'fee.update', tx);
  }

  private async authorizeFeeProofDownload(
    actor: ActorContext,
    ownerType: MaterialOwnerTypeValue,
    caseId: string,
    materialId: string,
    versionId: string,
  ): Promise<void> {
    if (ownerType !== 'CASE' || !this.isInternalMaterialActor(actor))
      throw this.forbidden();
    await this.database.$transaction(
      async (tx) => {
        await this.withMaterialAuthorization(() =>
          this.accessControl.authorizeDepartmentAction(actor, 'fee.read', tx),
        );
        const fee = await tx.feeRecord.findFirst({
          where: {
            departmentId: actor.departmentId,
            caseId,
            deletedAt: null,
            proofMaterialId: materialId,
            proofContentVersionId: versionId,
            case: { id: caseId, departmentId: actor.departmentId },
          },
          select: { id: true },
        });
        if (fee === null) throw this.notFound();
        const ref = await tx.materialReference.findFirst({
          where: {
            departmentId: actor.departmentId,
            resourceType: 'fee',
            resourceId: fee.id,
            purpose: 'FEE_PROOF',
            materialId,
            contentVersionId: versionId,
            assetVersionId: null,
            actionEventId: { not: null },
            actionEvent: {
              departmentId: actor.departmentId,
              resourceType: 'FEE',
              resourceId: fee.id,
              action: 'fee.proof-updated',
              internalActorUserId: { not: null },
              AND: [
                { details: { path: ['caseId'], equals: caseId } },
                { details: { path: ['proofMaterialId'], equals: materialId } },
                {
                  details: {
                    path: ['proofContentVersionId'],
                    equals: versionId,
                  },
                },
              ],
            },
          },
          select: { id: true },
        });
        if (ref === null) throw this.notFound();
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }

  private async authorizeEvidenceCertificateDownload(
    actor: ActorContext,
    matterId: string,
    materialId: string,
    versionId: string,
  ): Promise<void> {
    if (!this.isInternalMaterialActor(actor)) throw this.forbidden();
    await this.database.$transaction(
      async (tx) => {
        await this.withMaterialAuthorization(() =>
          this.accessControl.authorizeDepartmentAction(
            actor,
            'evidence.read',
            tx,
          ),
        );
        const certificate = await tx.notaryCertificate.findFirst({
          where: { matterId, departmentId: actor.departmentId },
          select: {
            id: true,
            actorUserId: true,
            notaryOfficeAccountBindingId: true,
            fromVersion: true,
            toVersion: true,
          },
        });
        if (certificate === null) throw this.notFound();
        const paper = await tx.evidencePaperCertificate.findFirst({
          where: {
            departmentId: actor.departmentId,
            sourceKind: 'NOTARY_MATTER',
            sourceId: matterId,
            sourceNotaryMatterId: matterId,
            sourceCertificateId: certificate.id,
            removedAt: null,
            group: {
              departmentId: actor.departmentId,
              sourceKind: 'NOTARY_MATTER',
              sourceId: matterId,
              sourceNotaryMatterId: matterId,
              sourceInitializedAt: { not: null },
            },
          },
          select: { id: true },
        });
        if (paper === null) throw this.notFound();
        const audits = await tx.auditEvent.findMany({
          where: {
            departmentId: actor.departmentId,
            resourceType: 'notary_matter',
            resourceId: matterId,
            action: 'notary.certificate_issued',
            actorUserId: certificate.actorUserId,
            notaryOfficeAccountBindingId:
              certificate.notaryOfficeAccountBindingId,
            internalActorUserId: null,
            details: { path: ['certificateId'], equals: certificate.id },
          },
          select: { id: true, details: true },
        });
        if (audits.length !== 1) throw this.notFound();
        const audit = audits[0];
        const details = audit.details;
        if (
          details === null ||
          typeof details !== 'object' ||
          Array.isArray(details) ||
          details.fromVersion !== certificate.fromVersion ||
          details.toVersion !== certificate.toVersion ||
          !Array.isArray(details.contentVersionIds)
        )
          throw this.notFound();
        const ids = details.contentVersionIds;
        if (
          ids.length < 1 ||
          ids.length > 10 ||
          ids.some((id) => typeof id !== 'string') ||
          new Set(ids).size !== ids.length ||
          !ids.includes(versionId)
        )
          throw this.notFound();
        const refs = await tx.materialReference.findMany({
          where: {
            departmentId: actor.departmentId,
            resourceType: 'notary_matter',
            resourceId: matterId,
            purpose: 'NOTARY_CERTIFICATE',
            actionEventId: audit.id,
            assetVersionId: null,
            material: {
              departmentId: actor.departmentId,
              ownerType: 'NOTARY_MATTER',
              ownerId: matterId,
              category: 'NOTARY_CERTIFICATE',
              purpose: 'NOTARY_CERTIFICATE',
            },
          },
          select: { materialId: true, contentVersionId: true },
        });
        if (
          refs.length !== ids.length ||
          new Set(refs.map((ref) => ref.contentVersionId)).size !==
            ids.length ||
          refs.some((ref) => !ids.includes(ref.contentVersionId)) ||
          !refs.some(
            (ref) =>
              ref.materialId === materialId &&
              ref.contentVersionId === versionId,
          )
        )
          throw this.notFound();
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }

  async openVersion(
    actor: ActorContext,
    materialId: string,
    versionId: string,
  ) {
    const material = await this.database.material.findFirst({
      where: { id: materialId, departmentId: actor.departmentId },
      include: {
        contentVersions: { where: { id: versionId, status: 'AVAILABLE' } },
      },
    });
    const version = material?.contentVersions[0];
    if (material === null || version === undefined) throw this.notFound();
    if (
      material.category === 'FEE_PROOF' &&
      !this.isInternalMaterialActor(actor)
    )
      throw this.forbidden();
    if (
      (material.category === 'FEE_PROOF' ||
        material.category === 'NOTARY_CERTIFICATE') &&
      (material.status !== 'ACTIVE' ||
        material.deletedAt != null ||
        version.status !== 'AVAILABLE')
    )
      throw this.notFound();
    if (material.ownerType === 'CASE' && material.status !== 'ACTIVE')
      throw this.notFound();
    if (
      material.ownerType === 'CASE' &&
      (actor.clientCustomerId !== undefined ||
        actor.lawyerAccountId !== undefined ||
        actor.notaryOfficeId !== undefined) &&
      version.caseSectionRecordUploadDraftId != null &&
      !(await this.hasSectionUploadFirstFreeze(this.database, version.id))
    )
      throw this.notFound();
    if (
      material.ownerType === 'CASE' &&
      (actor.clientCustomerId !== undefined ||
        actor.lawyerAccountId !== undefined ||
        actor.notaryOfficeId !== undefined) &&
      version.executionSupplementUploadDraftId != null &&
      !(await this.hasExecutionSupplementFirstFreeze(this.database, version.id))
    )
      throw this.notFound();
    if (material.ownerType === 'CASE' && actor.clientCustomerId !== undefined) {
      await this.authorizeOwner(actor, 'CASE', material.ownerId, 'read');
      const allowed = await this.clientCaseVersionWhitelist(
        actor,
        material.ownerId,
      );
      if (!allowed.get(materialId)?.has(versionId)) throw this.notFound();
    }
    if (actor.lawyerAccountId !== undefined) {
      if (material.ownerType === 'CASE') {
        await this.authorizeOwner(actor, 'CASE', material.ownerId, 'read');
        const current = material.currentVersionId === versionId;
        const frozen = await this.database.materialReference.findFirst({
          where: {
            departmentId: actor.departmentId,
            resourceType: 'case',
            resourceId: material.ownerId,
            materialId,
            contentVersionId: versionId,
            actionEventId: { not: null },
          },
          select: { id: true },
        });
        if (!current && frozen === null) throw this.notFound();
      } else if (
        material.ownerType === 'NOTARY_MATTER' &&
        material.status === 'ACTIVE' &&
        ['NOTARY_CERTIFICATE', 'NOTARY_DISCLOSURE'].includes(material.category)
      ) {
        const sourceCase = await this.database.case.findFirst({
          where: {
            departmentId: actor.departmentId,
            sourceNotaryMatterId: material.ownerId,
          },
          select: { id: true, certificateId: true },
        });
        if (sourceCase === null || sourceCase.certificateId === null)
          throw this.notFound();
        const frozen = await this.listFrozenCertificateFiles(
          actor,
          material.ownerId,
          sourceCase.certificateId,
        );
        if (
          !frozen.some(
            (ref) =>
              ref.materialId === materialId &&
              ref.contentVersionId === versionId,
          )
        )
          throw this.notFound();
      } else throw this.notFound();
    }
    if (
      (actor.clientCustomerId !== undefined ||
        actor.notaryOfficeId !== undefined) &&
      material.ownerType === 'NOTARY_MATTER' &&
      ((actor.clientCustomerId !== undefined &&
        material.category !== 'NOTARY_OPENING_PHOTO') ||
        (actor.notaryOfficeId !== undefined &&
          ![
            'NOTARY_OPENING_PHOTO',
            'NOTARY_CERTIFICATE',
            'NOTARY_DISCLOSURE',
          ].includes(material.category)) ||
        material.status !== 'ACTIVE')
    )
      throw this.notFound();
    if (material.category === 'FEE_PROOF') {
      await this.authorizeFeeProofDownload(
        actor,
        material.ownerType,
        material.ownerId,
        materialId,
        versionId,
      );
    } else if (!(
      actor.lawyerAccountId !== undefined &&
      material.ownerType === 'NOTARY_MATTER'
    ))
      try {
        await this.authorizeOwner(
          actor,
          material.ownerType,
          material.ownerId,
          'read',
          this.database,
          undefined,
          undefined,
          material.category,
        );
      } catch (error) {
        if (
          !(error instanceof ForbiddenException) ||
          material.ownerType !== 'NOTARY_MATTER' ||
          material.category !== 'NOTARY_CERTIFICATE' ||
          !this.isInternalMaterialActor(actor)
        )
          throw error;
        await this.authorizeEvidenceCertificateDownload(
          actor,
          material.ownerId,
          materialId,
          versionId,
        );
      }
    const notaryMatter =
      actor.notaryOfficeId === undefined
        ? null
        : await this.database.notaryMatter.findFirst({
            where: {
              id: material.ownerId,
              departmentId: actor.departmentId,
              notaryOfficeId: actor.notaryOfficeId,
            },
            select: { stage: true },
          });
    if (actor.notaryOfficeId !== undefined && notaryMatter === null)
      throw this.notFound();
    if (
      actor.notaryOfficeId !== undefined &&
      ((notaryMatter?.stage === 'WAITING_UNBOX' &&
        material.category !== 'NOTARY_OPENING_PHOTO') ||
        (notaryMatter?.stage === 'WAITING_CERTIFICATE' &&
          !['NOTARY_CERTIFICATE', 'NOTARY_DISCLOSURE'].includes(
            material.category,
          )) ||
        (notaryMatter?.stage === 'ARCHIVED' &&
          !['NOTARY_CERTIFICATE', 'NOTARY_DISCLOSURE'].includes(
            material.category,
          )))
    )
      throw this.notFound();
    if (
      (actor.clientCustomerId !== undefined && material.ownerType !== 'CASE') ||
      (notaryMatter !== null &&
        !['WAITING_UNBOX', 'WAITING_CERTIFICATE'].includes(
          notaryMatter.stage,
        )) ||
      (actor.clientCustomerId === undefined &&
        actor.notaryOfficeId === undefined &&
        ['NOTARY_CERTIFICATE', 'NOTARY_DISCLOSURE'].includes(material.category))
    ) {
      const reference = await this.database.materialReference.findFirst({
        where: {
          departmentId: actor.departmentId,
          resourceType:
            material.ownerType === 'NOTARY_MATTER' ? 'notary_matter' : 'lead',
          resourceId: material.ownerId,
          purpose:
            material.ownerType === 'NOTARY_MATTER'
              ? material.category
              : 'LEAD_SCREENSHOT',
          materialId,
          contentVersionId: versionId,
          actionEventId:
            material.ownerType === 'NOTARY_MATTER' ? { not: null } : null,
          ...(material.ownerType === 'NOTARY_MATTER'
            ? {
                actionEvent: {
                  action:
                    material.category === 'NOTARY_OPENING_PHOTO'
                      ? 'notary.opening_recorded'
                      : 'notary.certificate_issued',
                  resourceType: 'notary_matter',
                  resourceId: material.ownerId,
                  departmentId: actor.departmentId,
                },
              }
            : {}),
        },
        select: { id: true, actionEvent: { select: { details: true } } },
      });
      if (
        reference === null ||
        (material.ownerType === 'NOTARY_MATTER' &&
          !(material.category === 'NOTARY_OPENING_PHOTO'
            ? isFrozenOpeningPhotoVersion(
                reference.actionEvent?.details,
                versionId,
              )
            : isFrozenCertificateVersion(
                reference.actionEvent?.details,
                material.category,
                versionId,
              )))
      )
        throw this.notFound();
    }
    if (
      actor.notaryOfficeId !== undefined &&
      notaryMatter?.stage === 'WAITING_UNBOX' &&
      version.uploadedBy !== actor.userId
    )
      throw this.notFound();
    if (
      material.ownerType === 'LEAD_DRAFT' &&
      version.uploadedBy !== actor.userId
    ) {
      throw this.forbidden();
    }
    try {
      return {
        stream: await this.storage.open(version.storageKey),
        originalFilename: version.originalFilename,
        mimeType: version.mimeType,
        sizeBytes: Number(version.sizeBytes),
        sha256: version.sha256,
      };
    } catch (error) {
      if (error instanceof BlobStorageUnavailableError) {
        throw this.storageUnavailable();
      }
      if (error instanceof BlobNotFoundError) throw this.notFound();
      throw error;
    }
  }

  async softDelete(
    actor: ActorContext,
    materialId: string,
    expectedVersion: number,
  ) {
    if (actor.notaryOfficeId !== undefined) throw this.forbidden();
    await this.withSerializableMaterialMutation(async (transaction) => {
      const actorLocks = await this.lockMaterialMutationActorFirst(
        transaction,
        actor,
        materialId,
      );
      await this.lockMaterialAndCurrentVersion(
        transaction,
        actor.departmentId,
        materialId,
      );
      await this.assertAgreementCategoryDidNotAppear(
        transaction,
        actor,
        materialId,
        actorLocks.agreementLocked,
      );
      const material = await this.findMaterialForMutation(
        actor,
        materialId,
        transaction,
        transaction,
        actorLocks.supplementCaseId === undefined
          ? undefined
          : {
              transaction,
              caseId: actorLocks.supplementCaseId,
              operation: 'delete',
            },
      );
      const currentVersion = material.contentVersions.find(
        (version) => version.id === material.currentVersionId,
      );
      if (
        material.status !== 'ACTIVE' ||
        currentVersion?.status !== 'AVAILABLE'
      ) {
        throw this.versionConflict();
      }
      const references = await transaction.materialReference.count({
        where: { materialId },
      });
      if (references > 0) throw this.versionConflict();
      const changed = await transaction.material.updateMany({
        where: { id: materialId, status: 'ACTIVE', version: expectedVersion },
        data: {
          status: 'DELETED',
          deletedAt: this.clock(),
          version: { increment: 1 },
        },
      });
      if (changed.count !== 1) throw this.versionConflict();
      const lawyerBindingId =
        actor.lawyerAccountId === undefined
          ? undefined
          : await currentLawyerBindingId(
              transaction,
              actor,
              material.ownerId,
              true,
            );
      await transaction.auditEvent.create({
        data: {
          departmentId: actor.departmentId,
          actorUserId: actor.userId,
          ...(lawyerBindingId === undefined
            ? {}
            : { lawyerAccountBindingId: lawyerBindingId }),
          resourceType: 'material',
          resourceId: materialId,
          action: 'material.deleted',
          details: {
            fromVersion: expectedVersion,
            toVersion: expectedVersion + 1,
          },
        },
      });
    });
    return {
      id: materialId,
      status: 'DELETED' as const,
      version: expectedVersion + 1,
    };
  }

  async restore(
    actor: ActorContext,
    materialId: string,
    expectedVersion: number,
  ) {
    if (actor.notaryOfficeId !== undefined) throw this.forbidden();
    await this.withSerializableMaterialMutation(async (transaction) => {
      const actorLocks = await this.lockMaterialMutationActorFirst(
        transaction,
        actor,
        materialId,
      );
      await this.lockMaterialAndCurrentVersion(
        transaction,
        actor.departmentId,
        materialId,
      );
      await this.assertAgreementCategoryDidNotAppear(
        transaction,
        actor,
        materialId,
        actorLocks.agreementLocked,
      );
      const material = await this.findMaterialForMutation(
        actor,
        materialId,
        transaction,
        transaction,
        actorLocks.supplementCaseId === undefined
          ? undefined
          : {
              transaction,
              caseId: actorLocks.supplementCaseId,
              operation: 'restore',
            },
      );
      const currentVersion = material.contentVersions.find(
        (version) => version.id === material.currentVersionId,
      );
      if (
        material.status !== 'DELETED' ||
        material.deletedAt === null ||
        this.clock().getTime() - material.deletedAt.getTime() >= RETENTION_MS ||
        currentVersion?.status !== 'AVAILABLE'
      ) {
        throw this.versionConflict();
      }
      await transaction.$executeRawUnsafe(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        ownerQuotaKey(material),
      );
      const activeCount =
        material.category === 'EXECUTION_SUPPLEMENT'
          ? await this.executionSupplementPendingCount(
              transaction,
              actor,
              material,
            )
          : await transaction.material.count({
              where: {
                departmentId: material.departmentId,
                ownerType: material.ownerType,
                ownerId: material.ownerId,
                category: material.category,
                status: 'ACTIVE',
                ...(material.category === 'FEE_PROOF'
                  ? { references: { none: { purpose: 'FEE_PROOF' } } }
                  : {}),
                ...(material.category === 'MAIL_RECEIPT'
                  ? {
                      currentVersion: {
                        is: {
                          materialReferences: {
                            none: {
                              purpose: 'MAIL_RECEIPT',
                              actionEventId: { not: null },
                            },
                          },
                        },
                      },
                    }
                  : material.category === 'JUDGMENT'
                    ? {
                        contentVersions: {
                          none: {
                            OR: [
                              { caseJudgmentVersions: { some: {} } },
                              { judgmentRecordDocuments: { some: {} } },
                            ],
                          },
                        },
                      }
                    : material.category === 'CUSTOMER_RIGHT_EVIDENCE'
                      ? {
                          currentVersion: {
                            is: {
                              materialReferences: {
                                none: { assetVersionId: { not: null } },
                              },
                            },
                          },
                        }
                      : material.category === 'CUSTOMER_AGREEMENT'
                        ? {
                            currentVersion: {
                              is: {
                                materialReferences: {
                                  none: { purpose: 'CUSTOMER_AGREEMENT' },
                                },
                              },
                            },
                          }
                        : {}),
              },
            });
      if (activeCount >= materialLimit(material.category)) {
        throw this.validationError();
      }
      const changed = await transaction.material.updateMany({
        where: { id: materialId, status: 'DELETED', version: expectedVersion },
        data: {
          status: 'ACTIVE',
          deletedAt: null,
          version: { increment: 1 },
        },
      });
      if (changed.count !== 1) throw this.versionConflict();
      const lawyerBindingId =
        actor.lawyerAccountId === undefined
          ? undefined
          : await currentLawyerBindingId(
              transaction,
              actor,
              material.ownerId,
              true,
            );
      await transaction.auditEvent.create({
        data: {
          departmentId: actor.departmentId,
          actorUserId: actor.userId,
          ...(lawyerBindingId === undefined
            ? {}
            : { lawyerAccountBindingId: lawyerBindingId }),
          resourceType: 'material',
          resourceId: materialId,
          action: 'material.restored',
          details: {
            fromVersion: expectedVersion,
            toVersion: expectedVersion + 1,
          },
        },
      });
    });
    return {
      id: materialId,
      status: 'ACTIVE' as const,
      version: expectedVersion + 1,
    };
  }

  private async findMaterialForMutation(
    actor: ActorContext,
    materialId: string,
    reader: MaterialMutationReader = this.database,
    snapshotReader?: AccessControlSnapshotReader,
    supplement?: Readonly<{
      transaction: MaterialTransactionClient;
      caseId: string;
      operation: 'delete' | 'restore';
    }>,
  ) {
    const material = await reader.material.findFirst({
      where: { id: materialId, departmentId: actor.departmentId },
      include: {
        contentVersions: {
          select: {
            id: true,
            uploadedBy: true,
            status: true,
            originalFilename: true,
            executionSupplementUploadDraft: true,
          },
        },
      },
    });
    if (material === null) throw this.notFound();
    if (material.category === 'EXECUTION_SUPPLEMENT') {
      if (
        supplement === undefined ||
        reader !== supplement.transaction ||
        material.ownerType !== 'CASE' ||
        material.ownerId !== supplement.caseId
      )
        throw this.versionConflict();
      const current = material.contentVersions.find(
        (v) => v.id === material.currentVersionId,
      );
      const draft = current?.executionSupplementUploadDraft;
      const target = draft && this.executionSupplementUploadTarget(draft);
      if (
        !current ||
        !draft ||
        !target ||
        current.uploadedBy !== actor.userId ||
        draft.actorUserId !== actor.userId ||
        draft.departmentId !== actor.departmentId ||
        draft.ownerId !== material.ownerId ||
        draft.status !== 'FINALIZED' ||
        draft.pendingStorageKey !== null ||
        current.originalFilename !== draft.originalFilename
      )
        throw this.forbidden();
      const binding = await this.assertExecutionSupplementTarget(
        supplement.transaction,
        actor,
        material.ownerId,
        target,
        supplement.operation === 'delete' ? 'DELETE_PREPARATION' : true,
      );
      if (
        draft.internalActorUserId !==
          (binding === undefined ? actor.userId : null) ||
        draft.lawyerAccountBindingId !== (binding ?? null)
      )
        throw this.forbidden();
      if (
        (await this.hasExecutionSupplementFirstFreeze(
          supplement.transaction,
          current.id,
        )) ||
        (await supplement.transaction.materialReference.count({
          where: { materialId },
        })) > 0
      )
        throw this.versionConflict();
    } else {
      if (supplement !== undefined) throw this.versionConflict();
      await this.authorizeOwner(
        actor,
        material.ownerType,
        material.ownerId,
        'write',
        reader,
        snapshotReader,
        undefined,
        material.category,
      );
    }
    if (
      actor.lawyerAccountId !== undefined &&
      (material.ownerType !== 'CASE' ||
        !material.contentVersions.some(
          (version) =>
            version.id === material.currentVersionId &&
            version.uploadedBy === actor.userId,
        ))
    )
      throw this.forbidden();
    if (
      material.ownerType === 'LEAD_DRAFT' &&
      !material.contentVersions.some(
        (version) => version.uploadedBy === actor.userId,
      )
    ) {
      throw this.forbidden();
    }
    return material;
  }

  private async hasCustomerAgreementScope(
    actor: ActorContext,
    customerId: string,
  ): Promise<boolean> {
    if (
      actor.clientCustomerId !== undefined ||
      actor.notaryOfficeId !== undefined ||
      actor.lawyerAccountId !== undefined
    )
      return false;
    let scope: Awaited<ReturnType<AccessControlService['buildCustomerScope']>>;
    try {
      scope = await this.accessControl.buildCustomerScope(
        actor,
        'customer.agreement.read',
      );
    } catch (error) {
      if (error instanceof ForbiddenException) return false;
      throw error;
    }
    return (
      (await this.database.customer.findFirst({
        where: { id: customerId, deletedAt: null, ...scope },
        select: { id: true },
      })) !== null
    );
  }

  private async lockMaterialMutationActorFirst(
    transaction: MaterialTransactionClient,
    actor: ActorContext,
    materialId: string,
  ): Promise<
    Readonly<{ agreementLocked: boolean; supplementCaseId?: string }>
  > {
    const hint = await transaction.material.findFirst({
      where: { id: materialId, departmentId: actor.departmentId },
      select: { ownerType: true, ownerId: true, category: true },
    });
    if (hint?.category === 'FEE_PROOF') {
      if (hint.ownerType !== 'CASE') throw this.invalidVersion();
      await this.lockFeeMaterialActor(transaction, actor);
      await this.authorizeOwner(
        actor,
        'CASE',
        hint.ownerId,
        'write',
        transaction,
        transaction,
        undefined,
        'FEE_PROOF',
      );
      const locked = await transaction.$queryRawUnsafe<Array<{ id: string }>>(
        'SELECT "id" FROM "cases" WHERE "id"=$1::uuid AND "department_id"=$2::uuid FOR UPDATE',
        hint.ownerId,
        actor.departmentId,
      );
      if (locked.length !== 1) throw this.notFound();
      return { agreementLocked: false };
    }
    if (hint?.category === 'EXECUTION_SUPPLEMENT') {
      if (hint.ownerType !== 'CASE') throw this.invalidVersion();
      const locked = await transaction.$queryRawUnsafe<Array<{ id: string }>>(
        'SELECT "id" FROM "cases" WHERE "id"=$1::uuid AND "department_id"=$2::uuid FOR UPDATE',
        hint.ownerId,
        actor.departmentId,
      );
      if (locked.length !== 1) throw this.notFound();
      return { agreementLocked: false, supplementCaseId: hint.ownerId };
    }
    if (
      hint?.ownerType !== 'CUSTOMER' ||
      hint.category !== 'CUSTOMER_AGREEMENT'
    )
      return { agreementLocked: false };
    if (!this.organization) throw new Error('OrganizationService unavailable');
    await lockCustomerActorFacts(transaction, this.organization, actor);
    await this.authorizeOwner(
      actor,
      'CUSTOMER',
      hint.ownerId,
      'write',
      transaction,
      transaction,
      undefined,
      hint.category,
    );
    const locked = await transaction.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM customers WHERE id = ${hint.ownerId}::uuid
        AND department_id = ${actor.departmentId}::uuid FOR UPDATE`;
    if (locked.length !== 1) throw this.notFound();
    await this.authorizeOwner(
      actor,
      'CUSTOMER',
      hint.ownerId,
      'write',
      transaction,
      transaction,
      undefined,
      hint.category,
    );
    return { agreementLocked: true };
  }

  private async assertAgreementCategoryDidNotAppear(
    transaction: MaterialTransactionClient,
    actor: ActorContext,
    materialId: string,
    agreementLocked: boolean,
  ): Promise<void> {
    const current = await transaction.material.findFirst({
      where: { id: materialId, departmentId: actor.departmentId },
      select: { ownerType: true, category: true },
    });
    if (
      current?.ownerType === 'CUSTOMER' &&
      current.category === 'CUSTOMER_AGREEMENT' &&
      !agreementLocked
    )
      throw this.versionConflict();
  }

  private async lockMaterialAndCurrentVersion(
    transaction: MaterialTransactionClient,
    departmentId: string,
    materialId: string,
  ): Promise<void> {
    const locked = await transaction.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT m."id"
       FROM "materials" m
       JOIN "content_versions" cv ON cv."id" = m."current_version_id"
       WHERE m."id" = $1::uuid AND m."department_id" = $2::uuid
       FOR NO KEY UPDATE OF m, cv`,
      materialId,
      departmentId,
    );
    if (locked.length !== 1) throw this.notFound();
  }

  private async withSerializableMaterialMutation<T>(
    operation: (transaction: MaterialTransactionClient) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.database.$transaction(operation, {
          isolationLevel: 'Serializable',
        });
      } catch (error) {
        if (!this.isSerializationConflict(error)) throw error;
        if (attempt === 2) throw this.versionConflict();
      }
    }
    throw this.versionConflict();
  }

  private isSerializationConflict(error: unknown): boolean {
    if (error === null || typeof error !== 'object') return false;
    const record = error as Record<string, unknown>;
    if (record.code === 'P2034') return true;
    if (record.code === 'P2010') {
      const meta = record.meta;
      const adapter =
        meta !== null &&
        typeof meta === 'object' &&
        'driverAdapterError' in meta
          ? meta.driverAdapterError
          : undefined;
      const cause =
        adapter !== null && typeof adapter === 'object' && 'cause' in adapter
          ? adapter.cause
          : undefined;
      if (
        cause !== null &&
        typeof cause === 'object' &&
        (('originalCode' in cause && cause.originalCode === '40001') ||
          ('sqlState' in cause && cause.sqlState === '40001'))
      ) {
        return true;
      }
    }
    return this.isSerializationConflict(record.cause);
  }

  async listFrozenCertificateFiles(
    actor: ActorContext,
    matterId: string,
    certificateId: string,
  ) {
    if (actor.lawyerAccountId !== undefined) {
      const sourceCase = await this.database.case.findFirst({
        where: {
          departmentId: actor.departmentId,
          sourceNotaryMatterId: matterId,
          certificateId,
        },
        select: { id: true },
      });
      if (sourceCase === null) throw this.notFound();
      await currentLawyerBindingId(this.database, actor, sourceCase.id);
    } else {
      await this.authorizeOwner(
        actor,
        'NOTARY_MATTER',
        matterId,
        'read',
        this.database,
        undefined,
        undefined,
        'NOTARY_CERTIFICATE',
      );
    }
    const refs = await this.database.materialReference.findMany({
      where: {
        departmentId: actor.departmentId,
        resourceType: 'notary_matter',
        resourceId: matterId,
        purpose: { in: ['NOTARY_CERTIFICATE', 'NOTARY_DISCLOSURE'] },
        actionEventId: { not: null },
        actionEvent: {
          action: 'notary.certificate_issued',
          departmentId: actor.departmentId,
          resourceType: 'notary_matter',
          resourceId: matterId,
          details: { path: ['certificateId'], equals: certificateId },
        },
        material: {
          departmentId: actor.departmentId,
          ownerType: 'NOTARY_MATTER',
          ownerId: matterId,
          status: 'ACTIVE',
        },
      },
      select: {
        purpose: true,
        materialId: true,
        contentVersionId: true,
        actionEvent: { select: { details: true } },
        contentVersion: { select: { originalFilename: true, mimeType: true } },
      },
    });
    return refs
      .filter((ref) =>
        isFrozenCertificateVersion(
          ref.actionEvent?.details,
          ref.purpose,
          ref.contentVersionId,
        ),
      )
      .map((ref) => ({
        purpose: ref.purpose,
        materialId: ref.materialId,
        contentVersionId: ref.contentVersionId,
        originalFilename: ref.contentVersion.originalFilename,
        mimeType: ref.contentVersion.mimeType,
      }));
  }

  async listFrozenCaseComplaintFiles(actor: ActorContext, caseId: string) {
    await this.authorizeOwner(actor, 'CASE', caseId, 'read');
    const refs = await this.database.materialReference.findMany({
      where: {
        departmentId: actor.departmentId,
        resourceType: 'case',
        resourceId: caseId,
        purpose: { in: ['COMPLAINT', 'AUTHORIZATION'] },
        actionEvent: {
          action: 'case.complaint.submitted',
          resourceType: 'CASE',
          resourceId: caseId,
          departmentId: actor.departmentId,
        },
        material: {
          ownerType: 'CASE',
          ownerId: caseId,
          departmentId: actor.departmentId,
          status: 'ACTIVE',
        },
      },
      orderBy: { createdAt: 'asc' },
      select: {
        purpose: true,
        materialId: true,
        contentVersionId: true,
        contentVersion: { select: { originalFilename: true, mimeType: true } },
      },
    });
    return refs.map((ref) => ({
      purpose: ref.purpose,
      materialId: ref.materialId,
      contentVersionId: ref.contentVersionId,
      originalFilename: ref.contentVersion.originalFilename,
      mimeType: ref.contentVersion.mimeType,
    }));
  }

  async listSubmittedCaseComplaintVersionIds(
    transaction: MaterialTransactionClient,
    actor: ActorContext,
    caseId: string,
  ): Promise<readonly string[]> {
    await this.authorizeOwner(
      actor,
      'CASE',
      caseId,
      'read',
      transaction,
      transaction,
    );
    const references = await transaction.materialReference.findMany({
      where: {
        departmentId: actor.departmentId,
        resourceType: 'case',
        resourceId: caseId,
        purpose: 'COMPLAINT',
        actionEvent: {
          action: 'case.complaint.submitted',
          resourceType: 'CASE',
          resourceId: caseId,
          departmentId: actor.departmentId,
        },
      },
      select: { contentVersionId: true },
    });
    return references.map((reference) => reference.contentVersionId);
  }

  async freezeCaseComplaintConfirmationReference(
    transaction: MaterialTransactionClient,
    actor: ActorContext,
    caseId: string,
    fact: ValidatedMaterialVersionFact,
    actionEventId: string,
  ) {
    const validation = this.validatedVersionFacts.get(fact);
    if (
      validation === undefined ||
      validation.transaction !== transaction ||
      validation.canonicalFact.departmentId !== actor.departmentId ||
      validation.canonicalFact.ownerType !== 'CASE' ||
      validation.canonicalFact.ownerId !== caseId ||
      validation.canonicalFact.category !== 'COMPLAINT' ||
      validation.firstUploadTarget !== undefined ||
      validation.canonicalFact.purpose !== 'COMPLAINT'
    )
      throw this.invalidVersion();
    return transaction.materialReference.create({
      data: {
        departmentId: actor.departmentId,
        resourceType: 'case',
        resourceId: caseId,
        purpose: 'COMPLAINT_CONFIRMATION',
        materialId: validation.canonicalFact.materialId,
        contentVersionId: validation.canonicalFact.contentVersionId,
        actionEventId,
      },
    });
  }

  async freezeCaseComplaintMailingReferences(
    transaction: MaterialTransactionClient,
    actor: ActorContext,
    caseId: string,
    mailingId: string,
    facts: readonly ValidatedMaterialVersionFact[],
    actionEventId: string,
  ): Promise<void> {
    for (const fact of facts) {
      const validation = this.validatedVersionFacts.get(fact);
      if (
        validation === undefined ||
        validation.transaction !== transaction ||
        validation.canonicalFact.departmentId !== actor.departmentId ||
        validation.canonicalFact.ownerType !== 'CASE' ||
        validation.canonicalFact.ownerId !== caseId ||
        validation.canonicalFact.category !== 'MAIL_RECEIPT' ||
        validation.firstUploadTarget !== undefined ||
        validation.canonicalFact.purpose !== 'MAIL_RECEIPT'
      )
        throw this.invalidVersion();
      await transaction.caseComplaintMailingVersion.create({
        data: {
          mailingId,
          caseId,
          departmentId: actor.departmentId,
          materialId: validation.canonicalFact.materialId,
          contentVersionId: validation.canonicalFact.contentVersionId,
        },
      });
      await transaction.materialReference.create({
        data: {
          departmentId: actor.departmentId,
          resourceType: 'case',
          resourceId: caseId,
          purpose: 'MAIL_RECEIPT',
          materialId: validation.canonicalFact.materialId,
          contentVersionId: validation.canonicalFact.contentVersionId,
          actionEventId,
        },
      });
    }
  }

  async listFrozenCaseComplaintConfirmationFile(
    actor: ActorContext,
    caseId: string,
  ) {
    await this.authorizeOwner(actor, 'CASE', caseId, 'read');
    const ref = await this.database.materialReference.findFirst({
      where: {
        departmentId: actor.departmentId,
        resourceType: 'case',
        resourceId: caseId,
        purpose: 'COMPLAINT_CONFIRMATION',
        actionEvent: {
          action: 'case.complaint.confirmed',
          resourceType: 'CASE',
          resourceId: caseId,
          departmentId: actor.departmentId,
        },
      },
      select: {
        materialId: true,
        contentVersionId: true,
        contentVersion: { select: { originalFilename: true, mimeType: true } },
      },
    });
    return ref === null
      ? null
      : {
          materialId: ref.materialId,
          contentVersionId: ref.contentVersionId,
          originalFilename: ref.contentVersion.originalFilename,
          mimeType: ref.contentVersion.mimeType,
        };
  }

  async freezeCaseFilingReferences(
    transaction: MaterialTransactionClient,
    actor: ActorContext,
    caseId: string,
    submissionId: string,
    facts: readonly ValidatedMaterialVersionFact[],
    actionEventId: string,
  ): Promise<void> {
    for (const fact of facts) {
      const validation = this.validatedVersionFacts.get(fact);
      const canonical = validation?.canonicalFact;
      if (
        validation?.firstUploadTarget !== undefined ||
        validation?.transaction !== transaction ||
        canonical?.departmentId !== actor.departmentId ||
        canonical.ownerType !== 'CASE' ||
        canonical.ownerId !== caseId ||
        !['FILING_EVIDENCE', 'FILING_SCREENSHOT'].includes(
          canonical.category,
        ) ||
        canonical.purpose !== canonical.category ||
        !allowedMimeTypes[canonical.category].has(canonical.mimeType) ||
        canonical.sizeBytes > BigInt(materialFileLimit(canonical.category))
      )
        throw this.invalidVersion();
      await transaction.caseFilingVersion.create({
        data: {
          submissionId,
          caseId,
          departmentId: actor.departmentId,
          materialId: canonical.materialId,
          contentVersionId: canonical.contentVersionId,
          category: canonical.category,
        },
      });
      await transaction.materialReference.create({
        data: {
          departmentId: actor.departmentId,
          resourceType: 'case',
          resourceId: caseId,
          purpose: canonical.category,
          materialId: canonical.materialId,
          contentVersionId: canonical.contentVersionId,
          actionEventId,
        },
      });
    }
  }

  async listFrozenCaseFilingFiles(actor: ActorContext, caseId: string) {
    await this.authorizeOwner(actor, 'CASE', caseId, 'read');
    const references = await this.database.materialReference.findMany({
      where: {
        departmentId: actor.departmentId,
        resourceType: 'case',
        resourceId: caseId,
        purpose: { in: ['FILING_EVIDENCE', 'FILING_SCREENSHOT'] },
        actionEvent: {
          action: 'case.filing.submitted',
          resourceType: 'CASE',
          resourceId: caseId,
          departmentId: actor.departmentId,
        },
      },
      orderBy: { createdAt: 'asc' },
      select: {
        purpose: true,
        materialId: true,
        contentVersionId: true,
        contentVersion: { select: { originalFilename: true, mimeType: true } },
      },
    });
    return references.map((reference) => ({
      purpose: reference.purpose,
      materialId: reference.materialId,
      contentVersionId: reference.contentVersionId,
      originalFilename: reference.contentVersion.originalFilename,
      mimeType: reference.contentVersion.mimeType,
    }));
  }

  async freezeCaseAcceptanceReferences(
    transaction: MaterialTransactionClient,
    actor: ActorContext,
    caseId: string,
    acceptanceId: string,
    facts: readonly ValidatedMaterialVersionFact[],
    actionEventId: string,
  ): Promise<void> {
    for (const fact of facts) {
      const validation = this.validatedVersionFacts.get(fact);
      const canonical = validation?.canonicalFact;
      if (
        validation?.firstUploadTarget !== undefined ||
        validation?.transaction !== transaction ||
        canonical?.departmentId !== actor.departmentId ||
        canonical.ownerType !== 'CASE' ||
        canonical.ownerId !== caseId ||
        !['ACCEPTANCE_NOTICE', 'PAYMENT_LIST', 'SERVICE_DOCUMENT'].includes(
          canonical.category,
        ) ||
        canonical.purpose !== canonical.category ||
        !allowedMimeTypes[canonical.category].has(canonical.mimeType) ||
        canonical.sizeBytes > BigInt(materialFileLimit(canonical.category))
      )
        throw this.invalidVersion();
      await transaction.caseAcceptanceVersion.create({
        data: {
          acceptanceId,
          caseId,
          departmentId: actor.departmentId,
          materialId: canonical.materialId,
          contentVersionId: canonical.contentVersionId,
          category: canonical.category,
        },
      });
      await transaction.materialReference.create({
        data: {
          departmentId: actor.departmentId,
          resourceType: 'case',
          resourceId: caseId,
          purpose: canonical.category,
          materialId: canonical.materialId,
          contentVersionId: canonical.contentVersionId,
          actionEventId,
        },
      });
    }
  }

  async freezeCaseJudgmentReferences(
    transaction: MaterialTransactionClient,
    actor: ActorContext,
    caseId: string,
    factId: string,
    facts: readonly ValidatedMaterialVersionFact[],
    actionEventId: string,
  ): Promise<void> {
    for (const fact of facts) {
      const validation = this.validatedVersionFacts.get(fact);
      const canonical = validation?.canonicalFact;
      if (
        validation?.firstUploadTarget !== undefined ||
        validation?.transaction !== transaction ||
        canonical?.departmentId !== actor.departmentId ||
        canonical.ownerType !== 'CASE' ||
        canonical.ownerId !== caseId ||
        canonical.category !== 'JUDGMENT' ||
        canonical.purpose !== 'JUDGMENT' ||
        !allowedMimeTypes.JUDGMENT.has(canonical.mimeType) ||
        canonical.sizeBytes > BigInt(materialFileLimit('JUDGMENT'))
      )
        throw this.invalidVersion();
      await transaction.caseJudgmentVersion.create({
        data: {
          factId,
          caseId,
          departmentId: actor.departmentId,
          materialId: canonical.materialId,
          contentVersionId: canonical.contentVersionId,
        },
      });
      await transaction.materialReference.create({
        data: {
          departmentId: actor.departmentId,
          resourceType: 'case',
          resourceId: caseId,
          purpose: 'JUDGMENT',
          materialId: canonical.materialId,
          contentVersionId: canonical.contentVersionId,
          actionEventId,
        },
      });
    }
  }

  async freezeCaseSecondInstanceReferences(
    transaction: MaterialTransactionClient,
    actor: ActorContext,
    caseId: string,
    factId: string,
    facts: readonly ValidatedMaterialVersionFact[],
    actionEventId: string,
    target: 'PROGRESS' | 'RESULT',
  ): Promise<void> {
    for (const fact of facts) {
      const validation = this.validatedVersionFacts.get(fact);
      const canonical = validation?.canonicalFact;
      if (
        validation?.firstUploadTarget !== undefined ||
        validation?.transaction !== transaction ||
        canonical?.departmentId !== actor.departmentId ||
        canonical.ownerType !== 'CASE' ||
        canonical.ownerId !== caseId ||
        canonical.purpose !== canonical.category ||
        (target === 'PROGRESS'
          ? !['SECOND_INSTANCE_DOCUMENT', 'SECOND_INSTANCE_SERVICE'].includes(
              canonical.category,
            )
          : canonical.category !== 'SECOND_INSTANCE_JUDGMENT') ||
        !allowedMimeTypes[canonical.category].has(canonical.mimeType) ||
        canonical.sizeBytes > BigInt(materialFileLimit(canonical.category))
      )
        throw this.invalidVersion();
      if (target === 'PROGRESS') {
        await transaction.caseSecondInstanceProgressVersion.create({
          data: {
            progressId: factId,
            caseId,
            departmentId: actor.departmentId,
            materialId: canonical.materialId,
            contentVersionId: canonical.contentVersionId,
            category: canonical.category,
          },
        });
      } else {
        await transaction.caseSecondInstanceResultVersion.create({
          data: {
            resultId: factId,
            caseId,
            departmentId: actor.departmentId,
            materialId: canonical.materialId,
            contentVersionId: canonical.contentVersionId,
          },
        });
      }
      await transaction.materialReference.create({
        data: {
          departmentId: actor.departmentId,
          resourceType: 'case',
          resourceId: caseId,
          purpose: canonical.category,
          materialId: canonical.materialId,
          contentVersionId: canonical.contentVersionId,
          actionEventId,
        },
      });
    }
  }

  async freezeCaseExecutionSubmissionReferences(
    transaction: MaterialTransactionClient,
    actor: ActorContext,
    caseId: string,
    submissionId: string,
    facts: readonly ValidatedMaterialVersionFact[],
    actionEventId: string,
  ): Promise<void> {
    for (const fact of facts) {
      const validation = this.validatedVersionFacts.get(fact);
      const canonical = validation?.canonicalFact;
      if (
        validation?.firstUploadTarget !== undefined ||
        validation?.transaction !== transaction ||
        canonical?.departmentId !== actor.departmentId ||
        canonical.ownerType !== 'CASE' ||
        canonical.ownerId !== caseId ||
        canonical.category !== 'EXECUTION_APPLICATION' ||
        canonical.purpose !== 'EXECUTION_APPLICATION' ||
        !allowedMimeTypes.EXECUTION_APPLICATION.has(canonical.mimeType) ||
        canonical.sizeBytes > BigInt(materialFileLimit('EXECUTION_APPLICATION'))
      )
        throw this.invalidVersion();
      await transaction.caseExecutionSubmissionVersion.create({
        data: {
          submissionId,
          caseId,
          departmentId: actor.departmentId,
          materialId: canonical.materialId,
          contentVersionId: canonical.contentVersionId,
        },
      });
      await transaction.materialReference.create({
        data: {
          departmentId: actor.departmentId,
          resourceType: 'case',
          resourceId: caseId,
          purpose: 'EXECUTION_APPLICATION',
          materialId: canonical.materialId,
          contentVersionId: canonical.contentVersionId,
          actionEventId,
        },
      });
    }
  }

  async freezeCaseExecutionConfirmationReferences(
    transaction: MaterialTransactionClient,
    actor: ActorContext,
    caseId: string,
    confirmationId: string,
    facts: readonly ValidatedMaterialVersionFact[],
    actionEventId: string,
  ): Promise<void> {
    if (facts.length < 1 || facts.length > 10) throw this.invalidVersion();
    for (const fact of facts) {
      const validation = this.validatedVersionFacts.get(fact);
      const canonical = validation?.canonicalFact;
      if (
        validation?.firstUploadTarget !== undefined ||
        validation?.transaction !== transaction ||
        canonical?.departmentId !== actor.departmentId ||
        canonical.ownerType !== 'CASE' ||
        canonical.ownerId !== caseId ||
        canonical.category !== 'EXECUTION_APPLICATION' ||
        canonical.purpose !== 'EXECUTION_APPLICATION' ||
        !allowedMimeTypes.EXECUTION_APPLICATION.has(canonical.mimeType) ||
        canonical.sizeBytes > BigInt(materialFileLimit('EXECUTION_APPLICATION'))
      )
        throw this.invalidVersion();
      await transaction.caseExecutionConfirmationVersion.create({
        data: {
          confirmationId,
          caseId,
          departmentId: actor.departmentId,
          materialId: canonical.materialId,
          contentVersionId: canonical.contentVersionId,
        },
      });
      await transaction.materialReference.create({
        data: {
          departmentId: actor.departmentId,
          resourceType: 'case',
          resourceId: caseId,
          purpose: 'EXECUTION_APPLICATION',
          materialId: canonical.materialId,
          contentVersionId: canonical.contentVersionId,
          actionEventId,
        },
      });
    }
  }

  async freezeCaseSectionRecordCorrectionReferences(
    transaction: MaterialTransactionClient,
    actor: ActorContext,
    caseId: string,
    target: CaseSectionRecordCorrectionReferenceTarget,
    facts: readonly ValidatedMaterialVersionFact[],
    auditEventId: string,
  ): Promise<void> {
    const definition = sectionRecordMaterials[target.kind];
    if (
      definition === undefined ||
      actor.clientCustomerId !== undefined ||
      actor.notaryOfficeId !== undefined ||
      actor.lawyerAccountId !== undefined ||
      !caseId.trim() ||
      !target.correctionId.trim() ||
      !auditEventId.trim() ||
      facts.length > 10 ||
      (facts.length === 0 &&
        target.kind !== 'EXECUTION_FINISH' &&
        target.kind !== 'CLOSURE')
    )
      throw this.invalidVersion();
    for (const fact of facts) {
      const validation = this.validatedVersionFacts.get(fact);
      if (validation?.firstUploadTarget !== undefined) {
        if (
          validation.transaction !== transaction ||
          validation.firstUploadTarget.kind !== target.kind
        )
          throw this.invalidVersion();
        await this.assertFirstUploadCorrection(
          transaction,
          actor,
          caseId,
          target.correctionId,
          auditEventId,
          validation.firstUploadTarget,
        );
      }
    }
    const canonicalFacts = facts.map((fact) => {
      const validation = this.validatedVersionFacts.get(fact);
      const canonical = validation?.canonicalFact;
      if (
        validation?.transaction !== transaction ||
        canonical?.departmentId !== actor.departmentId ||
        canonical.ownerType !== 'CASE' ||
        canonical.ownerId !== caseId ||
        canonical.category !== definition.category ||
        canonical.purpose !== definition.category ||
        !allowedMimeTypes[definition.category].has(canonical.mimeType) ||
        canonical.sizeBytes <= 0n ||
        canonical.sizeBytes > BigInt(materialFileLimit(definition.category))
      )
        throw this.invalidVersion();
      return canonical;
    });
    if (
      new Set(canonicalFacts.map((fact) => fact.materialId)).size !==
        facts.length ||
      new Set(canonicalFacts.map((fact) => fact.contentVersionId)).size !==
        facts.length
    ) {
      throw this.invalidVersion();
    }
    for (const fact of canonicalFacts) {
      const data = {
        correctionId: target.correctionId,
        caseId,
        departmentId: actor.departmentId,
        materialId: fact.materialId,
        contentVersionId: fact.contentVersionId,
      };
      switch (target.kind) {
        case 'EXECUTION_MAILING':
          await transaction.caseExecutionMailingRecordCorrectionDocument.create(
            { data },
          );
          break;
        case 'EXECUTION_FILING':
          await transaction.caseExecutionFilingRecordCorrectionDocument.create({
            data,
          });
          break;
        case 'EXECUTION_FINISH':
          await transaction.caseExecutionFinishRecordCorrectionDocument.create({
            data,
          });
          break;
        case 'JUDGMENT':
          await transaction.caseJudgmentRecordCorrectionDocument.create({
            data,
          });
          break;
        case 'CLOSURE':
          await transaction.caseClosureRecordCorrectionDocument.create({
            data,
          });
          break;
      }
    }
    for (const fact of facts) {
      const validation = this.validatedVersionFacts.get(fact);
      if (validation?.firstUploadTarget !== undefined)
        validation.sectionFreezeEventId = auditEventId;
    }
    if (facts.length > 0) {
      const inserted = await this.freezeReferences(transaction, {
        departmentId: actor.departmentId,
        resourceType: 'case',
        resourceId: caseId,
        facts,
        actionEventId: auditEventId,
      });
      if (inserted.count !== facts.length) throw this.invalidVersion();
    }
  }

  private async assertFirstUploadCorrection(
    tx: MaterialTransactionClient,
    actor: ActorContext,
    caseId: string,
    correctionId: string,
    auditEventId: string,
    target: CaseSectionRecordUploadTarget,
  ) {
    const where = {
      id: correctionId,
      caseId,
      departmentId: actor.departmentId,
      recordedByUserId: actor.userId,
      auditEventId,
      fromRevision: target.expectedRevision,
    };
    let exact = false;
    switch (target.kind) {
      case 'EXECUTION_MAILING':
        exact =
          (await tx.caseExecutionMailingRecordCorrection.findFirst({
            where: { ...where, mailingId: target.targetId },
            select: { id: true },
          })) !== null;
        break;
      case 'EXECUTION_FILING':
        exact =
          (await tx.caseExecutionFilingRecordCorrection.findFirst({
            where: { ...where, filingId: target.targetId },
            select: { id: true },
          })) !== null;
        break;
      case 'EXECUTION_FINISH':
        exact =
          (await tx.caseExecutionFinishRecordCorrection.findFirst({
            where: { ...where, finishId: target.targetId },
            select: { id: true },
          })) !== null;
        break;
      case 'JUDGMENT':
        exact =
          (await tx.caseJudgmentRecordCorrection.findFirst({
            where: {
              ...where,
              judgmentId: target.targetId,
              trialRoundId: target.trialRoundId,
            },
            select: { id: true },
          })) !== null;
        break;
      case 'CLOSURE':
        exact =
          (await tx.caseClosureRecordCorrection.findFirst({
            where: {
              ...where,
              closureId: target.targetId,
              sourceClosureVersionId: target.expectedClosureVersionId,
            },
            select: { id: true },
          })) !== null;
        break;
    }
    if (!exact) throw this.invalidVersion();
  }

  async freezeCaseExecutionMailingReferences(
    transaction: MaterialTransactionClient,
    actor: ActorContext,
    caseId: string,
    mailingId: string,
    facts: readonly ValidatedMaterialVersionFact[],
    actionEventId: string,
  ): Promise<void> {
    for (const fact of facts) {
      const validation = this.validatedVersionFacts.get(fact);
      const canonical = validation?.canonicalFact;
      if (
        validation?.firstUploadTarget !== undefined ||
        validation?.transaction !== transaction ||
        canonical?.departmentId !== actor.departmentId ||
        canonical.ownerType !== 'CASE' ||
        canonical.ownerId !== caseId ||
        canonical.category !== 'MAIL_RECEIPT' ||
        canonical.purpose !== 'MAIL_RECEIPT' ||
        !allowedMimeTypes.MAIL_RECEIPT.has(canonical.mimeType) ||
        canonical.sizeBytes > BigInt(materialFileLimit('MAIL_RECEIPT'))
      )
        throw this.invalidVersion();
      await transaction.caseExecutionMailingVersion.create({
        data: {
          mailingId,
          caseId,
          departmentId: actor.departmentId,
          materialId: canonical.materialId,
          contentVersionId: canonical.contentVersionId,
        },
      });
      await transaction.materialReference.create({
        data: {
          departmentId: actor.departmentId,
          resourceType: 'case',
          resourceId: caseId,
          purpose: 'MAIL_RECEIPT',
          materialId: canonical.materialId,
          contentVersionId: canonical.contentVersionId,
          actionEventId,
        },
      });
    }
  }

  async freezeCaseExecutionFilingReferences(
    transaction: MaterialTransactionClient,
    actor: ActorContext,
    caseId: string,
    filingId: string,
    facts: readonly ValidatedMaterialVersionFact[],
    actionEventId: string,
  ): Promise<void> {
    for (const fact of facts) {
      const validation = this.validatedVersionFacts.get(fact);
      const canonical = validation?.canonicalFact;
      if (
        validation?.firstUploadTarget !== undefined ||
        validation?.transaction !== transaction ||
        canonical?.departmentId !== actor.departmentId ||
        canonical.ownerType !== 'CASE' ||
        canonical.ownerId !== caseId ||
        canonical.category !== 'EXECUTION_FILING_PROOF' ||
        canonical.purpose !== 'EXECUTION_FILING_PROOF' ||
        !allowedMimeTypes.EXECUTION_FILING_PROOF.has(canonical.mimeType) ||
        canonical.sizeBytes >
          BigInt(materialFileLimit('EXECUTION_FILING_PROOF'))
      )
        throw this.invalidVersion();
      await transaction.caseExecutionFilingVersion.create({
        data: {
          filingId,
          caseId,
          departmentId: actor.departmentId,
          materialId: canonical.materialId,
          contentVersionId: canonical.contentVersionId,
        },
      });
      await transaction.materialReference.create({
        data: {
          departmentId: actor.departmentId,
          resourceType: 'case',
          resourceId: caseId,
          purpose: 'EXECUTION_FILING_PROOF',
          materialId: canonical.materialId,
          contentVersionId: canonical.contentVersionId,
          actionEventId,
        },
      });
    }
  }

  async freezeCaseClosureReferences(
    transaction: MaterialTransactionClient,
    actor: ActorContext,
    caseId: string,
    closureVersionId: string,
    facts: readonly ValidatedMaterialVersionFact[],
    actionEventId: string,
  ): Promise<void> {
    for (const fact of facts) {
      const validation = this.validatedVersionFacts.get(fact);
      const canonical = validation?.canonicalFact;
      if (
        validation?.firstUploadTarget !== undefined ||
        validation?.transaction !== transaction ||
        canonical?.departmentId !== actor.departmentId ||
        canonical.ownerType !== 'CASE' ||
        canonical.ownerId !== caseId ||
        canonical.category !== 'CASE_CLOSURE_DOCUMENT' ||
        canonical.purpose !== 'CASE_CLOSURE_DOCUMENT' ||
        !allowedMimeTypes.CASE_CLOSURE_DOCUMENT.has(canonical.mimeType) ||
        canonical.sizeBytes > BigInt(materialFileLimit('CASE_CLOSURE_DOCUMENT'))
      )
        throw this.invalidVersion();
      await transaction.caseClosureDocument.create({
        data: {
          closureVersionId,
          caseId,
          departmentId: actor.departmentId,
          materialId: canonical.materialId,
          contentVersionId: canonical.contentVersionId,
        },
      });
      await transaction.materialReference.create({
        data: {
          departmentId: actor.departmentId,
          resourceType: 'case',
          resourceId: caseId,
          purpose: 'CASE_CLOSURE_DOCUMENT',
          materialId: canonical.materialId,
          contentVersionId: canonical.contentVersionId,
          actionEventId,
        },
      });
    }
  }

  async listFrozenCaseClosureFiles(
    actor: ActorContext,
    caseId: string,
    closureVersionId: string,
  ) {
    if (
      actor.clientCustomerId !== undefined ||
      actor.notaryOfficeId !== undefined
    )
      throw this.forbidden();
    await this.authorizeOwner(actor, 'CASE', caseId, 'read');
    const documents = await this.database.caseClosureDocument.findMany({
      where: { caseId, departmentId: actor.departmentId, closureVersionId },
      select: {
        materialId: true,
        contentVersionId: true,
        contentVersion: { select: { originalFilename: true, mimeType: true } },
      },
      orderBy: { contentVersionId: 'asc' },
    });
    return documents.map((item) => ({
      materialId: item.materialId,
      contentVersionId: item.contentVersionId,
      originalFilename: item.contentVersion.originalFilename,
      mimeType: item.contentVersion.mimeType,
    }));
  }

  async freezeCaseExecutionFinishReferences(
    transaction: MaterialTransactionClient,
    actor: ActorContext,
    caseId: string,
    finishId: string,
    facts: readonly ValidatedMaterialVersionFact[],
    actionEventId: string,
  ): Promise<void> {
    for (const fact of facts) {
      const validation = this.validatedVersionFacts.get(fact);
      const canonical = validation?.canonicalFact;
      if (
        validation?.firstUploadTarget !== undefined ||
        validation?.transaction !== transaction ||
        canonical?.departmentId !== actor.departmentId ||
        canonical.ownerType !== 'CASE' ||
        canonical.ownerId !== caseId ||
        canonical.category !== 'EXECUTION_FINISH_BASIS' ||
        canonical.purpose !== 'EXECUTION_FINISH_BASIS' ||
        !allowedMimeTypes.EXECUTION_FINISH_BASIS.has(canonical.mimeType) ||
        canonical.sizeBytes >
          BigInt(materialFileLimit('EXECUTION_FINISH_BASIS'))
      )
        throw this.invalidVersion();
      await transaction.caseExecutionFinishVersion.create({
        data: {
          finishId,
          caseId,
          departmentId: actor.departmentId,
          materialId: canonical.materialId,
          contentVersionId: canonical.contentVersionId,
        },
      });
      await transaction.materialReference.create({
        data: {
          departmentId: actor.departmentId,
          resourceType: 'case',
          resourceId: caseId,
          purpose: 'EXECUTION_FINISH_BASIS',
          materialId: canonical.materialId,
          contentVersionId: canonical.contentVersionId,
          actionEventId,
        },
      });
    }
  }

  private async isFrozenCaseVersion(
    transaction: MaterialTransactionClient,
    category: MaterialCategoryValue,
    caseId: string,
    departmentId: string,
    materialId: string,
    contentVersionId: string,
    sectionRecordKind?: CaseSectionRecordKind,
  ): Promise<boolean> {
    if (category === 'EXECUTION_SUPPLEMENT')
      return this.hasExecutionSupplementFirstFreeze(
        transaction,
        contentVersionId,
        true,
      );
    if (sectionRecordKind !== undefined) {
      const definition = sectionRecordMaterials[sectionRecordKind];
      if (definition?.category !== category) return false;
      return (
        (await transaction.materialReference.findFirst({
          where: {
            departmentId,
            resourceType: 'case',
            resourceId: caseId,
            materialId,
            contentVersionId,
            purpose: category,
            actionEvent: {
              departmentId,
              resourceType: 'CASE',
              resourceId: caseId,
              action: { in: [...definition.actions] },
            },
          },
          select: { id: true },
        })) !== null
      );
    }
    if (category === 'CASE_CLOSURE_DOCUMENT')
      return (
        (await transaction.caseClosureDocument.findFirst({
          where: { caseId, departmentId, materialId, contentVersionId },
          select: { closureVersionId: true },
        })) !== null
      );
    if (category === 'EXECUTION_APPLICATION')
      return (
        (await transaction.caseExecutionSubmissionVersion.findFirst({
          where: { caseId, departmentId, materialId, contentVersionId },
          select: { submissionId: true },
        })) !== null ||
        (await transaction.caseExecutionConfirmationVersion.findFirst({
          where: { caseId, departmentId, materialId, contentVersionId },
          select: { confirmationId: true },
        })) !== null
      );
    if (category === 'JUDGMENT')
      return (
        (await transaction.caseJudgmentVersion.findFirst({
          where: { caseId, departmentId, materialId, contentVersionId },
          select: { factId: true },
        })) !== null
      );
    if (category === 'SECOND_INSTANCE_JUDGMENT')
      return (
        (await transaction.caseSecondInstanceResultVersion.findFirst({
          where: { caseId, departmentId, materialId, contentVersionId },
          select: { resultId: true },
        })) !== null
      );
    if (
      category === 'SECOND_INSTANCE_DOCUMENT' ||
      category === 'SECOND_INSTANCE_SERVICE'
    )
      return (
        (await transaction.caseSecondInstanceProgressVersion.findFirst({
          where: {
            caseId,
            departmentId,
            materialId,
            contentVersionId,
            category,
          },
          select: { progressId: true },
        })) !== null
      );
    return false;
  }

  async listFrozenCaseAcceptanceFiles(actor: ActorContext, caseId: string) {
    await this.authorizeOwner(actor, 'CASE', caseId, 'read');
    const references = await this.database.materialReference.findMany({
      where: {
        departmentId: actor.departmentId,
        resourceType: 'case',
        resourceId: caseId,
        purpose: {
          in: ['ACCEPTANCE_NOTICE', 'PAYMENT_LIST', 'SERVICE_DOCUMENT'],
        },
        actionEvent: {
          action: 'case.acceptance.registered',
          resourceType: 'CASE',
          resourceId: caseId,
          departmentId: actor.departmentId,
        },
      },
      orderBy: { createdAt: 'asc' },
      select: {
        purpose: true,
        materialId: true,
        contentVersionId: true,
        contentVersion: { select: { originalFilename: true, mimeType: true } },
      },
    });
    return references.map((reference) => ({
      purpose: reference.purpose,
      materialId: reference.materialId,
      contentVersionId: reference.contentVersionId,
      originalFilename: reference.contentVersion.originalFilename,
      mimeType: reference.contentVersion.mimeType,
    }));
  }

  async listFrozenCaseComplaintMailingFiles(
    actor: ActorContext,
    caseId: string,
  ) {
    await this.authorizeOwner(actor, 'CASE', caseId, 'read');
    const references = await this.database.materialReference.findMany({
      where: {
        departmentId: actor.departmentId,
        resourceType: 'case',
        resourceId: caseId,
        purpose: 'MAIL_RECEIPT',
        actionEvent: {
          action: 'case.complaint.mailed',
          resourceType: 'CASE',
          resourceId: caseId,
          departmentId: actor.departmentId,
        },
      },
      orderBy: { createdAt: 'asc' },
      select: {
        materialId: true,
        contentVersionId: true,
        contentVersion: { select: { originalFilename: true, mimeType: true } },
      },
    });
    return references.map((reference) => ({
      materialId: reference.materialId,
      contentVersionId: reference.contentVersionId,
      originalFilename: reference.contentVersion.originalFilename,
      mimeType: reference.contentVersion.mimeType,
    }));
  }

  async listFrozenCaseExecutionMailingFiles(
    actor: ActorContext,
    caseId: string,
  ) {
    await this.authorizeOwner(actor, 'CASE', caseId, 'read');
    const references = await this.database.materialReference.findMany({
      where: {
        departmentId: actor.departmentId,
        resourceType: 'case',
        resourceId: caseId,
        purpose: 'MAIL_RECEIPT',
        actionEvent: {
          action: 'case.execution.mailed',
          resourceType: 'CASE',
          resourceId: caseId,
          departmentId: actor.departmentId,
        },
      },
      orderBy: { createdAt: 'asc' },
      select: {
        materialId: true,
        contentVersionId: true,
        contentVersion: { select: { originalFilename: true, mimeType: true } },
      },
    });
    return references.map((reference) => ({
      materialId: reference.materialId,
      contentVersionId: reference.contentVersionId,
      originalFilename: reference.contentVersion.originalFilename,
      mimeType: reference.contentVersion.mimeType,
    }));
  }

  async listFrozenCaseExecutionFilingFiles(
    actor: ActorContext,
    caseId: string,
  ) {
    if (
      actor.clientCustomerId !== undefined ||
      actor.notaryOfficeId !== undefined
    )
      throw this.forbidden();
    await this.authorizeOwner(actor, 'CASE', caseId, 'read');
    const references = await this.database.materialReference.findMany({
      where: {
        departmentId: actor.departmentId,
        resourceType: 'case',
        resourceId: caseId,
        purpose: 'EXECUTION_FILING_PROOF',
        actionEvent: {
          action: 'case.execution.filing.submitted',
          resourceType: 'CASE',
          resourceId: caseId,
          departmentId: actor.departmentId,
        },
      },
      orderBy: { createdAt: 'asc' },
      select: {
        materialId: true,
        contentVersionId: true,
        contentVersion: { select: { originalFilename: true, mimeType: true } },
      },
    });
    return references.map((reference) => ({
      materialId: reference.materialId,
      contentVersionId: reference.contentVersionId,
      originalFilename: reference.contentVersion.originalFilename,
      mimeType: reference.contentVersion.mimeType,
    }));
  }

  async listFrozenCaseExecutionFinishFiles(
    actor: ActorContext,
    caseId: string,
  ) {
    if (
      actor.clientCustomerId !== undefined ||
      actor.notaryOfficeId !== undefined
    )
      throw this.forbidden();
    await this.authorizeOwner(actor, 'CASE', caseId, 'read');
    const references = await this.database.materialReference.findMany({
      where: {
        departmentId: actor.departmentId,
        resourceType: 'case',
        resourceId: caseId,
        purpose: 'EXECUTION_FINISH_BASIS',
        actionEvent: {
          action: 'case.execution.finished',
          resourceType: 'CASE',
          resourceId: caseId,
          departmentId: actor.departmentId,
        },
      },
      orderBy: { createdAt: 'asc' },
      select: {
        materialId: true,
        contentVersionId: true,
        contentVersion: { select: { originalFilename: true, mimeType: true } },
      },
    });
    return references.map((reference) => ({
      materialId: reference.materialId,
      contentVersionId: reference.contentVersionId,
      originalFilename: reference.contentVersion.originalFilename,
      mimeType: reference.contentVersion.mimeType,
    }));
  }

  private async authorizeOwner(
    actor: ActorContext,
    ownerType: MaterialOwnerTypeValue,
    ownerId: string,
    operation: 'read' | 'write',
    reader: MaterialAuthorizationReader = this.database,
    snapshotReader?: AccessControlSnapshotReader,
    leadAction?: Extract<
      LeadAction,
      'lead.read' | 'lead.edit' | 'lead.evidence.decide' | 'notary.unbox.record'
    >,
    notaryCategory?: MaterialCategoryValue,
  ): Promise<void> {
    if (notaryCategory === 'FEE_PROOF') {
      if (ownerType !== 'CASE' || !this.isInternalMaterialActor(actor))
        throw this.forbidden();
      await this.withMaterialAuthorization(() =>
        this.accessControl.authorizeDepartmentAction(
          actor,
          operation === 'write' ? 'fee.update' : 'fee.read',
          snapshotReader,
        ),
      );
      if (
        (await reader.case.findFirst({
          where: { id: ownerId, departmentId: actor.departmentId },
          select: { id: true },
        })) === null
      )
        throw this.notFound();
      return;
    }
    if (
      ownerType === 'CUSTOMER' &&
      (actor.clientCustomerId !== undefined ||
        actor.notaryOfficeId !== undefined ||
        actor.lawyerAccountId !== undefined)
    )
      throw this.forbidden();
    if (actor.lawyerAccountId !== undefined && ownerType !== 'CASE')
      throw this.forbidden();
    if (ownerType === 'CASE') {
      if (actor.notaryOfficeId !== undefined) throw this.forbidden();
      if (
        notaryCategory === 'CASE_CLOSURE_DOCUMENT' &&
        actor.clientCustomerId !== undefined
      )
        throw this.forbidden();
      if (operation === 'write' && notaryCategory === 'CASE_CLOSURE_DOCUMENT') {
        const source = await reader.$queryRawUnsafe<Array<{ id: string }>>(
          `SELECT c."id" FROM "cases" c JOIN "case_execution_finishes" f ON f."case_id"=c."id" AND f."department_id"=c."department_id"
           LEFT JOIN "case_closures" h ON h."case_id"=c."id" AND h."department_id"=c."department_id"
           LEFT JOIN "case_closure_versions" v ON v."id"=h."current_version_id" AND v."closure_id"=h."id" AND v."finish_id"=f."id" AND v."case_id"=c."id" AND v."department_id"=c."department_id"
           WHERE c."id"=$1::uuid AND c."department_id"=$2::uuid AND c."stage"='WAITING_ARCHIVE'
            AND c."source_lead_id" IS NOT NULL AND c."source_notary_matter_id" IS NOT NULL AND c."certificate_id" IS NOT NULL
            AND ((h."id" IS NULL AND f."to_version"=c."version") OR (h."finish_id"=f."id" AND v."to_version"=c."version"))
           UNION ALL
           SELECT c."id" FROM "cases" c
           JOIN "case_external_entries" e ON e."case_id"=c."id" AND e."department_id"=c."department_id"
           LEFT JOIN "case_execution_finishes" f ON f."case_id"=c."id" AND f."department_id"=c."department_id" AND f."external_entry_id"=e."id"
           LEFT JOIN "case_closures" h ON h."case_id"=c."id" AND h."department_id"=c."department_id" AND h."external_entry_id"=e."id"
           LEFT JOIN "case_closure_versions" v ON v."id"=h."current_version_id" AND v."closure_id"=h."id"
             AND v."case_id"=c."id" AND v."department_id"=c."department_id" AND v."external_entry_id"=e."id"
             AND v."finish_id" IS NOT DISTINCT FROM h."finish_id"
           WHERE c."id"=$1::uuid AND c."department_id"=$2::uuid AND c."stage"='WAITING_ARCHIVE'
             AND c."source_lead_id" IS NULL AND c."source_notary_matter_id" IS NULL AND c."certificate_id" IS NULL
             AND ((h."id" IS NULL AND ((e."initial_stage"='WAITING_ARCHIVE' AND c."version"=1 AND f."id" IS NULL)
               OR (f."id" IS NOT NULL AND f."to_version"=c."version")))
               OR (h."id" IS NOT NULL AND h."finish_id" IS NOT DISTINCT FROM f."id" AND v."to_version"=c."version"))`,
          ownerId,
          actor.departmentId,
        );
        if (source.length !== 1) throw this.versionConflict();
      }
      if (
        operation === 'write' &&
        notaryCategory === 'EXECUTION_FINISH_BASIS'
      ) {
        if (actor.clientCustomerId !== undefined) throw this.forbidden();
        const source = await reader.$queryRawUnsafe<Array<{ id: string }>>(
          `SELECT c."id" FROM "cases" c
           JOIN "case_execution_filings" f ON f."case_id"=c."id" AND f."department_id"=c."department_id" AND f."to_version"=c."version"
           JOIN "case_execution_mailings" m ON m."id"=f."mailing_id" AND m."case_id"=c."id" AND m."department_id"=c."department_id" AND m."to_version"=f."from_version"
           JOIN "case_execution_confirmations" conf ON conf."id"=m."confirmation_id" AND conf."case_id"=c."id" AND conf."department_id"=c."department_id" AND conf."to_version"=m."from_version"
           JOIN "case_execution_submissions" s ON s."id"=conf."submission_id" AND s."case_id"=c."id" AND s."department_id"=c."department_id" AND s."to_version"=conf."from_version"
           JOIN "case_judgment_next_steps" choice ON choice."id"=s."judgment_next_step_id" AND choice."case_id"=c."id" AND choice."department_id"=c."department_id" AND choice."trial_round_id"=s."trial_round_id"
           WHERE c."id"=$1::uuid AND c."department_id"=$2::uuid AND c."stage"='EXECUTING'
             AND c."source_lead_id" IS NOT NULL AND c."source_notary_matter_id" IS NOT NULL AND c."certificate_id" IS NOT NULL
             AND c."current_execution_submission_id"=s."id" AND c."current_trial_round_id"=s."trial_round_id"
             AND c."current_judgment_next_step_id"=s."judgment_next_step_id"
             AND c."current_second_instance_result_id" IS NOT DISTINCT FROM s."second_instance_result_id"
             AND NOT EXISTS (SELECT 1 FROM "case_judgment_next_step_revocations" r WHERE r."choice_id"=choice."id")
             AND ((choice."next"='EXECUTION' AND s."second_instance_result_id" IS NULL) OR
               (choice."next"='APPEAL' AND EXISTS (SELECT 1 FROM "case_second_instance_results" r
                 WHERE r."id"=s."second_instance_result_id" AND r."case_id"=c."id" AND r."department_id"=c."department_id"
                   AND r."choice_id"=choice."id" AND r."trial_round_id"=s."trial_round_id" AND r."result" IN ('CHANGE','AFFIRM')
                   AND NOT EXISTS (SELECT 1 FROM "case_second_instance_result_revocations" rev WHERE rev."result_id"=r."id"))))
             AND NOT EXISTS (SELECT 1 FROM "case_execution_finishes" ef WHERE ef."case_id"=c."id" AND ef."department_id"=c."department_id")
           UNION ALL
           SELECT c."id" FROM "cases" c
           JOIN "case_external_entries" e ON e."case_id"=c."id" AND e."department_id"=c."department_id"
           LEFT JOIN "case_execution_filings" f ON f."case_id"=c."id" AND f."department_id"=c."department_id" AND f."external_entry_id"=e."id"
           WHERE c."id"=$1::uuid AND c."department_id"=$2::uuid AND c."stage"='EXECUTING'
             AND c."source_lead_id" IS NULL AND c."source_notary_matter_id" IS NULL AND c."certificate_id" IS NULL
             AND NOT EXISTS (SELECT 1 FROM "case_execution_finishes" ef WHERE ef."case_id"=c."id" AND ef."department_id"=c."department_id")
             AND ((e."initial_stage"='EXECUTING' AND c."version"=1 AND f."id" IS NULL)
               OR (f."id" IS NOT NULL AND f."to_version"=c."version"))`,
          ownerId,
          actor.departmentId,
        );
        if (source.length !== 1) throw this.versionConflict();
      }
      if (actor.lawyerAccountId !== undefined) {
        await currentLawyerBindingId(reader, actor, ownerId);
        const lawyerCase = await reader.case.findFirst({
          where: { id: ownerId, departmentId: actor.departmentId },
          select: { stage: true },
        });
        if (lawyerCase === null) throw this.notFound();
        if (
          operation === 'write' &&
          !(
            (lawyerCase.stage === 'WAITING_COMPLAINT' &&
              ['COMPLAINT', 'AUTHORIZATION'].includes(notaryCategory ?? '')) ||
            (lawyerCase.stage === 'WAITING_COMPLAINT_CONFIRMATION' &&
              notaryCategory === 'COMPLAINT') ||
            (lawyerCase.stage === 'WAITING_COMPLAINT_STAMP' &&
              notaryCategory === 'MAIL_RECEIPT') ||
            (lawyerCase.stage === 'WAITING_FILING' &&
              ['FILING_EVIDENCE', 'FILING_SCREENSHOT'].includes(
                notaryCategory ?? '',
              )) ||
            (['WAITING_FORMAL_ACCEPTANCE', 'WAITING_HEARING'].includes(
              lawyerCase.stage,
            ) &&
              [
                'ACCEPTANCE_NOTICE',
                'PAYMENT_LIST',
                'SERVICE_DOCUMENT',
              ].includes(notaryCategory ?? '')) ||
            (lawyerCase.stage === 'WAITING_JUDGMENT' &&
              notaryCategory === 'JUDGMENT') ||
            (lawyerCase.stage === 'SECOND_INSTANCE' &&
              [
                'SECOND_INSTANCE_DOCUMENT',
                'SECOND_INSTANCE_SERVICE',
                'SECOND_INSTANCE_JUDGMENT',
              ].includes(notaryCategory ?? '')) ||
            ([
              'WAITING_EXECUTION_DOCUMENTS',
              'WAITING_EXECUTION_CONFIRMATION',
            ].includes(lawyerCase.stage) &&
              notaryCategory === 'EXECUTION_APPLICATION') ||
            (lawyerCase.stage === 'WAITING_EXECUTION_STAMP' &&
              notaryCategory === 'MAIL_RECEIPT') ||
            (lawyerCase.stage === 'WAITING_EXECUTION_FILING' &&
              notaryCategory === 'EXECUTION_FILING_PROOF') ||
            (lawyerCase.stage === 'EXECUTING' &&
              notaryCategory === 'EXECUTION_FINISH_BASIS') ||
            (lawyerCase.stage === 'WAITING_ARCHIVE' &&
              notaryCategory === 'CASE_CLOSURE_DOCUMENT' &&
              (await reader.case.findFirst({
                where: {
                  id: ownerId,
                  departmentId: actor.departmentId,
                  closure: { is: null },
                },
                select: { id: true },
              })) !== null)
          )
        )
          throw this.versionConflict();
        return;
      }
      if (actor.clientCustomerId !== undefined) {
        const binding = await reader.customerAccountBinding.findFirst({
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
        if (binding == null) throw this.forbidden();
        const clientCase = await reader.case.findFirst({
          where: {
            id: ownerId,
            departmentId: actor.departmentId,
            customerId: actor.clientCustomerId,
            complaintConfirmation: { isNot: null },
          },
          select: { stage: true },
        });
        if (clientCase === null) throw this.notFound();
        if (
          operation === 'write' &&
          (!['WAITING_COMPLAINT_STAMP', 'WAITING_EXECUTION_STAMP'].includes(
            clientCase.stage,
          ) ||
            notaryCategory !== 'MAIL_RECEIPT')
        )
          throw this.versionConflict();
        return;
      }
      await this.withMaterialAuthorization(() =>
        this.accessControl.authorizeDepartmentAction(
          actor,
          'case.read',
          snapshotReader,
        ),
      );
      const record = await reader.case.findFirst({
        where: { id: ownerId, departmentId: actor.departmentId },
        select: {
          departmentId: true,
          stage: true,
          responsibleUserId: true,
          responsibleMembership: { select: { teamId: true } },
        },
      });
      if (record === null) throw this.notFound();
      if (operation === 'write') {
        if (
          record.stage !== 'WAITING_COMPLAINT' &&
          !(
            record.stage === 'WAITING_COMPLAINT_CONFIRMATION' &&
            notaryCategory === 'COMPLAINT'
          ) &&
          !(
            ['WAITING_COMPLAINT_STAMP', 'WAITING_EXECUTION_STAMP'].includes(
              record.stage,
            ) && notaryCategory === 'MAIL_RECEIPT'
          ) &&
          !(
            record.stage === 'WAITING_FILING' &&
            (notaryCategory === 'FILING_EVIDENCE' ||
              notaryCategory === 'FILING_SCREENSHOT')
          ) &&
          !(
            (record.stage === 'WAITING_FORMAL_ACCEPTANCE' ||
              record.stage === 'WAITING_HEARING') &&
            (notaryCategory === 'ACCEPTANCE_NOTICE' ||
              notaryCategory === 'PAYMENT_LIST' ||
              notaryCategory === 'SERVICE_DOCUMENT')
          ) &&
          !(
            record.stage === 'WAITING_JUDGMENT' && notaryCategory === 'JUDGMENT'
          ) &&
          !(
            record.stage === 'SECOND_INSTANCE' &&
            [
              'SECOND_INSTANCE_DOCUMENT',
              'SECOND_INSTANCE_SERVICE',
              'SECOND_INSTANCE_JUDGMENT',
            ].includes(notaryCategory ?? '')
          ) &&
          !(
            [
              'WAITING_EXECUTION_DOCUMENTS',
              'WAITING_EXECUTION_CONFIRMATION',
            ].includes(record.stage) &&
            notaryCategory === 'EXECUTION_APPLICATION'
          ) &&
          !(
            record.stage === 'WAITING_EXECUTION_FILING' &&
            notaryCategory === 'EXECUTION_FILING_PROOF'
          ) &&
          !(
            record.stage === 'EXECUTING' &&
            notaryCategory === 'EXECUTION_FINISH_BASIS'
          ) &&
          !(
            record.stage === 'WAITING_ARCHIVE' &&
            notaryCategory === 'CASE_CLOSURE_DOCUMENT'
          )
        )
          throw this.versionConflict();
        await this.withMaterialAuthorization(async () => {
          const facts = {
            departmentId: record.departmentId,
            responsibleUserId: record.responsibleUserId,
            ...(record.responsibleMembership.teamId
              ? { teamId: record.responsibleMembership.teamId }
              : {}),
          };
          if (notaryCategory === 'JUDGMENT') {
            if (
              !(await this.accessControl.canAuthorizeCase(
                actor,
                'case.judgment.register',
                facts,
                snapshotReader,
              )) &&
              !(await this.accessControl.canAuthorizeCase(
                actor,
                'case.judgment.correct',
                facts,
                snapshotReader,
              ))
            )
              throw this.forbidden();
            return;
          }
          if (notaryCategory?.startsWith('SECOND_INSTANCE_')) {
            if (
              !(await this.accessControl.canAuthorizeCase(
                actor,
                'case.second_instance.save',
                facts,
                snapshotReader,
              )) &&
              !(await this.accessControl.canAuthorizeCase(
                actor,
                'case.second_instance.result',
                facts,
                snapshotReader,
              ))
            )
              throw this.forbidden();
            return;
          }
          if (notaryCategory === 'EXECUTION_APPLICATION') {
            if (
              !(await this.accessControl.canAuthorizeCase(
                actor,
                'case.execution.submit',
                facts,
                snapshotReader,
              ))
            )
              throw this.forbidden();
            return;
          }
          if (notaryCategory === 'CASE_CLOSURE_DOCUMENT') {
            const source = await reader.case.findFirst({
              where: { id: ownerId, departmentId: actor.departmentId },
              select: { closure: { select: { id: true } } },
            });
            if (source === null) throw this.notFound();
            await this.accessControl.authorizeCase(
              actor,
              source.closure === null
                ? 'case.closure.record'
                : 'case.closure.correct',
              facts,
              snapshotReader,
            );
            return;
          }
          await this.accessControl.authorizeCase(
            actor,
            record.stage === 'EXECUTING'
              ? 'case.execution.finish'
              : record.stage === 'WAITING_EXECUTION_STAMP'
                ? 'case.execution.mail'
                : record.stage === 'WAITING_EXECUTION_FILING'
                  ? 'case.execution.filing.submit'
                  : record.stage === 'WAITING_COMPLAINT'
                    ? 'case.complaint.submit'
                    : record.stage === 'WAITING_COMPLAINT_CONFIRMATION'
                      ? 'case.complaint.confirm'
                      : record.stage === 'WAITING_FILING'
                        ? 'case.filing.submit'
                        : record.stage === 'WAITING_FORMAL_ACCEPTANCE' ||
                            record.stage === 'WAITING_HEARING'
                          ? 'case.acceptance.register'
                          : 'case.complaint.mail',
            facts,
            snapshotReader,
          );
        });
      }
      return;
    }
    if (actor.notaryOfficeId !== undefined) {
      if (actor.clientCustomerId !== undefined || ownerType !== 'NOTARY_MATTER')
        throw this.forbidden();
      const binding = await reader.notaryOfficeAccountBinding.findFirst({
        where: {
          userId: actor.userId,
          departmentId: actor.departmentId,
          notaryOfficeId: actor.notaryOfficeId,
          active: true,
          notaryOffice: { status: 'ACTIVE' },
          user: { active: true, accountType: 'NOTARY' },
        },
        select: { id: true },
      });
      if (binding === null) throw this.forbidden();
      const matter = await reader.notaryMatter.findFirst({
        where: {
          id: ownerId,
          departmentId: actor.departmentId,
          notaryOfficeId: actor.notaryOfficeId,
          stage:
            operation === 'write'
              ? notaryCategory === 'NOTARY_CERTIFICATE' ||
                notaryCategory === 'NOTARY_DISCLOSURE'
                ? 'WAITING_CERTIFICATE'
                : 'WAITING_UNBOX'
              : {
                  in: [
                    'WAITING_UNBOX',
                    'UNBOX_REVIEW',
                    'WAITING_CERTIFICATE',
                    'ARCHIVED',
                  ],
                },
          ...(operation === 'read'
            ? {
                OR: [
                  { stage: { not: 'ARCHIVED' as const } },
                  { certificate: { isNot: null } },
                ],
              }
            : {}),
        },
        select: { id: true },
      });
      if (matter === null) throw this.notFound();
      return;
    }
    if (actor.clientCustomerId !== undefined) {
      if (operation !== 'read') throw this.forbidden();
      if (ownerType === 'NOTARY_MATTER') {
        const binding = await reader.customerAccountBinding.findFirst({
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
        if (binding === null) throw this.forbidden();
        const matter = await reader.notaryMatter.findFirst({
          where: {
            id: ownerId,
            departmentId: actor.departmentId,
            customerId: actor.clientCustomerId,
            opening: { isNot: null },
            stage: { in: ['UNBOX_REVIEW', 'ISSUANCE_DECISION', 'ARCHIVED'] },
            sourceLead: {
              pushedAt: { not: null },
              pushedByUserId: { not: null },
            },
          },
          select: { id: true },
        });
        if (matter === null) throw this.notFound();
        return;
      }
      if (ownerType !== 'LEAD') throw this.forbidden();
      const lead = await reader.lead.findFirst({
        where: {
          id: ownerId,
          departmentId: actor.departmentId,
          customerId: actor.clientCustomerId,
          pushedAt: { not: null },
          pushedByUserId: { not: null },
          OR: [
            { status: 'WAITING_REVIEW', activeReviewDecisionId: null },
            {
              status: 'WAITING_EVIDENCE_DECISION',
              reviewDecision: { is: { result: 'INFRINGEMENT' } },
            },
            {
              status: 'TRANSFERRED_TO_NOTARY',
              reviewDecision: { is: { result: 'INFRINGEMENT' } },
            },
            {
              status: 'ARCHIVED',
              evidenceDecision: { is: { result: 'NO_EVIDENCE' } },
            },
            {
              status: 'ARCHIVED',
              reviewDecision: {
                is: {
                  result: 'NO_INFRINGEMENT',
                  archiveType: 'NO_INFRINGEMENT',
                  archivedAt: { not: null },
                },
              },
            },
          ],
        },
        select: { id: true },
      });
      if (lead === null) throw this.notFound();
      return;
    }
    if (ownerType === 'NOTARY_MATTER') {
      const caseCertificateRead =
        operation === 'read' &&
        (notaryCategory === 'NOTARY_CERTIFICATE' ||
          notaryCategory === 'NOTARY_DISCLOSURE');
      if (caseCertificateRead) {
        await this.withMaterialAuthorization(() =>
          this.accessControl.authorizeDepartmentAction(
            actor,
            'case.read',
            snapshotReader,
          ),
        );
        const relatedCase = await reader.case.findFirst({
          where: {
            sourceNotaryMatterId: ownerId,
            departmentId: actor.departmentId,
          },
          select: { id: true },
        });
        if (relatedCase === null) throw this.notFound();
        return;
      }
      const action =
        operation === 'write'
          ? 'notary.unbox.record'
          : (leadAction ?? 'lead.read');
      const scope = await this.withMaterialAuthorization(() =>
        this.accessControl.buildLeadScope(actor, action, snapshotReader),
      );
      const matter = await reader.notaryMatter.findFirst({
        where: {
          id: ownerId,
          departmentId: actor.departmentId,
          sourceLead: scope,
        },
        select: {
          stage: true,
          departmentId: true,
          sourceLead: {
            select: { responsibleUserId: true, teamId: true },
          },
        },
      });
      if (matter === null) throw this.notFound();
      if (operation === 'write') {
        if (matter.stage !== 'WAITING_UNBOX') throw this.versionConflict();
        await this.withMaterialAuthorization(() =>
          this.accessControl.authorizeLead(
            actor,
            'notary.unbox.record',
            {
              departmentId: matter.departmentId,
              responsibleUserId: matter.sourceLead.responsibleUserId,
              ...(matter.sourceLead.teamId === null
                ? {}
                : { teamId: matter.sourceLead.teamId }),
            },
            snapshotReader,
          ),
        );
      }
      return;
    }
    if (ownerType === 'LEAD_DRAFT') {
      if (
        !(await this.accessControl.canAuthorizeNewLead(actor, snapshotReader))
      ) {
        throw this.forbidden();
      }
      const draft = await reader.uploadDraft.findFirst({
        where: {
          departmentId: actor.departmentId,
          actorUserId: actor.userId,
          ownerType,
          ownerId,
          expiresAt: { gt: this.clock() },
        },
        select: { id: true },
      });
      if (draft === null) throw this.notFound();
      return;
    }
    if (ownerType === 'CUSTOMER') {
      const agreement = notaryCategory === 'CUSTOMER_AGREEMENT';
      const writeAction = agreement
        ? ('customer.agreement.edit' as const)
        : notaryCategory === 'CUSTOMER_RIGHT_EVIDENCE'
          ? ('customer.edit-routine' as const)
          : ('customer.admit' as const);
      const readScope = await this.withMaterialAuthorization(() =>
        this.accessControl.buildCustomerScope(
          actor,
          'customer.read',
          snapshotReader,
        ),
      );
      const writeScope =
        operation === 'write'
          ? await this.withMaterialAuthorization(() =>
              this.accessControl.buildCustomerScope(
                actor,
                writeAction,
                snapshotReader,
              ),
            )
          : null;
      const agreementReadScope = agreement
        ? await this.withMaterialAuthorization(() =>
            this.accessControl.buildCustomerScope(
              actor,
              'customer.agreement.read',
              snapshotReader,
            ),
          )
        : null;
      const customer = await reader.customer.findFirst({
        where: {
          id: ownerId,
          deletedAt: null,
          AND: [
            readScope,
            ...(agreementReadScope ? [agreementReadScope] : []),
            ...(writeScope ? [writeScope] : []),
          ],
        },
        select: {
          departmentId: true,
          responsibleUserId: true,
          teamId: true,
        },
      });
      if (customer === null) throw this.notFound();
      if (operation === 'write') {
        await this.withMaterialAuthorization(() =>
          this.accessControl.authorizeCustomer(
            actor,
            writeAction,
            {
              departmentId: customer.departmentId,
              responsibleUserId: customer.responsibleUserId,
              ...(customer.teamId === null ? {} : { teamId: customer.teamId }),
            },
            snapshotReader,
          ),
        );
      }
      return;
    }
    const action =
      leadAction ?? (operation === 'write' ? 'lead.edit' : 'lead.read');
    const scope = await this.withMaterialAuthorization(() =>
      this.accessControl.buildLeadScope(actor, action, snapshotReader),
    );
    const lead = await reader.lead.findFirst({
      where: { id: ownerId, ...scope },
      select: {
        departmentId: true,
        responsibleUserId: true,
        teamId: true,
      },
    });
    if (lead === null) throw this.notFound();
    if (operation === 'write') {
      await this.withMaterialAuthorization(() =>
        this.accessControl.authorizeLead(
          actor,
          'lead.edit',
          {
            departmentId: lead.departmentId,
            responsibleUserId: lead.responsibleUserId,
            ...(lead.teamId === null ? {} : { teamId: lead.teamId }),
          },
          snapshotReader,
        ),
      );
    }
  }

  private async lawyerCaseVersionWhitelist(
    actor: ActorContext,
    caseId: string,
  ): Promise<Map<string, Set<string>>> {
    await currentLawyerBindingId(this.database, actor, caseId);
    const [materials, references] = await Promise.all([
      this.database.material.findMany({
        where: {
          departmentId: actor.departmentId,
          ownerType: 'CASE',
          ownerId: caseId,
          status: 'ACTIVE',
          category: {
            in: [
              'COMPLAINT',
              'AUTHORIZATION',
              'MAIL_RECEIPT',
              'FILING_EVIDENCE',
              'FILING_SCREENSHOT',
              'ACCEPTANCE_NOTICE',
              'PAYMENT_LIST',
              'SERVICE_DOCUMENT',
              'JUDGMENT',
              'SECOND_INSTANCE_DOCUMENT',
              'SECOND_INSTANCE_SERVICE',
              'SECOND_INSTANCE_JUDGMENT',
              'EXECUTION_APPLICATION',
              'EXECUTION_FILING_PROOF',
              'EXECUTION_SUPPLEMENT',
              'EXECUTION_FINISH_BASIS',
              'CASE_CLOSURE_DOCUMENT',
            ],
          },
        },
        select: {
          id: true,
          category: true,
          currentVersionId: true,
          currentVersion: {
            select: {
              caseSectionRecordUploadDraftId: true,
              executionSupplementUploadDraftId: true,
            },
          },
        },
      }),
      this.database.materialReference.findMany({
        where: {
          departmentId: actor.departmentId,
          resourceType: 'case',
          resourceId: caseId,
          actionEventId: { not: null },
          material: {
            departmentId: actor.departmentId,
            ownerType: 'CASE',
            ownerId: caseId,
            status: 'ACTIVE',
          },
        },
        select: { materialId: true, contentVersionId: true },
      }),
    ]);
    const allowed = new Map<string, Set<string>>();
    const secondCategories = new Set([
      'SECOND_INSTANCE_DOCUMENT',
      'SECOND_INSTANCE_SERVICE',
      'SECOND_INSTANCE_JUDGMENT',
    ]);
    const categories = new Map(
      materials.map((material) => [material.id, material.category]),
    );
    for (const material of materials) {
      if (material.category === 'EXECUTION_SUPPLEMENT') {
        const versions = new Set<string>();
        if (
          material.currentVersionId !== null &&
          (await this.hasExecutionSupplementFirstFreeze(
            this.database,
            material.currentVersionId,
          ))
        )
          versions.add(material.currentVersionId);
        allowed.set(material.id, versions);
        continue;
      }
      if (
        material.currentVersionId !== null &&
        material.currentVersion?.caseSectionRecordUploadDraftId != null &&
        !(await this.hasSectionUploadFirstFreeze(
          this.database,
          material.currentVersionId,
        ))
      )
        continue;
      if (
        material.currentVersionId !== null ||
        secondCategories.has(material.category)
      )
        allowed.set(
          material.id,
          new Set(
            material.currentVersionId === null
              ? []
              : [material.currentVersionId],
          ),
        );
    }
    for (const reference of references) {
      if (
        categories.get(reference.materialId) === 'EXECUTION_SUPPLEMENT' &&
        !(await this.hasExecutionSupplementFirstFreeze(
          this.database,
          reference.contentVersionId,
        ))
      )
        continue;
      if (secondCategories.has(categories.get(reference.materialId) ?? ''))
        continue;
      const versions = allowed.get(reference.materialId);
      if (versions !== undefined) versions.add(reference.contentVersionId);
    }
    const secondMaterialIds = materials
      .filter((material) => secondCategories.has(material.category))
      .map((material) => material.id);
    if (secondMaterialIds.length > 0) {
      const [progressVersions, resultVersions] = await Promise.all([
        this.database.caseSecondInstanceProgressVersion.findMany({
          where: {
            caseId,
            departmentId: actor.departmentId,
            materialId: { in: secondMaterialIds },
            category: {
              in: ['SECOND_INSTANCE_DOCUMENT', 'SECOND_INSTANCE_SERVICE'],
            },
          },
          select: { materialId: true, contentVersionId: true, category: true },
        }),
        this.database.caseSecondInstanceResultVersion.findMany({
          where: {
            caseId,
            departmentId: actor.departmentId,
            materialId: { in: secondMaterialIds },
          },
          select: { materialId: true, contentVersionId: true },
        }),
      ]);
      for (const version of progressVersions) {
        if (categories.get(version.materialId) === version.category)
          allowed.get(version.materialId)?.add(version.contentVersionId);
      }
      for (const version of resultVersions) {
        if (categories.get(version.materialId) === 'SECOND_INSTANCE_JUDGMENT')
          allowed.get(version.materialId)?.add(version.contentVersionId);
      }
    }
    return allowed;
  }

  private async clientCaseVersionWhitelist(
    actor: ActorContext,
    caseId: string,
  ): Promise<Map<string, Set<string>>> {
    const record = await this.database.case.findFirst({
      where: {
        id: caseId,
        departmentId: actor.departmentId,
        customerId: actor.clientCustomerId,
        complaintConfirmation: { isNot: null },
      },
      select: {
        stage: true,
        complaintConfirmation: {
          select: { confirmedComplaintContentVersionId: true },
        },
      },
    });
    if (record?.complaintConfirmation == null) throw this.notFound();
    const references = await this.database.materialReference.findMany({
      where: {
        departmentId: actor.departmentId,
        resourceType: 'case',
        resourceId: caseId,
        OR: [
          {
            purpose: 'COMPLAINT_CONFIRMATION',
            contentVersionId:
              record.complaintConfirmation.confirmedComplaintContentVersionId,
            material: {
              ownerType: 'CASE',
              ownerId: caseId,
              departmentId: actor.departmentId,
              category: 'COMPLAINT',
            },
            actionEvent: {
              action: 'case.complaint.confirmed',
              resourceType: 'CASE',
              resourceId: caseId,
              departmentId: actor.departmentId,
            },
          },
          {
            purpose: 'AUTHORIZATION',
            material: {
              ownerType: 'CASE',
              ownerId: caseId,
              departmentId: actor.departmentId,
              category: 'AUTHORIZATION',
            },
            actionEvent: {
              action: 'case.complaint.submitted',
              resourceType: 'CASE',
              resourceId: caseId,
              departmentId: actor.departmentId,
            },
          },
          {
            purpose: 'MAIL_RECEIPT',
            material: {
              ownerType: 'CASE',
              ownerId: caseId,
              departmentId: actor.departmentId,
              category: 'MAIL_RECEIPT',
            },
            actionEvent: {
              action: {
                in: [
                  'case.complaint.mailed',
                  'case.execution.mailed',
                  'case.execution.mailing.record-corrected',
                ],
              },
              resourceType: 'CASE',
              resourceId: caseId,
              departmentId: actor.departmentId,
            },
          },
        ],
      },
      select: { materialId: true, contentVersionId: true, purpose: true },
    });
    const allowed = new Map<string, Set<string>>();
    const add = (materialId: string, versionId: string) => {
      const versions = allowed.get(materialId) ?? new Set<string>();
      versions.add(versionId);
      allowed.set(materialId, versions);
    };
    for (const ref of references) {
      if (
        ref.purpose === 'COMPLAINT_CONFIRMATION' &&
        ref.contentVersionId !==
          record.complaintConfirmation.confirmedComplaintContentVersionId
      )
        continue;
      add(ref.materialId, ref.contentVersionId);
    }
    if (
      ['WAITING_COMPLAINT_STAMP', 'WAITING_EXECUTION_STAMP'].includes(
        record.stage,
      )
    ) {
      const drafts = await this.database.material.findMany({
        where: {
          departmentId: actor.departmentId,
          ownerType: 'CASE',
          ownerId: caseId,
          category: 'MAIL_RECEIPT',
          status: 'ACTIVE',
          contentVersions: {
            some: { uploadedBy: actor.userId, status: 'AVAILABLE' },
          },
        },
        select: {
          id: true,
          category: true,
          currentVersionId: true,
          contentVersions: {
            where: { uploadedBy: actor.userId, status: 'AVAILABLE' },
            select: { id: true },
          },
        },
      });
      for (const draft of drafts) {
        if (
          draft.category !== 'MAIL_RECEIPT' ||
          draft.currentVersionId === null
        )
          continue;
        if (
          draft.contentVersions.some(
            (version) => version.id === draft.currentVersionId,
          )
        )
          add(draft.id, draft.currentVersionId);
      }
    }
    return allowed;
  }

  private assertCategoryPurposeMatrix(input: {
    ownerType: MaterialOwnerTypeValue;
    category: keyof typeof allowedMimeTypes;
    purpose: string;
  }): void {
    const valid =
      (input.ownerType === 'CUSTOMER' &&
        input.category === 'CUSTOMER_IDENTITY' &&
        ['IDENTITY_FULL', 'IDENTITY_FRONT', 'IDENTITY_BACK'].includes(
          input.purpose,
        )) ||
      (input.ownerType === 'CUSTOMER' &&
        input.category === 'CUSTOMER_RIGHT_EVIDENCE' &&
        input.purpose === 'CUSTOMER_RIGHT_EVIDENCE') ||
      (input.ownerType === 'CUSTOMER' &&
        input.category === 'CUSTOMER_AGREEMENT' &&
        input.purpose === 'CUSTOMER_AGREEMENT') ||
      (input.ownerType === 'LEAD_DRAFT' &&
        input.category === 'LEAD_SCREENSHOT' &&
        input.purpose === 'LEAD_SCREENSHOT') ||
      (input.ownerType === 'CASE' &&
        (input.category === 'COMPLAINT' ||
          input.category === 'AUTHORIZATION' ||
          input.category === 'MAIL_RECEIPT' ||
          input.category === 'FILING_EVIDENCE' ||
          input.category === 'FILING_SCREENSHOT') &&
        input.purpose === input.category) ||
      (input.ownerType === 'CASE' &&
        (input.category === 'ACCEPTANCE_NOTICE' ||
          input.category === 'PAYMENT_LIST' ||
          input.category === 'SERVICE_DOCUMENT' ||
          input.category === 'JUDGMENT' ||
          input.category === 'SECOND_INSTANCE_DOCUMENT' ||
          input.category === 'SECOND_INSTANCE_SERVICE' ||
          input.category === 'SECOND_INSTANCE_JUDGMENT' ||
          input.category === 'EXECUTION_APPLICATION' ||
          input.category === 'EXECUTION_FILING_PROOF' ||
          input.category === 'EXECUTION_SUPPLEMENT' ||
          input.category === 'EXECUTION_FINISH_BASIS' ||
          input.category === 'CASE_CLOSURE_DOCUMENT') &&
        input.purpose === input.category) ||
      (input.ownerType === 'CASE' &&
        input.category === 'FEE_PROOF' &&
        input.purpose === input.category) ||
      (input.ownerType === 'NOTARY_MATTER' &&
        input.category === 'NOTARY_OPENING_PHOTO' &&
        input.purpose === 'NOTARY_OPENING_PHOTO') ||
      (input.ownerType === 'NOTARY_MATTER' &&
        (input.category === 'NOTARY_CERTIFICATE' ||
          input.category === 'NOTARY_DISCLOSURE') &&
        input.purpose === input.category);
    if (!valid) throw this.validationError();
  }

  private normalizeFilename(value: string): string {
    const filename = value.trim();
    if (
      filename.length === 0 ||
      filename.length > 200 ||
      hasControlCharacters(filename)
    ) {
      throw this.invalidVersion();
    }
    return filename;
  }

  private async withMaterialAuthorization<T>(
    operation: () => Promise<T>,
  ): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof ForbiddenException) throw this.forbidden();
      throw error;
    }
  }

  private validationError() {
    return new BadRequestException({
      code: 'VALIDATION_ERROR',
      message: '材料上传参数无效',
    });
  }

  private forbidden() {
    return new ForbiddenException({
      code: 'ACTION_FORBIDDEN',
      message: '无权执行此材料操作',
    });
  }

  private notFound() {
    return new NotFoundException({
      code: 'RESOURCE_NOT_FOUND',
      message: '材料或目标不存在或不可访问',
    });
  }

  private invalidVersion() {
    return new BadRequestException({
      code: 'MATERIAL_VERSION_INVALID',
      message: '材料内容、格式或元数据无效',
    });
  }

  private versionConflict() {
    return new ConflictException({
      code: 'VERSION_CONFLICT',
      message: '材料状态或版本已变化',
    });
  }

  private storageUnavailable() {
    return new ServiceUnavailableException({
      code: 'STORAGE_UNAVAILABLE',
      message: '私有材料存储暂不可用',
    });
  }
}

function isMimeAllowedForPurpose(
  category: keyof typeof allowedMimeTypes,
  purpose: string,
  mimeType: string,
): boolean {
  if (!allowedMimeTypes[category].has(mimeType)) return false;
  if (
    category === 'CUSTOMER_IDENTITY' &&
    (purpose === 'IDENTITY_FRONT' || purpose === 'IDENTITY_BACK')
  ) {
    return mimeType === 'image/jpeg' || mimeType === 'image/png';
  }
  return true;
}

function normalizeMimeType(value: string): string {
  const normalized = value.trim().toLowerCase();
  return normalized === 'image/jpg' ? 'image/jpeg' : normalized;
}

function toMaterialPurpose(value: string): MaterialPurposeValue {
  if (
    value === 'IDENTITY_FULL' ||
    value === 'IDENTITY_FRONT' ||
    value === 'IDENTITY_BACK' ||
    value === 'CUSTOMER_RIGHT_EVIDENCE' ||
    value === 'CUSTOMER_AGREEMENT' ||
    value === 'LEAD_SCREENSHOT' ||
    value === 'NOTARY_OPENING_PHOTO' ||
    value === 'NOTARY_CERTIFICATE' ||
    value === 'NOTARY_DISCLOSURE' ||
    value === 'COMPLAINT' ||
    value === 'AUTHORIZATION' ||
    value === 'MAIL_RECEIPT' ||
    value === 'FILING_EVIDENCE' ||
    value === 'FILING_SCREENSHOT' ||
    value === 'ACCEPTANCE_NOTICE' ||
    value === 'PAYMENT_LIST' ||
    value === 'SERVICE_DOCUMENT' ||
    value === 'JUDGMENT' ||
    value === 'SECOND_INSTANCE_DOCUMENT' ||
    value === 'SECOND_INSTANCE_SERVICE' ||
    value === 'SECOND_INSTANCE_JUDGMENT' ||
    value === 'EXECUTION_APPLICATION' ||
    value === 'EXECUTION_FILING_PROOF' ||
    value === 'EXECUTION_SUPPLEMENT' ||
    value === 'EXECUTION_FINISH_BASIS' ||
    value === 'CASE_CLOSURE_DOCUMENT' ||
    value === 'FEE_PROOF'
  ) {
    return value;
  }
  throw new Error('Invalid persisted material purpose');
}

function materialLimit(category: keyof typeof allowedMimeTypes): number {
  return category === 'CUSTOMER_IDENTITY'
    ? 10
    : category === 'CUSTOMER_RIGHT_EVIDENCE' ||
        category === 'CUSTOMER_AGREEMENT'
      ? 10
      : category === 'NOTARY_OPENING_PHOTO'
        ? 50
        : category === 'FILING_EVIDENCE'
          ? 50
          : category === 'NOTARY_CERTIFICATE' ||
              category === 'NOTARY_DISCLOSURE' ||
              category === 'COMPLAINT' ||
              category === 'AUTHORIZATION' ||
              category === 'MAIL_RECEIPT' ||
              category === 'FILING_SCREENSHOT' ||
              category === 'ACCEPTANCE_NOTICE' ||
              category === 'PAYMENT_LIST' ||
              category === 'SERVICE_DOCUMENT' ||
              category === 'JUDGMENT' ||
              category === 'SECOND_INSTANCE_DOCUMENT' ||
              category === 'SECOND_INSTANCE_SERVICE' ||
              category === 'SECOND_INSTANCE_JUDGMENT' ||
              category === 'EXECUTION_APPLICATION' ||
              category === 'EXECUTION_FILING_PROOF' ||
              category === 'EXECUTION_SUPPLEMENT' ||
              category === 'EXECUTION_FINISH_BASIS' ||
              category === 'CASE_CLOSURE_DOCUMENT' ||
              category === 'FEE_PROOF'
            ? 10
            : 20;
}

function materialFileLimit(category: keyof typeof allowedMimeTypes): number {
  return category === 'NOTARY_CERTIFICATE' ||
    category === 'NOTARY_DISCLOSURE' ||
    category === 'COMPLAINT' ||
    category === 'AUTHORIZATION' ||
    category === 'FILING_EVIDENCE' ||
    category === 'ACCEPTANCE_NOTICE' ||
    category === 'PAYMENT_LIST' ||
    category === 'SERVICE_DOCUMENT' ||
    category === 'JUDGMENT' ||
    category === 'SECOND_INSTANCE_DOCUMENT' ||
    category === 'SECOND_INSTANCE_SERVICE' ||
    category === 'SECOND_INSTANCE_JUDGMENT' ||
    category === 'EXECUTION_APPLICATION' ||
    category === 'EXECUTION_FILING_PROOF' ||
    category === 'EXECUTION_SUPPLEMENT' ||
    category === 'EXECUTION_FINISH_BASIS' ||
    category === 'CASE_CLOSURE_DOCUMENT' ||
    category === 'FEE_PROOF'
    ? 50 * 1024 * 1024
    : 20 * 1024 * 1024;
}

function ownerQuotaKey(input: {
  departmentId: string;
  ownerType: MaterialOwnerTypeValue;
  ownerId: string;
  category: keyof typeof allowedMimeTypes;
}): string {
  return [
    input.departmentId,
    input.ownerType,
    input.ownerId,
    input.category,
  ].join(':');
}

function hasControlCharacters(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint < 32 || codePoint === 127;
  });
}
