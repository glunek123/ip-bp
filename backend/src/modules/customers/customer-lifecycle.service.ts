import { createHash } from 'node:crypto';
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AccessControlService,
  type CustomerAction,
} from '../../access-control/access-control.service';
import { ActorContext } from '../../access-control/actor-context';
import { DatabaseService } from '../../database/database.service';
import { OrganizationService } from '../../access-control/organization.service';
import { lockCustomerContactActor } from './customer-contact-locks';
import { recordContactVersion } from './customer-contact.service';
import { CustomerDraftLifecycleDto } from './customer-lifecycle.dto';
import { type CustomerSummary, toCustomerSummary } from './customer.service';

export type DeletedCustomerDraft = CustomerSummary & {
  deletedAt: string;
  deletedByUserId: string;
  deletionReason: string | null;
  capabilities: { restoreDraft: true };
};

@Injectable()
export class CustomerLifecycleService {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: AccessControlService,
    private readonly organization: OrganizationService,
  ) {}

  async listDeleted(actor: ActorContext, page: number, pageSize: number) {
    const [read, restore] = await Promise.all([
      this.access.buildCustomerScope(actor, 'customer.read'),
      this.access.buildCustomerScope(actor, 'customer.restore-draft'),
    ]);
    const where = { deletedAt: { not: null }, AND: [read, restore] };
    const [rows, total] = await this.database.$transaction([
      this.database.customer.findMany({
        where,
        orderBy: [{ deletedAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.database.customer.count({ where }),
    ]);
    return {
      items: rows.map((row): DeletedCustomerDraft => ({
        ...toCustomerSummary(row),
        deletedAt: row.deletedAt!.toISOString(),
        deletedByUserId: row.deletedByUserId!,
        deletionReason: row.deletionReason,
        capabilities: { restoreDraft: true },
      })),
      total,
      page,
      pageSize,
    };
  }

  deleteDraft(
    actor: ActorContext,
    id: string,
    key: string,
    input: CustomerDraftLifecycleDto,
  ) {
    return this.command(
      actor,
      id,
      key,
      input,
      'DELETE',
      'customer.delete-draft',
    );
  }

  restoreDraft(
    actor: ActorContext,
    id: string,
    key: string,
    input: CustomerDraftLifecycleDto,
  ) {
    return this.command(
      actor,
      id,
      key,
      input,
      'RESTORE',
      'customer.restore-draft',
    );
  }

  private async command(
    actor: ActorContext,
    id: string,
    key: string,
    input: CustomerDraftLifecycleDto,
    action: 'DELETE' | 'RESTORE',
    permission: CustomerAction,
  ): Promise<CustomerSummary> {
    const reason = input.reason?.trim() ?? null;
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify({
          action,
          id,
          expectedVersion: input.expectedVersion,
          reason,
        }),
      )
      .digest('hex');
    return this.database.$transaction(async (tx) => {
      await lockCustomerContactActor(tx, this.organization, actor);
      const [preRead, preWrite] = await Promise.all([
        this.access.buildCustomerScope(actor, 'customer.read', tx),
        this.access.buildCustomerScope(actor, permission, tx),
      ]);
      const preliminary = await tx.customer.findFirst({
        where: { id, AND: [preRead, preWrite] },
        select: { id: true },
      });
      if (preliminary === null) throw this.notFound();
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM customers WHERE id = ${id}::uuid AND department_id = ${actor.departmentId}::uuid FOR UPDATE`;
      if (locked.length !== 1) throw this.notFound();
      const [read, write] = await Promise.all([
        this.access.buildCustomerScope(actor, 'customer.read', tx),
        this.access.buildCustomerScope(actor, permission, tx),
      ]);
      const current = await tx.customer.findFirst({
        where: { id, AND: [read, write] },
      });
      if (current === null) throw this.notFound();

      const receipt = await tx.customerDraftLifecycleReceipt.findUnique({
        where: {
          departmentId_actorUserId_idempotencyKey: {
            departmentId: actor.departmentId,
            actorUserId: actor.userId,
            idempotencyKey: key,
          },
        },
      });
      if (receipt !== null) {
        if (
          receipt.requestFingerprint !== fingerprint ||
          receipt.action !== action ||
          receipt.customerId !== id
        )
          throw this.conflict(
            'CUSTOMER_IDEMPOTENCY_CONFLICT',
            '幂等键已用于不同请求',
          );
        const snapshot = receipt.resultSnapshot as Omit<
          CustomerSummary,
          'cooperationStatus'
        > & {
          cooperationStatus?: CustomerSummary['cooperationStatus'];
        };
        // Receipts written before CU005 represent the then-implicit
        // COOPERATING state. Their immutable JSON is never rewritten.
        return {
          ...snapshot,
          cooperationStatus: snapshot.cooperationStatus ?? 'COOPERATING',
        };
      }
      if (current.version !== input.expectedVersion)
        throw this.conflict(
          'CUSTOMER_VERSION_CONFLICT',
          '客户资料已被他人更新，请刷新后再提交',
        );
      if (
        current.profileStatus !== 'DRAFT' ||
        current.admittedAt !== null ||
        current.everAdmitted ||
        (action === 'DELETE'
          ? current.deletedAt !== null
          : current.deletedAt === null)
      )
        throw this.conflict(
          'CUSTOMER_DRAFT_STATE_CONFLICT',
          '客户草稿状态不允许此操作',
        );
      if (action === 'DELETE') {
        const associations = await tx.$queryRaw<Array<{ blocked: boolean }>>`
          SELECT (
            EXISTS (SELECT 1 FROM customer_admission_receipts WHERE result_customer_id = ${id}::uuid)
            OR EXISTS (SELECT 1 FROM rights_holder_command_receipts WHERE result_customer_id = ${id}::uuid)
            OR EXISTS (SELECT 1 FROM customer_rights_holder_links WHERE customer_id = ${id}::uuid)
            OR EXISTS (SELECT 1 FROM customer_account_bindings WHERE customer_id = ${id}::uuid)
            OR EXISTS (SELECT 1 FROM customer_right_assets WHERE customer_id = ${id}::uuid)
            OR EXISTS (SELECT 1 FROM customer_right_asset_versions WHERE customer_id = ${id}::uuid)
            OR EXISTS (SELECT 1 FROM customer_right_asset_receipts WHERE customer_id = ${id}::uuid)
            OR EXISTS (SELECT 1 FROM customer_contacts WHERE customer_id = ${id}::uuid)
            OR EXISTS (SELECT 1 FROM leads WHERE customer_id = ${id}::uuid)
            OR EXISTS (SELECT 1 FROM cases WHERE customer_id = ${id}::uuid)
            OR EXISTS (SELECT 1 FROM upload_drafts WHERE owner_type = 'CUSTOMER' AND owner_id = ${id}::uuid)
            OR EXISTS (SELECT 1 FROM materials WHERE owner_type = 'CUSTOMER' AND owner_id = ${id}::uuid)
          ) AS blocked`;
        if (associations[0]?.blocked)
          throw this.conflict(
            'CUSTOMER_DRAFT_HAS_ASSOCIATIONS',
            '客户草稿已有业务关联，不能删除',
          );
      }
      if (action === 'RESTORE') {
        const receiptHistory = await tx.$queryRaw<Array<{ blocked: boolean }>>`
          SELECT (EXISTS (SELECT 1 FROM customer_admission_receipts WHERE result_customer_id = ${id}::uuid)
            OR EXISTS (SELECT 1 FROM rights_holder_command_receipts WHERE result_customer_id = ${id}::uuid)) AS blocked`;
        if (receiptHistory[0]?.blocked)
          throw this.conflict(
            'CUSTOMER_DRAFT_HAS_ASSOCIATIONS',
            '客户草稿已有业务关联，不能恢复',
          );
      }
      const now = new Date();
      const changed = await tx.customer.updateMany({
        where: {
          id,
          version: input.expectedVersion,
          deletedAt: action === 'DELETE' ? null : { not: null },
        },
        data: {
          deletedAt: action === 'DELETE' ? now : null,
          deletedByUserId: action === 'DELETE' ? actor.userId : null,
          deletionReason: action === 'DELETE' ? reason : null,
          version: { increment: 1 },
        },
      });
      if (changed.count !== 1)
        throw this.conflict(
          'CUSTOMER_VERSION_CONFLICT',
          '客户资料已被他人更新，请刷新后再提交',
        );
      if (action === 'RESTORE' && current.legacyContactPending) {
        const existing = await tx.customerContact.count({
          where: { customerId: id },
        });
        if (existing === 0 && current.admissionContactName !== null) {
          const contact = await tx.customerContact.create({
            data: {
              customerId: id,
              departmentId: actor.departmentId,
              name: current.admissionContactName,
              phone: current.admissionContactPhone,
              email: current.admissionContactEmail,
              origin: 'LEGACY_BACKFILL',
              originKey: `legacy:${id}`,
              createdByUserId: actor.userId,
              updatedByUserId: actor.userId,
            },
          });
          await recordContactVersion(
            tx,
            contact,
            'CREATED',
            null,
            actor.userId,
          );
          await tx.customer.update({
            where: { id },
            data: {
              compatibilityContactId: contact.id,
              legacyContactPending: false,
            },
          });
        } else {
          await tx.customer.update({
            where: { id },
            data: {
              compatibilityContactId: null,
              admissionContactName: null,
              admissionContactPhone: null,
              admissionContactEmail: null,
              legacyContactPending: false,
            },
          });
        }
      }
      const audit = await tx.auditEvent.create({
        data: {
          departmentId: actor.departmentId,
          actorUserId: actor.userId,
          resourceType: 'customer',
          resourceId: id,
          action:
            action === 'DELETE'
              ? 'customer.draft-deleted'
              : 'customer.draft-restored',
          details: {
            fromVersion: input.expectedVersion,
            toVersion: input.expectedVersion + 1,
            reason,
          },
        },
      });
      const fact = await tx.customerDraftLifecycleFact.create({
        data: {
          customerId: id,
          departmentId: actor.departmentId,
          action,
          actorUserId: actor.userId,
          fromVersion: input.expectedVersion,
          toVersion: input.expectedVersion + 1,
          reason,
          auditEventId: audit.id,
        },
      });
      const updated = await tx.customer.findUniqueOrThrow({ where: { id } });
      const result = toCustomerSummary(updated);
      await tx.customerDraftLifecycleReceipt.create({
        data: {
          departmentId: actor.departmentId,
          actorUserId: actor.userId,
          idempotencyKey: key,
          requestFingerprint: fingerprint,
          action,
          customerId: id,
          factId: fact.id,
          resultSnapshot: result,
        },
      });
      return result;
    });
  }

  private notFound() {
    return new NotFoundException({
      code: 'CUSTOMER_NOT_FOUND',
      message: '客户不存在或不可访问',
    });
  }

  private conflict(code: string, message: string) {
    return new ConflictException({ code, message });
  }
}
