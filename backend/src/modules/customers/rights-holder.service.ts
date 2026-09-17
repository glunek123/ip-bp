import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  AccessControlService,
  CustomerScopePredicate,
} from '../../access-control/access-control.service';
import { ActorContext } from '../../access-control/actor-context';
import { DatabaseService } from '../../database/database.service';
import type { Prisma } from '../../generated/prisma/client';
import {
  CreateAndLinkRightsHolderDto,
  LinkExistingRightsHolderDto,
} from './rights-holder.dto';

type RightsHolderRecord = {
  id: string;
  name: string;
  credit: string | null;
  address: string | null;
  legalRepresentative: string | null;
  duty: string | null;
  updatedAt: Date;
};

export type RightsHolderSummary = {
  id: string;
  name: string;
  credit: string | null;
  address: string | null;
  legalRepresentative: string | null;
  duty: string | null;
  updatedAt: string;
};

export type RightsHolderCommandResult = {
  holder: RightsHolderSummary;
  linkId: string;
  customerVersion: number;
};

type CommandAction = 'create-and-link' | 'link-existing';

type ReceiptResult = {
  requestFingerprint: string;
  resultHolderId: string;
  resultLinkId: string;
  resultCustomerVersion: number;
};

const holderSelect = {
  id: true,
  name: true,
  credit: true,
  address: true,
  legalRepresentative: true,
  duty: true,
  updatedAt: true,
} as const;

@Injectable()
export class RightsHolderService {
  constructor(
    private readonly database: DatabaseService,
    private readonly accessControl: AccessControlService,
  ) {}

  async createAndLink(
    actor: ActorContext,
    customerId: string,
    idempotencyKey: string,
    input: CreateAndLinkRightsHolderDto,
  ): Promise<RightsHolderCommandResult> {
    const normalized = {
      expectedCustomerVersion: input.expectedCustomerVersion,
      name: this.requiredName(input.name),
      credit: this.optional(input.credit),
      address: this.optional(input.address),
      legalRepresentative: this.optional(input.legalRepresentative),
      duty: this.optional(input.duty),
    };
    const action: CommandAction = 'create-and-link';
    const fingerprint = this.fingerprint({
      action,
      customerId,
      ...normalized,
    });
    const editScope = await this.accessControl.buildCustomerScope(
      actor,
      'customer.edit-routine',
    );

    try {
      return await this.database.$transaction(async (transaction) => {
        const target = await transaction.customer.findFirst({
          where: { id: customerId, ...editScope },
          select: { id: true },
        });
        if (target === null) throw this.customerNotFound();

        const receipt = await transaction.rightsHolderCommandReceipt.findUnique(
          {
            where: this.receiptWhere(actor, action, idempotencyKey),
          },
        );
        if (receipt !== null) {
          return await this.rebuildReceiptResult(
            transaction,
            actor,
            receipt,
            fingerprint,
          );
        }

        await this.incrementCustomerVersion(
          transaction,
          actor,
          customerId,
          normalized.expectedCustomerVersion,
        );
        const created = await transaction.rightsHolder.create({
          data: {
            departmentId: actor.departmentId,
            name: normalized.name,
            credit: normalized.credit,
            address: normalized.address,
            legalRepresentative: normalized.legalRepresentative,
            duty: normalized.duty,
          },
        });
        const link = await transaction.customerRightsHolderLink.create({
          data: {
            customerId,
            rightsHolderId: created.id,
            departmentId: actor.departmentId,
          },
        });
        const customerVersion = normalized.expectedCustomerVersion + 1;
        await transaction.auditEvent.create({
          data: {
            departmentId: actor.departmentId,
            actorUserId: actor.userId,
            resourceType: 'rights-holder',
            resourceId: created.id,
            action: 'rights-holder.created',
            details: { rightsHolderId: created.id },
          },
        });
        await transaction.auditEvent.create({
          data: {
            departmentId: actor.departmentId,
            actorUserId: actor.userId,
            resourceType: 'customer',
            resourceId: customerId,
            action: 'customer.rights-holder-linked',
            details: {
              customerId,
              rightsHolderId: created.id,
              linkId: link.id,
              customerVersion,
            },
          },
        });
        await transaction.rightsHolderCommandReceipt.create({
          data: {
            departmentId: actor.departmentId,
            actorUserId: actor.userId,
            action,
            idempotencyKey,
            requestFingerprint: fingerprint,
            resultHolderId: created.id,
            resultLinkId: link.id,
            resultCustomerId: customerId,
            resultCustomerVersion: customerVersion,
          },
        });
        return {
          holder: this.toSummary(created),
          linkId: link.id,
          customerVersion,
        };
      });
    } catch (error) {
      return await this.recoverCommandRace(
        error,
        actor,
        action,
        idempotencyKey,
        fingerprint,
        false,
      );
    }
  }

  async linkExisting(
    actor: ActorContext,
    customerId: string,
    idempotencyKey: string,
    input: LinkExistingRightsHolderDto,
  ): Promise<RightsHolderCommandResult> {
    const action: CommandAction = 'link-existing';
    const fingerprint = this.fingerprint({
      action,
      customerId,
      expectedCustomerVersion: input.expectedCustomerVersion,
      rightsHolderId: input.rightsHolderId,
    });
    const [editScope, readScope] = await Promise.all([
      this.accessControl.buildCustomerScope(actor, 'customer.edit-routine'),
      this.accessControl.tryBuildCustomerScope(actor, 'customer.read'),
    ]);

    try {
      return await this.database.$transaction(async (transaction) => {
        const target = await transaction.customer.findFirst({
          where: { id: customerId, ...editScope },
          select: { id: true },
        });
        if (target === null) throw this.customerNotFound();

        const receipt = await transaction.rightsHolderCommandReceipt.findUnique(
          {
            where: this.receiptWhere(actor, action, idempotencyKey),
          },
        );
        if (receipt !== null) {
          return await this.rebuildReceiptResult(
            transaction,
            actor,
            receipt,
            fingerprint,
            readScope,
          );
        }

        const visibleHolder =
          readScope === null
            ? null
            : await transaction.rightsHolder.findFirst({
                where: {
                  id: input.rightsHolderId,
                  departmentId: actor.departmentId,
                  links: { some: { customer: readScope } },
                },
                select: holderSelect,
              });
        if (visibleHolder === null) throw this.holderNotFound();

        const existing = await transaction.customerRightsHolderLink.findUnique({
          where: {
            customerId_rightsHolderId: {
              customerId,
              rightsHolderId: input.rightsHolderId,
            },
          },
          select: { id: true },
        });
        if (existing !== null) throw this.alreadyLinked();

        const updated = await transaction.customer.updateMany({
          where: {
            id: customerId,
            departmentId: actor.departmentId,
            version: input.expectedCustomerVersion,
          },
          data: { version: { increment: 1 } },
        });
        if (updated.count !== 1) {
          const concurrentlyLinked =
            await transaction.customerRightsHolderLink.findUnique({
              where: {
                customerId_rightsHolderId: {
                  customerId,
                  rightsHolderId: input.rightsHolderId,
                },
              },
              select: { id: true },
            });
          if (concurrentlyLinked !== null) throw this.alreadyLinked();
          throw this.versionConflict();
        }
        const link = await transaction.customerRightsHolderLink.create({
          data: {
            customerId,
            rightsHolderId: input.rightsHolderId,
            departmentId: actor.departmentId,
          },
        });
        const customerVersion = input.expectedCustomerVersion + 1;
        await transaction.auditEvent.create({
          data: {
            departmentId: actor.departmentId,
            actorUserId: actor.userId,
            resourceType: 'customer',
            resourceId: customerId,
            action: 'customer.rights-holder-linked',
            details: {
              customerId,
              rightsHolderId: visibleHolder.id,
              linkId: link.id,
              customerVersion,
            },
          },
        });
        await transaction.rightsHolderCommandReceipt.create({
          data: {
            departmentId: actor.departmentId,
            actorUserId: actor.userId,
            action,
            idempotencyKey,
            requestFingerprint: fingerprint,
            resultHolderId: visibleHolder.id,
            resultLinkId: link.id,
            resultCustomerId: customerId,
            resultCustomerVersion: customerVersion,
          },
        });
        return {
          holder: this.toSummary(visibleHolder),
          linkId: link.id,
          customerVersion,
        };
      });
    } catch (error) {
      return await this.recoverCommandRace(
        error,
        actor,
        action,
        idempotencyKey,
        fingerprint,
        true,
        readScope,
      );
    }
  }

  async list(
    actor: ActorContext,
    customerId: string,
    page: number,
    pageSize: number,
  ): Promise<{
    items: RightsHolderSummary[];
    total: number;
    page: number;
    pageSize: number;
    capabilities: { create: boolean; link: boolean };
  }> {
    const [readScope, editScope] = await Promise.all([
      this.accessControl.buildCustomerScope(actor, 'customer.read'),
      this.accessControl.tryBuildCustomerScope(actor, 'customer.edit-routine'),
    ]);
    const target = await this.database.customer.findFirst({
      where: { id: customerId, ...readScope },
      select: { id: true },
    });
    if (target === null) throw this.customerNotFound();

    const canEdit =
      editScope !== null &&
      (await this.database.customer.findFirst({
        where: { id: customerId, ...editScope },
        select: { id: true },
      })) !== null;
    const where = {
      departmentId: actor.departmentId,
      links: { some: { customerId } },
    };
    const [holders, total] = await this.database.$transaction([
      this.database.rightsHolder.findMany({
        where,
        select: holderSelect,
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.database.rightsHolder.count({ where }),
    ]);
    return {
      items: holders.map((item) => this.toSummary(item)),
      total,
      page,
      pageSize,
      capabilities: { create: canEdit, link: canEdit },
    };
  }

  async get(
    actor: ActorContext,
    customerId: string,
    rightsHolderId: string,
  ): Promise<RightsHolderSummary> {
    const readScope = await this.accessControl.buildCustomerScope(
      actor,
      'customer.read',
    );
    const target = await this.database.customer.findFirst({
      where: { id: customerId, ...readScope },
      select: { id: true },
    });
    if (target === null) throw this.customerNotFound();
    const item = await this.database.rightsHolder.findFirst({
      where: {
        id: rightsHolderId,
        departmentId: actor.departmentId,
        links: { some: { customerId } },
      },
      select: holderSelect,
    });
    if (item === null) throw this.holderNotFound();
    return this.toSummary(item);
  }

  async findLinkable(
    actor: ActorContext,
    customerId: string,
    query: string | undefined,
    page: number,
    pageSize: number,
  ): Promise<{
    items: RightsHolderSummary[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const readScope = await this.accessControl.buildCustomerScope(
      actor,
      'customer.read',
    );
    const target = await this.database.customer.findFirst({
      where: { id: customerId, ...readScope },
      select: { id: true },
    });
    if (target === null) throw this.customerNotFound();
    const normalizedQuery = this.optional(query);
    const where = {
      departmentId: actor.departmentId,
      links: { some: { customer: readScope } },
      NOT: { links: { some: { customerId } } },
      ...(normalizedQuery === null
        ? {}
        : {
            name: { contains: normalizedQuery, mode: 'insensitive' as const },
          }),
    };
    const [holders, total] = await this.database.$transaction([
      this.database.rightsHolder.findMany({
        where,
        select: holderSelect,
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.database.rightsHolder.count({ where }),
    ]);
    return {
      items: holders.map((item) => this.toSummary(item)),
      total,
      page,
      pageSize,
    };
  }

  private async incrementCustomerVersion(
    transaction: Parameters<Parameters<DatabaseService['$transaction']>[0]>[0],
    actor: ActorContext,
    customerId: string,
    expectedVersion: number,
  ): Promise<void> {
    const updated = await transaction.customer.updateMany({
      where: {
        id: customerId,
        departmentId: actor.departmentId,
        version: expectedVersion,
      },
      data: { version: { increment: 1 } },
    });
    if (updated.count !== 1) throw this.versionConflict();
  }

  private async recoverCommandRace(
    error: unknown,
    actor: ActorContext,
    action: CommandAction,
    idempotencyKey: string,
    fingerprint: string,
    mapUnclaimedUniqueToAlreadyLinked: boolean,
    readScope?: CustomerScopePredicate | null,
  ): Promise<RightsHolderCommandResult> {
    const uniqueConstraint = this.isUniqueConstraintError(error);
    const alreadyLinked = this.isAlreadyLinked(error);
    if (
      !uniqueConstraint &&
      !this.isVersionConflict(error) &&
      !(mapUnclaimedUniqueToAlreadyLinked && alreadyLinked)
    ) {
      throw error;
    }
    const receipt = await this.database.rightsHolderCommandReceipt.findUnique({
      where: this.receiptWhere(actor, action, idempotencyKey),
    });
    if (receipt !== null) {
      return await this.rebuildReceiptResult(
        this.database,
        actor,
        receipt,
        fingerprint,
        readScope,
      );
    }
    if (
      mapUnclaimedUniqueToAlreadyLinked &&
      (uniqueConstraint || alreadyLinked)
    ) {
      throw this.alreadyLinked();
    }
    throw error;
  }

  private async rebuildReceiptResult(
    reader: DatabaseService | Prisma.TransactionClient,
    actor: ActorContext,
    receipt: ReceiptResult,
    fingerprint: string,
    readScope?: CustomerScopePredicate | null,
  ): Promise<RightsHolderCommandResult> {
    if (receipt.requestFingerprint !== fingerprint) {
      throw this.idempotencyConflict();
    }
    if (readScope === null) throw this.holderNotFound();
    const item = await reader.rightsHolder.findFirst({
      where: {
        id: receipt.resultHolderId,
        departmentId: actor.departmentId,
        ...(readScope === undefined
          ? {}
          : { links: { some: { customer: readScope } } }),
      },
      select: holderSelect,
    });
    if (item === null) throw this.holderNotFound();
    return {
      holder: this.toSummary(item),
      linkId: receipt.resultLinkId,
      customerVersion: receipt.resultCustomerVersion,
    };
  }

  private receiptWhere(
    actor: ActorContext,
    action: CommandAction,
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

  private fingerprint(value: Record<string, unknown>): string {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
  }

  private requiredName(value: string): string {
    const normalized = typeof value === 'string' ? value.trim() : '';
    if (normalized.length === 0) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: '权利主体名称不能为空',
      });
    }
    return normalized;
  }

  private optional(value: string | undefined): string | null {
    if (value === undefined) return null;
    const normalized = value.trim();
    return normalized.length === 0 ? null : normalized;
  }

  private toSummary(item: RightsHolderRecord): RightsHolderSummary {
    return {
      id: item.id,
      name: item.name,
      credit: item.credit,
      address: item.address,
      legalRepresentative: item.legalRepresentative,
      duty: item.duty,
      updatedAt: item.updatedAt.toISOString(),
    };
  }

  private customerNotFound(): NotFoundException {
    return new NotFoundException({
      code: 'CUSTOMER_NOT_FOUND',
      message: '客户不存在或不可访问',
    });
  }

  private holderNotFound(): NotFoundException {
    return new NotFoundException({
      code: 'RIGHTS_HOLDER_NOT_FOUND',
      message: '权利主体不存在或不可访问',
    });
  }

  private alreadyLinked(): ConflictException {
    return new ConflictException({
      code: 'RIGHTS_HOLDER_ALREADY_LINKED',
      message: '该权利主体已关联当前客户',
    });
  }

  private versionConflict(): ConflictException {
    return new ConflictException({
      code: 'CUSTOMER_VERSION_CONFLICT',
      message: '客户资料已被他人更新，请重新加载后再提交',
    });
  }

  private idempotencyConflict(): ConflictException {
    return new ConflictException({
      code: 'IDEMPOTENCY_KEY_REUSED',
      message: '该 Idempotency-Key 已用于不同请求',
    });
  }

  private isUniqueConstraintError(error: unknown): boolean {
    if (error === null || typeof error !== 'object') return false;
    const record = error as Record<string, unknown>;
    if (record.code === 'P2002') return true;
    return this.isUniqueConstraintError(record.cause);
  }

  private isVersionConflict(error: unknown): boolean {
    if (!(error instanceof ConflictException)) return false;
    const response = error.getResponse();
    return (
      response !== null &&
      typeof response === 'object' &&
      'code' in response &&
      response.code === 'CUSTOMER_VERSION_CONFLICT'
    );
  }

  private isAlreadyLinked(error: unknown): boolean {
    if (!(error instanceof ConflictException)) return false;
    const response = error.getResponse();
    return (
      response !== null &&
      typeof response === 'object' &&
      'code' in response &&
      response.code === 'RIGHTS_HOLDER_ALREADY_LINKED'
    );
  }
}
