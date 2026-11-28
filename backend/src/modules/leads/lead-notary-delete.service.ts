import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AccessControlService } from '../../access-control/access-control.service';
import { ActorContext } from '../../access-control/actor-context';
import { DatabaseService } from '../../database/database.service';
import { DeletionAuditService } from '../deletion-audit';

export type DeleteEntityInput = {
  reason?: string | null;
  expectedVersion?: number | null;
};

@Injectable()
export class LeadNotaryDeleteService {
  constructor(
    private readonly db: DatabaseService,
    private readonly access: AccessControlService,
    private readonly audit: DeletionAuditService,
  ) {}

  async removeLead(
    actor: ActorContext,
    leadId: string,
    input: DeleteEntityInput = {},
  ): Promise<{ id: string }> {
    this.ensureInternalActor(actor);
    const reason = this.requireReason(input.reason);

    return this.db.$transaction(
      async (tx) => {
        try {
          await this.access.authorizeDepartmentAction(actor, 'case.delete', tx);
        } catch (error) {
          if (error instanceof ForbiddenException) {
            throw new ForbiddenException({
              code: 'LEAD_DELETE_FORBIDDEN',
              message: '无权删除线索',
            });
          }
          throw error;
        }

        const locked = await tx.$queryRawUnsafe<{ id: string }[]>(
          'SELECT id FROM leads WHERE id = $1::uuid AND department_id = $2::uuid FOR UPDATE',
          leadId,
          actor.departmentId,
        );
        if (locked.length !== 1) {
          throw new NotFoundException({ code: 'LEAD_NOT_FOUND' });
        }

        const found = await tx.lead.findFirst({
          where: { id: leadId, departmentId: actor.departmentId },
          select: {
            id: true,
            businessNo: true,
            status: true,
            version: true,
            shopName: true,
            creationChannel: true,
            createdAt: true,
            customer: { select: { name: true } },
            _count: {
              select: {
                notaryMatters: true,
                cases: true,
                products: true,
              },
            },
          },
        });
        if (!found) throw new NotFoundException({ code: 'LEAD_NOT_FOUND' });

        if (
          input.expectedVersion !== undefined &&
          input.expectedVersion !== null &&
          found.version !== input.expectedVersion
        ) {
          throw new ConflictException({
            code: 'LEAD_VERSION_CONFLICT',
            message: '线索已发生变化，请刷新后重试。',
          });
        }

        const blockers: string[] = [];
        if (found._count.notaryMatters > 0) blockers.push('公证取证批次');
        if (found._count.cases > 0) blockers.push('衍生诉讼案件');
        if (blockers.length > 0) {
          throw new BadRequestException({
            code: 'LEAD_HAS_DOWNSTREAM',
            message: `该线索已产生${blockers.join('、')}，不能直接删除。`,
          });
        }

        await this.audit.record(tx, actor, {
          entityType: 'LEAD',
          entityId: found.id,
          businessNo: found.businessNo,
          entityTitle: `线索 ${found.businessNo}（${found.customer.name} / ${found.shopName}）`,
          deleteReason: reason,
          snapshot: {
            businessNo: found.businessNo,
            status: found.status,
            shopName: found.shopName,
            customerName: found.customer.name,
            creationChannel: found.creationChannel,
            productCount: found._count.products,
            createdAt: found.createdAt.toISOString(),
          },
        });

        await tx.$executeRawUnsafe(
          'UPDATE leads SET active_review_decision_id = NULL, active_evidence_decision_id = NULL WHERE id = $1::uuid',
          leadId,
        );
        await tx.$executeRawUnsafe(
          'DELETE FROM lead_image_import_tasks WHERE lead_id = $1::uuid',
          leadId,
        );
        await tx.$executeRawUnsafe(
          'DELETE FROM lead_product_screenshots WHERE lead_id = $1::uuid',
          leadId,
        );
        await tx.$executeRawUnsafe(
          'DELETE FROM lead_products WHERE lead_id = $1::uuid',
          leadId,
        );
        await tx.$executeRawUnsafe(
          'DELETE FROM lead_infringements WHERE lead_id = $1::uuid',
          leadId,
        );
        await tx.$executeRawUnsafe(
          'DELETE FROM lead_withdrawal_confirmations WHERE lead_id = $1::uuid',
          leadId,
        );
        await tx.$executeRawUnsafe(
          'DELETE FROM lead_withdrawal_applications WHERE lead_id = $1::uuid',
          leadId,
        );
        await tx.$executeRawUnsafe(
          'DELETE FROM lead_proxy_evidence_confirmations WHERE lead_id = $1::uuid',
          leadId,
        );
        await tx.$executeRawUnsafe(
          'DELETE FROM lead_evidence_decisions WHERE lead_id = $1::uuid',
          leadId,
        );
        await tx.$executeRawUnsafe(
          'DELETE FROM client_lead_review_receipts WHERE result_lead_id = $1::uuid',
          leadId,
        );
        await tx.$executeRawUnsafe(
          'DELETE FROM lead_review_decisions WHERE lead_id = $1::uuid',
          leadId,
        );
        await tx.$executeRawUnsafe(
          'DELETE FROM lead_command_receipts WHERE result_lead_id = $1::uuid',
          leadId,
        );
        await tx.$executeRawUnsafe(
          "DELETE FROM legacy_attachments WHERE owner_type = 'LEAD' AND owner_id = $1::uuid",
          leadId,
        );
        await tx.$executeRawUnsafe(
          "DELETE FROM business_number_aliases WHERE entity_type = 'LEAD' AND entity_id = $1::uuid",
          leadId,
        );
        await tx.$executeRawUnsafe(
          'DELETE FROM leads WHERE id = $1::uuid AND department_id = $2::uuid',
          leadId,
          actor.departmentId,
        );

        return { id: leadId };
      },
      { timeout: 15000, maxWait: 10000 },
    );
  }

  async removeNotaryMatter(
    actor: ActorContext,
    matterId: string,
    input: DeleteEntityInput = {},
  ): Promise<{ id: string }> {
    this.ensureInternalActor(actor);
    const reason = this.requireReason(input.reason);

    return this.db.$transaction(
      async (tx) => {
        try {
          await this.access.authorizeDepartmentAction(actor, 'case.delete', tx);
        } catch (error) {
          if (error instanceof ForbiddenException) {
            throw new ForbiddenException({
              code: 'NOTARY_DELETE_FORBIDDEN',
              message: '无权删除公证取证批次',
            });
          }
          throw error;
        }

        const locked = await tx.$queryRawUnsafe<{ id: string }[]>(
          'SELECT id FROM notary_matters WHERE id = $1::uuid AND department_id = $2::uuid FOR UPDATE',
          matterId,
          actor.departmentId,
        );
        if (locked.length !== 1) {
          throw new NotFoundException({ code: 'NOTARY_MATTER_NOT_FOUND' });
        }

        const found = await tx.notaryMatter.findFirst({
          where: { id: matterId, departmentId: actor.departmentId },
          select: {
            id: true,
            businessNo: true,
            stage: true,
            version: true,
            createdAt: true,
            notaryOffice: { select: { name: true } },
            sourceLead: { select: { businessNo: true, shopName: true } },
            case: { select: { id: true } },
            _count: {
              select: {
                feeRecords: true,
                costs: true,
                evidenceItems: true,
              },
            },
          },
        });
        if (!found) {
          throw new NotFoundException({ code: 'NOTARY_MATTER_NOT_FOUND' });
        }

        if (
          input.expectedVersion !== undefined &&
          input.expectedVersion !== null &&
          found.version !== input.expectedVersion
        ) {
          throw new ConflictException({
            code: 'NOTARY_VERSION_CONFLICT',
            message: '公证批次已发生变化，请刷新后重试。',
          });
        }

        const blockers: string[] = [];
        if (found.case) blockers.push('关联案件');
        if (found._count.feeRecords > 0 || found._count.costs > 0)
          blockers.push('费用记录');
        if (found._count.evidenceItems > 0) blockers.push('实物证物台账');
        if (blockers.length > 0) {
          throw new BadRequestException({
            code: 'NOTARY_HAS_DOWNSTREAM',
            message: `该公证批次已产生${blockers.join('、')}，不能直接删除。`,
          });
        }

        await this.audit.record(tx, actor, {
          entityType: 'NOTARY_MATTER',
          entityId: found.id,
          businessNo: found.businessNo,
          entityTitle: `公证 ${found.businessNo}（${found.notaryOffice.name} / ${found.sourceLead.shopName}）`,
          deleteReason: reason,
          snapshot: {
            businessNo: found.businessNo,
            stage: found.stage,
            notaryOfficeName: found.notaryOffice.name,
            sourceLeadBusinessNo: found.sourceLead.businessNo,
            shopName: found.sourceLead.shopName,
            createdAt: found.createdAt.toISOString(),
          },
        });

        await tx.$executeRawUnsafe(
          'DELETE FROM notary_return_amounts WHERE matter_id = $1::uuid OR source_evidence_matter_id = $1::uuid',
          matterId,
        );
        await tx.$executeRawUnsafe(
          'DELETE FROM notary_return_archives WHERE matter_id = $1::uuid',
          matterId,
        );
        await tx.$executeRawUnsafe(
          'DELETE FROM notary_certificates WHERE matter_id = $1::uuid',
          matterId,
        );
        await tx.$executeRawUnsafe(
          'DELETE FROM notary_issuance_decision_audit_events WHERE matter_id = $1::uuid',
          matterId,
        );
        await tx.$executeRawUnsafe(
          'DELETE FROM notary_issuance_decisions WHERE matter_id = $1::uuid',
          matterId,
        );
        await tx.$executeRawUnsafe(
          'DELETE FROM notary_opening_review_audit_events WHERE matter_id = $1::uuid',
          matterId,
        );
        await tx.$executeRawUnsafe(
          'DELETE FROM notary_opening_review_receipts WHERE result_matter_id = $1::uuid',
          matterId,
        );
        await tx.$executeRawUnsafe(
          'DELETE FROM notary_opening_review_decisions WHERE matter_id = $1::uuid',
          matterId,
        );
        await tx.$executeRawUnsafe(
          'DELETE FROM notary_opening_sender_corrections WHERE matter_id = $1::uuid',
          matterId,
        );
        await tx.$executeRawUnsafe(
          'DELETE FROM notary_matter_opening WHERE matter_id = $1::uuid',
          matterId,
        );
        await tx.$executeRawUnsafe(
          'DELETE FROM notary_evidence_correction_logistics WHERE matter_id = $1::uuid',
          matterId,
        );
        await tx.$executeRawUnsafe(
          'DELETE FROM notary_evidence_corrections WHERE matter_id = $1::uuid',
          matterId,
        );
        await tx.$executeRawUnsafe(
          'DELETE FROM notary_matter_logistics WHERE matter_id = $1::uuid',
          matterId,
        );
        await tx.$executeRawUnsafe(
          'DELETE FROM notary_matter_evidence WHERE matter_id = $1::uuid',
          matterId,
        );
        await tx.$executeRawUnsafe(
          'DELETE FROM notary_evidence_drafts WHERE matter_id = $1::uuid',
          matterId,
        );
        await tx.$executeRawUnsafe(
          'DELETE FROM notary_matter_products WHERE notary_matter_id = $1::uuid',
          matterId,
        );
        await tx.$executeRawUnsafe(
          'DELETE FROM notary_matter_materials WHERE notary_matter_id = $1::uuid',
          matterId,
        );
        await tx.$executeRawUnsafe(
          'DELETE FROM notary_matter_command_receipts WHERE result_matter_id = $1::uuid',
          matterId,
        );
        await tx.$executeRawUnsafe(
          'DELETE FROM notary_routine_profiles WHERE matter_id = $1::uuid',
          matterId,
        );
        await tx.$executeRawUnsafe(
          'UPDATE notary_opening_import_items SET selected_matter_id = NULL WHERE selected_matter_id = $1::uuid',
          matterId,
        );
        await tx.$executeRawUnsafe(
          'DELETE FROM evidence_audit_events WHERE group_id IN (SELECT id FROM evidence_group_versions WHERE source_notary_matter_id = $1::uuid)',
          matterId,
        );
        await tx.$executeRawUnsafe(
          'DELETE FROM evidence_paper_certificates WHERE source_notary_matter_id = $1::uuid',
          matterId,
        );
        await tx.$executeRawUnsafe(
          'DELETE FROM evidence_group_versions WHERE source_notary_matter_id = $1::uuid',
          matterId,
        );
        await tx.$executeRawUnsafe(
          "DELETE FROM legacy_attachments WHERE owner_type = 'NOTARY_MATTER' AND owner_id = $1::uuid",
          matterId,
        );
        await tx.$executeRawUnsafe(
          "DELETE FROM business_number_aliases WHERE entity_type = 'NOTARY_MATTER' AND entity_id = $1::uuid",
          matterId,
        );
        await tx.$executeRawUnsafe(
          'DELETE FROM notary_matters WHERE id = $1::uuid AND department_id = $2::uuid',
          matterId,
          actor.departmentId,
        );

        return { id: matterId };
      },
      { timeout: 15000, maxWait: 10000 },
    );
  }

  private ensureInternalActor(actor: ActorContext): void {
    if (
      actor.lawyerAccountId ||
      actor.clientCustomerId ||
      actor.notaryOfficeId
    ) {
      throw new ForbiddenException({
        code: 'ACTION_FORBIDDEN',
        message: '无权执行此删除操作',
      });
    }
  }

  private requireReason(raw: string | null | undefined): string {
    const reason = raw?.trim() ?? '';
    if (reason.length < 1 || reason.length > 500) {
      throw new BadRequestException({
        code: 'DELETE_REASON_REQUIRED',
        message: '请填写删除原因（1 至 500 字）。',
      });
    }
    return reason;
  }
}
