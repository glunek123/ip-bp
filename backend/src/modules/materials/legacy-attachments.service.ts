import {
  BadGatewayException,
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AccessControlService } from '../../access-control/access-control.service';
import { ActorContext } from '../../access-control/actor-context';
import { DatabaseService } from '../../database/database.service';
import { DeletionAuditService } from '../deletion-audit';

export type LegacyAttachmentOwnerType =
  | 'CASE'
  | 'NOTARY_MATTER'
  | 'LEAD'
  | 'CUSTOMER';

export type LegacyAttachmentItem = {
  id: string;
  legacyAttachmentId: string;
  ownerType: string;
  ownerId: string;
  categoryCode: string;
  categoryLabel: string;
  title: string;
  filename: string;
  extname: string | null;
  sizeBytes: number | null;
  mimeType: string | null;
  ossUrl: string;
  createdAt: string;
};

type OwnerMeta = {
  departmentId: string;
  businessNo: string | null;
  title: string;
};

@Injectable()
export class LegacyAttachmentsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly access: AccessControlService,
    private readonly audit: DeletionAuditService,
  ) {}

  async list(
    actor: ActorContext,
    ownerType: LegacyAttachmentOwnerType,
    ownerId: string,
  ): Promise<{ items: LegacyAttachmentItem[] }> {
    this.ensureInternalActor(actor);
    await this.authorizeOwnerRead(actor, ownerType, ownerId);
    const rows = await this.db.legacyAttachment.findMany({
      where: { ownerType, ownerId },
      orderBy: [{ categoryCode: 'asc' }, { legacyAttachmentId: 'asc' }],
    });
    return {
      items: rows.map((row) => ({
        id: row.id,
        legacyAttachmentId: row.legacyAttachmentId.toString(),
        ownerType: row.ownerType,
        ownerId: row.ownerId,
        categoryCode: row.categoryCode,
        categoryLabel: row.categoryLabel,
        title: row.title,
        filename: row.filename,
        extname: row.extname,
        sizeBytes: row.sizeBytes !== null ? Number(row.sizeBytes) : null,
        mimeType: row.mimeType,
        ossUrl: row.ossUrl,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  }

  async resolveContent(
    actor: ActorContext,
    id: string,
  ): Promise<{ ossUrl: string; filename: string; mimeType: string }> {
    this.ensureInternalActor(actor);
    const row = await this.db.legacyAttachment.findUnique({ where: { id } });
    if (!row) {
      throw new NotFoundException({
        code: 'LEGACY_ATTACHMENT_NOT_FOUND',
        message: '未找到历史附件记录',
      });
    }
    await this.authorizeOwnerRead(
      actor,
      row.ownerType as LegacyAttachmentOwnerType,
      row.ownerId,
    );
    let parsed: URL;
    try {
      parsed = new URL(row.ossUrl);
    } catch {
      throw new BadGatewayException({
        code: 'LEGACY_ATTACHMENT_INVALID_URL',
        message: '历史附件地址无效',
      });
    }
    if (
      parsed.protocol !== 'https:' ||
      !parsed.hostname.toLowerCase().endsWith('.aliyuncs.com')
    ) {
      throw new BadGatewayException({
        code: 'LEGACY_ATTACHMENT_INVALID_URL',
        message: '历史附件地址不受支持',
      });
    }
    return {
      ossUrl: row.ossUrl,
      filename: row.filename || row.title || 'attachment',
      mimeType: row.mimeType || 'application/octet-stream',
    };
  }

  async remove(
    actor: ActorContext,
    id: string,
    reasonInput: string | null | undefined,
  ): Promise<{ id: string }> {
    this.ensureInternalActor(actor);
    const reason = reasonInput?.trim() ?? '';
    if (reason.length < 1 || reason.length > 500) {
      throw new BadRequestException({
        code: 'LEGACY_ATTACHMENT_DELETE_REASON_REQUIRED',
        message: '请填写删除原因（1 至 500 字）。',
      });
    }

    return this.db.$transaction(async (tx) => {
      try {
        await this.access.authorizeDepartmentAction(actor, 'case.delete', tx);
      } catch (error) {
        if (error instanceof ForbiddenException) {
          throw new ForbiddenException({
            code: 'LEGACY_ATTACHMENT_DELETE_FORBIDDEN',
            message: '无权删除历史附件',
          });
        }
        throw error;
      }

      const row = await tx.legacyAttachment.findUnique({ where: { id } });
      if (!row) {
        throw new NotFoundException({
          code: 'LEGACY_ATTACHMENT_NOT_FOUND',
          message: '未找到历史附件记录',
        });
      }

      const owner = await this.findOwnerInDepartment(
        tx,
        actor.departmentId,
        row.ownerType,
        row.ownerId,
      );
      if (!owner) {
        throw new NotFoundException({
          code: 'LEGACY_ATTACHMENT_NOT_FOUND',
          message: '未找到历史附件记录',
        });
      }

      await this.audit.record(tx, actor, {
        entityType: 'LEGACY_ATTACHMENT',
        entityId: row.id,
        businessNo: owner.businessNo,
        entityTitle: `${row.categoryLabel} · ${row.filename}`,
        deleteReason: reason,
        snapshot: {
          ownerType: row.ownerType,
          ownerId: row.ownerId,
          ownerTitle: owner.title,
          categoryCode: row.categoryCode,
          categoryLabel: row.categoryLabel,
          filename: row.filename,
          title: row.title,
          ossUrl: row.ossUrl,
          legacyAttachmentId: row.legacyAttachmentId.toString(),
          sizeBytes: row.sizeBytes !== null ? Number(row.sizeBytes) : null,
        },
      });

      await tx.legacyAttachment.delete({ where: { id: row.id } });
      return { id: row.id };
    });
  }

  private ensureInternalActor(actor: ActorContext): void {
    if (actor.lawyerAccountId || actor.clientCustomerId || actor.notaryOfficeId) {
      throw new ForbiddenException({
        code: 'LEGACY_ATTACHMENT_FORBIDDEN',
        message: '仅内部人员可访问历史附件',
      });
    }
  }

  private async authorizeOwnerRead(
    actor: ActorContext,
    ownerType: LegacyAttachmentOwnerType,
    ownerId: string,
  ): Promise<void> {
    if (ownerType === 'CASE') {
      const found = await this.db.case.findFirst({
        where: { id: ownerId, departmentId: actor.departmentId },
        select: { departmentId: true, responsibleUserId: true },
      });
      if (!found) {
        throw new NotFoundException({
          code: 'LEGACY_ATTACHMENT_OWNER_NOT_FOUND',
          message: '未找到关联案件',
        });
      }
      await this.access.authorizeCase(actor, 'case.read', {
        departmentId: found.departmentId,
        responsibleUserId: found.responsibleUserId,
      });
      return;
    }

    if (ownerType === 'LEAD') {
      const found = await this.db.lead.findFirst({
        where: { id: ownerId, departmentId: actor.departmentId },
        select: { departmentId: true, responsibleUserId: true, teamId: true },
      });
      if (!found) {
        throw new NotFoundException({
          code: 'LEGACY_ATTACHMENT_OWNER_NOT_FOUND',
          message: '未找到关联线索',
        });
      }
      await this.access.authorizeLead(actor, 'lead.read', {
        departmentId: found.departmentId,
        responsibleUserId: found.responsibleUserId,
        teamId: found.teamId ?? undefined,
      });
      return;
    }

    if (ownerType === 'NOTARY_MATTER') {
      const found = await this.db.notaryMatter.findFirst({
        where: { id: ownerId, departmentId: actor.departmentId },
        select: {
          departmentId: true,
          responsibleUserId: true,
          sourceLead: { select: { teamId: true } },
        },
      });
      if (!found) {
        throw new NotFoundException({
          code: 'LEGACY_ATTACHMENT_OWNER_NOT_FOUND',
          message: '未找到关联公证事项',
        });
      }
      await this.access.authorizeLead(actor, 'lead.read', {
        departmentId: found.departmentId,
        responsibleUserId: found.responsibleUserId,
        teamId: found.sourceLead?.teamId ?? undefined,
      });
      return;
    }

    const found = await this.db.customer.findFirst({
      where: { id: ownerId, departmentId: actor.departmentId, deletedAt: null },
      select: { departmentId: true, responsibleUserId: true, teamId: true },
    });
    if (!found) {
      throw new NotFoundException({
        code: 'LEGACY_ATTACHMENT_OWNER_NOT_FOUND',
        message: '未找到关联客户',
      });
    }
    await this.access.authorizeCustomer(actor, 'customer.read', {
      departmentId: found.departmentId,
      responsibleUserId: found.responsibleUserId,
      teamId: found.teamId ?? undefined,
    });
  }

  private async findOwnerInDepartment(
    tx: Pick<
      DatabaseService,
      'case' | 'lead' | 'notaryMatter' | 'customer' | 'rightsHolder'
    >,
    departmentId: string,
    ownerType: string,
    ownerId: string,
  ): Promise<OwnerMeta | null> {
    if (ownerType === 'CASE') {
      const row = await tx.case.findFirst({
        where: { id: ownerId, departmentId },
        select: { departmentId: true, businessNo: true },
      });
      return row
        ? {
            departmentId: row.departmentId,
            businessNo: row.businessNo,
            title: `案件 ${row.businessNo}`,
          }
        : null;
    }
    if (ownerType === 'LEAD') {
      const row = await tx.lead.findFirst({
        where: { id: ownerId, departmentId },
        select: { departmentId: true, businessNo: true, shopName: true },
      });
      return row
        ? {
            departmentId: row.departmentId,
            businessNo: row.businessNo,
            title: `线索 ${row.businessNo}（${row.shopName}）`,
          }
        : null;
    }
    if (ownerType === 'NOTARY_MATTER') {
      const row = await tx.notaryMatter.findFirst({
        where: { id: ownerId, departmentId },
        select: { departmentId: true, businessNo: true },
      });
      return row
        ? {
            departmentId: row.departmentId,
            businessNo: row.businessNo,
            title: `公证 ${row.businessNo}`,
          }
        : null;
    }
    if (ownerType === 'CUSTOMER') {
      const row = await tx.customer.findFirst({
        where: { id: ownerId, departmentId },
        select: { departmentId: true, businessId: true, name: true },
      });
      return row
        ? {
            departmentId: row.departmentId,
            businessNo:
              row.businessId !== null ? String(row.businessId) : null,
            title: `客户 ${row.name}`,
          }
        : null;
    }
    if (ownerType === 'RIGHTS_HOLDER') {
      const row = await tx.rightsHolder.findFirst({
        where: { id: ownerId, departmentId },
        select: { departmentId: true, name: true },
      });
      return row
        ? {
            departmentId: row.departmentId,
            businessNo: null,
            title: `权利主体 ${row.name}`,
          }
        : null;
    }
    return null;
  }
}
