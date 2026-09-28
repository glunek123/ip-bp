import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ActorContext } from '../../access-control/actor-context';
import { DatabaseService } from '../../database/database.service';
import { Prisma } from '../../generated/prisma/client';

const clientMatterInclude = {
  sourceLead: {
    select: {
      id: true,
      businessNo: true,
      pushedAt: true,
      pushedByUserId: true,
    },
  },
  opening: { select: { matterId: true, recordedAt: true } },
  openingReviewDecision: {
    select: {
      result: true,
      reason: true,
      actorKind: true,
      actorDisplayNameSnapshot: true,
      decidedAt: true,
      archivedAt: true,
    },
  },
  selectedProducts: { select: { leadProductId: true } },
} satisfies Prisma.NotaryMatterInclude;
type ClientMatter = Prisma.NotaryMatterGetPayload<{
  include: typeof clientMatterInclude;
}>;

@Injectable()
export class ClientNotaryService {
  constructor(private readonly database: DatabaseService) {}

  async list(actor: ActorContext, page: number, pageSize: number) {
    const customerId = await this.assertClient(actor);
    const where: Prisma.NotaryMatterWhereInput = {
      departmentId: actor.departmentId,
      customerId,
      stage: 'UNBOX_REVIEW',
      opening: { isNot: null },
      sourceLead: { pushedAt: { not: null }, pushedByUserId: { not: null } },
    };
    const [items, total] = await Promise.all([
      this.database.notaryMatter.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          businessNo: true,
          stage: true,
          version: true,
          createdAt: true,
          sourceLead: { select: { businessNo: true } },
        },
      }),
      this.database.notaryMatter.count({ where }),
    ]);
    return {
      items: items.map((item) => ({
        id: item.id,
        businessNo: item.businessNo,
        stage: item.stage,
        version: item.version,
        createdAt: item.createdAt.toISOString(),
        sourceLeadBusinessNo: item.sourceLead.businessNo,
      })),
      total,
      page,
      pageSize,
    };
  }

  async get(actor: ActorContext, id: string) {
    const customerId = await this.assertClient(actor);
    const matter = await this.database.notaryMatter.findFirst({
      where: {
        id,
        departmentId: actor.departmentId,
        customerId,
        stage: { in: ['UNBOX_REVIEW', 'ISSUANCE_DECISION', 'ARCHIVED'] },
        opening: { isNot: null },
        sourceLead: { pushedAt: { not: null }, pushedByUserId: { not: null } },
      },
      include: clientMatterInclude,
    });
    if (matter === null) throw this.notFound();
    const photos = await this.database.materialReference.findMany({
      where: {
        departmentId: actor.departmentId,
        resourceType: 'notary_matter',
        resourceId: id,
        purpose: 'NOTARY_OPENING_PHOTO',
        actionEventId: { not: null },
        actionEvent: {
          action: 'notary.opening_recorded',
          resourceType: 'notary_matter',
          resourceId: id,
          departmentId: actor.departmentId,
        },
        material: {
          departmentId: actor.departmentId,
          ownerType: 'NOTARY_MATTER',
          ownerId: id,
          category: 'NOTARY_OPENING_PHOTO',
          status: 'ACTIVE',
        },
        contentVersion: { status: 'AVAILABLE' },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        materialId: true,
        contentVersionId: true,
        contentVersion: { select: { originalFilename: true, mimeType: true } },
      },
    });
    if (photos.length === 0) throw this.notFound();
    return this.project(matter, photos);
  }

  private project(
    matter: ClientMatter,
    photos: Array<{
      materialId: string;
      contentVersionId: string;
      contentVersion: { originalFilename: string; mimeType: string };
    }>,
  ) {
    const snapshot = matter.sourceSnapshot;
    if (
      snapshot === null ||
      typeof snapshot !== 'object' ||
      Array.isArray(snapshot) ||
      !Array.isArray(snapshot.selectedProducts)
    )
      throw this.notFound();
    const ids = new Set(
      matter.selectedProducts.map((item) => item.leadProductId),
    );
    const products = snapshot.selectedProducts.map((item) => {
      if (
        item === null ||
        typeof item !== 'object' ||
        Array.isArray(item) ||
        typeof item.id !== 'string' ||
        !ids.delete(item.id) ||
        typeof item.position !== 'number' ||
        (item.title !== null && typeof item.title !== 'string') ||
        (item.url !== null && typeof item.url !== 'string') ||
        typeof item.quantity !== 'number' ||
        typeof item.unitPrice !== 'string' ||
        typeof item.commentCount !== 'number' ||
        typeof item.estimatedAmount !== 'string'
      )
        throw this.notFound();
      return {
        id: item.id,
        position: item.position,
        title: item.title,
        url: item.url,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        commentCount: item.commentCount,
        estimatedAmount: item.estimatedAmount,
      };
    });
    if (ids.size !== 0) throw this.notFound();
    const decision = matter.openingReviewDecision;
    if (
      (matter.stage === 'UNBOX_REVIEW' && decision !== null) ||
      (matter.stage !== 'UNBOX_REVIEW' && decision === null)
    )
      throw this.notFound();
    return {
      id: matter.id,
      businessNo: matter.businessNo,
      stage: matter.stage,
      version: matter.version,
      createdAt: matter.createdAt.toISOString(),
      sourceLead: {
        id: matter.sourceLead.id,
        businessNo: matter.sourceLead.businessNo,
      },
      selectedProducts: products,
      opening: {
        recordedAt: matter.opening!.recordedAt.toISOString(),
        photos: photos.map((photo) => ({
          materialId: photo.materialId,
          contentVersionId: photo.contentVersionId,
          originalFilename: photo.contentVersion.originalFilename,
          mimeType: photo.contentVersion.mimeType,
        })),
      },
      reviewDecision:
        decision === null
          ? null
          : {
              result: decision.result,
              reason: decision.reason,
              actorKind: decision.actorKind,
              actorDisplayName: decision.actorDisplayNameSnapshot,
              decidedAt: decision.decidedAt.toISOString(),
              archivedAt: decision.archivedAt?.toISOString() ?? null,
            },
      capabilities: { reviewOpening: matter.stage === 'UNBOX_REVIEW' },
    };
  }

  private async assertClient(actor: ActorContext): Promise<string> {
    if (actor.clientCustomerId === undefined) throw this.forbidden();
    const binding = await this.database.customerAccountBinding.findFirst({
      where: {
        userId: actor.userId,
        customerId: actor.clientCustomerId,
        departmentId: actor.departmentId,
        active: true,
        user: { accountType: 'CLIENT', active: true },
        customer: { profileStatus: 'ADMITTED' },
      },
      select: { id: true, customerId: true },
    });
    if (binding === null) throw this.forbidden();
    return binding.customerId;
  }

  private forbidden() {
    return new ForbiddenException({
      code: 'ACTION_FORBIDDEN',
      message: '无权读取公证事项',
    });
  }
  private notFound() {
    return new NotFoundException({
      code: 'RESOURCE_NOT_FOUND',
      message: '公证事项不存在或不可访问',
    });
  }
}
