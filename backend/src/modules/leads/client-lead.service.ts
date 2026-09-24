import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { ActorContext } from '../../access-control/actor-context';
import type { PermissionAction } from '../../access-control/access-control.service';
import { DatabaseService } from '../../database/database.service';
import type { Prisma } from '../../generated/prisma/client';
import { MaterialService } from '../materials';
import type {
  ClientLeadView,
  ConfirmClientLeadWithdrawalDto,
  ReviewClientLeadDto,
} from './client-lead-review.dto';

const CLIENT_LEAD_REVIEW_ACTION =
  'client.lead.review' satisfies PermissionAction;
const CLIENT_LEAD_WITHDRAW_CONFIRM_ACTION =
  'client.lead.withdraw.confirm' satisfies PermissionAction;
const MAX_SERIALIZABLE_ATTEMPTS = 3;

type ClientBindingFacts = {
  id: string;
  customerId: string;
  reviewerDisplayName: string;
};

type ClientLeadReviewResult = {
  id: string;
  businessNo: string;
  version: number;
} & (
  | {
      status: 'WAITING_EVIDENCE_DECISION';
      reviewDecision: {
        result: 'INFRINGEMENT';
        reviewerDisplayName: string;
        decidedAt: string;
      };
    }
  | {
      status: 'ARCHIVED';
      reviewDecision: {
        result: 'NO_INFRINGEMENT';
        reason: string;
        reviewerDisplayName: string;
        decidedAt: string;
        archiveType: 'NO_INFRINGEMENT';
        archivedAt: string;
      };
    }
);

const clientLeadInclude = {
  products: { orderBy: { position: 'asc' as const } },
  infringements: { orderBy: { type: 'asc' as const } },
  rightsHolder: { select: { name: true } },
  reviewDecision: {
    select: {
      result: true,
      reason: true,
      archiveType: true,
      archivedAt: true,
      reviewerDisplayNameSnapshot: true,
      decidedAt: true,
    },
  },
  evidenceDecision: {
    select: {
      id: true,
      result: true,
      reason: true,
      actorDisplayNameSnapshot: true,
      decidedAt: true,
      archiveType: true,
      archivedAt: true,
      fromVersion: true,
      toVersion: true,
    },
  },
  withdrawalApplications: {
    select: {
      id: true,
      originalDecisionId: true,
      reason: true,
      appliedAt: true,
      fromVersion: true,
      toVersion: true,
      resultSnapshot: true,
      confirmation: {
        select: {
          id: true,
          confirmedAt: true,
          fromVersion: true,
          toVersion: true,
        },
      },
    },
  },
} satisfies Prisma.LeadInclude;

const clientLeadDetailInclude = {
  ...clientLeadInclude,
  reviewDecisions: {
    select: {
      id: true,
      result: true,
      reason: true,
      archiveType: true,
      archivedAt: true,
      reviewerDisplayNameSnapshot: true,
      decidedAt: true,
      fromVersion: true,
      toVersion: true,
    },
  },
} satisfies Prisma.LeadInclude;

type ClientLeadRecord = Prisma.LeadGetPayload<{
  include: typeof clientLeadInclude;
}>;
type ClientLeadDetailRecord = Prisma.LeadGetPayload<{
  include: typeof clientLeadDetailInclude;
}>;

type ClientLeadWithdrawalConfirmationResult = {
  id: string;
  applicationId: string;
  leadId: string;
  status: 'WAITING_REVIEW';
  version: number;
  confirmedByDisplayName: string;
  confirmedAt: string;
};

@Injectable()
export class ClientLeadService {
  constructor(
    private readonly database: DatabaseService,
    private readonly materials: MaterialService,
  ) {}

  async list(
    actor: ActorContext,
    view: ClientLeadView,
    page: number,
    pageSize: number,
  ) {
    const { customerId } = await this.assertClient(actor);
    const where: Prisma.LeadWhereInput = {
      departmentId: actor.departmentId,
      customerId,
      pushedAt: { not: null },
      pushedByUserId: { not: null },
      ...(view === 'PENDING'
        ? {
            OR: [
              {
                status: 'WAITING_REVIEW' as const,
                activeReviewDecisionId: null,
              },
              {
                status: 'ARCHIVED' as const,
                reviewDecision: {
                  is: {
                    result: 'NO_INFRINGEMENT' as const,
                    archiveType: 'NO_INFRINGEMENT' as const,
                    archivedAt: { not: null },
                  },
                },
                withdrawalApplications: {
                  some: { confirmation: { is: null } },
                },
              },
            ],
          }
        : {
            OR: [
              {
                status: 'WAITING_EVIDENCE_DECISION' as const,
                reviewDecision: { is: { result: 'INFRINGEMENT' as const } },
              },
              {
                status: 'ARCHIVED' as const,
                evidenceDecision: { is: { result: 'NO_EVIDENCE' as const } },
              },
              {
                status: 'ARCHIVED' as const,
                withdrawalApplications: {
                  none: { confirmation: { is: null } },
                },
                reviewDecision: {
                  is: {
                    result: 'NO_INFRINGEMENT' as const,
                    archiveType: 'NO_INFRINGEMENT' as const,
                    archivedAt: { not: null },
                  },
                },
              },
            ],
          }),
    };
    const [items, total] = await Promise.all([
      this.database.lead.findMany({
        where,
        orderBy: [{ pushedAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: clientLeadInclude,
      }),
      this.database.lead.count({ where }),
    ]);
    return {
      items: items.map((item) => this.view(item, [], false)),
      total,
      page,
      pageSize,
    };
  }

  async get(actor: ActorContext, id: string) {
    const { customerId } = await this.assertClient(actor);
    const lead = await this.database.lead.findFirst({
      where: {
        id,
        departmentId: actor.departmentId,
        customerId,
        pushedAt: { not: null },
        pushedByUserId: { not: null },
        OR: [
          { status: 'WAITING_REVIEW', activeReviewDecisionId: null },
          {
            status: 'WAITING_EVIDENCE_DECISION',
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
      include: clientLeadDetailInclude,
    });
    if (lead === null) throw this.notFound();
    const versionIds = await this.materials.listCurrentReferenceVersionIds(
      this.database,
      actor,
      {
        resourceType: 'lead',
        resourceId: lead.id,
        purpose: 'LEAD_SCREENSHOT',
      },
    );
    return this.view(lead, versionIds, true);
  }

  async review(
    actor: ActorContext,
    id: string,
    idempotencyKey: string,
    input: ReviewClientLeadDto,
  ): Promise<ClientLeadReviewResult> {
    if (
      (input.result === 'NO_INFRINGEMENT' &&
        (typeof input.reason !== 'string' ||
          [...input.reason.trim()].length < 1 ||
          [...input.reason.trim()].length > 5000)) ||
      (input.result === 'INFRINGEMENT' && input.reason !== undefined)
    )
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: '审核原因与结论不匹配',
      });
    const request =
      input.result === 'INFRINGEMENT'
        ? {
            leadId: id,
            result: input.result,
            expectedVersion: input.expectedVersion,
          }
        : {
            leadId: id,
            result: input.result,
            reason: input.reason!.trim(),
            expectedVersion: input.expectedVersion,
          };
    const fingerprint = createHash('sha256')
      .update(JSON.stringify(request))
      .digest('hex');
    for (let attempt = 1; attempt <= MAX_SERIALIZABLE_ATTEMPTS; attempt += 1) {
      try {
        return await this.database.$transaction(
          async (transaction) => {
            const binding = await this.assertClient(actor, transaction);
            const receipt =
              await transaction.clientLeadReviewReceipt.findUnique({
                where: this.reviewReceiptWhere(actor, idempotencyKey),
              });
            if (receipt !== null) {
              await this.assertReplayLead(
                transaction,
                actor,
                id,
                binding.customerId,
              );
              return this.reviewReceiptResult(receipt, fingerprint, id);
            }

            const locked = await transaction.$queryRawUnsafe<
              Array<{ id: string }>
            >(
              'SELECT "id" FROM "leads" WHERE "id" = $1::uuid AND "department_id" = $2::uuid AND "customer_id" = $3::uuid FOR UPDATE',
              id,
              actor.departmentId,
              binding.customerId,
            );
            if (locked.length !== 1) throw this.notFound();
            const current = await transaction.lead.findFirst({
              where: {
                id,
                departmentId: actor.departmentId,
                customerId: binding.customerId,
              },
              select: {
                id: true,
                businessNo: true,
                status: true,
                version: true,
                activeReviewDecisionId: true,
                pushedAt: true,
                pushedByUserId: true,
              },
            });
            if (
              current === null ||
              current.pushedAt === null ||
              current.pushedByUserId === null
            )
              throw this.notFound();
            if (
              current.status !== 'WAITING_REVIEW' ||
              current.activeReviewDecisionId !== null
            )
              throw this.invalidState();
            if (current.version !== input.expectedVersion)
              throw this.versionConflict();

            const nextStatus =
              input.result === 'INFRINGEMENT'
                ? 'WAITING_EVIDENCE_DECISION'
                : 'ARCHIVED';
            const decidedAt = new Date();
            const changed = await transaction.lead.updateMany({
              where: {
                id,
                departmentId: actor.departmentId,
                customerId: binding.customerId,
                status: 'WAITING_REVIEW',
                activeReviewDecisionId: null,
                version: input.expectedVersion,
                pushedAt: { not: null },
                pushedByUserId: { not: null },
              },
              data: {
                status: nextStatus,
                version: { increment: 1 },
              },
            });
            if (changed.count !== 1) throw this.versionConflict();

            const decision = await transaction.leadReviewDecision.create({
              data: {
                departmentId: actor.departmentId,
                leadId: id,
                customerId: binding.customerId,
                reviewerUserId: actor.userId,
                customerAccountBindingId: binding.id,
                reviewerDisplayNameSnapshot: binding.reviewerDisplayName,
                result: input.result,
                fromVersion: input.expectedVersion,
                toVersion: input.expectedVersion + 1,
                decidedAt,
                ...(input.result === 'NO_INFRINGEMENT'
                  ? {
                      reason: input.reason!.trim(),
                      archiveType: 'NO_INFRINGEMENT' as const,
                      archivedAt: decidedAt,
                    }
                  : {}),
              },
            });
            await transaction.lead.update({
              where: { id },
              data: { activeReviewDecisionId: decision.id },
            });
            const decisionSnapshot = {
              reviewerDisplayName: binding.reviewerDisplayName,
              decidedAt: decision.decidedAt.toISOString(),
            };
            const result: ClientLeadReviewResult =
              input.result === 'INFRINGEMENT'
                ? {
                    id,
                    businessNo: current.businessNo,
                    status: 'WAITING_EVIDENCE_DECISION',
                    version: input.expectedVersion + 1,
                    reviewDecision: {
                      result: 'INFRINGEMENT',
                      ...decisionSnapshot,
                    },
                  }
                : {
                    id,
                    businessNo: current.businessNo,
                    status: 'ARCHIVED',
                    version: input.expectedVersion + 1,
                    reviewDecision: {
                      result: 'NO_INFRINGEMENT',
                      reason: input.reason!.trim(),
                      ...decisionSnapshot,
                      archiveType: 'NO_INFRINGEMENT',
                      archivedAt: decidedAt.toISOString(),
                    },
                  };
            await transaction.clientLeadReviewReceipt.create({
              data: {
                departmentId: actor.departmentId,
                actorUserId: actor.userId,
                customerAccountBindingId: binding.id,
                action: CLIENT_LEAD_REVIEW_ACTION,
                idempotencyKey,
                requestFingerprint: fingerprint,
                resultLeadId: id,
                resultLeadVersion: result.version,
                reviewDecisionId: decision.id,
                resultSnapshot: result,
              },
            });
            return result;
          },
          { isolationLevel: 'Serializable' },
        );
      } catch (error) {
        if (this.isSerializationConflict(error)) {
          if (attempt < MAX_SERIALIZABLE_ATTEMPTS) continue;
          throw this.versionConflict();
        }
        if (this.isUnique(error)) {
          const binding = await this.assertClient(actor);
          const receipt =
            await this.database.clientLeadReviewReceipt.findUnique({
              where: this.reviewReceiptWhere(actor, idempotencyKey),
            });
          if (receipt !== null) {
            await this.assertReplayLead(
              this.database,
              actor,
              id,
              binding.customerId,
            );
            return this.reviewReceiptResult(receipt, fingerprint, id);
          }
          throw this.versionConflict();
        }
        throw error;
      }
    }
    throw this.versionConflict();
  }

  async confirmWithdrawal(
    actor: ActorContext,
    id: string,
    idempotencyKey: string,
    input: ConfirmClientLeadWithdrawalDto,
  ): Promise<ClientLeadWithdrawalConfirmationResult> {
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify({
          action: CLIENT_LEAD_WITHDRAW_CONFIRM_ACTION,
          leadId: id,
          applicationId: input.applicationId,
          expectedVersion: input.expectedVersion,
        }),
      )
      .digest('hex');
    for (let attempt = 1; attempt <= MAX_SERIALIZABLE_ATTEMPTS; attempt += 1) {
      try {
        return await this.database.$transaction(
          async (transaction) => {
            const binding = await this.assertClient(actor, transaction);
            const receipt =
              await transaction.leadWithdrawalConfirmation.findUnique({
                where: this.confirmationReceiptWhere(actor, idempotencyKey),
              });
            if (receipt !== null)
              return this.confirmationReceiptResult(
                receipt,
                fingerprint,
                id,
                binding.customerId,
              );

            const locked = await transaction.$queryRawUnsafe<
              Array<{ id: string }>
            >(
              'SELECT "id" FROM "leads" WHERE "id" = $1::uuid AND "department_id" = $2::uuid AND "customer_id" = $3::uuid FOR UPDATE',
              id,
              actor.departmentId,
              binding.customerId,
            );
            if (locked.length !== 1) throw this.notFound();
            const current = await transaction.lead.findFirst({
              where: {
                id,
                departmentId: actor.departmentId,
                customerId: binding.customerId,
              },
              select: {
                id: true,
                status: true,
                version: true,
                pushedAt: true,
                pushedByUserId: true,
                activeReviewDecisionId: true,
                reviewDecision: {
                  select: { result: true, archiveType: true, archivedAt: true },
                },
                withdrawalApplications: {
                  where: { id: input.applicationId },
                  select: {
                    id: true,
                    originalDecisionId: true,
                    toVersion: true,
                    confirmation: { select: { id: true } },
                  },
                },
              },
            });
            if (
              current === null ||
              current.pushedAt === null ||
              current.pushedByUserId === null
            )
              throw this.notFound();
            if (
              current.status !== 'ARCHIVED' ||
              current.activeReviewDecisionId === null ||
              current.reviewDecision?.result !== 'NO_INFRINGEMENT' ||
              current.reviewDecision.archiveType !== 'NO_INFRINGEMENT' ||
              current.reviewDecision.archivedAt === null ||
              current.withdrawalApplications.length !== 1 ||
              current.withdrawalApplications[0].originalDecisionId !==
                current.activeReviewDecisionId ||
              current.withdrawalApplications[0].confirmation !== null
            )
              throw this.withdrawalInvalidState();
            if (current.version !== input.expectedVersion)
              throw this.versionConflict();
            if (current.withdrawalApplications[0].toVersion !== current.version)
              throw this.withdrawalInvalidState();
            const changed = await transaction.lead.updateMany({
              where: {
                id,
                departmentId: actor.departmentId,
                customerId: binding.customerId,
                status: 'ARCHIVED',
                version: input.expectedVersion,
                activeReviewDecisionId: current.activeReviewDecisionId,
                pushedAt: { not: null },
                pushedByUserId: { not: null },
              },
              data: {
                status: 'WAITING_REVIEW',
                activeReviewDecisionId: null,
                version: { increment: 1 },
              },
            });
            if (changed.count !== 1) throw this.versionConflict();
            const confirmedAt = new Date();
            const result: ClientLeadWithdrawalConfirmationResult = {
              id: randomUUID(),
              applicationId: input.applicationId,
              leadId: id,
              status: 'WAITING_REVIEW',
              version: input.expectedVersion + 1,
              confirmedByDisplayName: binding.reviewerDisplayName,
              confirmedAt: confirmedAt.toISOString(),
            };
            await transaction.leadWithdrawalConfirmation.create({
              data: {
                id: result.id,
                applicationId: input.applicationId,
                originalDecisionId: current.activeReviewDecisionId,
                leadId: id,
                customerId: binding.customerId,
                departmentId: actor.departmentId,
                actorUserId: actor.userId,
                customerAccountBindingId: binding.id,
                confirmedAt,
                fromVersion: input.expectedVersion,
                toVersion: result.version,
                idempotencyKey,
                requestFingerprint: fingerprint,
                resultSnapshot: result,
              },
            });
            return result;
          },
          { isolationLevel: 'Serializable' },
        );
      } catch (error) {
        if (this.isSerializationConflict(error)) {
          if (attempt < MAX_SERIALIZABLE_ATTEMPTS) continue;
          throw this.versionConflict();
        }
        if (this.isUnique(error)) {
          const binding = await this.assertClient(actor);
          const receipt =
            await this.database.leadWithdrawalConfirmation.findUnique({
              where: this.confirmationReceiptWhere(actor, idempotencyKey),
            });
          if (receipt !== null)
            return this.confirmationReceiptResult(
              receipt,
              fingerprint,
              id,
              binding.customerId,
            );
          throw this.versionConflict();
        }
        throw error;
      }
    }
    throw this.versionConflict();
  }

  private confirmationReceiptWhere(
    actor: ActorContext,
    idempotencyKey: string,
  ) {
    return {
      departmentId_actorUserId_idempotencyKey: {
        departmentId: actor.departmentId,
        actorUserId: actor.userId,
        idempotencyKey,
      },
    };
  }

  private async assertReplayLead(
    reader: Pick<Prisma.TransactionClient, 'lead'>,
    actor: ActorContext,
    id: string,
    customerId: string,
  ): Promise<void> {
    const lead = await reader.lead.findFirst({
      where: {
        id,
        departmentId: actor.departmentId,
        customerId,
        pushedAt: { not: null },
        pushedByUserId: { not: null },
      },
      select: { id: true },
    });
    if (lead === null) throw this.notFound();
  }

  private confirmationReceiptResult(
    receipt: {
      requestFingerprint: string;
      resultSnapshot: Prisma.JsonValue;
      leadId: string;
      customerId: string;
      applicationId: string;
      id: string;
      toVersion: number;
      confirmedAt: Date;
    },
    fingerprint: string,
    leadId: string,
    customerId: string,
  ): ClientLeadWithdrawalConfirmationResult {
    if (receipt.leadId !== leadId || receipt.customerId !== customerId)
      throw this.notFound();
    if (receipt.requestFingerprint !== fingerprint)
      throw this.idempotencyConflict();
    const snapshot = receipt.resultSnapshot;
    if (
      snapshot === null ||
      typeof snapshot !== 'object' ||
      Array.isArray(snapshot)
    )
      throw this.corruptReceipt();
    const value: Record<string, unknown> = snapshot;
    if (
      value.id !== receipt.id ||
      value.applicationId !== receipt.applicationId ||
      value.leadId !== leadId ||
      value.status !== 'WAITING_REVIEW' ||
      value.version !== receipt.toVersion ||
      typeof value.confirmedByDisplayName !== 'string' ||
      value.confirmedAt !== receipt.confirmedAt.toISOString()
    )
      throw this.corruptReceipt();
    return value as ClientLeadWithdrawalConfirmationResult;
  }

  private withdrawalInvalidState() {
    return new ConflictException({
      code: 'INVALID_STATE',
      message: '当前线索无法确认撤回申请',
    });
  }

  private async assertClient(
    actor: ActorContext,
    reader: Pick<Prisma.TransactionClient, 'customerAccountBinding'> = this
      .database,
  ): Promise<ClientBindingFacts> {
    if (actor.clientCustomerId === undefined) throw this.forbidden();
    const binding = await reader.customerAccountBinding.findFirst({
      where: {
        userId: actor.userId,
        customerId: actor.clientCustomerId,
        departmentId: actor.departmentId,
        active: true,
        user: { active: true, accountType: 'CLIENT' },
        customer: { profileStatus: 'ADMITTED' },
      },
      select: {
        id: true,
        customerId: true,
        user: { select: { displayName: true } },
      },
    });
    if (binding === null) throw this.forbidden();
    return {
      id: binding.id,
      customerId: binding.customerId,
      reviewerDisplayName: binding.user.displayName,
    };
  }

  private reviewReceiptWhere(actor: ActorContext, idempotencyKey: string) {
    return {
      departmentId_actorUserId_action_idempotencyKey: {
        departmentId: actor.departmentId,
        actorUserId: actor.userId,
        action: CLIENT_LEAD_REVIEW_ACTION,
        idempotencyKey,
      },
    };
  }

  private reviewReceiptResult(
    receipt: {
      requestFingerprint: string;
      resultLeadId: string;
      resultLeadVersion: number;
      resultSnapshot: Prisma.JsonValue;
    },
    fingerprint: string,
    leadId: string,
  ): ClientLeadReviewResult {
    if (receipt.requestFingerprint !== fingerprint)
      throw this.idempotencyConflict();
    const snapshot = receipt.resultSnapshot;
    if (
      snapshot === null ||
      typeof snapshot !== 'object' ||
      Array.isArray(snapshot)
    )
      throw this.corruptReceipt();
    const value: Record<string, unknown> = snapshot;
    const decision = value.reviewDecision;
    const decisionFields =
      decision !== null &&
      typeof decision === 'object' &&
      !Array.isArray(decision)
        ? (decision as Record<string, unknown>)
        : null;
    if (
      receipt.resultLeadId !== leadId ||
      value.id !== leadId ||
      value.version !== receipt.resultLeadVersion ||
      typeof value.businessNo !== 'string' ||
      decisionFields === null ||
      typeof decisionFields.reviewerDisplayName !== 'string' ||
      typeof decisionFields.decidedAt !== 'string' ||
      !(
        (value.status === 'WAITING_EVIDENCE_DECISION' &&
          decisionFields.result === 'INFRINGEMENT' &&
          decisionFields.reason === undefined &&
          decisionFields.archiveType === undefined &&
          decisionFields.archivedAt === undefined) ||
        (value.status === 'ARCHIVED' &&
          decisionFields.result === 'NO_INFRINGEMENT' &&
          typeof decisionFields.reason === 'string' &&
          decisionFields.reason.trim().length > 0 &&
          decisionFields.reason === decisionFields.reason.trim() &&
          [...decisionFields.reason].length <= 5000 &&
          decisionFields.archiveType === 'NO_INFRINGEMENT' &&
          decisionFields.archivedAt === decisionFields.decidedAt)
      )
    )
      throw this.corruptReceipt();
    return value as ClientLeadReviewResult;
  }

  private isSerializationConflict(error: unknown): boolean {
    if (error === null || typeof error !== 'object') return false;
    const value = error as { code?: unknown; meta?: unknown; cause?: unknown };
    if (value.code === 'P2034') return true;
    if (
      value.code === 'P2010' &&
      value.meta !== null &&
      typeof value.meta === 'object'
    ) {
      const adapter = (value.meta as { driverAdapterError?: unknown })
        .driverAdapterError;
      if (adapter !== null && typeof adapter === 'object') {
        const cause = (adapter as { cause?: unknown }).cause;
        if (cause !== null && typeof cause === 'object') {
          const state = cause as { originalCode?: unknown; sqlState?: unknown };
          if (state.originalCode === '40001' || state.sqlState === '40001')
            return true;
        }
      }
    }
    return this.isSerializationConflict(value.cause);
  }

  private isUnique(error: unknown): boolean {
    return (
      error !== null &&
      typeof error === 'object' &&
      ((error as { code?: unknown }).code === 'P2002' ||
        this.isUnique((error as { cause?: unknown }).cause))
    );
  }

  private invalidState() {
    return new ConflictException({
      code: 'INVALID_STATE',
      message: '仅待审核线索可以提交审核',
    });
  }

  private versionConflict() {
    return new ConflictException({
      code: 'VERSION_CONFLICT',
      message: '线索版本已变化',
    });
  }

  private idempotencyConflict() {
    return new ConflictException({
      code: 'IDEMPOTENCY_CONFLICT',
      message: '幂等键已用于其他请求',
    });
  }

  private corruptReceipt() {
    return new InternalServerErrorException({
      code: 'INTERNAL_ERROR',
      message: '审核回执不可用',
    });
  }

  private view(
    lead: ClientLeadRecord | ClientLeadDetailRecord,
    leadScreenshotContentVersionIds: readonly string[],
    detail: boolean,
  ) {
    const applications = lead.withdrawalApplications ?? [];
    const pending = applications.find(
      (application) =>
        application.originalDecisionId === lead.activeReviewDecisionId &&
        application.confirmation === null,
    );
    const history =
      detail && 'reviewDecisions' in lead
        ? [
            ...(lead.evidenceDecision === null ||
            lead.evidenceDecision === undefined
              ? []
              : [
                  {
                    kind: 'EVIDENCE_DECISION' as const,
                    id: lead.evidenceDecision.id,
                    fromVersion: lead.evidenceDecision.fromVersion,
                    toVersion: lead.evidenceDecision.toVersion,
                    result: lead.evidenceDecision.result,
                    reason: lead.evidenceDecision.reason,
                    archiveType: lead.evidenceDecision.archiveType,
                    archivedAt: lead.evidenceDecision.archivedAt.toISOString(),
                    decidedByDisplayName:
                      lead.evidenceDecision.actorDisplayNameSnapshot,
                    occurredAt: lead.evidenceDecision.decidedAt.toISOString(),
                  },
                ]),
            ...lead.reviewDecisions.map((decision) => ({
              kind: 'REVIEW_DECISION' as const,
              id: decision.id,
              fromVersion: decision.fromVersion,
              toVersion: decision.toVersion,
              result: decision.result,
              reason: decision.reason,
              archiveType: decision.archiveType,
              archivedAt: decision.archivedAt?.toISOString() ?? null,
              reviewerDisplayName: decision.reviewerDisplayNameSnapshot,
              occurredAt: decision.decidedAt.toISOString(),
            })),
            ...applications.flatMap((application) => [
              {
                kind: 'WITHDRAWAL_APPLICATION' as const,
                id: application.id,
                fromVersion: application.fromVersion,
                toVersion: application.toVersion,
                reason: application.reason,
                applicantDisplayName: this.applicationDisplayName(
                  application.resultSnapshot,
                ),
                occurredAt: application.appliedAt.toISOString(),
              },
              ...(application.confirmation === null
                ? []
                : [
                    {
                      kind: 'WITHDRAWAL_CONFIRMATION' as const,
                      id: application.confirmation.id,
                      applicationId: application.id,
                      fromVersion: application.confirmation.fromVersion,
                      toVersion: application.confirmation.toVersion,
                      occurredAt:
                        application.confirmation.confirmedAt.toISOString(),
                    },
                  ]),
            ]),
          ].sort(
            (left, right) =>
              left.fromVersion - right.fromVersion ||
              left.id.localeCompare(right.id),
          )
        : [];
    return {
      id: lead.id,
      businessNo: lead.businessNo,
      status: lead.status,
      version: lead.version,
      caseType: lead.caseType,
      infringementTypes: lead.infringements.map(({ type }) => type),
      source: lead.source,
      platform: lead.platform,
      foundAt: lead.foundAt.toISOString(),
      shopName: lead.shopName,
      shopExternalId: lead.shopExternalId ?? null,
      rightsHolderName: lead.rightsHolder.name,
      products: lead.products.map((product) => ({
        id: product.id,
        position: product.position,
        url: product.url ?? null,
        title: product.title ?? null,
        quantity: product.quantity,
        unitPrice: product.unitPrice.toFixed(2),
        commentCount: product.commentCount,
        estimatedAmount: product.estimatedAmount.toFixed(2),
      })),
      leadScreenshotContentVersionIds: [...leadScreenshotContentVersionIds],
      pushedAt: lead.pushedAt?.toISOString() ?? null,
      reviewDecision: lead.reviewDecision
        ? lead.reviewDecision.result === 'NO_INFRINGEMENT'
          ? {
              result: 'NO_INFRINGEMENT' as const,
              reason: lead.reviewDecision.reason,
              reviewerDisplayName:
                lead.reviewDecision.reviewerDisplayNameSnapshot,
              decidedAt: lead.reviewDecision.decidedAt.toISOString(),
              archiveType: lead.reviewDecision.archiveType,
              archivedAt: lead.reviewDecision.archivedAt?.toISOString() ?? null,
            }
          : {
              result: 'INFRINGEMENT' as const,
              reviewerDisplayName:
                lead.reviewDecision.reviewerDisplayNameSnapshot,
              decidedAt: lead.reviewDecision.decidedAt.toISOString(),
            }
        : null,
      evidenceDecision: lead.evidenceDecision
        ? {
            result: lead.evidenceDecision.result,
            reason: lead.evidenceDecision.reason,
            decidedByDisplayName:
              lead.evidenceDecision.actorDisplayNameSnapshot,
            decidedAt: lead.evidenceDecision.decidedAt.toISOString(),
            archiveType: lead.evidenceDecision.archiveType,
            archivedAt: lead.evidenceDecision.archivedAt.toISOString(),
          }
        : null,
      pendingWithdrawalApplication:
        pending === undefined
          ? null
          : {
              id: pending.id,
              reason: pending.reason,
              applicantDisplayName: this.applicationDisplayName(
                pending.resultSnapshot,
              ),
              appliedAt: pending.appliedAt.toISOString(),
            },
      history,
      capabilities: {
        review:
          lead.status === 'WAITING_REVIEW' &&
          lead.activeReviewDecisionId === null,
        confirmWithdrawal:
          lead.status === 'ARCHIVED' &&
          pending !== undefined &&
          lead.reviewDecision?.result === 'NO_INFRINGEMENT' &&
          lead.reviewDecision.archiveType === 'NO_INFRINGEMENT' &&
          lead.reviewDecision.archivedAt !== null,
      },
    };
  }

  private applicationDisplayName(snapshot: unknown): string {
    if (
      snapshot === null ||
      typeof snapshot !== 'object' ||
      Array.isArray(snapshot) ||
      !('applicantDisplayName' in snapshot) ||
      typeof snapshot.applicantDisplayName !== 'string'
    )
      throw this.corruptReceipt();
    return snapshot.applicantDisplayName;
  }

  private forbidden() {
    return new ForbiddenException({
      code: 'ACTION_FORBIDDEN',
      message: '当前账号不是有效客户账号',
    });
  }
  private notFound() {
    return new NotFoundException({
      code: 'RESOURCE_NOT_FOUND',
      message: '线索不存在或不可访问',
    });
  }
}
