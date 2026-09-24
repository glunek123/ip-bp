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
  CreateNotaryOfficeDto,
  RecordNotaryEvidenceDto,
  SetNotaryOfficeStatusDto,
  TransferLeadToNotaryDto,
} from './lead-notary.dto';

const MAX_SERIALIZABLE_ATTEMPTS = 3;

type TransferResult = {
  id: string;
  businessNo: string;
  leadId: string;
  leadStatus: 'TRANSFERRED_TO_NOTARY';
  leadVersion: number;
  stage: 'PENDING_EVIDENCE';
  notaryOffice: { id: string; name: string };
  selectedProductIds: string[];
  selectedContentVersionIds: string[];
  evidenceMode: 'ONLINE_PURCHASE';
  batchPurpose: string;
  createdAt: string;
};

type EvidenceLogistics = {
  id: string;
  companyState: 'PRESENT' | 'NONE';
  companyValue: string | null;
  trackingState: 'PRESENT' | 'NONE';
  trackingValue: string | null;
};

type EvidenceResult = {
  id: string;
  stage: 'WAITING_UNBOX';
  version: number;
  evidence: {
    evidenceAt: string;
    sampleFeeState: 'KNOWN' | 'PENDING';
    sampleFeeAmount: string | null;
    recordedAt: string;
    recordedByUserId: string;
    logistics: EvidenceLogistics[];
  };
};

@Injectable()
export class LeadNotaryService {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: AccessControlService,
    private readonly materials: MaterialService,
  ) {}

  async listOffices(actor: ActorContext) {
    await this.assertInternal(actor);
    const create = await this.canManageOffices(actor);
    if (!create) {
      try {
        await this.access.buildLeadScope(actor, 'lead.evidence.decide');
      } catch (error) {
        throw this.mapAuthorization(error);
      }
    }
    const offices = await this.database.notaryOffice.findMany({
      where: { departmentId: actor.departmentId, status: 'ACTIVE' },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      select: { id: true, name: true, status: true },
    });
    return { items: offices, capabilities: { create } };
  }

  async createOffice(actor: ActorContext, input: CreateNotaryOfficeDto) {
    const name = input.name?.trim();
    if (
      typeof name !== 'string' ||
      [...name].length < 1 ||
      [...name].length > 200
    )
      throw this.validation();
    try {
      return await this.database.$transaction(
        async (tx) => {
          await this.assertInternal(actor, tx);
          await this.access.authorizeDepartmentAction(
            actor,
            'notary.office.manage',
            tx,
          );
          const office = await tx.notaryOffice.create({
            data: {
              departmentId: actor.departmentId,
              name,
              createdByUserId: actor.userId,
            },
            select: { id: true, name: true, status: true },
          });
          await tx.auditEvent.create({
            data: {
              departmentId: actor.departmentId,
              actorUserId: actor.userId,
              resourceType: 'notary_office',
              resourceId: office.id,
              action: 'notary_office.created',
              details: { name },
            },
          });
          return office;
        },
        { isolationLevel: 'Serializable' },
      );
    } catch (error) {
      if (this.isUnique(error))
        throw new ConflictException({
          code: 'OFFICE_EXISTS',
          message: '该公证处已存在',
        });
      throw this.mapAuthorization(error);
    }
  }

  async deactivateOffice(
    actor: ActorContext,
    id: string,
    input: SetNotaryOfficeStatusDto,
  ) {
    if (input.status !== 'INACTIVE') throw this.validation();
    try {
      return await this.database.$transaction(
        async (tx) => {
          await this.assertInternal(actor, tx);
          await this.access.authorizeDepartmentAction(
            actor,
            'notary.office.manage',
            tx,
          );
          const changed = await tx.notaryOffice.updateMany({
            where: { id, departmentId: actor.departmentId, status: 'ACTIVE' },
            data: { status: 'INACTIVE' },
          });
          if (changed.count !== 1) throw this.notFound();
          await tx.auditEvent.create({
            data: {
              departmentId: actor.departmentId,
              actorUserId: actor.userId,
              resourceType: 'notary_office',
              resourceId: id,
              action: 'notary_office.deactivated',
            },
          });
          return { id, status: 'INACTIVE' as const };
        },
        { isolationLevel: 'Serializable' },
      );
    } catch (error) {
      throw this.mapAuthorization(error);
    }
  }

  async transfer(
    actor: ActorContext,
    leadId: string,
    idempotencyKey: string,
    input: TransferLeadToNotaryDto,
  ): Promise<TransferResult> {
    const purpose = input.batchPurpose?.trim();
    if (
      !Array.isArray(input.selectedProductIds) ||
      input.selectedProductIds.length < 1 ||
      !input.selectedProductIds.every((id) => typeof id === 'string') ||
      new Set(input.selectedProductIds).size !==
        input.selectedProductIds.length ||
      !Array.isArray(input.selectedContentVersionIds) ||
      !input.selectedContentVersionIds.every((id) => typeof id === 'string') ||
      new Set(input.selectedContentVersionIds).size !==
        input.selectedContentVersionIds.length ||
      typeof purpose !== 'string' ||
      [...purpose].length < 1 ||
      [...purpose].length > 500 ||
      input.evidenceMode !== 'ONLINE_PURCHASE' ||
      !Number.isInteger(input.expectedVersion) ||
      input.expectedVersion < 1 ||
      (input.createNewBatch !== undefined &&
        typeof input.createNewBatch !== 'boolean')
    )
      throw this.validation();
    const newBatch = input.createNewBatch === true;
    const fingerprint = this.fingerprint({
      leadId,
      selectedProductIds: [...input.selectedProductIds].sort(),
      selectedContentVersionIds: [...input.selectedContentVersionIds].sort(),
      notaryOfficeId: input.notaryOfficeId,
      evidenceMode: input.evidenceMode,
      batchPurpose: purpose,
      expectedVersion: input.expectedVersion,
      createNewBatch: newBatch,
    });

    for (let attempt = 1; attempt <= MAX_SERIALIZABLE_ATTEMPTS; attempt += 1) {
      try {
        return await this.database.$transaction(
          async (tx) => {
            const locked = await tx.$queryRawUnsafe<Array<{ id: string }>>(
              'SELECT "id" FROM "leads" WHERE "id" = $1::uuid AND "department_id" = $2::uuid FOR UPDATE',
              leadId,
              actor.departmentId,
            );
            if (locked.length !== 1) throw this.notFound();
            const lead = await tx.lead.findFirst({
              where: { id: leadId, departmentId: actor.departmentId },
              include: {
                products: { orderBy: { position: 'asc' } },
                customer: { select: { profileStatus: true } },
                reviewDecision: { select: { id: true, result: true } },
                evidenceDecision: { select: { id: true } },
              },
            });
            if (lead === null) throw this.notFound();
            await this.assertInternal(actor, tx);
            try {
              await this.access.authorizeLead(
                actor,
                'lead.evidence.decide',
                {
                  departmentId: lead.departmentId,
                  responsibleUserId: lead.responsibleUserId,
                  ...(lead.teamId === null ? {} : { teamId: lead.teamId }),
                },
                tx,
              );
            } catch (error) {
              throw this.mapAuthorization(error);
            }
            const prior = await tx.leadCommandReceipt.findUnique({
              where: {
                departmentId_actorUserId_action_idempotencyKey: {
                  departmentId: actor.departmentId,
                  actorUserId: actor.userId,
                  action: 'notary_handoff',
                  idempotencyKey,
                },
              },
            });
            if (prior !== null)
              return this.receiptResult(prior, fingerprint, leadId);
            if (
              lead.activeReviewDecisionId === null ||
              lead.reviewDecision?.id !== lead.activeReviewDecisionId ||
              lead.reviewDecision.result !== 'INFRINGEMENT' ||
              lead.evidenceDecision !== null ||
              (newBatch
                ? lead.status !== 'TRANSFERRED_TO_NOTARY'
                : lead.status !== 'WAITING_EVIDENCE_DECISION')
            )
              throw this.invalidState();
            if (lead.version !== input.expectedVersion)
              throw this.versionConflict();
            if (lead.customer.profileStatus !== 'ADMITTED')
              throw this.customerNotAdmitted();
            if (
              newBatch &&
              (await tx.notaryMatter.count({
                where: {
                  departmentId: actor.departmentId,
                  sourceLeadId: leadId,
                },
              })) < 1
            )
              throw this.invalidState();
            const chosenProducts = lead.products.filter((product) =>
              input.selectedProductIds.includes(product.id),
            );
            if (chosenProducts.length !== input.selectedProductIds.length)
              throw this.invalidSelection();
            const office = await tx.notaryOffice.findFirst({
              where: {
                id: input.notaryOfficeId,
                departmentId: actor.departmentId,
                status: 'ACTIVE',
              },
              select: { id: true, name: true, status: true },
            });
            if (office === null) throw this.officeUnavailable();
            const lockedOffice = await tx.$queryRawUnsafe<
              Array<{ id: string }>
            >(
              'SELECT "id" FROM "notary_offices" WHERE "id" = $1::uuid AND "department_id" = $2::uuid AND "status" = \'ACTIVE\' FOR SHARE',
              office.id,
              actor.departmentId,
            );
            if (lockedOffice.length !== 1) throw this.officeUnavailable();
            const currentVersionIds =
              await this.materials.listCurrentReferenceVersionIds(
                tx,
                actor,
                {
                  resourceType: 'lead',
                  resourceId: leadId,
                  purpose: 'LEAD_SCREENSHOT',
                },
                'lead.evidence.decide',
              );
            if (
              input.selectedContentVersionIds.some(
                (id) => !currentVersionIds.includes(id),
              )
            )
              throw this.invalidSelection();
            const materialFacts =
              input.selectedContentVersionIds.length === 0
                ? []
                : await this.materials.assertAvailableVersions(tx, actor, {
                    ownerType: 'LEAD',
                    ownerId: leadId,
                    category: 'LEAD_SCREENSHOT',
                    contentVersionIds: input.selectedContentVersionIds,
                    minCount: 0,
                    maxCount: 20,
                    leadAction: 'lead.evidence.decide',
                  });
            const changed = await tx.lead.updateMany({
              where: {
                id: leadId,
                departmentId: actor.departmentId,
                status: lead.status,
                version: input.expectedVersion,
                activeReviewDecisionId: lead.activeReviewDecisionId,
              },
              data: {
                status: 'TRANSFERRED_TO_NOTARY',
                version: { increment: 1 },
              },
            });
            if (changed.count !== 1) throw this.versionConflict();
            const businessNo = await this.allocateBusinessNo(tx);
            const matterId = randomUUID();
            const createdAt = new Date();
            const selectedProductIds = chosenProducts.map(
              (product) => product.id,
            );
            const selectedContentVersionIds = [
              ...input.selectedContentVersionIds,
            ];
            const sourceSnapshot: Prisma.InputJsonObject = {
              sourceLeadId: lead.id,
              sourceLeadBusinessNo: lead.businessNo,
              activeReviewDecisionId: lead.activeReviewDecisionId,
              customerId: lead.customerId,
              rightsHolderId: lead.rightsHolderId,
              responsibleUserId: lead.responsibleUserId,
              shopName: lead.shopName,
              caseType: lead.caseType,
              source: lead.source,
              platform: lead.platform,
              foundAt: lead.foundAt.toISOString(),
              selectedProducts: chosenProducts.map((product) => ({
                id: product.id,
                position: product.position,
                title: product.title,
                url: product.url,
                quantity: product.quantity,
                unitPrice: product.unitPrice.toFixed(2),
                commentCount: product.commentCount,
                estimatedAmount: product.estimatedAmount.toFixed(2),
              })),
              selectedContentVersionIds,
            };
            await tx.notaryMatter.create({
              data: {
                id: matterId,
                businessNo,
                departmentId: actor.departmentId,
                sourceType: 'LEAD',
                sourceLeadId: leadId,
                customerId: lead.customerId,
                rightsHolderId: lead.rightsHolderId,
                responsibleUserId: lead.responsibleUserId,
                notaryOfficeId: office.id,
                stage: 'PENDING_EVIDENCE',
                version: 1,
                evidenceMode: 'ONLINE_PURCHASE',
                batchPurpose: purpose,
                sourceSnapshot,
                createdByUserId: actor.userId,
                fromLeadVersion: input.expectedVersion,
                toLeadVersion: input.expectedVersion + 1,
                createdAt,
              },
            });
            await tx.notaryMatterProduct.createMany({
              data: selectedProductIds.map((productId) => ({
                notaryMatterId: matterId,
                sourceLeadId: leadId,
                leadProductId: productId,
              })),
            });
            if (materialFacts.length > 0)
              await tx.notaryMatterMaterial.createMany({
                data: materialFacts.map((fact) => ({
                  notaryMatterId: matterId,
                  departmentId: actor.departmentId,
                  materialId: fact.materialId,
                  contentVersionId: fact.contentVersionId,
                })),
              });
            const result: TransferResult = {
              id: matterId,
              businessNo,
              leadId,
              leadStatus: 'TRANSFERRED_TO_NOTARY',
              leadVersion: input.expectedVersion + 1,
              stage: 'PENDING_EVIDENCE',
              notaryOffice: { id: office.id, name: office.name },
              selectedProductIds,
              selectedContentVersionIds,
              evidenceMode: 'ONLINE_PURCHASE',
              batchPurpose: purpose,
              createdAt: createdAt.toISOString(),
            };
            await tx.auditEvent.create({
              data: {
                departmentId: actor.departmentId,
                actorUserId: actor.userId,
                resourceType: 'lead',
                resourceId: leadId,
                action: newBatch
                  ? 'lead.evidence_batch_created'
                  : 'lead.transferred_to_notary',
                details: {
                  notaryMatterId: matterId,
                  businessNo,
                  fromVersion: input.expectedVersion,
                  toVersion: result.leadVersion,
                  selectedProductIds,
                  selectedContentVersionIds,
                  notaryOfficeId: office.id,
                  evidenceMode: 'ONLINE_PURCHASE',
                  batchPurpose: purpose,
                },
              },
            });
            await tx.leadCommandReceipt.create({
              data: {
                departmentId: actor.departmentId,
                actorUserId: actor.userId,
                action: 'notary_handoff',
                idempotencyKey,
                requestFingerprint: fingerprint,
                resultLeadId: leadId,
                resultLeadVersion: result.leadVersion,
                resultSnapshot: result,
              },
            });
            return result;
          },
          { isolationLevel: 'Serializable' },
        );
      } catch (error) {
        if (this.isSerializationConflict(error) || this.isUnique(error)) {
          if (attempt < MAX_SERIALIZABLE_ATTEMPTS) continue;
          throw this.versionConflict();
        }
        throw this.mapAuthorization(error);
      }
    }
    throw this.versionConflict();
  }

  async recordEvidence(
    actor: ActorContext,
    matterId: string,
    idempotencyKey: string,
    input: RecordNotaryEvidenceDto,
  ): Promise<EvidenceResult> {
    const normalized = this.normalizeEvidence(input);
    const fingerprint = this.fingerprint({
      matterId,
      ...normalized.fingerprint,
    });
    for (let attempt = 1; attempt <= MAX_SERIALIZABLE_ATTEMPTS; attempt += 1) {
      try {
        return await this.database.$transaction(
          async (tx) => {
            const locked = await tx.$queryRawUnsafe<Array<{ id: string }>>(
              'SELECT "id" FROM "notary_matters" WHERE "id" = $1::uuid AND "department_id" = $2::uuid FOR UPDATE',
              matterId,
              actor.departmentId,
            );
            if (locked.length !== 1) throw this.notFound();
            const matter = await tx.notaryMatter.findFirst({
              where: { id: matterId, departmentId: actor.departmentId },
              include: {
                sourceLead: {
                  select: { responsibleUserId: true, teamId: true },
                },
              },
            });
            if (matter === null) throw this.notFound();
            await this.assertInternal(actor, tx);
            try {
              await this.access.authorizeLead(
                actor,
                'notary.evidence.record',
                {
                  departmentId: matter.departmentId,
                  responsibleUserId: matter.sourceLead.responsibleUserId,
                  ...(matter.sourceLead.teamId === null
                    ? {}
                    : { teamId: matter.sourceLead.teamId }),
                },
                tx,
              );
            } catch (error) {
              throw this.mapAuthorization(error);
            }
            const receipt = await tx.notaryMatterCommandReceipt.findUnique({
              where: {
                departmentId_actorUserId_action_idempotencyKey: {
                  departmentId: actor.departmentId,
                  actorUserId: actor.userId,
                  action: 'evidence.record',
                  idempotencyKey,
                },
              },
            });
            if (receipt !== null)
              return this.evidenceReceiptResult(receipt, fingerprint, matterId);
            if (
              matter.stage !== 'PENDING_EVIDENCE' ||
              matter.evidenceMode !== 'ONLINE_PURCHASE'
            )
              throw new ConflictException({
                code: 'INVALID_STATE',
                message: '该公证事项当前不能登记取证物流',
              });
            if (matter.version !== input.expectedVersion)
              throw this.matterVersionConflict();
            const changed = await tx.notaryMatter.updateMany({
              where: {
                id: matterId,
                departmentId: actor.departmentId,
                stage: 'PENDING_EVIDENCE',
                version: input.expectedVersion,
              },
              data: {
                stage: 'WAITING_UNBOX',
                version: input.expectedVersion + 1,
              },
            });
            if (changed.count !== 1) throw this.matterVersionConflict();
            const recordedAt = new Date();
            const logistics = normalized.logistics.map((row) => ({
              id: randomUUID(),
              ...row,
            }));
            await tx.notaryMatterEvidence.create({
              data: {
                matterId,
                departmentId: actor.departmentId,
                evidenceAt: normalized.evidenceDate,
                sampleFeeState: normalized.sampleFeeState,
                sampleFeeAmount: normalized.sampleFeeAmount,
                recordedByUserId: actor.userId,
                recordedAt,
              },
            });
            await tx.notaryMatterLogistics.createMany({
              data: logistics.map((row, index) => ({
                ...row,
                matterId,
                position: index + 1,
              })),
            });
            const result: EvidenceResult = {
              id: matterId,
              stage: 'WAITING_UNBOX',
              version: input.expectedVersion + 1,
              evidence: {
                evidenceAt: normalized.evidenceAt,
                sampleFeeState: normalized.sampleFeeState,
                sampleFeeAmount: normalized.sampleFeeAmount,
                recordedAt: recordedAt.toISOString(),
                recordedByUserId: actor.userId,
                logistics,
              },
            };
            await tx.auditEvent.create({
              data: {
                departmentId: actor.departmentId,
                actorUserId: actor.userId,
                resourceType: 'notary_matter',
                resourceId: matterId,
                action: 'notary.evidence_recorded',
                details: {
                  fromStage: 'PENDING_EVIDENCE',
                  toStage: 'WAITING_UNBOX',
                  fromVersion: input.expectedVersion,
                  toVersion: result.version,
                  evidenceAt: normalized.evidenceAt,
                  sampleFeeState: normalized.sampleFeeState,
                  sampleFeeAmount: normalized.sampleFeeAmount,
                  logisticsIds: logistics.map((row) => row.id),
                },
              },
            });
            await tx.notaryMatterCommandReceipt.create({
              data: {
                departmentId: actor.departmentId,
                actorUserId: actor.userId,
                action: 'evidence.record',
                idempotencyKey,
                requestFingerprint: fingerprint,
                resultMatterId: matterId,
                resultMatterVersion: result.version,
                resultSnapshot: result,
              },
            });
            return result;
          },
          { isolationLevel: 'Serializable' },
        );
      } catch (error) {
        if (this.isSerializationConflict(error) || this.isUnique(error)) {
          if (attempt < MAX_SERIALIZABLE_ATTEMPTS) continue;
          throw this.matterVersionConflict();
        }
        throw this.mapAuthorization(error);
      }
    }
    throw this.matterVersionConflict();
  }

  async getMatter(actor: ActorContext, id: string) {
    await this.assertInternal(actor);
    let scope;
    try {
      scope = await this.access.buildLeadScope(actor, 'lead.read');
    } catch (error) {
      throw this.mapAuthorization(error);
    }
    const matter = await this.database.notaryMatter.findFirst({
      where: { id, departmentId: actor.departmentId, sourceLead: scope },
      include: {
        sourceLead: {
          select: {
            id: true,
            businessNo: true,
            responsibleUserId: true,
            teamId: true,
          },
        },
        notaryOffice: { select: { id: true, name: true } },
        evidence: {
          include: { logistics: { orderBy: { position: 'asc' } } },
        },
        selectedProducts: { orderBy: { leadProductId: 'asc' } },
        selectedMaterials: {
          include: {
            contentVersion: {
              select: { originalFilename: true, mimeType: true },
            },
          },
          orderBy: { contentVersionId: 'asc' },
        },
      },
    });
    if (matter === null) throw this.notFound();
    let recordEvidence = false;
    if (matter.stage === 'PENDING_EVIDENCE') {
      try {
        await this.access.authorizeLead(actor, 'notary.evidence.record', {
          departmentId: matter.departmentId,
          responsibleUserId: matter.sourceLead.responsibleUserId,
          ...(matter.sourceLead.teamId === null
            ? {}
            : { teamId: matter.sourceLead.teamId }),
        });
        recordEvidence = true;
      } catch (error) {
        if (!(error instanceof ForbiddenException)) throw error;
      }
    }
    if (matter.stage === 'WAITING_UNBOX' && matter.evidence === null)
      throw this.corruptReceipt();
    const productSnapshot = this.selectedProductSnapshot(
      matter.sourceSnapshot,
      matter.selectedProducts.map((item) => item.leadProductId),
    );
    const versionSnapshot = this.selectedVersionSnapshot(
      matter.sourceSnapshot,
      matter.selectedMaterials.map((item) => item.contentVersionId),
    );
    return {
      id: matter.id,
      businessNo: matter.businessNo,
      leadId: matter.sourceLeadId,
      leadStatus: 'TRANSFERRED_TO_NOTARY' as const,
      leadVersion: matter.toLeadVersion,
      stage: matter.stage,
      version: matter.version,
      capabilities: { recordEvidence },
      evidence:
        matter.evidence === null
          ? null
          : {
              evidenceAt: matter.evidence.evidenceAt.toISOString().slice(0, 10),
              sampleFeeState: matter.evidence.sampleFeeState,
              sampleFeeAmount:
                matter.evidence.sampleFeeAmount?.toFixed(2) ?? null,
              recordedAt: matter.evidence.recordedAt.toISOString(),
              recordedByUserId: matter.evidence.recordedByUserId,
              logistics: matter.evidence.logistics.map((row) => ({
                id: row.id,
                companyState: row.companyState,
                companyValue: row.companyValue,
                trackingState: row.trackingState,
                trackingValue: row.trackingValue,
              })),
            },
      notaryOffice: matter.notaryOffice,
      selectedProductIds: productSnapshot.map((item) => item.id),
      selectedContentVersionIds: versionSnapshot,
      evidenceMode: matter.evidenceMode,
      batchPurpose: matter.batchPurpose,
      createdAt: matter.createdAt.toISOString(),
      sourceLead: {
        id: matter.sourceLead.id,
        businessNo: matter.sourceLead.businessNo,
      },
      selectedProducts: productSnapshot,
      selectedMaterials: versionSnapshot.map((id) => {
        const item = matter.selectedMaterials.find(
          (selection) => selection.contentVersionId === id,
        );
        if (item === undefined) throw this.corruptReceipt();
        return {
          materialId: item.materialId,
          contentVersionId: item.contentVersionId,
          originalFilename: item.contentVersion.originalFilename,
          mimeType: item.contentVersion.mimeType,
        };
      }),
    };
  }

  private normalizeEvidence(input: RecordNotaryEvidenceDto) {
    if (
      typeof input.evidenceAt !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/u.test(input.evidenceAt) ||
      !Number.isInteger(input.expectedVersion) ||
      input.expectedVersion < 1 ||
      !Array.isArray(input.logistics) ||
      input.logistics.length < 1
    )
      throw this.validation();
    const evidenceDate = new Date(`${input.evidenceAt}T00:00:00.000Z`);
    if (
      Number.isNaN(evidenceDate.getTime()) ||
      evidenceDate.toISOString().slice(0, 10) !== input.evidenceAt
    )
      throw this.validation();
    if (input.sampleFeeState !== 'KNOWN' && input.sampleFeeState !== 'PENDING')
      throw this.validation();
    let sampleFeeAmount: string | null;
    if (input.sampleFeeState === 'KNOWN') {
      if (
        typeof input.sampleFeeAmount !== 'string' ||
        !/^(0|[1-9]\d{0,15})\.\d{2}$/u.test(input.sampleFeeAmount)
      )
        throw this.validation();
      sampleFeeAmount = input.sampleFeeAmount;
    } else {
      if (input.sampleFeeAmount !== null && input.sampleFeeAmount !== undefined)
        throw this.validation();
      sampleFeeAmount = null;
    }
    const field = (
      state: unknown,
      value: unknown,
      maxLength: number,
    ): { state: 'PRESENT' | 'NONE'; value: string | null } => {
      if (state === 'NONE') {
        if (value !== null && value !== undefined) throw this.validation();
        return { state, value: null };
      }
      if (state !== 'PRESENT' || typeof value !== 'string')
        throw this.validation();
      const trimmed = value.trim();
      if (trimmed.length < 1 || [...trimmed].length > maxLength)
        throw this.validation();
      return { state, value: trimmed };
    };
    const logistics = input.logistics.map((row) => {
      if (row === null || typeof row !== 'object') throw this.validation();
      const company = field(row.companyState, row.companyValue, 200);
      const tracking = field(row.trackingState, row.trackingValue, 100);
      return {
        companyState: company.state,
        companyValue: company.value,
        trackingState: tracking.state,
        trackingValue: tracking.value,
      };
    });
    return {
      evidenceAt: input.evidenceAt,
      evidenceDate,
      sampleFeeState: input.sampleFeeState,
      sampleFeeAmount,
      logistics,
      fingerprint: {
        evidenceAt: input.evidenceAt,
        sampleFeeState: input.sampleFeeState,
        sampleFeeAmount,
        logistics,
        expectedVersion: input.expectedVersion,
      },
    };
  }

  private evidenceReceiptResult(
    receipt: {
      requestFingerprint: string;
      resultMatterId: string;
      resultMatterVersion: number;
      resultSnapshot: unknown;
    },
    fingerprint: string,
    matterId: string,
  ): EvidenceResult {
    if (
      receipt.requestFingerprint !== fingerprint ||
      receipt.resultMatterId !== matterId
    )
      throw new ConflictException({
        code: 'IDEMPOTENCY_CONFLICT',
        message: '该 Idempotency-Key 已用于不同请求',
      });
    const value = receipt.resultSnapshot;
    if (value === null || typeof value !== 'object' || Array.isArray(value))
      throw this.corruptReceipt();
    const result = value as Record<string, unknown>;
    const evidence = result.evidence;
    if (
      result.id !== matterId ||
      result.stage !== 'WAITING_UNBOX' ||
      result.version !== receipt.resultMatterVersion ||
      evidence === null ||
      typeof evidence !== 'object' ||
      Array.isArray(evidence)
    )
      throw this.corruptReceipt();
    const record = evidence as Record<string, unknown>;
    if (
      typeof record.evidenceAt !== 'string' ||
      (record.sampleFeeState !== 'KNOWN' &&
        record.sampleFeeState !== 'PENDING') ||
      (record.sampleFeeAmount !== null &&
        typeof record.sampleFeeAmount !== 'string') ||
      typeof record.recordedAt !== 'string' ||
      typeof record.recordedByUserId !== 'string' ||
      !Array.isArray(record.logistics) ||
      record.logistics.length < 1 ||
      !record.logistics.every(
        (item) =>
          item !== null &&
          typeof item === 'object' &&
          typeof item.id === 'string' &&
          (item.companyState === 'PRESENT' || item.companyState === 'NONE') &&
          (item.companyValue === null ||
            typeof item.companyValue === 'string') &&
          (item.trackingState === 'PRESENT' || item.trackingState === 'NONE') &&
          (item.trackingValue === null ||
            typeof item.trackingValue === 'string'),
      )
    )
      throw this.corruptReceipt();
    return value as EvidenceResult;
  }

  private selectedProductSnapshot(
    snapshot: Prisma.JsonValue,
    productIds: string[],
  ) {
    if (
      snapshot === null ||
      typeof snapshot !== 'object' ||
      Array.isArray(snapshot) ||
      !Array.isArray(snapshot.selectedProducts)
    )
      throw this.corruptReceipt();
    const products = snapshot.selectedProducts;
    if (products.length !== productIds.length) throw this.corruptReceipt();
    const ids = new Set(productIds);
    return products.map((value) => {
      if (
        value === null ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        typeof value.id !== 'string' ||
        !ids.has(value.id) ||
        !Number.isInteger(value.position) ||
        (value.url !== null && typeof value.url !== 'string') ||
        (value.title !== null && typeof value.title !== 'string') ||
        !Number.isInteger(value.quantity) ||
        typeof value.unitPrice !== 'string' ||
        !Number.isInteger(value.commentCount) ||
        typeof value.estimatedAmount !== 'string'
      )
        throw this.corruptReceipt();
      ids.delete(value.id);
      return {
        id: value.id,
        position: value.position as number,
        url: value.url as string | null,
        title: value.title as string | null,
        quantity: value.quantity as number,
        unitPrice: value.unitPrice,
        commentCount: value.commentCount as number,
        estimatedAmount: value.estimatedAmount,
      };
    });
  }

  private selectedVersionSnapshot(
    snapshot: Prisma.JsonValue,
    versionIds: string[],
  ) {
    if (
      snapshot === null ||
      typeof snapshot !== 'object' ||
      Array.isArray(snapshot) ||
      !Array.isArray(snapshot.selectedContentVersionIds) ||
      snapshot.selectedContentVersionIds.length !== versionIds.length ||
      !snapshot.selectedContentVersionIds.every(
        (id) => typeof id === 'string' && versionIds.includes(id),
      ) ||
      new Set(snapshot.selectedContentVersionIds).size !== versionIds.length
    )
      throw this.corruptReceipt();
    return snapshot.selectedContentVersionIds as string[];
  }

  private async assertInternal(
    actor: ActorContext,
    tx: Pick<Prisma.TransactionClient, 'userAccount'> = this.database,
  ) {
    const account = await tx.userAccount.findUnique({
      where: { id: actor.userId },
      select: { accountType: true, active: true },
    });
    if (account?.accountType !== 'INTERNAL' || account.active === false)
      throw new ForbiddenException({
        code: 'ACTION_FORBIDDEN',
        message: '仅内部人员可执行该操作',
      });
  }

  private async canManageOffices(actor: ActorContext) {
    try {
      await this.access.authorizeDepartmentAction(
        actor,
        'notary.office.manage',
      );
      return true;
    } catch (error) {
      if (error instanceof ForbiddenException) return false;
      throw error;
    }
  }

  private async allocateBusinessNo(tx: Prisma.TransactionClient) {
    const rows = await tx.$queryRawUnsafe<
      Array<{ sequence: number; business_date: Date | string }>
    >(
      `INSERT INTO "notary_matter_number_counters" ("business_date", "last_value", "updated_at")
       VALUES ((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai')::date, 1, CURRENT_TIMESTAMP)
       ON CONFLICT ("business_date") DO UPDATE SET "last_value" = "notary_matter_number_counters"."last_value" + 1, "updated_at" = CURRENT_TIMESTAMP
       WHERE "notary_matter_number_counters"."last_value" < 999
       RETURNING "last_value" AS "sequence", "business_date"`,
    );
    const sequence = Number(rows[0]?.sequence);
    if (!Number.isInteger(sequence) || sequence < 1 || sequence > 999)
      throw new ConflictException({
        code: 'NOTARY_NUMBER_EXHAUSTED',
        message: '当日公证事项编号已用尽',
      });
    const date = rows[0]?.business_date;
    const code = (date instanceof Date ? date.toISOString() : String(date))
      .slice(0, 10)
      .replaceAll('-', '');
    if (!/^\d{8}$/u.test(code)) throw this.versionConflict();
    return `NT-${code}-${String(sequence).padStart(3, '0')}`;
  }

  private receiptResult(
    receipt: {
      requestFingerprint: string;
      resultLeadId: string;
      resultLeadVersion: number;
      resultSnapshot: unknown;
    },
    fingerprint: string,
    leadId: string,
  ): TransferResult {
    if (
      receipt.requestFingerprint !== fingerprint ||
      receipt.resultLeadId !== leadId
    )
      throw new ConflictException({
        code: 'IDEMPOTENCY_CONFLICT',
        message: '该 Idempotency-Key 已用于不同请求',
      });
    const value = receipt.resultSnapshot;
    if (value === null || typeof value !== 'object' || Array.isArray(value))
      throw this.corruptReceipt();
    const result = value as Record<string, unknown>;
    if (
      typeof result.id !== 'string' ||
      typeof result.businessNo !== 'string' ||
      result.leadId !== leadId ||
      result.leadVersion !== receipt.resultLeadVersion ||
      result.leadStatus !== 'TRANSFERRED_TO_NOTARY' ||
      result.stage !== 'PENDING_EVIDENCE' ||
      result.evidenceMode !== 'ONLINE_PURCHASE' ||
      typeof result.batchPurpose !== 'string' ||
      typeof result.createdAt !== 'string' ||
      !Array.isArray(result.selectedProductIds) ||
      !result.selectedProductIds.every((id) => typeof id === 'string') ||
      !Array.isArray(result.selectedContentVersionIds) ||
      !result.selectedContentVersionIds.every((id) => typeof id === 'string') ||
      result.notaryOffice === null ||
      typeof result.notaryOffice !== 'object' ||
      !('id' in result.notaryOffice) ||
      !('name' in result.notaryOffice) ||
      typeof result.notaryOffice.id !== 'string' ||
      typeof result.notaryOffice.name !== 'string'
    )
      throw this.corruptReceipt();
    return value as TransferResult;
  }

  private fingerprint(value: unknown) {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
  }
  private isUnique(error: unknown): boolean {
    return (
      error !== null &&
      typeof error === 'object' &&
      ((error as { code?: unknown }).code === 'P2002' ||
        this.isUnique((error as { cause?: unknown }).cause))
    );
  }
  private isSerializationConflict(error: unknown): boolean {
    if (error === null || typeof error !== 'object') return false;
    const record = error as { code?: unknown; cause?: unknown; meta?: unknown };
    if (record.code === 'P2034' || record.code === '40001') return true;
    const meta = record.meta as
      | {
          driverAdapterError?: {
            cause?: { originalCode?: unknown; sqlState?: unknown };
          };
        }
      | undefined;
    if (
      meta?.driverAdapterError?.cause?.originalCode === '40001' ||
      meta?.driverAdapterError?.cause?.sqlState === '40001'
    )
      return true;
    return this.isSerializationConflict(record.cause);
  }
  private mapAuthorization(error: unknown) {
    if (error instanceof ForbiddenException)
      return new ForbiddenException({
        code: 'ACTION_FORBIDDEN',
        message: '无权执行该操作',
      });
    return error;
  }
  private validation() {
    return new BadRequestException({
      code: 'VALIDATION_ERROR',
      message: '请求字段不符合接口要求',
    });
  }
  private notFound() {
    return new NotFoundException({
      code: 'RESOURCE_NOT_FOUND',
      message: '资源不存在或不可访问',
    });
  }
  private invalidState() {
    return new ConflictException({
      code: 'INVALID_STATE',
      message: '线索当前状态不允许新建取证批次',
    });
  }
  private versionConflict() {
    return new ConflictException({
      code: 'VERSION_CONFLICT',
      message: '线索已更新，请重新加载',
    });
  }
  private matterVersionConflict() {
    return new ConflictException({
      code: 'VERSION_CONFLICT',
      message: '公证事项已更新，请重新加载',
    });
  }
  private customerNotAdmitted() {
    return new ConflictException({
      code: 'CUSTOMER_NOT_ADMITTED',
      message: '客户已不处于准入状态',
    });
  }
  private invalidSelection() {
    return new ConflictException({
      code: 'INVALID_SELECTION',
      message: '所选商品或材料不属于当前线索的有效内容',
    });
  }
  private officeUnavailable() {
    return new ConflictException({
      code: 'OFFICE_UNAVAILABLE',
      message: '所选公证处不可用',
    });
  }
  private corruptReceipt() {
    return new InternalServerErrorException({
      code: 'INTERNAL_ERROR',
      message: '公证事项回执数据损坏',
    });
  }
}
