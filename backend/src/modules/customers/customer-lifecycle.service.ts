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
import {
  isCustomerContactRetryable,
  lockCustomerContactActor,
} from './customer-contact-locks';
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
    const [read, draftRestore, restore] = await Promise.all([
      this.access.buildCustomerScope(actor, 'customer.read'),
      this.access.tryBuildCustomerScope(actor, 'customer.restore-draft'),
      this.access.tryBuildCustomerScope(actor, 'customer.restore'),
    ]);
    const restoreScopes = [draftRestore, restore].filter(
      (scope): scope is NonNullable<typeof scope> => scope !== null,
    );
    if (restoreScopes.length === 0) throw this.notFound();
    const where = {
      deletedAt: { not: null },
      AND: [
        read,
        ...(restoreScopes.length === 1
          ? restoreScopes
          : [{ OR: restoreScopes }]),
      ],
    };
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
    return this.command(actor, id, key, input, 'DELETE', 'draft');
  }

  restoreDraft(
    actor: ActorContext,
    id: string,
    key: string,
    input: CustomerDraftLifecycleDto,
  ) {
    return this.command(actor, id, key, input, 'RESTORE', 'draft');
  }

  deleteCustomer(
    actor: ActorContext,
    id: string,
    key: string,
    input: CustomerDraftLifecycleDto,
  ) {
    return this.command(actor, id, key, input, 'DELETE', 'customer');
  }

  restoreCustomer(
    actor: ActorContext,
    id: string,
    key: string,
    input: CustomerDraftLifecycleDto,
  ) {
    return this.command(actor, id, key, input, 'RESTORE', 'customer');
  }

  async deletionImpact(actor: ActorContext, id: string) {
    const scope = await this.access.buildCustomerScope(
      actor,
      'customer.delete',
    );
    const customer = await this.database.customer.findFirst({
      where: { id, AND: [scope], deletedAt: null },
      select: { id: true, version: true, name: true },
    });
    if (customer === null) throw this.notFound();
    const [leads, cases, agreements, settlements, assets, accounts] =
      await Promise.all([
        this.database.lead.count({ where: { customerId: id } }),
        this.database.case.count({ where: { customerId: id } }),
        this.database.customerAgreement.count({ where: { customerId: id } }),
        this.database.customerSettlementRecord.count({
          where: { customerId: id },
        }),
        this.database.customerRightAsset.count({ where: { customerId: id } }),
        this.database.customerAccountBinding.count({
          where: { customerId: id },
        }),
      ]);
    return {
      id: customer.id,
      name: customer.name,
      version: customer.version,
      leads,
      cases,
      agreements,
      settlements,
      assets,
      accounts,
    };
  }

  private async command(
    actor: ActorContext,
    id: string,
    key: string,
    input: CustomerDraftLifecycleDto,
    action: 'DELETE' | 'RESTORE',
    kind: 'draft' | 'customer',
  ): Promise<CustomerSummary> {
    const permission: CustomerAction =
      kind === 'draft'
        ? action === 'DELETE'
          ? 'customer.delete-draft'
          : 'customer.restore-draft'
        : action === 'DELETE'
          ? 'customer.delete'
          : 'customer.restore';
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
    for (let attempt = 1; attempt <= 6; attempt += 1) {
      try {
        return await this.database.$transaction(async (tx) => {
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
              'cooperationStatus' | 'customerManagerName'
            > & {
              customerManagerName?: string | null;
              cooperationStatus?: CustomerSummary['cooperationStatus'];
            };
            // Receipts written before CU005 represent the then-implicit
            // COOPERATING state. Their immutable JSON is never rewritten.
            return {
              ...snapshot,
              customerManagerName: snapshot.customerManagerName ?? null,
              cooperationStatus: snapshot.cooperationStatus ?? 'COOPERATING',
            };
          }
          if (current.version !== input.expectedVersion)
            throw this.conflict(
              'CUSTOMER_VERSION_CONFLICT',
              '客户资料已被他人更新，请刷新后再提交',
            );
          if (
            action === 'DELETE'
              ? current.deletedAt !== null
              : current.deletedAt === null
          )
            throw this.conflict(
              kind === 'draft'
                ? 'CUSTOMER_DRAFT_STATE_CONFLICT'
                : 'CUSTOMER_LIFECYCLE_STATE_CONFLICT',
              '客户当前状态不允许此操作',
            );
          if (
            kind === 'draft' &&
            (current.profileStatus !== 'DRAFT' ||
              current.admittedAt !== null ||
              current.everAdmitted)
          )
            throw this.conflict(
              'CUSTOMER_DRAFT_STATE_CONFLICT',
              '客户当前状态不允许此操作',
            );
          if (kind === 'customer' && action === 'DELETE' && reason === null)
            throw this.conflict(
              'CUSTOMER_DELETE_REASON_REQUIRED',
              '请填写删除客户的原因',
            );
          if (kind === 'draft' && action === 'DELETE') {
            const associations = await tx.$queryRaw<
              Array<{ blocked: boolean }>
            >`
          SELECT (
            EXISTS (SELECT 1 FROM customer_admission_receipts WHERE result_customer_id = ${id}::uuid)
            OR EXISTS (SELECT 1 FROM rights_holder_command_receipts WHERE result_customer_id = ${id}::uuid)
            OR EXISTS (SELECT 1 FROM customer_rights_holder_links WHERE customer_id = ${id}::uuid)
            OR EXISTS (SELECT 1 FROM customer_account_bindings WHERE customer_id = ${id}::uuid)
            OR EXISTS (SELECT 1 FROM customer_right_assets WHERE customer_id = ${id}::uuid)
            OR EXISTS (SELECT 1 FROM customer_right_asset_versions WHERE customer_id = ${id}::uuid)
            OR EXISTS (SELECT 1 FROM customer_right_asset_receipts WHERE customer_id = ${id}::uuid)
            OR EXISTS (SELECT 1 FROM customer_contacts WHERE customer_id = ${id}::uuid)
            OR EXISTS (SELECT 1 FROM customer_agreements WHERE customer_id = ${id}::uuid)
            OR EXISTS (SELECT 1 FROM customer_agreement_versions WHERE customer_id = ${id}::uuid)
            OR EXISTS (SELECT 1 FROM customer_invoice_profiles WHERE customer_id = ${id}::uuid)
            OR EXISTS (SELECT 1 FROM customer_invoice_profile_versions WHERE customer_id = ${id}::uuid)
            OR EXISTS (SELECT 1 FROM customer_agreement_invoice_receipts WHERE customer_id = ${id}::uuid)
            OR EXISTS (SELECT 1 FROM customer_settlement_records WHERE customer_id = ${id}::uuid)
            OR EXISTS (SELECT 1 FROM customer_settlement_versions WHERE customer_id = ${id}::uuid)
            OR EXISTS (SELECT 1 FROM customer_settlement_receipts WHERE customer_id = ${id}::uuid)
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
          if (kind === 'draft' && action === 'RESTORE') {
            const receiptHistory = await tx.$queryRaw<
              Array<{ blocked: boolean }>
            >`
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
                  ? kind === 'draft'
                    ? 'customer.draft-deleted'
                    : 'customer.deleted'
                  : kind === 'draft'
                    ? 'customer.draft-restored'
                    : 'customer.restored',
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
          const updated = await tx.customer.findUniqueOrThrow({
            where: { id },
          });
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
      } catch (error) {
        if (!isCustomerContactRetryable(error)) throw error;
        if (attempt === 6)
          throw this.conflict(
            'CUSTOMER_CONTACT_BUSY',
            '联系人操作繁忙，请按原请求重试',
          );
        await new Promise((resolve) => setTimeout(resolve, attempt * 15));
      }
    }
    throw this.conflict(
      'CUSTOMER_CONTACT_BUSY',
      '联系人操作繁忙，请按原请求重试',
    );
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
