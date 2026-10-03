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
import { DatabaseService } from '../../database/database.service';
import type { Prisma } from '../../generated/prisma/client';
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

export type AssertAvailableVersionsInput = Readonly<{
  ownerType: MaterialOwnerTypeValue;
  ownerId: string;
  category: MaterialCategoryValue;
  contentVersionIds: readonly string[];
  minCount?: number;
  maxCount?: number;
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
>;
type MaterialMutationReader = MaterialAuthorizationReader &
  Pick<MaterialTransactionClient, 'material'>;
export type MaterialReferenceReader = MaterialAuthorizationReader &
  AccessControlSnapshotReader &
  Pick<MaterialTransactionClient, 'materialReference'>;
const allowedMimeTypes = {
  CUSTOMER_IDENTITY: new Set(['application/pdf', 'image/jpeg', 'image/png']),
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
} as const;

@Injectable()
export class MaterialService {
  private readonly clock: () => Date;
  private readonly validatedVersionFacts = new WeakMap<
    ValidatedMaterialVersionFact,
    {
      transaction: MaterialTransactionClient;
      canonicalFact: CanonicalMaterialVersionFact;
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
  ) {
    this.clock = clock ?? (() => new Date());
  }

  async createUploadDraft(actor: ActorContext, input: CreateUploadDraftDto) {
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
    if (input.ownerType === 'CUSTOMER') {
      if (input.ownerId === undefined) throw this.validationError();
      const scope = await this.withMaterialAuthorization(() =>
        this.accessControl.buildCustomerScope(actor, 'customer.read'),
      );
      const customer = await this.database.customer.findFirst({
        where: { id: input.ownerId, ...scope },
        select: {
          id: true,
          departmentId: true,
          responsibleUserId: true,
          teamId: true,
        },
      });
      if (customer === null) throw this.notFound();
      await this.withMaterialAuthorization(() =>
        this.accessControl.authorizeCustomer(actor, 'customer.admit', {
          departmentId: customer.departmentId,
          responsibleUserId: customer.responsibleUserId,
          ...(customer.teamId === null ? {} : { teamId: customer.teamId }),
        }),
      );
      ownerId = customer.id;
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
          where: { userId: actor.userId, customerId: actor.clientCustomerId,
            departmentId: actor.departmentId, active: true,
            user: { active: true, accountType: 'CLIENT' },
            customer: { profileStatus: 'ADMITTED' } },
          select: { id: true },
        });
        if (binding === null) throw this.forbidden();
        customerAccountBindingId = binding.id;
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

    const draft = await this.database.uploadDraft.create({
      data: {
        departmentId: actor.departmentId,
        actorUserId: actor.userId,
        ...(notaryOfficeAccountBindingId === undefined
          ? {}
          : { notaryOfficeAccountBindingId }),
        ...(customerAccountBindingId === undefined
          ? {}
          : { customerAccountBindingId }),
        ownerType: input.ownerType,
        ownerId,
        category: input.category,
        purpose: input.purpose,
        originalFilename,
        declaredMimeType,
        expiresAt,
      },
    });
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
      if (draft.ownerType !== 'CASE' || draft.category !== 'MAIL_RECEIPT' ||
        draft.customerAccountBindingId == null) throw this.forbidden();
      const binding = await this.database.customerAccountBinding.findFirst({
        where: { id: draft.customerAccountBindingId, userId: actor.userId,
          customerId: actor.clientCustomerId, departmentId: actor.departmentId,
          active: true, user: { active: true, accountType: 'CLIENT' },
          customer: { profileStatus: 'ADMITTED' } },
        select: { id: true },
      });
      if (binding === null) throw this.forbidden();
    } else if (draft.customerAccountBindingId != null) {
      throw this.forbidden();
    }
    if (draft.ownerType === 'CUSTOMER') {
      const scope = await this.withMaterialAuthorization(() =>
        this.accessControl.buildCustomerScope(actor, 'customer.read'),
      );
      const customer = await this.database.customer.findFirst({
        where: { id: draft.ownerId, ...scope },
        select: {
          departmentId: true,
          responsibleUserId: true,
          teamId: true,
        },
      });
      if (customer === null) throw this.notFound();
      await this.withMaterialAuthorization(() =>
        this.accessControl.authorizeCustomer(actor, 'customer.admit', {
          departmentId: customer.departmentId,
          responsibleUserId: customer.responsibleUserId,
          ...(customer.teamId === null ? {} : { teamId: customer.teamId }),
        }),
      );
    } else if (draft.ownerType === 'CASE') {
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
        const claimed = await this.database.uploadDraft.updateMany({
          where: {
            id: draft.id,
            departmentId: actor.departmentId,
            actorUserId: actor.userId,
            status: 'OPEN',
            expiresAt: { gt: this.clock() },
            pendingStorageKey: null,
          },
          data: { pendingStorageKey: storageKey },
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
          if (draft.ownerType === 'CASE') {
            const locked = await transaction.$queryRawUnsafe<
              Array<{ id: string }>
            >(
              'SELECT "id" FROM "cases" WHERE "id" = $1::uuid AND "department_id" = $2::uuid FOR UPDATE',
              draft.ownerId,
              actor.departmentId,
            );
            if (locked.length !== 1) throw this.notFound();
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
          const activeCount = await transaction.material.count({
            where: {
              departmentId: actor.departmentId,
              ownerType: draft.ownerType,
              ownerId: draft.ownerId,
              category: draft.category,
              status: 'ACTIVE',
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
            },
          });
          await transaction.material.update({
            where: { id: materialId },
            data: { currentVersionId: contentVersionId },
          });
          const finalized = await transaction.uploadDraft.updateMany({
            where: {
              id: draft.id,
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

    await this.authorizeOwner(
      actor,
      input.ownerType,
      input.ownerId,
      'read',
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
          select: { id: true, mimeType: true, status: true, uploadedBy: true },
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
        if (
          version.status !== 'AVAILABLE' ||
          (actor.notaryOfficeId !== undefined &&
            input.category === 'NOTARY_OPENING_PHOTO' &&
            version.uploadedBy !== actor.userId) ||
          facts.has(version.id) ||
          !contentVersionIds.includes(version.id) ||
          (input.ownerType === 'CASE' &&
            material.currentVersionId !== version.id) ||
          (input.ownerType === 'CASE' && input.category === 'MAIL_RECEIPT' &&
            actor.clientCustomerId !== undefined && version.uploadedBy !== actor.userId)
        ) {
          throw this.invalidVersion();
        }
        const canonicalFact = Object.freeze({
          departmentId: material.departmentId,
          materialId: material.id,
          contentVersionId: version.id,
          purpose: material.purpose,
          mimeType: version.mimeType,
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
        });
        facts.set(version.id, fact);
      }
    }
    if (facts.size !== contentVersionIds.length) {
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

    const canonicalFacts = input.facts.map((fact) => {
      const validation = this.validatedVersionFacts.get(fact);
      if (
        validation === undefined ||
        validation.transaction !== transaction ||
        validation.canonicalFact.departmentId !== input.departmentId
      ) {
        throw this.invalidVersion();
      }
      return validation.canonicalFact;
    });

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
    if (ownerType === 'CASE' && actor.clientCustomerId !== undefined) {
      const allowed = await this.clientCaseVersionWhitelist(actor, ownerId);
      if (allowed.size === 0) return { items: [], total: 0 };
      const allowedMaterialIds = [...allowed.keys()];
      const allowedVersionIds = [...new Set([...allowed.values()].flatMap((ids) => [...ids]))];
      const materials = await this.database.material.findMany({
        where: { departmentId: actor.departmentId, ownerType: 'CASE', ownerId,
          status: 'ACTIVE', id: { in: allowedMaterialIds } },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        select: { id: true, ownerType: true, ownerId: true, category: true,
          purpose: true, status: true, version: true, deletedAt: true,
          createdAt: true, updatedAt: true,
          contentVersions: { where: { id: { in: allowedVersionIds }, status: 'AVAILABLE' },
            orderBy: { createdAt: 'desc' },
            select: { id: true, materialId: true, originalFilename: true,
              mimeType: true, sizeBytes: true, sha256: true, status: true, createdAt: true } } },
      });
      const items = materials.flatMap((material) => {
        const versions = material.contentVersions.filter((version) =>
          allowed.get(material.id)?.has(version.id));
        if (versions.length === 0) return [];
        return [{ id: material.id, ownerType: material.ownerType,
          ownerId: material.ownerId, category: material.category,
          purpose: toMaterialPurpose(material.purpose), currentVersionId: null,
          status: 'ACTIVE' as const, version: material.version,
          deletedAt: material.deletedAt, createdAt: material.createdAt,
          updatedAt: material.updatedAt,
          contentVersions: versions.map((version) => ({
            id: version.id, materialId: version.materialId,
            originalFilename: version.originalFilename, mimeType: version.mimeType,
            sizeBytes: Number(version.sizeBytes), sha256: version.sha256,
            status: 'AVAILABLE' as const, createdAt: version.createdAt,
          })) }];
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
      items: items.map((material) => ({
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
      total: items.length,
    };
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
    if (material.ownerType === 'CASE' && material.status !== 'ACTIVE')
      throw this.notFound();
    if (material.ownerType === 'CASE' && actor.clientCustomerId !== undefined) {
      await this.authorizeOwner(actor, 'CASE', material.ownerId, 'read');
      const allowed = await this.clientCaseVersionWhitelist(actor, material.ownerId);
      if (!allowed.get(materialId)?.has(versionId)) throw this.notFound();
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
      await this.lockMaterialAndCurrentVersion(
        transaction,
        actor.departmentId,
        materialId,
      );
      const material = await this.findMaterialForMutation(
        actor,
        materialId,
        transaction,
        transaction,
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
      await transaction.auditEvent.create({
        data: {
          departmentId: actor.departmentId,
          actorUserId: actor.userId,
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
      await this.lockMaterialAndCurrentVersion(
        transaction,
        actor.departmentId,
        materialId,
      );
      const material = await this.findMaterialForMutation(
        actor,
        materialId,
        transaction,
        transaction,
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
      const activeCount = await transaction.material.count({
        where: {
          departmentId: material.departmentId,
          ownerType: material.ownerType,
          ownerId: material.ownerId,
          category: material.category,
          status: 'ACTIVE',
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
      await transaction.auditEvent.create({
        data: {
          departmentId: actor.departmentId,
          actorUserId: actor.userId,
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
  ) {
    const material = await reader.material.findFirst({
      where: { id: materialId, departmentId: actor.departmentId },
      include: {
        contentVersions: {
          select: { id: true, uploadedBy: true, status: true },
        },
      },
    });
    if (material === null) throw this.notFound();
    await this.authorizeOwner(
      actor,
      material.ownerType,
      material.ownerId,
      'write',
      reader,
      snapshotReader,
    );
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
      if (validation === undefined || validation.transaction !== transaction ||
        validation.canonicalFact.departmentId !== actor.departmentId ||
        validation.canonicalFact.ownerType !== 'CASE' ||
        validation.canonicalFact.ownerId !== caseId ||
        validation.canonicalFact.category !== 'MAIL_RECEIPT' ||
        validation.canonicalFact.purpose !== 'MAIL_RECEIPT') throw this.invalidVersion();
      await transaction.caseComplaintMailingVersion.create({
        data: { mailingId, caseId, departmentId: actor.departmentId,
          materialId: validation.canonicalFact.materialId,
          contentVersionId: validation.canonicalFact.contentVersionId },
      });
      await transaction.materialReference.create({
        data: { departmentId: actor.departmentId, resourceType: 'case',
          resourceId: caseId, purpose: 'MAIL_RECEIPT',
          materialId: validation.canonicalFact.materialId,
          contentVersionId: validation.canonicalFact.contentVersionId,
          actionEventId },
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

  async listFrozenCaseComplaintMailingFiles(actor: ActorContext, caseId: string) {
    await this.authorizeOwner(actor, 'CASE', caseId, 'read');
    const references = await this.database.materialReference.findMany({
      where: { departmentId: actor.departmentId, resourceType: 'case',
        resourceId: caseId, purpose: 'MAIL_RECEIPT',
        actionEvent: { action: 'case.complaint.mailed', resourceType: 'CASE',
          resourceId: caseId, departmentId: actor.departmentId } },
      orderBy: { createdAt: 'asc' },
      select: { materialId: true, contentVersionId: true,
        contentVersion: { select: { originalFilename: true, mimeType: true } } },
    });
    return references.map((reference) => ({ materialId: reference.materialId,
      contentVersionId: reference.contentVersionId,
      originalFilename: reference.contentVersion.originalFilename,
      mimeType: reference.contentVersion.mimeType }));
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
    if (ownerType === 'CASE') {
      if (actor.notaryOfficeId !== undefined) throw this.forbidden();
      if (actor.clientCustomerId !== undefined) {
        const binding = await reader.customerAccountBinding.findFirst({
          where: { userId: actor.userId, customerId: actor.clientCustomerId,
            departmentId: actor.departmentId, active: true,
            user: { active: true, accountType: 'CLIENT' },
            customer: { profileStatus: 'ADMITTED' } },
          select: { id: true },
        });
        if (binding == null) throw this.forbidden();
        const clientCase = await reader.case.findFirst({
          where: { id: ownerId, departmentId: actor.departmentId,
            customerId: actor.clientCustomerId,
            complaintConfirmation: { isNot: null } },
          select: { stage: true },
        });
        if (clientCase === null) throw this.notFound();
        if (operation === 'write' &&
          (clientCase.stage !== 'WAITING_COMPLAINT_STAMP' ||
            notaryCategory !== 'MAIL_RECEIPT')) throw this.versionConflict();
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
          ) && !(record.stage === 'WAITING_COMPLAINT_STAMP' &&
            notaryCategory === 'MAIL_RECEIPT')
        )
          throw this.versionConflict();
        await this.withMaterialAuthorization(() =>
          this.accessControl.authorizeCase(
            actor,
            record.stage === 'WAITING_COMPLAINT'
              ? 'case.complaint.submit'
              : record.stage === 'WAITING_COMPLAINT_CONFIRMATION'
                ? 'case.complaint.confirm'
                : 'case.complaint.mail',
            {
              departmentId: record.departmentId,
              responsibleUserId: record.responsibleUserId,
              ...(record.responsibleMembership.teamId
                ? { teamId: record.responsibleMembership.teamId }
                : {}),
            },
            snapshotReader,
          ),
        );
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
      const scope = await this.withMaterialAuthorization(() =>
        this.accessControl.buildCustomerScope(
          actor,
          operation === 'read' ? 'customer.read' : 'customer.admit',
          snapshotReader,
        ),
      );
      const customer = await reader.customer.findFirst({
        where: { id: ownerId, ...scope },
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
            'customer.admit',
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

  private async clientCaseVersionWhitelist(
    actor: ActorContext,
    caseId: string,
  ): Promise<Map<string, Set<string>>> {
    const record = await this.database.case.findFirst({
      where: { id: caseId, departmentId: actor.departmentId,
        customerId: actor.clientCustomerId,
        complaintConfirmation: { isNot: null } },
      select: { stage: true,
        complaintConfirmation: { select: { confirmedComplaintContentVersionId: true } } },
    });
    if (record?.complaintConfirmation == null) throw this.notFound();
    const references = await this.database.materialReference.findMany({
      where: { departmentId: actor.departmentId, resourceType: 'case', resourceId: caseId,
        OR: [
          { purpose: 'COMPLAINT_CONFIRMATION',
            contentVersionId: record.complaintConfirmation.confirmedComplaintContentVersionId,
            material: { ownerType: 'CASE', ownerId: caseId,
              departmentId: actor.departmentId, category: 'COMPLAINT' },
            actionEvent: { action: 'case.complaint.confirmed', resourceType: 'CASE',
              resourceId: caseId, departmentId: actor.departmentId } },
          { purpose: 'AUTHORIZATION',
            material: { ownerType: 'CASE', ownerId: caseId,
              departmentId: actor.departmentId, category: 'AUTHORIZATION' },
            actionEvent: { action: 'case.complaint.submitted', resourceType: 'CASE',
              resourceId: caseId, departmentId: actor.departmentId } },
          { purpose: 'MAIL_RECEIPT',
            material: { ownerType: 'CASE', ownerId: caseId,
              departmentId: actor.departmentId, category: 'MAIL_RECEIPT' },
            actionEvent: { action: 'case.complaint.mailed', resourceType: 'CASE',
              resourceId: caseId, departmentId: actor.departmentId } },
        ] },
      select: { materialId: true, contentVersionId: true, purpose: true },
    });
    const allowed = new Map<string, Set<string>>();
    const add = (materialId: string, versionId: string) => {
      const versions = allowed.get(materialId) ?? new Set<string>();
      versions.add(versionId);
      allowed.set(materialId, versions);
    };
    for (const ref of references) {
      if (ref.purpose === 'COMPLAINT_CONFIRMATION' &&
        ref.contentVersionId !== record.complaintConfirmation.confirmedComplaintContentVersionId)
        continue;
      add(ref.materialId, ref.contentVersionId);
    }
    if (record.stage === 'WAITING_COMPLAINT_STAMP') {
      const drafts = await this.database.material.findMany({
        where: { departmentId: actor.departmentId, ownerType: 'CASE', ownerId: caseId,
          category: 'MAIL_RECEIPT', status: 'ACTIVE',
          contentVersions: { some: { uploadedBy: actor.userId, status: 'AVAILABLE' } } },
        select: { id: true, category: true, currentVersionId: true,
          contentVersions: { where: { uploadedBy: actor.userId, status: 'AVAILABLE' },
            select: { id: true } } },
      });
      for (const draft of drafts) {
        if (draft.category !== 'MAIL_RECEIPT' || draft.currentVersionId === null) continue;
        if (draft.contentVersions.some((version) => version.id === draft.currentVersionId))
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
      (input.ownerType === 'LEAD_DRAFT' &&
        input.category === 'LEAD_SCREENSHOT' &&
        input.purpose === 'LEAD_SCREENSHOT') ||
      (input.ownerType === 'CASE' &&
        (input.category === 'COMPLAINT' ||
          input.category === 'AUTHORIZATION' ||
          input.category === 'MAIL_RECEIPT') &&
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
    value === 'LEAD_SCREENSHOT' ||
    value === 'NOTARY_OPENING_PHOTO' ||
    value === 'NOTARY_CERTIFICATE' ||
    value === 'NOTARY_DISCLOSURE' ||
    value === 'COMPLAINT' ||
    value === 'AUTHORIZATION'
    || value === 'MAIL_RECEIPT'
  ) {
    return value;
  }
  throw new Error('Invalid persisted material purpose');
}

function materialLimit(category: keyof typeof allowedMimeTypes): number {
  return category === 'CUSTOMER_IDENTITY'
    ? 10
    : category === 'NOTARY_OPENING_PHOTO'
      ? 50
      : category === 'NOTARY_CERTIFICATE' ||
          category === 'NOTARY_DISCLOSURE' ||
          category === 'COMPLAINT' ||
          category === 'AUTHORIZATION'
          || category === 'MAIL_RECEIPT'
        ? 10
        : 20;
}

function materialFileLimit(category: keyof typeof allowedMimeTypes): number {
  return category === 'NOTARY_CERTIFICATE' ||
    category === 'NOTARY_DISCLOSURE' ||
    category === 'COMPLAINT' ||
    category === 'AUTHORIZATION'
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
