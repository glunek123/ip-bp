import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ActorContext } from '../../access-control/actor-context';
import { DatabaseService } from '../../database/database.service';
import { Prisma } from '../../generated/prisma/client';
import { isFrozenOpeningPhotoVersion } from '../materials';
import { openingReviewMatchesStage } from './notary-opening-review-read';

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
  issuanceDecision: { select: { decision: true, decidedAt: true } },
  certificate: { select: { id: true } },
  returnArchive: {
    select: {
      returnChoice: true,
      archiveReason: true,
      archivedAt: true,
      fromVersion: true,
      toVersion: true,
      amounts: {
        select: {
          kind: true,
          state: true,
          amount: true,
          partyKind: true,
          partyName: true,
          sourceEvidenceMatterId: true,
        },
      },
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

  async list(
    actor: ActorContext,
    page: number,
    pageSize: number,
    sourceLeadId?: string,
  ) {
    const customerId = await this.assertClient(actor);
    const where: Prisma.NotaryMatterWhereInput = {
      departmentId: actor.departmentId,
      customerId,
      ...(sourceLeadId === undefined
        ? { stage: 'UNBOX_REVIEW' as const }
        : {
            sourceLeadId,
            stage: {
              in: [
                'UNBOX_REVIEW',
                'ISSUANCE_DECISION',
                'WAITING_CERTIFICATE',
                'WAITING_RETURN',
                'ARCHIVED',
              ] as const,
            },
          }),
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
          openingReviewDecision: {
            select: {
              result: true,
              reason: true,
              decidedAt: true,
              archivedAt: true,
            },
          },
          issuanceDecision: { select: { decision: true, decidedAt: true } },
          certificate: { select: { id: true } },
          returnArchive: {
            select: {
              returnChoice: true,
              archiveReason: true,
              archivedAt: true,
              fromVersion: true,
              toVersion: true,
              amounts: {
                select: {
                  kind: true,
                  state: true,
                  amount: true,
                  partyKind: true,
                  partyName: true,
                  sourceEvidenceMatterId: true,
                },
              },
            },
          },
        },
      }),
      this.database.notaryMatter.count({ where }),
    ]);
    if (
      items.some(
        (item) =>
          (!openingReviewMatchesStage(item.stage, item.openingReviewDecision) &&
            !(
              item.stage === 'ARCHIVED' &&
              item.openingReviewDecision?.result === 'INFRINGEMENT' &&
              item.openingReviewDecision.reason === null &&
              item.openingReviewDecision.archivedAt === null
            )) ||
          !this.issuanceMatchesStage(
            item.stage,
            item.issuanceDecision,
            item.openingReviewDecision,
            item.certificate,
            item.returnArchive,
            item.id,
            item.version,
          ),
      )
    )
      throw this.notFound();
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
        stage: {
          in: [
            'UNBOX_REVIEW',
            'ISSUANCE_DECISION',
            'WAITING_CERTIFICATE',
            'WAITING_RETURN',
            'ARCHIVED',
          ],
        },
        opening: { isNot: null },
        sourceLead: { pushedAt: { not: null }, pushedByUserId: { not: null } },
      },
      include: clientMatterInclude,
    });
    if (matter === null) throw this.notFound();
    const photoReferences = await this.database.materialReference.findMany({
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
        actionEvent: { select: { details: true } },
      },
    });
    const photos = photoReferences.filter((reference) =>
      isFrozenOpeningPhotoVersion(
        reference.actionEvent?.details,
        reference.contentVersionId,
      ),
    );
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
      !openingReviewMatchesStage(matter.stage, decision) &&
      !(
        matter.stage === 'ARCHIVED' &&
        decision?.result === 'INFRINGEMENT' &&
        decision.reason === null &&
        decision.archivedAt === null
      )
    )
      throw this.notFound();
    if (
      !this.issuanceMatchesStage(
        matter.stage,
        matter.issuanceDecision,
        decision,
        matter.certificate,
        matter.returnArchive,
        matter.id,
        matter.version,
      )
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
      issuanceDecision:
        matter.issuanceDecision == null
          ? null
          : {
              decision: matter.issuanceDecision.decision,
              decidedAt: matter.issuanceDecision.decidedAt.toISOString(),
            },
      returnArchive:
        matter.returnArchive == null
          ? null
          : {
              returnChoice: matter.returnArchive.returnChoice,
              archiveReason: matter.returnArchive.archiveReason,
              archivedAt: matter.returnArchive.archivedAt.toISOString(),
            },
      capabilities: { reviewOpening: matter.stage === 'UNBOX_REVIEW' },
    };
  }

  private issuanceMatchesStage(
    stage: string,
    decision: { decision: 'ISSUE' | 'NO_ISSUE'; decidedAt: Date } | null,
    review: { result: 'INFRINGEMENT' | 'NO_INFRINGEMENT' } | null,
    certificate: { id: string } | null | undefined,
    archive: ClientMatter['returnArchive'] | undefined,
    matterId: string,
    version: number,
  ): boolean {
    if (stage === 'WAITING_CERTIFICATE')
      return (
        decision?.decision === 'ISSUE' && archive == null && certificate == null
      );
    if (stage === 'WAITING_RETURN')
      return (
        decision?.decision === 'NO_ISSUE' &&
        archive == null &&
        certificate == null
      );
    if (stage === 'ARCHIVED') {
      if (review?.result === 'NO_INFRINGEMENT')
        return decision == null && certificate == null && archive == null;
      if (decision?.decision === 'ISSUE')
        return certificate != null && archive == null;
      return (
        decision?.decision === 'NO_ISSUE' &&
        certificate == null &&
        archive != null &&
        ['RETURN', 'KEEP', 'REFUND_ONLY'].includes(archive.returnChoice) &&
        archive.archiveReason.trim() === archive.archiveReason &&
        Array.from(archive.archiveReason).length > 0 &&
        Array.from(archive.archiveReason).length <= 5000 &&
        archive.archivedAt instanceof Date &&
        archive.fromVersion === version - 1 &&
        archive.toVersion === version &&
        this.returnAmountsMatchArchive(archive, matterId)
      );
    }
    return decision == null && archive == null && certificate == null;
  }

  private returnAmountsMatchArchive(
    archive: NonNullable<ClientMatter['returnArchive']>,
    matterId: string,
  ): boolean {
    const seen = new Set<string>();
    for (const row of archive.amounts) {
      if (
        seen.has(row.kind) ||
        !['REFUND', 'FREIGHT'].includes(row.kind) ||
        !['KNOWN', 'PENDING'].includes(row.state) ||
        (row.kind === 'REFUND' && row.sourceEvidenceMatterId !== matterId) ||
        (row.kind === 'FREIGHT' && row.sourceEvidenceMatterId !== null) ||
        (row.state === 'KNOWN' && row.amount === null) ||
        (row.state === 'PENDING' && row.amount !== null) ||
        (row.amount !== null && row.amount.toNumber() < 0) ||
        (row.partyKind !== null &&
          !['CUSTOMER', 'FIRM', 'MERCHANT', 'OTHER'].includes(row.partyKind)) ||
        (row.amount !== null &&
          row.amount.toNumber() > 0 &&
          row.partyKind === null) ||
        (row.amount === null || row.amount.toNumber() === 0
          ? row.partyKind !== null || row.partyName !== null
          : row.partyKind === 'OTHER'
            ? !row.partyName?.trim()
            : row.partyName !== null)
      )
        return false;
      seen.add(row.kind);
    }
    if (archive.returnChoice === 'KEEP') return seen.size === 0;
    if (archive.returnChoice === 'REFUND_ONLY')
      return seen.has('REFUND') && !seen.has('FREIGHT');
    return seen.has('REFUND') && seen.has('FREIGHT');
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
