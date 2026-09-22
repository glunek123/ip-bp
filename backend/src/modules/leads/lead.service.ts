import { randomUUID, createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { AccessControlService } from '../../access-control/access-control.service';
import { ActorContext } from '../../access-control/actor-context';
import { DatabaseService } from '../../database/database.service';
import { Prisma } from '../../generated/prisma/client';
import { MaterialService } from '../materials';
import {
  CASE_TYPE_OPTIONS,
  CASE_TYPES,
  INFRINGEMENT_TYPE_OPTIONS,
  INFRINGEMENT_TYPES,
  LEAD_STATUSES,
  LeadPlatform,
  LeadSource,
  LeadStatus,
  PLATFORM_OPTIONS,
  PLATFORMS,
  SOURCE_OPTIONS,
  SOURCES,
} from './lead.constants';
import { CreateLeadCommand, PushLeadDto, UpdateLeadDto } from './lead.dto';

const MAX_SERIALIZABLE_ATTEMPTS = 3;
const leadInclude = {
  products: { orderBy: { position: 'asc' as const } },
  infringements: { orderBy: { type: 'asc' as const } },
  pushedBy: { select: { displayName: true } },
} satisfies Prisma.LeadInclude;

type LeadRecord = Prisma.LeadGetPayload<{ include: typeof leadInclude }>;
type LeadProductResponse = {
  id: string;
  position: number;
  url: string | null;
  title: string | null;
  quantity: number;
  unitPrice: string;
  commentCount: number;
  estimatedAmount: string;
};
type LeadResponse = {
  id: string;
  businessNo: string;
  departmentId: string;
  customerId: string;
  rightsHolderId: string;
  responsibleUserId: string;
  teamId: string | null;
  status: LeadRecord['status'];
  caseType: LeadRecord['caseType'];
  infringementTypes: LeadRecord['infringements'][number]['type'][];
  source: LeadRecord['source'];
  platform: LeadRecord['platform'];
  foundAt: string;
  shopName: string;
  shopExternalId: string | null;
  needDisclose: boolean;
  remark: string | null;
  creationChannel: LeadRecord['creationChannel'];
  externalSourceRef: string | null;
  products: LeadProductResponse[];
  leadScreenshotContentVersionIds: string[];
  version: number;
  pushedAt: string | null;
  pushedByUserId: string | null;
  pushedByDisplayName: string | null;
  createdAt: string;
  updatedAt: string;
};

type ProductInput = CreateLeadCommand['products'][number];
type NormalizedBusiness = Omit<
  CreateLeadCommand,
  'reservedLeadId' | 'customerId' | 'rightsHolderId' | 'products'
> & {
  products: Array<
    ProductInput & {
      url: string | null;
      title: string | null;
      estimatedAmount: Prisma.Decimal;
    }
  >;
  shopExternalId: string | null;
  remark: string | null;
  foundAtDate: Date;
};

type Receipt = {
  requestFingerprint: string;
  resultLeadId: string;
  resultLeadVersion: number;
  resultSnapshot: unknown;
};

type LeadPushResponse = {
  id: string;
  businessNo: string;
  status: 'WAITING_REVIEW';
  version: number;
  pushedAt: string;
  pushedByUserId: string;
  pushedByDisplayName: string;
};

@Injectable()
export class LeadService {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: AccessControlService,
    private readonly materials: MaterialService,
  ) {}

  async formContext(actor: ActorContext) {
    try {
      if (!(await this.access.canAuthorizeNewLead(actor)))
        throw this.actionForbidden();
      const customerScope = await this.access.buildCustomerScope(
        actor,
        'customer.read',
      );
      const customers = await this.database.customer.findMany({
        where: { ...customerScope, profileStatus: 'ADMITTED' },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          name: true,
          rightsHolderLinks: {
            orderBy: { id: 'asc' },
            select: { rightsHolder: { select: { id: true, name: true } } },
          },
        },
      });
      return {
        customers: customers.map((customer) => ({
          id: customer.id,
          name: customer.name,
          rightsHolders: customer.rightsHolderLinks.map(
            (link) => link.rightsHolder,
          ),
        })),
        dictionaries: {
          caseTypes: CASE_TYPE_OPTIONS,
          infringementTypes: INFRINGEMENT_TYPE_OPTIONS,
          sources: SOURCE_OPTIONS,
          platforms: PLATFORM_OPTIONS,
        },
      };
    } catch (error) {
      throw this.mapAuthorization(error);
    }
  }

  async list(
    actor: ActorContext,
    page: number,
    pageSize: number,
    status?: LeadStatus,
  ) {
    let scope;
    try {
      scope = await this.access.buildLeadScope(actor, 'lead.read');
    } catch (error) {
      throw this.mapAuthorization(error);
    }
    const itemScope = status === undefined ? scope : { ...scope, status };
    const [items, total, groups, create] = await Promise.all([
      this.database.lead.findMany({
        where: itemScope,
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: leadInclude,
      }),
      this.database.lead.count({ where: itemScope }),
      this.database.lead.groupBy({
        by: ['status'],
        where: scope,
        orderBy: { status: 'asc' },
        _count: { _all: true },
      }),
      this.access.canAuthorizeNewLead(actor),
    ]);
    const counts = Object.fromEntries(
      LEAD_STATUSES.map((status) => [status, 0]),
    ) as Record<(typeof LEAD_STATUSES)[number], number>;
    for (const group of groups) counts[group.status] = group._count._all;
    const screenshotIds = await this.currentScreenshotIds(
      actor,
      items.map((item) => item.id),
    );
    return {
      items: items.map((item) =>
        this.view(item, screenshotIds.get(item.id) ?? []),
      ),
      total,
      page,
      pageSize,
      counts,
      capabilities: { create },
    };
  }

  async editContext(actor: ActorContext, id: string) {
    let leadScope;
    try {
      leadScope = await this.access.buildLeadScope(actor, 'lead.edit');
    } catch (error) {
      throw this.mapAuthorization(error);
    }
    const lead = await this.database.lead.findFirst({
      where: { id, ...leadScope },
      select: {
        id: true,
        status: true,
        customerId: true,
        rightsHolderId: true,
      },
    });
    if (lead === null) throw this.notFound();
    if (lead.status !== 'WAITING_PUSH') throw this.invalidState();

    let customerScope;
    try {
      customerScope = await this.access.buildCustomerScope(
        actor,
        'customer.read',
      );
    } catch {
      throw this.notFound();
    }
    const customer = await this.database.customer.findFirst({
      where: {
        id: lead.customerId,
        ...customerScope,
        profileStatus: 'ADMITTED',
      },
      select: {
        id: true,
        name: true,
        rightsHolderLinks: {
          where: { rightsHolderId: lead.rightsHolderId },
          select: { rightsHolder: { select: { id: true, name: true } } },
        },
      },
    });
    const holder = customer?.rightsHolderLinks[0]?.rightsHolder;
    if (customer === null || holder === undefined) throw this.notFound();
    return {
      customers: [
        {
          id: customer.id,
          name: customer.name,
          rightsHolders: [holder],
        },
      ],
      dictionaries: {
        caseTypes: CASE_TYPE_OPTIONS,
        infringementTypes: INFRINGEMENT_TYPE_OPTIONS,
        sources: SOURCE_OPTIONS,
        platforms: PLATFORM_OPTIONS,
      },
    };
  }

  async get(actor: ActorContext, id: string) {
    let scope;
    try {
      scope = await this.access.buildLeadScope(actor, 'lead.read');
    } catch (error) {
      throw this.mapAuthorization(error);
    }
    const lead = await this.database.lead.findFirst({
      where: { id, ...scope },
      include: leadInclude,
    });
    if (lead === null) throw this.notFound();
    const [screenshotIds, edit, push] = await Promise.all([
      this.currentScreenshotIds(actor, [lead.id]),
      this.canEdit(actor, lead),
      this.canPush(actor, lead),
    ]);
    return {
      ...this.view(lead, screenshotIds.get(lead.id) ?? []),
      capabilities: { edit, push },
    };
  }

  async create(
    actor: ActorContext,
    idempotencyKey: string,
    input: CreateLeadCommand,
  ) {
    try {
      if (!(await this.access.canAuthorizeNewLead(actor)))
        throw this.actionForbidden();
    } catch (error) {
      throw this.mapAuthorization(error);
    }
    const normalized = this.normalizeBusiness(input);
    if (
      input.leadScreenshotContentVersionIds.length > 0 &&
      input.reservedLeadId === undefined
    )
      throw this.validation();
    const leadId = input.reservedLeadId ?? randomUUID();
    const fingerprint = this.fingerprint({
      ...input,
      ...this.fingerprintBusiness(normalized),
      reservedLeadId: input.reservedLeadId ?? null,
    });
    for (let attempt = 1; attempt <= MAX_SERIALIZABLE_ATTEMPTS; attempt += 1) {
      try {
        return await this.database.$transaction(
          async (transaction) => {
            if (!(await this.access.canAuthorizeNewLead(actor, transaction)))
              throw this.actionForbidden();
            const receipt = await transaction.leadCommandReceipt.findUnique({
              where: this.receiptWhere(actor, 'create', idempotencyKey),
            });
            if (receipt !== null)
              return this.receiptResult(actor, receipt, fingerprint);

            const membership = await transaction.departmentMembership.findFirst(
              {
                where: {
                  userId: actor.userId,
                  departmentId: actor.departmentId,
                  active: true,
                },
                select: { teamId: true, team: { select: { status: true } } },
              },
            );
            if (
              membership === null ||
              (membership.teamId !== null &&
                membership.team?.status !== 'ACTIVE')
            )
              throw this.actionForbidden();
            const facts = {
              departmentId: actor.departmentId,
              responsibleUserId: actor.userId,
              ...(membership.teamId === null
                ? {}
                : { teamId: membership.teamId }),
            };
            try {
              await this.access.authorizeLead(
                actor,
                'lead.create',
                facts,
                transaction,
              );
            } catch (error) {
              throw this.mapAuthorization(error);
            }
            await this.assertCustomerAndHolder(
              transaction,
              actor,
              input.customerId,
              input.rightsHolderId,
            );

            const materialFacts =
              input.reservedLeadId === undefined
                ? []
                : await this.materials.assertAvailableVersions(
                    transaction,
                    actor,
                    {
                      ownerType: 'LEAD_DRAFT',
                      ownerId: input.reservedLeadId,
                      category: 'LEAD_SCREENSHOT',
                      contentVersionIds: [
                        ...input.leadScreenshotContentVersionIds,
                      ],
                      minCount: 0,
                      maxCount: 20,
                    },
                  );
            const businessNo = await this.allocateBusinessNo(transaction);
            const created = await transaction.lead.create({
              data: {
                id: leadId,
                departmentId: actor.departmentId,
                businessNo,
                customerId: input.customerId,
                rightsHolderId: input.rightsHolderId,
                responsibleUserId: actor.userId,
                teamId: membership.teamId,
                status: 'WAITING_PUSH',
                caseType: normalized.caseType,
                source: normalized.source,
                platform: normalized.platform,
                foundAt: normalized.foundAtDate,
                shopName: normalized.shopName,
                shopExternalId: normalized.shopExternalId,
                needDisclose: normalized.needDisclose,
                remark: normalized.remark,
                creationChannel: 'MANUAL',
                externalSourceRef: null,
                products: {
                  create: normalized.products.map((product, index) => ({
                    position: index + 1,
                    url: product.url,
                    title: product.title,
                    quantity: product.quantity,
                    unitPrice: product.unitPrice,
                    commentCount: product.commentCount,
                    estimatedAmount: product.estimatedAmount,
                  })),
                },
                infringements: {
                  create: normalized.infringementTypes.map((type) => ({
                    type,
                  })),
                },
              },
              include: leadInclude,
            });
            if (input.reservedLeadId !== undefined) {
              await this.materials.adoptLeadDraftVersions(transaction, {
                reservedLeadId: input.reservedLeadId,
                targetLeadId: leadId,
                versions: materialFacts,
              });
            }
            if (materialFacts.length > 0) {
              await this.materials.freezeReferences(transaction, {
                departmentId: actor.departmentId,
                resourceType: 'lead',
                resourceId: leadId,
                facts: materialFacts,
              });
            }
            await transaction.auditEvent.create({
              data: {
                departmentId: actor.departmentId,
                actorUserId: actor.userId,
                resourceType: 'lead',
                resourceId: leadId,
                action: 'lead.created',
                details: {
                  businessNo,
                  version: 1,
                  productCount: normalized.products.length,
                  infringementCount: normalized.infringementTypes.length,
                  screenshotCount: materialFacts.length,
                },
              },
            });
            const result = this.view(created, [
              ...input.leadScreenshotContentVersionIds,
            ]);
            await transaction.leadCommandReceipt.create({
              data: {
                departmentId: actor.departmentId,
                actorUserId: actor.userId,
                action: 'create',
                idempotencyKey,
                requestFingerprint: fingerprint,
                resultLeadId: leadId,
                resultLeadVersion: 1,
                resultSnapshot: this.responseSnapshot(result),
              },
            });
            return result;
          },
          { isolationLevel: 'Serializable' },
        );
      } catch (error) {
        if (this.isSerializationConflict(error)) {
          if (attempt < MAX_SERIALIZABLE_ATTEMPTS) continue;
          throw this.versionConflict();
        }
        if (this.isUnique(error)) {
          const receipt = await this.database.leadCommandReceipt.findUnique({
            where: this.receiptWhere(actor, 'create', idempotencyKey),
          });
          if (receipt !== null)
            return this.receiptResult(actor, receipt, fingerprint);
        }
        throw this.mapAuthorization(error);
      }
    }
    throw this.versionConflict();
  }

  async update(actor: ActorContext, id: string, input: UpdateLeadDto) {
    const normalized = this.normalizeBusiness(input);
    for (let attempt = 1; attempt <= MAX_SERIALIZABLE_ATTEMPTS; attempt += 1) {
      try {
        return await this.database.$transaction(
          async (transaction) => {
            let scope;
            try {
              scope = await this.access.buildLeadScope(
                actor,
                'lead.edit',
                transaction,
              );
            } catch (error) {
              throw this.mapAuthorization(error);
            }
            const locked = await transaction.$queryRawUnsafe<
              Array<{ id: string }>
            >(
              'SELECT "id" FROM "leads" WHERE "id" = $1::uuid AND "department_id" = $2::uuid FOR UPDATE',
              id,
              actor.departmentId,
            );
            if (locked.length !== 1) throw this.notFound();
            const current = await transaction.lead.findFirst({
              where: { id, ...scope },
              include: leadInclude,
            });
            if (current === null) throw this.notFound();
            if (current.status !== 'WAITING_PUSH') throw this.invalidState();
            if (current.version !== input.expectedVersion)
              throw this.versionConflict();
            await this.assertCustomerAndHolder(
              transaction,
              actor,
              current.customerId,
              current.rightsHolderId,
            );
            const materialFacts =
              input.leadScreenshotContentVersionIds.length === 0
                ? []
                : await this.materials.assertAvailableVersions(
                    transaction,
                    actor,
                    {
                      ownerType: 'LEAD',
                      ownerId: id,
                      category: 'LEAD_SCREENSHOT',
                      contentVersionIds: [
                        ...input.leadScreenshotContentVersionIds,
                      ],
                      minCount: 0,
                      maxCount: 20,
                      leadAction: 'lead.edit',
                    },
                  );
            const changed = await transaction.lead.updateMany({
              where: {
                id,
                departmentId: actor.departmentId,
                version: input.expectedVersion,
                status: 'WAITING_PUSH',
              },
              data: {
                caseType: normalized.caseType,
                source: normalized.source,
                platform: normalized.platform,
                foundAt: normalized.foundAtDate,
                shopName: normalized.shopName,
                shopExternalId: normalized.shopExternalId,
                needDisclose: normalized.needDisclose,
                remark: normalized.remark,
                version: { increment: 1 },
              },
            });
            if (changed.count !== 1) throw this.versionConflict();
            await transaction.leadProduct.deleteMany({ where: { leadId: id } });
            await transaction.leadInfringement.deleteMany({
              where: { leadId: id },
            });
            await transaction.leadProduct.createMany({
              data: normalized.products.map((product, index) => ({
                leadId: id,
                position: index + 1,
                url: product.url,
                title: product.title,
                quantity: product.quantity,
                unitPrice: product.unitPrice,
                commentCount: product.commentCount,
                estimatedAmount: product.estimatedAmount,
              })),
            });
            await transaction.leadInfringement.createMany({
              data: normalized.infringementTypes.map((type) => ({
                leadId: id,
                type,
              })),
            });
            const referenceResult =
              await this.materials.replaceCurrentReferences(
                transaction,
                actor,
                {
                  resourceType: 'lead',
                  resourceId: id,
                  purpose: 'LEAD_SCREENSHOT',
                  versions: materialFacts,
                },
              );
            const changedFields = this.changedFields(
              current,
              normalized,
              referenceResult.changed,
            );
            await transaction.auditEvent.create({
              data: {
                departmentId: actor.departmentId,
                actorUserId: actor.userId,
                resourceType: 'lead',
                resourceId: id,
                action: 'lead.updated',
                details: {
                  fromVersion: input.expectedVersion,
                  toVersion: input.expectedVersion + 1,
                  changedFields,
                },
              },
            });
            const updated = await transaction.lead.findUnique({
              where: { id },
              include: leadInclude,
            });
            if (updated === null) throw this.notFound();
            return this.view(updated, referenceResult.afterVersionIds);
          },
          { isolationLevel: 'Serializable' },
        );
      } catch (error) {
        if (this.isSerializationConflict(error)) {
          if (attempt < MAX_SERIALIZABLE_ATTEMPTS) continue;
          throw this.versionConflict();
        }
        throw this.mapAuthorization(error);
      }
    }
    throw this.versionConflict();
  }

  async push(
    actor: ActorContext,
    id: string,
    idempotencyKey: string,
    input: PushLeadDto,
  ): Promise<LeadPushResponse> {
    const fingerprint = this.fingerprint({ leadId: id, ...input });
    for (let attempt = 1; attempt <= MAX_SERIALIZABLE_ATTEMPTS; attempt += 1) {
      try {
        return await this.database.$transaction(
          async (transaction) => {
            const locked = await transaction.$queryRawUnsafe<
              Array<{ id: string }>
            >(
              'SELECT "id" FROM "leads" WHERE "id" = $1::uuid AND "department_id" = $2::uuid FOR UPDATE',
              id,
              actor.departmentId,
            );
            if (locked.length !== 1) throw this.notFound();
            const current = await transaction.lead.findFirst({
              where: { id, departmentId: actor.departmentId },
              include: {
                products: { orderBy: { position: 'asc' } },
                infringements: { orderBy: { type: 'asc' } },
                customer: {
                  select: {
                    profileStatus: true,
                    clientAccountBindings: {
                      where: { active: true, user: { active: true } },
                      select: { id: true },
                      take: 1,
                    },
                  },
                },
              },
            });
            if (current === null) throw this.notFound();
            try {
              await this.access.authorizeLead(
                actor,
                'lead.push',
                {
                  departmentId: current.departmentId,
                  responsibleUserId: current.responsibleUserId,
                  ...(current.teamId === null
                    ? {}
                    : { teamId: current.teamId }),
                },
                transaction,
              );
            } catch (error) {
              throw this.mapAuthorization(error);
            }
            const pusher = await transaction.userAccount.findUnique({
              where: { id: actor.userId },
              select: { displayName: true },
            });
            if (pusher === null)
              throw new InternalServerErrorException(
                '推送操作人账号不可用，请稍后重试',
              );
            const receipt = await transaction.leadCommandReceipt.findUnique({
              where: this.receiptWhere(actor, 'push', idempotencyKey),
            });
            if (receipt !== null)
              return this.pushReceiptResult(
                actor,
                receipt,
                fingerprint,
                id,
                pusher.displayName,
              );
            if (current.status !== 'WAITING_PUSH')
              throw this.pushInvalidState();
            if (current.version !== input.expectedVersion)
              throw this.versionConflict();
            if (current.customer.profileStatus !== 'ADMITTED')
              throw this.customerNotAdmitted();
            if (current.products.length === 0) throw this.productsRequired();
            if (current.customer.clientAccountBindings.length === 0)
              throw this.clientAccountUnavailable();
            const pushedAt = new Date();
            const changed = await transaction.lead.updateMany({
              where: {
                id,
                departmentId: actor.departmentId,
                version: input.expectedVersion,
                status: 'WAITING_PUSH',
              },
              data: {
                status: 'WAITING_REVIEW',
                pushedAt,
                pushedByUserId: actor.userId,
                version: { increment: 1 },
              },
            });
            if (changed.count !== 1) throw this.versionConflict();
            await transaction.auditEvent.create({
              data: {
                departmentId: actor.departmentId,
                actorUserId: actor.userId,
                resourceType: 'lead',
                resourceId: id,
                action: 'lead.pushed',
                details: {
                  fromVersion: input.expectedVersion,
                  toVersion: input.expectedVersion + 1,
                },
              },
            });
            const result: LeadPushResponse = {
              id,
              businessNo: current.businessNo,
              status: 'WAITING_REVIEW',
              version: input.expectedVersion + 1,
              pushedAt: pushedAt.toISOString(),
              pushedByUserId: actor.userId,
              pushedByDisplayName: pusher.displayName,
            };
            await transaction.leadCommandReceipt.create({
              data: {
                departmentId: actor.departmentId,
                actorUserId: actor.userId,
                action: 'push',
                idempotencyKey,
                requestFingerprint: fingerprint,
                resultLeadId: id,
                resultLeadVersion: result.version,
                resultSnapshot: result,
              },
            });
            return result;
          },
          { isolationLevel: 'Serializable' },
        );
      } catch (error) {
        if (this.isSerializationConflict(error)) {
          if (attempt < MAX_SERIALIZABLE_ATTEMPTS) continue;
          throw this.versionConflict();
        }
        if (this.isUnique(error)) {
          const receipt = await this.database.leadCommandReceipt.findUnique({
            where: this.receiptWhere(actor, 'push', idempotencyKey),
          });
          if (receipt !== null) {
            const pusher = await this.database.userAccount.findUnique({
              where: { id: actor.userId },
              select: { displayName: true },
            });
            if (pusher !== null)
              return this.pushReceiptResult(
                actor,
                receipt,
                fingerprint,
                id,
                pusher.displayName,
              );
          }
        }
        throw this.mapAuthorization(error);
      }
    }
    throw this.versionConflict();
  }

  private async assertCustomerAndHolder(
    transaction: Prisma.TransactionClient,
    actor: ActorContext,
    customerId: string,
    rightsHolderId: string,
  ) {
    let customerScope;
    try {
      customerScope = await this.access.buildCustomerScope(
        actor,
        'customer.read',
        transaction,
      );
    } catch {
      throw this.notFound();
    }
    const customerWhere = {
      id: customerId,
      ...customerScope,
      departmentId: actor.departmentId,
      profileStatus: 'ADMITTED' as const,
    };
    const visibleCustomer = await transaction.customer.findFirst({
      where: customerWhere,
      select: { id: true },
    });
    if (visibleCustomer === null) throw this.notFound();
    const locked = await transaction.$queryRawUnsafe<
      Array<{ customer_id: string }>
    >(
      `SELECT customer."id" AS "customer_id"
       FROM "customers" customer
       JOIN "customer_rights_holder_links" link
         ON link."customer_id" = customer."id" AND link."department_id" = customer."department_id"
       WHERE customer."id" = $1::uuid AND customer."department_id" = $2::uuid
         AND customer."profile_status" = 'ADMITTED' AND link."rights_holder_id" = $3::uuid
       FOR SHARE OF customer, link`,
      customerId,
      actor.departmentId,
      rightsHolderId,
    );
    if (locked.length !== 1) throw this.notFound();
    const customer = await transaction.customer.findFirst({
      where: customerWhere,
      select: { id: true },
    });
    if (customer === null) throw this.notFound();
    const link = await transaction.customerRightsHolderLink.findFirst({
      where: { customerId, rightsHolderId, departmentId: actor.departmentId },
      select: { id: true },
    });
    if (link === null) throw this.notFound();
  }

  private normalizeBusiness(
    input: CreateLeadCommand | UpdateLeadDto,
  ): NormalizedBusiness {
    if (
      !CASE_TYPES.includes(input.caseType) ||
      !SOURCES.includes(input.source) ||
      !PLATFORMS.includes(input.platform) ||
      !Array.isArray(input.infringementTypes) ||
      input.infringementTypes.length < 1 ||
      input.infringementTypes.length > 12 ||
      new Set(input.infringementTypes).size !==
        input.infringementTypes.length ||
      input.infringementTypes.some(
        (type) => !INFRINGEMENT_TYPES.includes(type),
      ) ||
      !this.platformMatches(input.source, input.platform) ||
      !Array.isArray(input.products) ||
      input.products.length < 1 ||
      input.products.length > 100 ||
      !Array.isArray(input.leadScreenshotContentVersionIds) ||
      input.leadScreenshotContentVersionIds.length > 20 ||
      new Set(input.leadScreenshotContentVersionIds).size !==
        input.leadScreenshotContentVersionIds.length
    )
      throw this.validation();
    const shopName = this.required(input.shopName, 200);
    const foundAtDate = new Date(input.foundAt);
    if (Number.isNaN(foundAtDate.getTime())) throw this.validation();
    const products = input.products.map((product) => this.product(product));
    return {
      ...input,
      shopName,
      foundAtDate,
      shopExternalId: this.optional(input.shopExternalId, 100),
      remark: this.optional(input.remark, 5000),
      products,
    } as NormalizedBusiness;
  }

  private product(product: ProductInput) {
    const url = this.optional(product.url, 2048);
    const title = this.optional(product.title, 200);
    if (url === null && title === null) throw this.validation();
    if (url !== null) {
      try {
        const parsed = new URL(url);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
          throw this.validation();
      } catch (error) {
        if (error instanceof BadRequestException) throw error;
        throw this.validation();
      }
    }
    if (
      !Number.isInteger(product.quantity) ||
      product.quantity < 0 ||
      product.quantity > 2_147_483_647 ||
      !Number.isInteger(product.commentCount) ||
      product.commentCount < 0 ||
      product.commentCount > 2_147_483_647 ||
      typeof product.unitPrice !== 'string' ||
      !/^(0|[1-9]\d{0,15})(\.\d{1,2})?$/u.test(product.unitPrice)
    )
      throw this.validation();
    const basis =
      product.quantity > 0 ? product.quantity : product.commentCount;
    const estimatedAmount = new Prisma.Decimal(product.unitPrice)
      .mul(basis)
      .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    if (estimatedAmount.greaterThan('9999999999999999.99'))
      throw this.validation();
    return { ...product, url, title, estimatedAmount };
  }

  private platformMatches(source: LeadSource, platform: LeadPlatform) {
    return PLATFORM_OPTIONS[source].some((option) => option.value === platform);
  }

  private async allocateBusinessNo(transaction: Prisma.TransactionClient) {
    const rows = await transaction.$queryRawUnsafe<
      Array<{ sequence: number; business_date: Date | string }>
    >(
      `INSERT INTO "lead_number_counters" ("business_date", "last_value", "updated_at")
       VALUES ((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai')::date, 1, CURRENT_TIMESTAMP)
       ON CONFLICT ("business_date") DO UPDATE SET "last_value" = "lead_number_counters"."last_value" + 1, "updated_at" = CURRENT_TIMESTAMP
       WHERE "lead_number_counters"."last_value" < 999
       RETURNING "last_value" AS "sequence", "business_date"`,
    );
    const sequence = Number(rows[0]?.sequence);
    if (!Number.isInteger(sequence) || sequence < 1 || sequence > 999)
      throw this.numberExhausted();
    const businessDate = rows[0]?.business_date;
    const dateCode =
      businessDate instanceof Date
        ? businessDate.toISOString().slice(0, 10).replaceAll('-', '')
        : String(businessDate ?? '')
            .slice(0, 10)
            .replaceAll('-', '');
    if (!/^\d{8}$/u.test(dateCode)) throw this.versionConflict();
    return `LD-${dateCode}-${String(sequence).padStart(3, '0')}`;
  }

  private view(
    record: LeadRecord,
    leadScreenshotContentVersionIds: readonly string[],
  ): LeadResponse {
    return {
      id: record.id,
      businessNo: record.businessNo,
      departmentId: record.departmentId,
      customerId: record.customerId,
      rightsHolderId: record.rightsHolderId,
      responsibleUserId: record.responsibleUserId,
      teamId: record.teamId ?? null,
      status: record.status,
      caseType: record.caseType,
      infringementTypes: record.infringements.map(({ type }) => type),
      source: record.source,
      platform: record.platform,
      foundAt: record.foundAt.toISOString(),
      shopName: record.shopName,
      shopExternalId: record.shopExternalId ?? null,
      needDisclose: record.needDisclose,
      remark: record.remark ?? null,
      creationChannel: record.creationChannel,
      externalSourceRef: record.externalSourceRef ?? null,
      products: record.products.map((product) => ({
        id: product.id,
        position: product.position,
        url: product.url ?? null,
        title: product.title ?? null,
        quantity: product.quantity,
        unitPrice: this.decimal(product.unitPrice),
        commentCount: product.commentCount,
        estimatedAmount: this.decimal(product.estimatedAmount),
      })),
      leadScreenshotContentVersionIds: [...leadScreenshotContentVersionIds],
      version: record.version,
      pushedAt: record.pushedAt?.toISOString() ?? null,
      pushedByUserId: record.pushedByUserId ?? null,
      pushedByDisplayName: record.pushedBy?.displayName ?? null,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }

  private decimal(value: Prisma.Decimal) {
    return value.toFixed(2);
  }
  private async currentScreenshotIds(
    actor: ActorContext,
    leadIds: readonly string[],
  ) {
    const result = new Map<string, string[]>();
    if (leadIds.length === 0) return result;
    const versionIds = await Promise.all(
      leadIds.map((leadId) =>
        this.materials.listCurrentReferenceVersionIds(this.database, actor, {
          resourceType: 'lead',
          resourceId: leadId,
          purpose: 'LEAD_SCREENSHOT',
        }),
      ),
    );
    for (const [index, leadId] of leadIds.entries()) {
      result.set(leadId, [...(versionIds[index] ?? [])]);
    }
    return result;
  }
  private async canEdit(actor: ActorContext, lead: LeadRecord) {
    if (lead.status !== 'WAITING_PUSH') return false;
    try {
      const scope = await this.access.buildLeadScope(actor, 'lead.edit');
      return (
        (await this.database.lead.findFirst({
          where: { id: lead.id, ...scope },
          select: { id: true },
        })) !== null
      );
    } catch (error) {
      if (error instanceof ForbiddenException) return false;
      throw error;
    }
  }
  private async canPush(actor: ActorContext, lead: LeadRecord) {
    if (lead.status !== 'WAITING_PUSH') return false;
    try {
      await this.access.authorizeLead(actor, 'lead.push', {
        departmentId: lead.departmentId,
        responsibleUserId: lead.responsibleUserId,
        ...(lead.teamId === null ? {} : { teamId: lead.teamId }),
      });
      return true;
    } catch (error) {
      if (error instanceof ForbiddenException) return false;
      throw error;
    }
  }
  private responseSnapshot(response: LeadResponse): Prisma.InputJsonObject {
    return {
      id: response.id,
      businessNo: response.businessNo,
      departmentId: response.departmentId,
      customerId: response.customerId,
      rightsHolderId: response.rightsHolderId,
      responsibleUserId: response.responsibleUserId,
      teamId: response.teamId,
      status: response.status,
      caseType: response.caseType,
      infringementTypes: [...response.infringementTypes],
      source: response.source,
      platform: response.platform,
      foundAt: response.foundAt,
      shopName: response.shopName,
      shopExternalId: response.shopExternalId,
      needDisclose: response.needDisclose,
      remark: response.remark,
      creationChannel: response.creationChannel,
      externalSourceRef: response.externalSourceRef,
      products: response.products.map((product) => ({
        id: product.id,
        position: product.position,
        url: product.url,
        title: product.title,
        quantity: product.quantity,
        unitPrice: product.unitPrice,
        commentCount: product.commentCount,
        estimatedAmount: product.estimatedAmount,
      })),
      leadScreenshotContentVersionIds: [
        ...response.leadScreenshotContentVersionIds,
      ],
      version: response.version,
      pushedAt: response.pushedAt,
      pushedByUserId: response.pushedByUserId,
      pushedByDisplayName: response.pushedByDisplayName,
      createdAt: response.createdAt,
      updatedAt: response.updatedAt,
    };
  }
  private isLeadResponse(value: unknown): value is LeadResponse {
    if (value === null || typeof value !== 'object' || Array.isArray(value))
      return false;
    const candidate = value as Partial<LeadResponse>;
    return (
      typeof candidate.id === 'string' &&
      typeof candidate.businessNo === 'string' &&
      typeof candidate.departmentId === 'string' &&
      typeof candidate.customerId === 'string' &&
      typeof candidate.rightsHolderId === 'string' &&
      typeof candidate.responsibleUserId === 'string' &&
      (candidate.teamId === null || typeof candidate.teamId === 'string') &&
      LEAD_STATUSES.includes(
        candidate.status as (typeof LEAD_STATUSES)[number],
      ) &&
      typeof candidate.caseType === 'string' &&
      Array.isArray(candidate.infringementTypes) &&
      typeof candidate.source === 'string' &&
      typeof candidate.platform === 'string' &&
      typeof candidate.foundAt === 'string' &&
      typeof candidate.shopName === 'string' &&
      (candidate.shopExternalId === null ||
        typeof candidate.shopExternalId === 'string') &&
      typeof candidate.needDisclose === 'boolean' &&
      (candidate.remark === null || typeof candidate.remark === 'string') &&
      typeof candidate.creationChannel === 'string' &&
      (candidate.externalSourceRef === null ||
        typeof candidate.externalSourceRef === 'string') &&
      Array.isArray(candidate.products) &&
      candidate.products.every(
        (product) =>
          typeof product.id === 'string' &&
          Number.isInteger(product.position) &&
          (product.url === null || typeof product.url === 'string') &&
          (product.title === null || typeof product.title === 'string') &&
          Number.isInteger(product.quantity) &&
          typeof product.unitPrice === 'string' &&
          Number.isInteger(product.commentCount) &&
          typeof product.estimatedAmount === 'string',
      ) &&
      Array.isArray(candidate.leadScreenshotContentVersionIds) &&
      candidate.leadScreenshotContentVersionIds.every(
        (id) => typeof id === 'string',
      ) &&
      Number.isInteger(candidate.version) &&
      (candidate.pushedAt === null || typeof candidate.pushedAt === 'string') &&
      (candidate.pushedByUserId === null ||
        typeof candidate.pushedByUserId === 'string') &&
      (candidate.pushedByDisplayName === undefined ||
        candidate.pushedByDisplayName === null ||
        typeof candidate.pushedByDisplayName === 'string') &&
      typeof candidate.createdAt === 'string' &&
      typeof candidate.updatedAt === 'string'
    );
  }
  private fingerprint(input: unknown) {
    return createHash('sha256').update(JSON.stringify(input)).digest('hex');
  }
  private fingerprintBusiness(input: NormalizedBusiness) {
    return {
      ...input,
      foundAtDate: input.foundAtDate.toISOString(),
      products: input.products.map(({ estimatedAmount, ...product }) => ({
        ...product,
        estimatedAmount: estimatedAmount.toFixed(2),
      })),
    };
  }
  private receiptWhere(
    actor: ActorContext,
    action: string,
    idempotencyKey: string,
  ) {
    return {
      departmentId_actorUserId_action_idempotencyKey: {
        departmentId: actor.departmentId,
        actorUserId: actor.userId,
        action,
        idempotencyKey,
      },
    };
  }
  private receiptResult(
    actor: ActorContext,
    receipt: Receipt,
    fingerprint: string,
  ): LeadResponse {
    if (receipt.requestFingerprint !== fingerprint)
      throw this.idempotencyConflict();
    const snapshot = receipt.resultSnapshot;
    if (
      !this.isLeadResponse(snapshot) ||
      snapshot.id !== receipt.resultLeadId ||
      snapshot.version !== receipt.resultLeadVersion ||
      snapshot.departmentId !== actor.departmentId
    )
      throw this.corruptReceipt();
    return {
      ...snapshot,
      pushedByDisplayName: snapshot.pushedByDisplayName ?? null,
    };
  }
  private pushReceiptResult(
    actor: ActorContext,
    receipt: Receipt,
    fingerprint: string,
    leadId: string,
    fallbackDisplayName: string,
  ): LeadPushResponse {
    if (receipt.requestFingerprint !== fingerprint)
      throw this.idempotencyConflict();
    const snapshot = receipt.resultSnapshot;
    if (
      snapshot === null ||
      typeof snapshot !== 'object' ||
      Array.isArray(snapshot)
    )
      throw this.corruptReceipt();
    const result = snapshot as Record<string, unknown>;
    if (
      result.id !== leadId ||
      result.id !== receipt.resultLeadId ||
      result.status !== 'WAITING_REVIEW' ||
      result.version !== receipt.resultLeadVersion ||
      typeof result.businessNo !== 'string' ||
      typeof result.pushedAt !== 'string' ||
      typeof result.pushedByUserId !== 'string' ||
      result.pushedByUserId !== actor.userId ||
      (result.pushedByDisplayName !== undefined &&
        typeof result.pushedByDisplayName !== 'string')
    )
      throw this.corruptReceipt();
    return {
      ...(result as Omit<LeadPushResponse, 'pushedByDisplayName'>),
      pushedByDisplayName:
        typeof result.pushedByDisplayName === 'string'
          ? result.pushedByDisplayName
          : fallbackDisplayName,
    };
  }
  private changedFields(
    current: LeadRecord,
    normalized: NormalizedBusiness,
    screenshotChanged: boolean,
  ) {
    const changed: string[] = [];
    const scalarPairs: Array<[string, unknown, unknown]> = [
      ['caseType', current.caseType, normalized.caseType],
      ['source', current.source, normalized.source],
      ['platform', current.platform, normalized.platform],
      [
        'foundAt',
        current.foundAt instanceof Date
          ? current.foundAt.toISOString()
          : current.foundAt,
        normalized.foundAtDate.toISOString(),
      ],
      ['shopName', current.shopName, normalized.shopName],
      [
        'shopExternalId',
        current.shopExternalId ?? null,
        normalized.shopExternalId,
      ],
      ['needDisclose', current.needDisclose, normalized.needDisclose],
      ['remark', current.remark ?? null, normalized.remark],
    ];
    for (const [name, before, after] of scalarPairs) {
      if (before !== after) changed.push(name);
    }
    const currentProducts = current.products.map((product) => ({
      url: product.url,
      title: product.title,
      quantity: product.quantity,
      unitPrice: this.decimal(product.unitPrice),
      commentCount: product.commentCount,
    }));
    const nextProducts = normalized.products.map((product) => ({
      url: product.url,
      title: product.title,
      quantity: product.quantity,
      unitPrice: new Prisma.Decimal(product.unitPrice).toFixed(2),
      commentCount: product.commentCount,
    }));
    if (JSON.stringify(currentProducts) !== JSON.stringify(nextProducts))
      changed.push('products');
    const currentInfringements = current.infringements
      .map(({ type }) => type)
      .sort();
    const nextInfringements = [...normalized.infringementTypes].sort();
    if (
      JSON.stringify(currentInfringements) !== JSON.stringify(nextInfringements)
    )
      changed.push('infringementTypes');
    if (screenshotChanged) changed.push('leadScreenshotContentVersionIds');
    return changed;
  }
  private required(value: unknown, max: number) {
    if (typeof value !== 'string') throw this.validation();
    const result = value.normalize('NFKC').trim();
    if (!result || result.length > max) throw this.validation();
    return result;
  }
  private optional(value: unknown, max: number) {
    if (value === undefined || value === null) return null;
    const result = this.required(value, max);
    return result;
  }
  private mapAuthorization(error: unknown): unknown {
    if (error instanceof ForbiddenException) return this.actionForbidden();
    return error;
  }
  private isSerializationConflict(error: unknown): boolean {
    if (error === null || typeof error !== 'object') return false;
    const record = error as Record<string, unknown>;
    if (record.code === 'P2034') return true;
    if (record.code === 'P2010') {
      const meta = record.meta;
      const adapter =
        meta !== null &&
        typeof meta === 'object' &&
        'driverAdapterError' in meta
          ? meta.driverAdapterError
          : undefined;
      const cause =
        adapter !== null && typeof adapter === 'object' && 'cause' in adapter
          ? adapter.cause
          : undefined;
      if (
        cause !== null &&
        typeof cause === 'object' &&
        (('originalCode' in cause && cause.originalCode === '40001') ||
          ('sqlState' in cause && cause.sqlState === '40001'))
      )
        return true;
    }
    return this.isSerializationConflict(record.cause);
  }
  private isUnique(error: unknown): boolean {
    return (
      error !== null &&
      typeof error === 'object' &&
      ((error as { code?: unknown }).code === 'P2002' ||
        this.isUnique((error as { cause?: unknown }).cause))
    );
  }
  private validation() {
    return new BadRequestException({
      code: 'VALIDATION_ERROR',
      message: '请求字段不符合接口要求',
    });
  }
  private actionForbidden() {
    return new ForbiddenException({
      code: 'ACTION_FORBIDDEN',
      message: '无权执行此线索操作',
    });
  }
  private notFound() {
    return new NotFoundException({
      code: 'RESOURCE_NOT_FOUND',
      message: '线索或关联资源不存在或不可访问',
    });
  }
  private invalidState() {
    return new ConflictException({
      code: 'INVALID_STATE',
      message: '仅待推送线索可以编辑',
    });
  }
  private pushInvalidState() {
    return new ConflictException({
      code: 'INVALID_STATE',
      message: '仅待推送线索可以推送',
    });
  }
  private customerNotAdmitted() {
    return new ConflictException({
      code: 'CUSTOMER_NOT_ADMITTED',
      message: '客户已不处于准入状态',
    });
  }
  private productsRequired() {
    return new ConflictException({
      code: 'LEAD_PRODUCTS_REQUIRED',
      message: '线索至少需要一项有效商品',
    });
  }
  private clientAccountUnavailable() {
    return new ConflictException({
      code: 'CLIENT_ACCOUNT_UNAVAILABLE',
      message: '客户没有可用的已绑定账号',
    });
  }
  private versionConflict() {
    return new ConflictException({
      code: 'VERSION_CONFLICT',
      message: '线索已被他人更新，请重新加载',
    });
  }
  private idempotencyConflict() {
    return new ConflictException({
      code: 'IDEMPOTENCY_CONFLICT',
      message: '该 Idempotency-Key 已用于不同请求',
    });
  }
  private numberExhausted() {
    return new ConflictException({
      code: 'LEAD_NUMBER_EXHAUSTED',
      message: '当日线索编号已用尽',
    });
  }
  private corruptReceipt() {
    return new InternalServerErrorException({
      code: 'INTERNAL_ERROR',
      message: '线索回执数据损坏',
    });
  }
}
