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
} from '../../access-control/access-control.service';
import { ActorContext } from '../../access-control/actor-context';
import { DatabaseService } from '../../database/database.service';
import type { Prisma } from '../../generated/prisma/client';
import {
  CreateUploadDraftDto,
  MaterialCategoryValue,
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

type MaterialAuthorizationReader = Pick<
  MaterialTransactionClient,
  'customer' | 'uploadDraft' | 'lead'
>;
const allowedMimeTypes = {
  CUSTOMER_IDENTITY: new Set(['application/pdf', 'image/jpeg', 'image/png']),
  LEAD_SCREENSHOT: new Set([
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
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
        const blob = await this.storage.put(storageKey, source);
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

    await this.authorizeOwner(
      actor,
      input.ownerType,
      input.ownerId,
      'read',
      transaction,
      transaction,
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
        status: true,
        contentVersions: {
          where: {
            id: { in: contentVersionIds },
            status: 'AVAILABLE',
          },
          select: { id: true, mimeType: true, status: true },
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
          facts.has(version.id) ||
          !contentVersionIds.includes(version.id)
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

  async listOwnerMaterials(
    actor: ActorContext,
    ownerType: MaterialOwnerTypeValue,
    ownerId: string,
  ) {
    await this.authorizeOwner(actor, ownerType, ownerId, 'read');
    const items = await this.database.material.findMany({
      where: {
        departmentId: actor.departmentId,
        ownerType,
        ownerId,
        status: 'ACTIVE',
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      include: { contentVersions: { orderBy: { createdAt: 'desc' } } },
    });
    return {
      items: items.map((material) => ({
        ...material,
        contentVersions: material.contentVersions.map((version) => ({
          ...version,
          sizeBytes: Number(version.sizeBytes),
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
    await this.authorizeOwner(
      actor,
      material.ownerType,
      material.ownerId,
      'read',
    );
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
    const material = await this.findMaterialForMutation(actor, materialId);
    if (material.status !== 'ACTIVE') throw this.versionConflict();
    const references = await this.database.materialReference.count({
      where: { materialId },
    });
    if (references > 0) throw this.versionConflict();
    const changed = await this.database.material.updateMany({
      where: { id: materialId, status: 'ACTIVE', version: expectedVersion },
      data: {
        status: 'DELETED',
        deletedAt: this.clock(),
        version: { increment: 1 },
      },
    });
    if (changed.count !== 1) throw this.versionConflict();
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
    const material = await this.findMaterialForMutation(actor, materialId);
    if (
      material.status !== 'DELETED' ||
      material.deletedAt === null ||
      this.clock().getTime() - material.deletedAt.getTime() >= RETENTION_MS
    ) {
      throw this.versionConflict();
    }
    await this.database.$transaction(async (transaction) => {
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
  ) {
    const material = await this.database.material.findFirst({
      where: { id: materialId, departmentId: actor.departmentId },
      include: { contentVersions: { select: { uploadedBy: true } } },
    });
    if (material === null) throw this.notFound();
    await this.authorizeOwner(
      actor,
      material.ownerType,
      material.ownerId,
      'write',
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

  private async authorizeOwner(
    actor: ActorContext,
    ownerType: MaterialOwnerTypeValue,
    ownerId: string,
    operation: 'read' | 'write',
    reader: MaterialAuthorizationReader = this.database,
    snapshotReader?: AccessControlSnapshotReader,
  ): Promise<void> {
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
    const scope = await this.withMaterialAuthorization(() =>
      this.accessControl.buildLeadScope(actor, 'lead.read', snapshotReader),
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
        input.purpose === 'LEAD_SCREENSHOT');
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

function materialLimit(category: keyof typeof allowedMimeTypes): number {
  return category === 'CUSTOMER_IDENTITY' ? 10 : 20;
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
