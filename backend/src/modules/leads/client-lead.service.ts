import {
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { ActorContext } from '../../access-control/actor-context';
import type { PermissionAction } from '../../access-control/access-control.service';
import { DatabaseService } from '../../database/database.service';
import type { Prisma } from '../../generated/prisma/client';
import { MaterialService } from '../materials';
import type {
  ClientLeadView,
  ReviewClientLeadDto,
} from './client-lead-review.dto';

const CLIENT_LEAD_REVIEW_ACTION =
  'client.lead.review' satisfies PermissionAction;
const MAX_SERIALIZABLE_ATTEMPTS = 3;

type ClientBindingFacts = {
  id: string;
  customerId: string;
  reviewerDisplayName: string;
};

type ClientLeadReviewResult = {
  id: string;
  businessNo: string;
  status: 'WAITING_EVIDENCE_DECISION';
  version: number;
  reviewDecision: {
    result: 'INFRINGEMENT';
    reviewerDisplayName: string;
    decidedAt: string;
  };
};

const clientLeadInclude = {
  products: { orderBy: { position: 'asc' as const } },
  infringements: { orderBy: { type: 'asc' as const } },
  rightsHolder: { select: { name: true } },
  reviewDecision: {
    select: {
      result: true,
      reviewerDisplayNameSnapshot: true,
      decidedAt: true,
    },
  },
} satisfies Prisma.LeadInclude;

type ClientLeadRecord = Prisma.LeadGetPayload<{
  include: typeof clientLeadInclude;
}>;

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
        ? { status: 'WAITING_REVIEW' as const }
        : {
            status: 'WAITING_EVIDENCE_DECISION' as const,
            reviewDecision: { isNot: null },
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
      items: items.map((item) => this.view(item, [])),
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
          { status: 'WAITING_REVIEW' },
          {
            status: 'WAITING_EVIDENCE_DECISION',
            reviewDecision: { isNot: null },
          },
        ],
      },
      include: clientLeadInclude,
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
    return this.view(lead, versionIds);
  }

  async review(
    actor: ActorContext,
    id: string,
    idempotencyKey: string,
    input: ReviewClientLeadDto,
  ): Promise<ClientLeadReviewResult> {
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify({
          leadId: id,
          result: input.result,
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
              await transaction.clientLeadReviewReceipt.findUnique({
                where: this.reviewReceiptWhere(actor, idempotencyKey),
              });
            if (receipt !== null)
              return this.reviewReceiptResult(receipt, fingerprint, id);

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
            if (current.status !== 'WAITING_REVIEW') throw this.invalidState();
            if (current.version !== input.expectedVersion)
              throw this.versionConflict();

            const changed = await transaction.lead.updateMany({
              where: {
                id,
                departmentId: actor.departmentId,
                customerId: binding.customerId,
                status: 'WAITING_REVIEW',
                version: input.expectedVersion,
                pushedAt: { not: null },
                pushedByUserId: { not: null },
              },
              data: {
                status: 'WAITING_EVIDENCE_DECISION',
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
                result: 'INFRINGEMENT',
                fromVersion: input.expectedVersion,
                toVersion: input.expectedVersion + 1,
              },
            });
            const result: ClientLeadReviewResult = {
              id,
              businessNo: current.businessNo,
              status: 'WAITING_EVIDENCE_DECISION',
              version: input.expectedVersion + 1,
              reviewDecision: {
                result: 'INFRINGEMENT',
                reviewerDisplayName: binding.reviewerDisplayName,
                decidedAt: decision.decidedAt.toISOString(),
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
          await this.assertClient(actor);
          const receipt =
            await this.database.clientLeadReviewReceipt.findUnique({
              where: this.reviewReceiptWhere(actor, idempotencyKey),
            });
          if (receipt !== null)
            return this.reviewReceiptResult(receipt, fingerprint, id);
          throw this.versionConflict();
        }
        throw error;
      }
    }
    throw this.versionConflict();
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
      value.status !== 'WAITING_EVIDENCE_DECISION' ||
      value.version !== receipt.resultLeadVersion ||
      typeof value.businessNo !== 'string' ||
      decisionFields === null ||
      decisionFields.result !== 'INFRINGEMENT' ||
      typeof decisionFields.reviewerDisplayName !== 'string' ||
      typeof decisionFields.decidedAt !== 'string'
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
      message: '仅待审核线索可以确认侵权',
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
    lead: ClientLeadRecord,
    leadScreenshotContentVersionIds: readonly string[],
  ) {
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
        ? {
            result: lead.reviewDecision.result,
            reviewerDisplayName:
              lead.reviewDecision.reviewerDisplayNameSnapshot,
            decidedAt: lead.reviewDecision.decidedAt.toISOString(),
          }
        : null,
      capabilities: { review: lead.status === 'WAITING_REVIEW' },
    };
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
