import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ActorContext } from '../../access-control/actor-context';
import { DatabaseService } from '../../database/database.service';
import { isFrozenOpeningPhotoVersion } from '../materials';
import { isFrozenCertificateVersion } from '../materials';

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

  async list(
    actor: ActorContext,
    page: number,
    pageSize: number,
    stage:
      'WAITING_UNBOX' | 'WAITING_CERTIFICATE' | 'ARCHIVED' = 'WAITING_UNBOX',
  ) {
    const officeId = await this.authorize(actor);
    const where = {
      departmentId: actor.departmentId,
      notaryOfficeId: officeId,
      stage,
      ...(stage === 'ARCHIVED' ? { certificate: { isNot: null } } : {}),
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
        stage: matter.stage,
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
        OR: [
          {
            stage: {
              in: ['WAITING_UNBOX', 'UNBOX_REVIEW', 'WAITING_CERTIFICATE'],
            },
          },
          { stage: 'ARCHIVED', certificate: { isNot: null } },
        ],
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
            sampleFeeState: true,
            sampleFeeAmount: true,
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
          },
        },
        issuanceDecision: {
          select: {
            decision: true,
            actorDisplayNameSnapshot: true,
            decidedAt: true,
          },
        },
        certificate: {
          select: {
            certificateNo: true,
            certificateDate: true,
            issuedAt: true,
            needDisclose: true,
            case: { select: { id: true, businessNo: true } },
          },
        },
      },
    });
    if (matter === null) throw this.notFound();
    const refs =
      matter.stage === 'ARCHIVED' || matter.opening === null
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
    const certificateRefs =
      matter.certificate === null || matter.certificate === undefined
        ? []
        : await this.database.materialReference.findMany({
            where: {
              departmentId: actor.departmentId,
              resourceType: 'notary_matter',
              resourceId: id,
              purpose: { in: ['NOTARY_CERTIFICATE', 'NOTARY_DISCLOSURE'] },
              actionEventId: { not: null },
              actionEvent: {
                action: 'notary.certificate_issued',
                resourceType: 'notary_matter',
                resourceId: id,
                departmentId: actor.departmentId,
              },
              material: {
                departmentId: actor.departmentId,
                ownerType: 'NOTARY_MATTER',
                ownerId: id,
                status: 'ACTIVE',
              },
            },
            select: {
              purpose: true,
              materialId: true,
              contentVersionId: true,
              actionEvent: { select: { details: true } },
              contentVersion: {
                select: { originalFilename: true, mimeType: true },
              },
            },
          });
    const frozen = certificateRefs.filter((ref) =>
      isFrozenCertificateVersion(
        ref.actionEvent?.details,
        ref.purpose,
        ref.contentVersionId,
      ),
    );
    const file = (ref: (typeof frozen)[number]) => ({
      materialId: ref.materialId,
      contentVersionId: ref.contentVersionId,
      originalFilename: ref.contentVersion.originalFilename,
      mimeType: ref.contentVersion.mimeType,
    });
    return {
      id: matter.id,
      businessNo: matter.businessNo,
      stage: matter.stage,
      version: matter.version,
      createdAt: matter.createdAt.toISOString(),
      evidence:
        matter.stage === 'ARCHIVED' || matter.evidence === null
          ? null
          : {
              evidenceAt: matter.evidence.evidenceAt.toISOString().slice(0, 10),
              sampleFeeState: matter.evidence.sampleFeeState,
              sampleFeeAmount:
                matter.evidence.sampleFeeAmount?.toString() ?? null,
              logistics: matter.evidence.logistics,
            },
      opening:
        matter.stage === 'ARCHIVED' || matter.opening === null
          ? null
          : {
              senderName: matter.opening.senderName,
              senderPhone: matter.opening.senderPhone,
              senderAddress: matter.opening.senderAddress,
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
      issuanceDecision:
        matter.stage === 'ARCHIVED' ||
        matter.issuanceDecision === null ||
        matter.issuanceDecision === undefined
          ? null
          : {
              decision: matter.issuanceDecision.decision,
              actorDisplayName:
                matter.issuanceDecision.actorDisplayNameSnapshot,
              decidedAt: matter.issuanceDecision.decidedAt.toISOString(),
            },
      certificate:
        matter.certificate === null || matter.certificate === undefined
          ? null
          : {
              certificateNo: matter.certificate.certificateNo,
              certificateDate: matter.certificate.certificateDate
                .toISOString()
                .slice(0, 10),
              issuedAt: matter.certificate.issuedAt.toISOString(),
              needDisclose: matter.certificate.needDisclose,
              files: frozen
                .filter((ref) => ref.purpose === 'NOTARY_CERTIFICATE')
                .map(file),
              disclosureFiles: frozen
                .filter((ref) => ref.purpose === 'NOTARY_DISCLOSURE')
                .map(file),
              caseId: matter.certificate.case?.id ?? null,
              caseBusinessNo: matter.certificate.case?.businessNo ?? null,
            },
      capabilities: {
        recordOpening: matter.stage === 'WAITING_UNBOX',
        issueCertificate: matter.stage === 'WAITING_CERTIFICATE',
      },
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
