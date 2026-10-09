import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma, CustomerContact } from '../../generated/prisma/client';
import { AccessControlService } from '../../access-control/access-control.service';
import { ActorContext } from '../../access-control/actor-context';
import { OrganizationService } from '../../access-control/organization.service';
import { DatabaseService } from '../../database/database.service';
import {
  ContactListQueryDto,
  ContactVersionListQueryDto,
  CreateContactDto,
  EndContactDto,
  SetContactPrimaryDto,
  UpdateContactDto,
} from './customer-contact.dto';
import {
  isCustomerContactRetryable,
  lockCustomerContactActor,
} from './customer-contact-locks';

type ContactAction = 'CREATE' | 'UPDATE' | 'PRIMARY' | 'END';
type ContactInput =
  CreateContactDto | UpdateContactDto | SetContactPrimaryDto | EndContactDto;
export type ContactSummary = {
  id: string;
  customerId: string;
  name: string;
  phone: string | null;
  email: string | null;
  duty: string | null;
  isPrimary: boolean;
  endedAt: string | null;
  endReason: string | null;
  version: number;
  origin: 'LEGACY_BACKFILL' | 'LEGACY_CREATE' | 'ADMISSION_FREEFORM' | 'MANUAL';
  createdAt: string;
  updatedAt: string;
};
type ContactSnapshot = Pick<
  ContactSummary,
  'name' | 'phone' | 'email' | 'duty' | 'isPrimary' | 'endedAt' | 'endReason'
>;
export type ContactCommandResult = {
  contact: ContactSummary;
  customerVersion: number;
  primaryContactId: string | null;
};

export function contactSummary(row: CustomerContact): ContactSummary {
  return {
    id: row.id,
    customerId: row.customerId,
    name: row.name,
    phone: row.phone,
    email: row.email,
    duty: row.duty,
    isPrimary: row.isPrimary,
    endedAt: row.endedAt?.toISOString() ?? null,
    endReason: row.endReason,
    version: row.version,
    origin: row.origin as ContactSummary['origin'],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function contactSnapshot(row: CustomerContact): ContactSnapshot {
  const { name, phone, email, duty, isPrimary, endedAt, endReason } =
    contactSummary(row);
  return { name, phone, email, duty, isPrimary, endedAt, endReason };
}

export async function recordContactVersion(
  tx: Prisma.TransactionClient,
  row: CustomerContact,
  action: 'CREATED' | 'UPDATED' | 'PRIMARY_SET' | 'PRIMARY_UNSET' | 'ENDED',
  before: ContactSnapshot | null,
  actorUserId: string | null,
): Promise<void> {
  await tx.customerContactVersion.create({
    data: {
      contactId: row.id,
      version: row.version,
      action,
      before: before === null ? undefined : (before as Prisma.InputJsonObject),
      after: contactSnapshot(row) as Prisma.InputJsonObject,
      actorUserId,
      source: actorUserId === null ? 'LEGACY_MIGRATION' : 'HUMAN',
    },
  });
}

@Injectable()
export class CustomerContactService {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: AccessControlService,
    private readonly organization: OrganizationService,
  ) {}

  async list(
    actor: ActorContext,
    customerId: string,
    query: ContactListQueryDto,
  ) {
    const scope = await this.access.buildCustomerScope(actor, 'customer.read');
    const customer = await this.database.customer.findFirst({
      where: { id: customerId, ...scope, deletedAt: null },
      select: { id: true },
    });
    if (customer === null) throw this.notFound();
    const where = {
      customerId,
      departmentId: actor.departmentId,
      ...(query.status === undefined
        ? {}
        : { endedAt: query.status === 'ACTIVE' ? null : { not: null } }),
    };
    const [items, total, primary] = await Promise.all([
      this.database.customerContact.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.database.customerContact.count({ where }),
      this.database.customerContact.findFirst({
        where: {
          customerId,
          departmentId: actor.departmentId,
          endedAt: null,
          isPrimary: true,
        },
        select: { id: true },
      }),
    ]);
    return {
      items: items.map(contactSummary),
      total,
      page: query.page,
      pageSize: query.pageSize,
      primaryContactId: primary?.id ?? null,
    };
  }

  async versions(
    actor: ActorContext,
    customerId: string,
    contactId: string,
    query: ContactVersionListQueryDto,
  ) {
    const scope = await this.access.buildCustomerScope(actor, 'customer.read');
    const customer = await this.database.customer.findFirst({
      where: { id: customerId, ...scope, deletedAt: null },
      select: { id: true },
    });
    if (customer === null) throw this.notFound();
    const contact = await this.database.customerContact.findFirst({
      where: { id: contactId, customerId, departmentId: actor.departmentId },
      select: { id: true },
    });
    if (contact === null) throw this.notFound();
    const where = { contactId };
    const [rows, total] = await Promise.all([
      this.database.customerContactVersion.findMany({
        where,
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.database.customerContactVersion.count({ where }),
    ]);
    return {
      items: rows.map((row) => ({
        id: row.id,
        contactId: row.contactId,
        version: row.version,
        action: row.action,
        before: row.before,
        after: row.after,
        actor:
          row.source === 'LEGACY_MIGRATION'
            ? { kind: 'LEGACY_MIGRATION', userId: null }
            : { kind: 'HUMAN', userId: row.actorUserId },
        occurredAt: row.occurredAt.toISOString(),
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  create(
    actor: ActorContext,
    customerId: string,
    key: string,
    input: CreateContactDto,
  ) {
    return this.command(actor, customerId, null, key, 'CREATE', input);
  }
  update(
    actor: ActorContext,
    customerId: string,
    contactId: string,
    key: string,
    input: UpdateContactDto,
  ) {
    return this.command(actor, customerId, contactId, key, 'UPDATE', input);
  }
  primary(
    actor: ActorContext,
    customerId: string,
    contactId: string,
    key: string,
    input: SetContactPrimaryDto,
  ) {
    return this.command(actor, customerId, contactId, key, 'PRIMARY', input);
  }
  end(
    actor: ActorContext,
    customerId: string,
    contactId: string,
    key: string,
    input: EndContactDto,
  ) {
    return this.command(actor, customerId, contactId, key, 'END', input);
  }

  private async command(
    actor: ActorContext,
    customerId: string,
    contactId: string | null,
    key: string,
    action: ContactAction,
    input: ContactInput,
  ): Promise<ContactCommandResult> {
    const canonical = {
      expectedCustomerVersion: input.expectedCustomerVersion,
      expectedContactVersion:
        'expectedContactVersion' in input
          ? input.expectedContactVersion
          : undefined,
      name: 'name' in input ? input.name : undefined,
      phone: 'phone' in input ? input.phone : undefined,
      email: 'email' in input ? input.email : undefined,
      duty: 'duty' in input ? input.duty : undefined,
      isPrimary: 'isPrimary' in input ? input.isPrimary : undefined,
      primary: 'primary' in input ? input.primary : undefined,
      reason: 'reason' in input ? input.reason : undefined,
    };
    const fingerprint = createHash('sha256')
      .update(JSON.stringify({ action, customerId, contactId, ...canonical }))
      .digest('hex');
    for (let attempt = 1; attempt <= 6; attempt += 1) {
      try {
        return await this.database.$transaction(
          async (tx) => {
            await lockCustomerContactActor(tx, this.organization, actor);
            await this.visible(tx, actor, customerId, true);
            const locked = await tx.$queryRaw<
              Array<{ id: string }>
            >`SELECT id FROM customers
            WHERE id = ${customerId}::uuid AND department_id = ${actor.departmentId}::uuid FOR UPDATE`;
            if (locked.length !== 1) throw this.notFound();
            const customer = await this.visible(tx, actor, customerId, true);
            const receipt = await tx.customerContactCommandReceipt.findUnique({
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
                receipt.customerId !== customerId ||
                receipt.action !== action ||
                receipt.requestFingerprint !== fingerprint
              )
                throw this.conflict('CUSTOMER_CONTACT_IDEMPOTENCY_CONFLICT');
              return receipt.resultSnapshot as ContactCommandResult;
            }
            if (customer.version !== input.expectedCustomerVersion)
              throw this.conflict('CUSTOMER_VERSION_CONFLICT');
            let contact: CustomerContact;
            if (action === 'CREATE') {
              const create = input as CreateContactDto;
              this.checkContent(
                create.name,
                create.phone ?? null,
                create.email ?? null,
              );
              if (create.isPrimary)
                await this.unsetPreviousPrimary(tx, customerId, actor.userId);
              contact = await tx.customerContact.create({
                data: {
                  customerId,
                  departmentId: actor.departmentId,
                  name: create.name,
                  phone: create.phone ?? null,
                  email: create.email ?? null,
                  duty: create.duty ?? null,
                  isPrimary: create.isPrimary ?? false,
                  origin: 'MANUAL',
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
            } else {
              const existing = await tx.customerContact.findFirst({
                where: {
                  id: contactId!,
                  customerId,
                  departmentId: actor.departmentId,
                },
              });
              if (existing === null) throw this.notFound();
              if (existing.endedAt !== null)
                throw this.conflict('CUSTOMER_CONTACT_ENDED');
              if (
                existing.version !==
                (input as UpdateContactDto).expectedContactVersion
              )
                throw this.conflict('CUSTOMER_CONTACT_VERSION_CONFLICT');
              const before = contactSnapshot(existing);
              if (action === 'UPDATE') {
                const update = input as UpdateContactDto;
                const name = update.name ?? existing.name;
                const phone =
                  update.phone === undefined ? existing.phone : update.phone;
                const email =
                  update.email === undefined ? existing.email : update.email;
                this.checkContent(name, phone, email);
                if (
                  name === existing.name &&
                  phone === existing.phone &&
                  email === existing.email &&
                  (update.duty === undefined || update.duty === existing.duty)
                )
                  throw this.conflict('CUSTOMER_CONTACT_STATE_CONFLICT');
                contact = await tx.customerContact.update({
                  where: { id: existing.id },
                  data: {
                    name,
                    phone,
                    email,
                    duty:
                      update.duty === undefined ? existing.duty : update.duty,
                    version: { increment: 1 },
                    updatedByUserId: actor.userId,
                  },
                });
                if (customer.compatibilityContactId === contact.id)
                  await tx.customer.update({
                    where: { id: customerId },
                    data: {
                      admissionContactName: contact.name,
                      admissionContactPhone: contact.phone,
                      admissionContactEmail: contact.email,
                    },
                  });
                await recordContactVersion(
                  tx,
                  contact,
                  'UPDATED',
                  before,
                  actor.userId,
                );
              } else if (action === 'PRIMARY') {
                const primary = (input as SetContactPrimaryDto).primary;
                if (primary === existing.isPrimary)
                  throw this.conflict('CUSTOMER_CONTACT_STATE_CONFLICT');
                if (primary)
                  await this.unsetPreviousPrimary(tx, customerId, actor.userId);
                contact = await tx.customerContact.update({
                  where: { id: existing.id },
                  data: {
                    isPrimary: primary,
                    version: { increment: 1 },
                    updatedByUserId: actor.userId,
                  },
                });
                await recordContactVersion(
                  tx,
                  contact,
                  primary ? 'PRIMARY_SET' : 'PRIMARY_UNSET',
                  before,
                  actor.userId,
                );
              } else {
                const now = new Date();
                contact = await tx.customerContact.update({
                  where: { id: existing.id },
                  data: {
                    isPrimary: false,
                    endedAt: now,
                    endedByUserId: actor.userId,
                    endReason: (input as EndContactDto).reason ?? null,
                    version: { increment: 1 },
                    updatedByUserId: actor.userId,
                  },
                });
                if (customer.compatibilityContactId === contact.id)
                  await tx.customer.update({
                    where: { id: customerId },
                    data: {
                      compatibilityContactId: null,
                      admissionContactName: null,
                      admissionContactPhone: null,
                      admissionContactEmail: null,
                    },
                  });
                await recordContactVersion(
                  tx,
                  contact,
                  'ENDED',
                  before,
                  actor.userId,
                );
              }
            }
            const updated = await tx.customer.update({
              where: { id: customerId },
              data: { version: { increment: 1 } },
            });
            const primary = await tx.customerContact.findFirst({
              where: {
                customerId,
                departmentId: actor.departmentId,
                endedAt: null,
                isPrimary: true,
              },
              select: { id: true },
            });
            const result: ContactCommandResult = {
              contact: contactSummary(contact),
              customerVersion: updated.version,
              primaryContactId: primary?.id ?? null,
            };
            await tx.auditEvent.create({
              data: {
                departmentId: actor.departmentId,
                actorUserId: actor.userId,
                resourceType: 'customer-contact',
                resourceId: contact.id,
                action: `customer-contact.${action.toLowerCase()}`,
                details: {
                  customerId,
                  contactId: contact.id,
                  version: contact.version,
                  customerVersion: updated.version,
                },
              },
            });
            await tx.customerContactCommandReceipt.create({
              data: {
                departmentId: actor.departmentId,
                actorUserId: actor.userId,
                idempotencyKey: key,
                customerId,
                action,
                requestFingerprint: fingerprint,
                resultSnapshot: result as unknown as Prisma.InputJsonObject,
                resultCustomerVersion: updated.version,
              },
            });
            return result;
          },
          { isolationLevel: 'Serializable' },
        );
      } catch (error) {
        if (!isCustomerContactRetryable(error)) throw error;
        if (attempt === 6) throw this.conflict('CUSTOMER_CONTACT_BUSY');
        await new Promise((resolve) => setTimeout(resolve, attempt * 15));
      }
    }
    throw this.conflict('CUSTOMER_CONTACT_BUSY');
  }

  private async unsetPreviousPrimary(
    tx: Prisma.TransactionClient,
    customerId: string,
    actorUserId: string,
  ) {
    const old = await tx.customerContact.findFirst({
      where: { customerId, endedAt: null, isPrimary: true },
    });
    if (old === null) return;
    const updated = await tx.customerContact.update({
      where: { id: old.id },
      data: {
        isPrimary: false,
        version: { increment: 1 },
        updatedByUserId: actorUserId,
      },
    });
    await recordContactVersion(
      tx,
      updated,
      'PRIMARY_UNSET',
      contactSnapshot(old),
      actorUserId,
    );
  }

  private async visible(
    tx: Prisma.TransactionClient,
    actor: ActorContext,
    id: string,
    write: boolean,
  ) {
    const read = await this.access.buildCustomerScope(
      actor,
      'customer.read',
      tx,
    );
    const edit = write
      ? await this.access.buildCustomerScope(actor, 'customer.edit-routine', tx)
      : null;
    const customer = await tx.customer.findFirst({
      where: {
        id,
        deletedAt: null,
        AND: [read, ...(edit === null ? [] : [edit])],
      },
    });
    if (customer === null) throw this.notFound();
    return customer;
  }
  private checkContent(
    name: string,
    phone: string | null,
    email: string | null,
  ) {
    if (!name.trim() || (!phone?.trim() && !email?.trim()))
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: '联系人姓名和联系方式不完整',
      });
  }
  private notFound() {
    return new NotFoundException({
      code: 'CUSTOMER_NOT_FOUND',
      message: '客户不存在或不可访问',
    });
  }
  private conflict(code: string) {
    return new ConflictException({
      code,
      message: '联系人状态已变化，请刷新后重试',
    });
  }
}
