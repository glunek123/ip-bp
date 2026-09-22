import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ActorContext } from '../../access-control/actor-context';
import { DatabaseService } from '../../database/database.service';
import type { Prisma } from '../../generated/prisma/client';
import { MaterialService } from '../materials';
import type { ClientLeadView } from './client-lead-review.dto';

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
    const customerId = await this.assertClient(actor);
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
    const customerId = await this.assertClient(actor);
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

  private async assertClient(actor: ActorContext): Promise<string> {
    if (actor.clientCustomerId === undefined) throw this.forbidden();
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
    return actor.clientCustomerId;
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
