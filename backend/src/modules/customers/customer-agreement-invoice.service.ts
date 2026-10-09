import { createHash, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type {
  Prisma,
  CustomerAgreementVersion,
  CustomerInvoiceProfileVersion,
} from '../../generated/prisma/client';
import type { ActorContext } from '../../access-control/actor-context';
import {
  AccessControlService,
  type CustomerAction,
} from '../../access-control/access-control.service';
import { OrganizationService } from '../../access-control/organization.service';
import { lockCustomerActorFacts } from '../../access-control/customer-actor-facts-lock';
import { DatabaseService } from '../../database/database.service';
import { MaterialService } from '../materials/material.service';
import type {
  CreateAgreementDto,
  ReviseAgreementDto,
  CreateInvoiceProfileDto,
  ReviseInvoiceProfileDto,
  CustomerDocumentVersionQueryDto,
} from './customer-agreement-invoice.dto';

type AgreementInput = CreateAgreementDto | ReviseAgreementDto;
type InvoiceInput = CreateInvoiceProfileDto | ReviseInvoiceProfileDto;
type CommandAction =
  'AGREEMENT_CREATE' | 'AGREEMENT_REVISE' | 'INVOICE_CREATE' | 'INVOICE_REVISE';
type CustomerReader = Prisma.TransactionClient | DatabaseService;

function fail(code: string, message: string): ConflictException {
  return new ConflictException({ code, message });
}
function date(value: string | null | undefined): Date | null {
  if (value === undefined || value === null) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/u.test(value) ||
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  )
    throw new BadRequestException({
      code: 'VALIDATION_ERROR',
      message: '协议日期无效',
    });
  return parsed;
}
function isoDay(value: Date | null): string | null {
  return value?.toISOString().slice(0, 10) ?? null;
}
function fingerprint(
  action: CommandAction,
  customerId: string,
  targetId: string | null,
  input: AgreementInput | InvoiceInput,
): string {
  const values = Object.fromEntries(
    Object.entries(input).sort(([a], [b]) => a.localeCompare(b)),
  );
  return createHash('sha256')
    .update(JSON.stringify({ action, customerId, targetId, values }))
    .digest('hex');
}
function retryable(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false;
  const candidate = error as {
    code?: unknown;
    cause?: unknown;
    meta?: {
      code?: unknown;
      databaseErrorCode?: unknown;
      driverAdapterError?: {
        cause?: { originalCode?: unknown; sqlState?: unknown };
      };
    };
  };
  return (
    ['P2034', '55P03', '40001', '40P01'].some((code) =>
      [
        candidate.code,
        candidate.meta?.code,
        candidate.meta?.databaseErrorCode,
        candidate.meta?.driverAdapterError?.cause?.originalCode,
        candidate.meta?.driverAdapterError?.cause?.sqlState,
      ].includes(code),
    ) || retryable(candidate.cause)
  );
}
function receiptCollision(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false;
  const candidate = error as {
    code?: unknown;
    cause?: unknown;
    meta?: {
      modelName?: unknown;
      driverAdapterError?: { cause?: { constraint?: { index?: unknown } } };
    };
  };
  return (
    (candidate.code === 'P2002' &&
      candidate.meta?.modelName === 'CustomerAgreementInvoiceReceipt' &&
      candidate.meta.driverAdapterError?.cause?.constraint?.index ===
        'customer_agreement_invoice_receipts_actor_key') ||
    receiptCollision(candidate.cause)
  );
}

@Injectable()
export class CustomerAgreementInvoiceService {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: AccessControlService,
    private readonly organization: OrganizationService,
    private readonly materials: MaterialService,
  ) {}

  private notFound(): NotFoundException {
    return new NotFoundException({
      code: 'RESOURCE_NOT_FOUND',
      message: '客户或资料不存在或不可访问',
    });
  }

  private async visibleCustomer(
    reader: CustomerReader,
    actor: ActorContext,
    customerId: string,
    action: 'agreement' | 'invoice',
    edit: boolean,
  ) {
    const actions: CustomerAction[] = [
      'customer.read',
      `customer.${action}.read`,
    ];
    if (edit) actions.push(`customer.${action}.edit`);
    const scopes = await Promise.all(
      actions.map((permission) =>
        this.access.buildCustomerScope(actor, permission, reader),
      ),
    );
    const customer = await reader.customer.findFirst({
      where: {
        id: customerId,
        departmentId: actor.departmentId,
        deletedAt: null,
        AND: scopes,
      },
      select: {
        id: true,
        departmentId: true,
        responsibleUserId: true,
        teamId: true,
        version: true,
      },
    });
    if (customer === null) throw this.notFound();
    return customer;
  }

  private async canEdit(
    actor: ActorContext,
    customer: {
      departmentId: string;
      responsibleUserId: string;
      teamId: string | null;
    },
    action: 'agreement' | 'invoice',
    reader: CustomerReader,
  ): Promise<boolean> {
    return this.access.canAuthorizeCustomer(
      actor,
      `customer.${action}.edit`,
      {
        departmentId: customer.departmentId,
        responsibleUserId: customer.responsibleUserId,
        ...(customer.teamId === null ? {} : { teamId: customer.teamId }),
      },
      reader,
    );
  }

  private async lockedCustomer(
    tx: Prisma.TransactionClient,
    actor: ActorContext,
    customerId: string,
    action: 'agreement' | 'invoice',
  ) {
    await lockCustomerActorFacts(tx, this.organization, actor);
    await this.visibleCustomer(tx, actor, customerId, action, true);
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM customers WHERE id = ${customerId}::uuid AND department_id = ${actor.departmentId}::uuid FOR UPDATE`;
    if (locked.length !== 1) throw this.notFound();
    return this.visibleCustomer(tx, actor, customerId, action, true);
  }

  private async agreementVersion(
    reader: CustomerReader,
    row: CustomerAgreementVersion,
  ) {
    const refs =
      row.contentVersionIds.length === 0
        ? []
        : await reader.materialReference.findMany({
            where: {
              departmentId: row.departmentId,
              resourceType: 'customer_agreement_version',
              resourceId: row.id,
              purpose: 'CUSTOMER_AGREEMENT',
              contentVersionId: { in: row.contentVersionIds },
            },
            select: {
              materialId: true,
              contentVersionId: true,
              contentVersion: {
                select: { originalFilename: true, mimeType: true },
              },
            },
          });
    const byId = new Map(refs.map((ref) => [ref.contentVersionId, ref]));
    return {
      id: row.id,
      agreementId: row.agreementId,
      customerId: row.customerId,
      departmentId: row.departmentId,
      version: row.version,
      title: row.title,
      model: row.model,
      settlementMethod: row.settlementMethod,
      validityMode: row.validityMode,
      effectiveFrom: isoDay(row.effectiveFrom),
      effectiveTo: isoDay(row.effectiveTo),
      contentVersionIds: row.contentVersionIds,
      files: row.contentVersionIds.map((id) => {
        const ref = byId.get(id);
        if (!ref) throw new Error('Frozen agreement reference missing');
        return {
          materialId: ref.materialId,
          contentVersionId: id,
          originalFilename: ref.contentVersion.originalFilename,
          mimeType: ref.contentVersion.mimeType,
        };
      }),
      recordedByUserId: row.recordedByUserId,
      recordedAt: row.recordedAt.toISOString(),
      auditEventId: row.auditEventId,
    };
  }

  private invoiceVersion(row: CustomerInvoiceProfileVersion) {
    return {
      id: row.id,
      profileId: row.profileId,
      customerId: row.customerId,
      departmentId: row.departmentId,
      version: row.version,
      invoiceType: row.invoiceType,
      invoiceSubject: row.invoiceSubject,
      taxNo: row.taxNo,
      bank: row.bank,
      recordedByUserId: row.recordedByUserId,
      recordedAt: row.recordedAt.toISOString(),
      auditEventId: row.auditEventId,
    };
  }

  async getAgreement(
    actor: ActorContext,
    customerId: string,
    agreementId?: string,
  ) {
    const customer = await this.visibleCustomer(
      this.database,
      actor,
      customerId,
      'agreement',
      false,
    );
    const agreement = await this.database.customerAgreement.findFirst({
      where: {
        customerId,
        departmentId: actor.departmentId,
        ...(agreementId ? { id: agreementId } : {}),
      },
    });
    if (agreementId && !agreement) throw this.notFound();
    const currentVersion = agreement?.currentVersionId
      ? await this.database.customerAgreementVersion.findUnique({
          where: { id: agreement.currentVersionId },
        })
      : null;
    return {
      agreement:
        agreement && currentVersion
          ? {
              id: agreement.id,
              version: agreement.version,
              currentVersion: await this.agreementVersion(
                this.database,
                currentVersion,
              ),
            }
          : null,
      canEdit: await this.canEdit(actor, customer, 'agreement', this.database),
      customerVersion: customer.version,
    };
  }

  async agreementVersions(
    actor: ActorContext,
    customerId: string,
    agreementId: string,
    query: CustomerDocumentVersionQueryDto,
  ) {
    await this.visibleCustomer(
      this.database,
      actor,
      customerId,
      'agreement',
      false,
    );
    const agreement = await this.database.customerAgreement.findFirst({
      where: { id: agreementId, customerId, departmentId: actor.departmentId },
      select: { id: true },
    });
    if (!agreement) throw this.notFound();
    const where = { agreementId, customerId, departmentId: actor.departmentId };
    const [rows, total] = await Promise.all([
      this.database.customerAgreementVersion.findMany({
        where,
        orderBy: [{ version: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.database.customerAgreementVersion.count({ where }),
    ]);
    return {
      items: await Promise.all(
        rows.map((row) => this.agreementVersion(this.database, row)),
      ),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async getInvoice(actor: ActorContext, customerId: string) {
    const customer = await this.visibleCustomer(
      this.database,
      actor,
      customerId,
      'invoice',
      false,
    );
    const profile = await this.database.customerInvoiceProfile.findFirst({
      where: { customerId, departmentId: actor.departmentId },
    });
    const version = profile?.currentVersionId
      ? await this.database.customerInvoiceProfileVersion.findUnique({
          where: { id: profile.currentVersionId },
        })
      : null;
    return {
      profile:
        profile && version
          ? {
              id: profile.id,
              version: profile.version,
              currentVersion: this.invoiceVersion(version),
            }
          : null,
      canEdit: await this.canEdit(actor, customer, 'invoice', this.database),
      customerVersion: customer.version,
    };
  }

  async invoiceVersions(
    actor: ActorContext,
    customerId: string,
    query: CustomerDocumentVersionQueryDto,
  ) {
    await this.visibleCustomer(
      this.database,
      actor,
      customerId,
      'invoice',
      false,
    );
    const profile = await this.database.customerInvoiceProfile.findFirst({
      where: { customerId, departmentId: actor.departmentId },
      select: { id: true },
    });
    if (!profile)
      return {
        items: [],
        total: 0,
        page: query.page,
        pageSize: query.pageSize,
      };
    const where = {
      profileId: profile.id,
      customerId,
      departmentId: actor.departmentId,
    };
    const [rows, total] = await Promise.all([
      this.database.customerInvoiceProfileVersion.findMany({
        where,
        orderBy: [{ version: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.database.customerInvoiceProfileVersion.count({ where }),
    ]);
    return {
      items: rows.map((row) => this.invoiceVersion(row)),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  createAgreement(
    actor: ActorContext,
    customerId: string,
    key: string,
    input: CreateAgreementDto,
  ) {
    return this.agreementCommand(
      actor,
      customerId,
      null,
      key,
      'AGREEMENT_CREATE',
      input,
    );
  }
  reviseAgreement(
    actor: ActorContext,
    customerId: string,
    agreementId: string,
    key: string,
    input: ReviseAgreementDto,
  ) {
    return this.agreementCommand(
      actor,
      customerId,
      agreementId,
      key,
      'AGREEMENT_REVISE',
      input,
    );
  }
  createInvoice(
    actor: ActorContext,
    customerId: string,
    key: string,
    input: CreateInvoiceProfileDto,
  ) {
    return this.invoiceCommand(actor, customerId, key, 'INVOICE_CREATE', input);
  }
  reviseInvoice(
    actor: ActorContext,
    customerId: string,
    key: string,
    input: ReviseInvoiceProfileDto,
  ) {
    return this.invoiceCommand(actor, customerId, key, 'INVOICE_REVISE', input);
  }

  private async runCommand<T>(
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      try {
        return await this.database.$transaction(work, {
          isolationLevel: 'Serializable',
          timeout: 15000,
        });
      } catch (error) {
        if (receiptCollision(error)) {
          if (attempt === 5)
            throw fail('CUSTOMER_IDEMPOTENCY_CONFLICT', '幂等键已用于不同请求');
          continue;
        }
        if (!retryable(error)) throw error;
        if (attempt === 5)
          throw new ServiceUnavailableException({
            code: 'BUSY',
            message: '资料维护繁忙，请保留原请求重试',
          });
      }
    }
    throw new Error('Unreachable command retry state');
  }

  private async receipt(
    tx: Prisma.TransactionClient,
    actor: ActorContext,
    customerId: string,
    action: CommandAction,
    key: string,
    hash: string,
  ) {
    const found = await tx.customerAgreementInvoiceReceipt.findUnique({
      where: {
        departmentId_actorUserId_action_idempotencyKey: {
          departmentId: actor.departmentId,
          actorUserId: actor.userId,
          action,
          idempotencyKey: key,
        },
      },
    });
    if (
      found &&
      (found.customerId !== customerId || found.requestFingerprint !== hash)
    )
      throw fail('CUSTOMER_IDEMPOTENCY_CONFLICT', '幂等键已用于不同请求');
    return found?.resultSnapshot ?? null;
  }

  private async agreementCommand(
    actor: ActorContext,
    customerId: string,
    agreementId: string | null,
    key: string,
    action: 'AGREEMENT_CREATE' | 'AGREEMENT_REVISE',
    input: AgreementInput,
  ) {
    const hash = fingerprint(action, customerId, agreementId, input);
    return this.runCommand(async (tx) => {
      const customer = await this.lockedCustomer(
        tx,
        actor,
        customerId,
        'agreement',
      );
      const previousResult = await this.receipt(
        tx,
        actor,
        customerId,
        action,
        key,
        hash,
      );
      if (previousResult !== null) return previousResult;
      if (customer.version !== input.expectedCustomerVersion)
        throw fail('CUSTOMER_VERSION_CONFLICT', '客户版本已变化');
      const agreement = await tx.customerAgreement.findFirst({
        where: { customerId, departmentId: actor.departmentId },
      });
      if (action === 'AGREEMENT_CREATE' && agreement)
        throw fail('AGREEMENT_EXISTS', '客户协议已存在');
      if (
        action === 'AGREEMENT_REVISE' &&
        (!agreement ||
          agreement.id !== agreementId ||
          agreement.version !==
            (input as ReviseAgreementDto).expectedAgreementVersion)
      )
        throw fail('AGREEMENT_VERSION_CONFLICT', '协议版本已变化');
      const prior = agreement?.currentVersionId
        ? await tx.customerAgreementVersion.findUnique({
            where: { id: agreement.currentVersionId },
          })
        : null;
      const title = input.title ?? prior?.title;
      const validityMode = input.validityMode ?? prior?.validityMode;
      if (!title || !validityMode)
        throw new BadRequestException({
          code: 'VALIDATION_ERROR',
          message: '协议字段不完整',
        });
      const effectiveFrom =
        input.effectiveFrom === undefined
          ? (prior?.effectiveFrom ?? null)
          : date(input.effectiveFrom);
      const effectiveTo =
        input.effectiveTo === undefined
          ? (prior?.effectiveTo ?? null)
          : date(input.effectiveTo);
      if (
        (validityMode === 'FIXED' && effectiveTo === null) ||
        (validityMode !== 'FIXED' && effectiveTo !== null) ||
        (effectiveFrom && effectiveTo && effectiveFrom > effectiveTo)
      )
        throw new BadRequestException({
          code: 'VALIDATION_ERROR',
          message: '协议期限无效',
        });
      const ids = input.contentVersionIds ?? prior?.contentVersionIds ?? [];
      if (ids.length > 10 || new Set(ids).size !== ids.length)
        throw new BadRequestException({
          code: 'VALIDATION_ERROR',
          message: '协议材料版本重复或超限',
        });
      const facts = ids.length
        ? await this.materials.assertAvailableVersions(tx, actor, {
            ownerType: 'CUSTOMER',
            ownerId: customerId,
            category: 'CUSTOMER_AGREEMENT',
            contentVersionIds: ids,
            minCount: 0,
            maxCount: 10,
          })
        : [];
      if (facts.some((fact) => fact.purpose !== 'CUSTOMER_AGREEMENT'))
        throw fail('MATERIAL_VERSION_CONFLICT', '协议材料用途不符');
      const changed = await tx.customer.updateMany({
        where: {
          id: customerId,
          version: input.expectedCustomerVersion,
          deletedAt: null,
        },
        data: { version: { increment: 1 } },
      });
      if (changed.count !== 1)
        throw fail('CUSTOMER_VERSION_CONFLICT', '客户版本已变化');
      const stableId = agreement?.id ?? randomUUID();
      const versionId = randomUUID();
      const versionNumber = (agreement?.version ?? 0) + 1;
      if (!agreement)
        await tx.customerAgreement.create({
          data: {
            id: stableId,
            customerId,
            departmentId: actor.departmentId,
            version: 1,
          },
        });
      const audit = await tx.auditEvent.create({
        data: {
          departmentId: actor.departmentId,
          actorUserId: actor.userId,
          resourceType: 'customer_agreement',
          resourceId: stableId,
          action: agreement
            ? 'customer.agreement.revised'
            : 'customer.agreement.created',
          details: { version: versionNumber },
        },
      });
      const created = await tx.customerAgreementVersion.create({
        data: {
          id: versionId,
          agreementId: stableId,
          customerId,
          departmentId: actor.departmentId,
          version: versionNumber,
          title,
          model:
            input.model === undefined ? (prior?.model ?? null) : input.model,
          settlementMethod:
            input.settlementMethod === undefined
              ? (prior?.settlementMethod ?? null)
              : input.settlementMethod,
          validityMode,
          effectiveFrom,
          effectiveTo,
          contentVersionIds: ids,
          recordedByUserId: actor.userId,
          auditEventId: audit.id,
        },
      });
      if (facts.length)
        await this.materials.freezeReferences(tx, {
          departmentId: actor.departmentId,
          resourceType: 'customer_agreement_version',
          resourceId: versionId,
          facts,
          actionEventId: audit.id,
        });
      const updated = await tx.customerAgreement.updateMany({
        where: {
          id: stableId,
          customerId,
          departmentId: actor.departmentId,
          version: agreement?.version ?? 1,
        },
        data: {
          currentVersionId: versionId,
          ...(agreement ? { version: { increment: 1 } } : {}),
        },
      });
      if (updated.count !== 1)
        throw fail('AGREEMENT_VERSION_CONFLICT', '协议版本已变化');
      const result = {
        agreement: {
          id: stableId,
          version: versionNumber,
          currentVersion: await this.agreementVersion(tx, created),
        },
        canEdit: true,
        customerVersion: customer.version + 1,
      };
      await tx.customerAgreementInvoiceReceipt.create({
        data: {
          departmentId: actor.departmentId,
          actorUserId: actor.userId,
          action,
          idempotencyKey: key,
          requestFingerprint: hash,
          customerId,
          resultSnapshot: result as Prisma.InputJsonObject,
        },
      });
      return result;
    });
  }

  private async invoiceCommand(
    actor: ActorContext,
    customerId: string,
    key: string,
    action: 'INVOICE_CREATE' | 'INVOICE_REVISE',
    input: InvoiceInput,
  ) {
    const hash = fingerprint(action, customerId, null, input);
    return this.runCommand(async (tx) => {
      const customer = await this.lockedCustomer(
        tx,
        actor,
        customerId,
        'invoice',
      );
      const previousResult = await this.receipt(
        tx,
        actor,
        customerId,
        action,
        key,
        hash,
      );
      if (previousResult !== null) return previousResult;
      if (customer.version !== input.expectedCustomerVersion)
        throw fail('CUSTOMER_VERSION_CONFLICT', '客户版本已变化');
      const profile = await tx.customerInvoiceProfile.findFirst({
        where: { customerId, departmentId: actor.departmentId },
      });
      if (action === 'INVOICE_CREATE' && profile)
        throw fail('INVOICE_EXISTS', '开票资料已存在');
      if (
        action === 'INVOICE_REVISE' &&
        (!profile ||
          profile.version !==
            (input as ReviseInvoiceProfileDto).expectedInvoiceVersion)
      )
        throw fail('INVOICE_VERSION_CONFLICT', '开票资料版本已变化');
      const prior = profile?.currentVersionId
        ? await tx.customerInvoiceProfileVersion.findUnique({
            where: { id: profile.currentVersionId },
          })
        : null;
      const changed = await tx.customer.updateMany({
        where: {
          id: customerId,
          version: input.expectedCustomerVersion,
          deletedAt: null,
        },
        data: { version: { increment: 1 } },
      });
      if (changed.count !== 1)
        throw fail('CUSTOMER_VERSION_CONFLICT', '客户版本已变化');
      const stableId = profile?.id ?? randomUUID();
      const versionId = randomUUID();
      const versionNumber = (profile?.version ?? 0) + 1;
      if (!profile)
        await tx.customerInvoiceProfile.create({
          data: {
            id: stableId,
            customerId,
            departmentId: actor.departmentId,
            version: 1,
          },
        });
      const audit = await tx.auditEvent.create({
        data: {
          departmentId: actor.departmentId,
          actorUserId: actor.userId,
          resourceType: 'customer_invoice_profile',
          resourceId: stableId,
          action: profile
            ? 'customer.invoice.revised'
            : 'customer.invoice.created',
          details: { version: versionNumber },
        },
      });
      const created = await tx.customerInvoiceProfileVersion.create({
        data: {
          id: versionId,
          profileId: stableId,
          customerId,
          departmentId: actor.departmentId,
          version: versionNumber,
          invoiceType:
            input.invoiceType === undefined
              ? (prior?.invoiceType ?? null)
              : input.invoiceType,
          invoiceSubject:
            input.invoiceSubject === undefined
              ? (prior?.invoiceSubject ?? null)
              : input.invoiceSubject,
          taxNo:
            input.taxNo === undefined ? (prior?.taxNo ?? null) : input.taxNo,
          bank: input.bank === undefined ? (prior?.bank ?? null) : input.bank,
          recordedByUserId: actor.userId,
          auditEventId: audit.id,
        },
      });
      const updated = await tx.customerInvoiceProfile.updateMany({
        where: {
          id: stableId,
          customerId,
          departmentId: actor.departmentId,
          version: profile?.version ?? 1,
        },
        data: {
          currentVersionId: versionId,
          ...(profile ? { version: { increment: 1 } } : {}),
        },
      });
      if (updated.count !== 1)
        throw fail('INVOICE_VERSION_CONFLICT', '开票资料版本已变化');
      const result = {
        profile: {
          id: stableId,
          version: versionNumber,
          currentVersion: this.invoiceVersion(created),
        },
        canEdit: true,
        customerVersion: customer.version + 1,
      };
      await tx.customerAgreementInvoiceReceipt.create({
        data: {
          departmentId: actor.departmentId,
          actorUserId: actor.userId,
          action,
          idempotencyKey: key,
          requestFingerprint: hash,
          customerId,
          resultSnapshot: result as Prisma.InputJsonObject,
        },
      });
      return result;
    });
  }
}
