import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ActorContext } from '../../access-control/actor-context';
import { DatabaseService } from '../../database/database.service';
import { isFrozenOpeningPhotoVersion } from '../materials';

@Injectable()
export class NotaryPortalService {
  constructor(private readonly database: DatabaseService) {}

  private async authorize(actor: ActorContext): Promise<string> {
    if (
      actor.notaryOfficeId === undefined ||
      actor.clientCustomerId !== undefined
    )
      throw this.forbidden();
    const binding = await this.database.notaryOfficeAccountBinding.findFirst({
      where: {
        userId: actor.userId,
        departmentId: actor.departmentId,
        notaryOfficeId: actor.notaryOfficeId,
        active: true,
        user: { active: true, accountType: 'NOTARY' },
        notaryOffice: { status: 'ACTIVE' },
      },
      select: { id: true },
    });
    if (binding === null) throw this.forbidden();
    return actor.notaryOfficeId;
  }

  async assertActor(actor: ActorContext): Promise<void> {
    await this.authorize(actor);
  }

  async list(actor: ActorContext, page: number, pageSize: number) {
    const officeId = await this.authorize(actor);
    const where = {
      departmentId: actor.departmentId,
      notaryOfficeId: officeId,
      stage: 'WAITING_UNBOX' as const,
    };
    const [matters, total] = await Promise.all([
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
        },
      }),
      this.database.notaryMatter.count({ where }),
    ]);
    return {
      items: matters.map((matter) => ({
        ...matter,
        stage: 'WAITING_UNBOX' as const,
        createdAt: matter.createdAt.toISOString(),
      })),
      total,
      page,
      pageSize,
    };
  }

  async get(actor: ActorContext, id: string) {
    const officeId = await this.authorize(actor);
    const matter = await this.database.notaryMatter.findFirst({
      where: {
        id,
        departmentId: actor.departmentId,
        notaryOfficeId: officeId,
        stage: { in: ['WAITING_UNBOX', 'UNBOX_REVIEW'] },
      },
      select: {
        id: true,
        businessNo: true,
        stage: true,
        version: true,
        createdAt: true,
        evidence: {
          select: {
            evidenceAt: true,
            logistics: {
              orderBy: [{ position: 'asc' }, { id: 'asc' }],
              select: {
                id: true,
                companyState: true,
                companyValue: true,
                trackingState: true,
                trackingValue: true,
              },
            },
          },
        },
        opening: {
          select: {
            senderName: true,
            senderPhone: true,
            senderAddress: true,
            recordedAt: true,
            recordedByUserId: true,
          },
        },
      },
    });
    if (matter === null) throw this.notFound();
    const refs =
      matter.opening === null
        ? []
        : await this.database.materialReference.findMany({
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
            },
            select: {
              materialId: true,
              contentVersionId: true,
              actionEvent: { select: { details: true } },
              contentVersion: {
                select: { originalFilename: true, mimeType: true },
              },
            },
          });
    return {
      id: matter.id,
      businessNo: matter.businessNo,
      stage: matter.stage,
      version: matter.version,
      createdAt: matter.createdAt.toISOString(),
      evidence:
        matter.evidence === null
          ? null
          : {
              evidenceAt: matter.evidence.evidenceAt.toISOString().slice(0, 10),
              logistics: matter.evidence.logistics,
            },
      opening:
        matter.opening === null
          ? null
          : {
              ...matter.opening,
              recordedAt: matter.opening.recordedAt.toISOString(),
              photos: refs
                .filter((ref) =>
                  isFrozenOpeningPhotoVersion(
                    ref.actionEvent?.details,
                    ref.contentVersionId,
                  ),
                )
                .map((ref) => ({
                  materialId: ref.materialId,
                  contentVersionId: ref.contentVersionId,
                  originalFilename: ref.contentVersion.originalFilename,
                  mimeType: ref.contentVersion.mimeType,
                })),
            },
      capabilities: { recordOpening: matter.stage === 'WAITING_UNBOX' },
    };
  }

  private forbidden() {
    return new ForbiddenException({
      code: 'ACTION_FORBIDDEN',
      message: '无权访问公证处事项',
    });
  }
  private notFound() {
    return new NotFoundException({
      code: 'RESOURCE_NOT_FOUND',
      message: '公证事项不存在或不可访问',
    });
  }
}
