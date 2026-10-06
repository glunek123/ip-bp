import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ActorContext } from '../../access-control/actor-context';
import { DatabaseService } from '../../database/database.service';
import { MaterialService } from '../materials';
import { Prisma } from '../../generated/prisma/client';
import {
  ClientCaseDetailResponseDto,
  ClientCaseListResponseDto,
} from './client-case.response.dto';

@Injectable()
export class ClientCaseService {
  constructor(
    private readonly database: DatabaseService,
    private readonly materials: MaterialService,
  ) {}

  private async assertClient(actor: ActorContext): Promise<void> {
    if (
      actor.clientCustomerId === undefined ||
      actor.notaryOfficeId !== undefined
    )
      throw this.forbidden();
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
  }

  async list(
    actor: ActorContext,
    view: 'PENDING' | 'RECORDED',
    page: number,
    pageSize: number,
  ): Promise<ClientCaseListResponseDto> {
    await this.assertClient(actor);
    const where = {
      departmentId: actor.departmentId,
      customerId: actor.clientCustomerId!,
      complaintConfirmation: { isNot: null },
      stage:
        view === 'PENDING'
          ? ('WAITING_COMPLAINT_STAMP' as const)
          : {
              in: [
                'WAITING_FILING' as const,
                'WAITING_FORMAL_ACCEPTANCE' as const,
                'WAITING_HEARING' as const,
              ],
            },
    };
    const [items, total] = await Promise.all([
      this.database.case.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          businessNo: true,
          stage: true,
          version: true,
          rightsHolder: { select: { name: true } },
          defendants: { orderBy: { createdAt: 'asc' }, select: { name: true } },
        },
      }),
      this.database.case.count({ where }),
    ]);
    return {
      items: items.map((item) => ({
        id: item.id,
        businessNo: item.businessNo,
        stage: item.stage as
          | 'WAITING_COMPLAINT_STAMP'
          | 'WAITING_FILING'
          | 'WAITING_FORMAL_ACCEPTANCE'
          | 'WAITING_HEARING',
        version: item.version,
        canMailComplaint: item.stage === 'WAITING_COMPLAINT_STAMP',
        rightsHolderName: item.rightsHolder.name,
        defendantNames: item.defendants.map((defendant) => defendant.name),
      })),
      total,
      page,
      pageSize,
    };
  }

  async get(
    actor: ActorContext,
    caseId: string,
  ): Promise<ClientCaseDetailResponseDto> {
    await this.assertClient(actor);
    const record = await this.database.case.findFirst({
      where: {
        id: caseId,
        departmentId: actor.departmentId,
        customerId: actor.clientCustomerId,
        complaintConfirmation: { isNot: null },
      },
      select: {
        id: true,
        businessNo: true,
        stage: true,
        version: true,
        rightsHolder: { select: { name: true } },
        defendants: { orderBy: { createdAt: 'asc' }, select: { name: true } },
        complaintConfirmation: {
          select: {
            confirmedAt: true,
            confirmedComplaintContentVersionId: true,
            amountState: true,
            amount: true,
          },
        },
        complaintMailing: { select: { mailedAt: true, recordedAt: true } },
      },
    });
    if (record?.complaintConfirmation == null) throw this.notFound();
    const materials = await this.materials.listOwnerMaterials(
      actor,
      'CASE',
      caseId,
    );
    const files = materials.items.flatMap((material) =>
      material.contentVersions.map((version) => ({
        category: material.category,
        materialId: material.id,
        contentVersionId: version.id,
        originalFilename: version.originalFilename,
        mimeType: version.mimeType,
      })),
    );
    const toFile = (file: (typeof files)[number]) => ({
      materialId: file.materialId,
      contentVersionId: file.contentVersionId,
      originalFilename: file.originalFilename,
      mimeType: file.mimeType,
    });
    const complaintFile = files.find(
      (file) =>
        file.category === 'COMPLAINT' &&
        file.contentVersionId ===
          record.complaintConfirmation!.confirmedComplaintContentVersionId,
    );
    const receiptFiles = files
      .filter((file) => file.category === 'MAIL_RECEIPT')
      .map(toFile);
    return {
      id: record.id,
      businessNo: record.businessNo,
      stage: record.stage as
        | 'WAITING_COMPLAINT_STAMP'
        | 'WAITING_FILING'
        | 'WAITING_FORMAL_ACCEPTANCE'
        | 'WAITING_HEARING',
      version: record.version,
      canMailComplaint: record.stage === 'WAITING_COMPLAINT_STAMP',
      rightsHolderName: record.rightsHolder.name,
      defendantNames: record.defendants.map((defendant) => defendant.name),
      confirmedAmountState: record.complaintConfirmation.amountState,
      confirmedAmount:
        record.complaintConfirmation.amount === null
          ? null
          : new Prisma.Decimal(
              record.complaintConfirmation.amount.toString(),
            ).toFixed(2),
      confirmedAt: record.complaintConfirmation.confirmedAt.toISOString(),
      complaintFile: complaintFile === undefined ? null : toFile(complaintFile),
      authorizationFiles: files
        .filter((file) => file.category === 'AUTHORIZATION')
        .map(toFile),
      pendingReceiptFiles:
        record.stage === 'WAITING_COMPLAINT_STAMP' ? receiptFiles : [],
      complaintMailing:
        record.complaintMailing === null
          ? null
          : {
              mailedAt: record.complaintMailing.mailedAt
                .toISOString()
                .slice(0, 10),
              recordedAt: record.complaintMailing.recordedAt.toISOString(),
              receiptFiles,
            },
    };
  }

  private forbidden() {
    return new ForbiddenException({
      code: 'ACTION_FORBIDDEN',
      message: '无权访问客户案件',
    });
  }
  private notFound() {
    return new NotFoundException({
      code: 'RESOURCE_NOT_FOUND',
      message: '案件不存在或不可访问',
    });
  }
}
