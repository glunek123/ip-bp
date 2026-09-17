import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AccessControlService } from '../../access-control/access-control.service';
import { ActorContext } from '../../access-control/actor-context';
import { DatabaseService } from '../../database/database.service';
import {
  CreateCustomerDraftDto,
  CustomerDuplicatesQueryDto,
  UpdateCustomerDraftDto,
} from './customer.dto';

type CustomerRecord = {
  id: string;
  name: string;
  normalizedName: string;
  customerType: string | null;
  identityType: string | null;
  identityNumber: string | null;
  normalizedIdentityNumber: string | null;
  issuingCountryOrRegion: string | null;
  category: string | null;
  region: string | null;
  admissionContactName: string | null;
  admissionContactPhone: string | null;
  admissionContactEmail: string | null;
  profileStatus: 'DRAFT';
  departmentId: string;
  responsibleUserId: string;
  teamId: string | null;
  version: number;
  updatedAt: Date;
};

export type CustomerSummary = {
  id: string;
  name: string;
  customerType: string | null;
  identityType: string | null;
  identityNumber: string | null;
  issuingCountryOrRegion: string | null;
  category: string | null;
  region: string | null;
  admissionContactName: string | null;
  admissionContactPhone: string | null;
  admissionContactEmail: string | null;
  profileStatus: 'draft';
  departmentId: string;
  responsibleUserId: string;
  version: number;
  updatedAt: string;
};

export type CustomerDetail = CustomerSummary & {
  capabilities: { editRoutine: boolean };
  history: Array<{
    action: string;
    actorUserId: string;
    occurredAt: string;
  }>;
};

type NormalizedCustomerEdit = {
  name: string;
  normalizedName: string;
  customerType: string | null;
  identityType: string | null;
  identityNumber: string | null;
  normalizedIdentityNumber: string | null;
  issuingCountryOrRegion: string | null;
  category: string | null;
  region: string | null;
  admissionContactName: string | null;
  admissionContactPhone: string | null;
  admissionContactEmail: string | null;
};

const editableFields: Array<keyof NormalizedCustomerEdit> = [
  'name',
  'customerType',
  'identityType',
  'identityNumber',
  'issuingCountryOrRegion',
  'category',
  'region',
  'admissionContactName',
  'admissionContactPhone',
  'admissionContactEmail',
];

@Injectable()
export class CustomerService {
  constructor(
    private readonly database: DatabaseService,
    private readonly accessControl: AccessControlService,
  ) {}

  async createDraft(
    actor: ActorContext,
    input: CreateCustomerDraftDto,
  ): Promise<CustomerSummary> {
    const facts = await this.accessControl.authorizeNewCustomer(actor);

    const name = input.name.trim();
    const normalizedName = this.normalizeComparable(name);
    const duplicateNameReason = this.normalizeOptional(
      input.duplicateNameReason,
    );
    const admissionContact = this.normalizeAdmissionContact(input);
    const readScope = await this.accessControl.tryBuildCustomerScope(
      actor,
      'customer.read',
    );
    const customer = await this.database.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe?.(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        `${actor.departmentId}:${normalizedName}`,
      );
      const sameName =
        readScope === null
          ? null
          : await transaction.customer.findFirst({
              where: { normalizedName, ...readScope },
              select: { id: true },
            });
      if (sameName !== null) {
        if (duplicateNameReason === null) throw this.nameReasonRequired();
      }

      const created = await transaction.customer.create({
        data: {
          name,
          normalizedName,
          category: this.normalizeOptional(input.category),
          region: this.normalizeOptional(input.region),
          ...admissionContact,
          profileStatus: 'DRAFT',
          departmentId: actor.departmentId,
          responsibleUserId: actor.userId,
          teamId: facts.teamId ?? null,
        },
      });
      await transaction.auditEvent.create({
        data: {
          departmentId: actor.departmentId,
          actorUserId: actor.userId,
          resourceType: 'customer',
          resourceId: created.id,
          action: 'customer.draft-created',
          details: { customerId: created.id },
        },
      });
      if (sameName !== null && duplicateNameReason !== null) {
        await transaction.auditEvent.create({
          data: {
            departmentId: actor.departmentId,
            actorUserId: actor.userId,
            resourceType: 'customer',
            resourceId: created.id,
            action: 'customer.duplicate-name-overridden',
            details: { reason: duplicateNameReason },
          },
        });
      }
      return created;
    });

    return this.toSummary(customer);
  }

  async list(
    actor: ActorContext,
    page: number,
    pageSize: number,
  ): Promise<{
    items: CustomerSummary[];
    total: number;
    page: number;
    pageSize: number;
    capabilities: { createDraft: boolean };
  }> {
    const [where, canCreateDraft] = await Promise.all([
      this.accessControl.buildCustomerScope(actor, 'customer.read'),
      this.accessControl.canAuthorizeNewCustomer(actor),
    ]);
    const [customers, total] = await this.database.$transaction([
      this.database.customer.findMany({
        where,
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.database.customer.count({ where }),
    ]);

    return {
      items: customers.map((customer) => this.toSummary(customer)),
      total,
      page,
      pageSize,
      capabilities: { createDraft: canCreateDraft },
    };
  }

  async get(actor: ActorContext, id: string): Promise<CustomerDetail> {
    const scope = await this.accessControl.buildCustomerScope(
      actor,
      'customer.read',
    );
    const customer = await this.database.customer.findFirst({
      where: { id, ...scope },
    });
    if (customer === null) throw this.notFound();

    const [history, editRoutine] = await Promise.all([
      this.database.auditEvent.findMany({
        where: {
          departmentId: actor.departmentId,
          resourceType: 'customer',
          resourceId: customer.id,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { action: true, actorUserId: true, createdAt: true },
      }),
      this.accessControl.canAuthorizeCustomer(actor, 'customer.edit-routine', {
        departmentId: customer.departmentId,
        responsibleUserId: customer.responsibleUserId,
        ...(customer.teamId === null ? {} : { teamId: customer.teamId }),
      }),
    ]);
    return {
      ...this.toSummary(customer),
      capabilities: { editRoutine },
      history: history.map((event) => ({
        action: event.action,
        actorUserId: event.actorUserId,
        occurredAt: event.createdAt.toISOString(),
      })),
    };
  }

  async findDuplicates(
    actor: ActorContext,
    query: CustomerDuplicatesQueryDto,
  ): Promise<{
    exactIdentity: Array<{
      id: string;
      name: string;
      category: string | null;
      region: string | null;
    }>;
    sameName: Array<{
      id: string;
      name: string;
      category: string | null;
      region: string | null;
    }>;
  }> {
    const name = this.normalizeOptional(query.name);
    const normalizedName =
      name === null ? null : this.normalizeComparable(name);
    const identityType = this.normalizeIdentity(query.identityType);
    const normalizedIdentityNumber = this.normalizeIdentity(
      query.identityNumber,
    );
    this.assertIdentityPair(identityType, normalizedIdentityNumber);
    if (normalizedName === null && normalizedIdentityNumber === null) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: '至少提供客户名称或完整证件信息',
      });
    }

    const scope = await this.accessControl.buildCustomerScope(
      actor,
      'customer.read',
    );
    const exclusion =
      query.excludeCustomerId === undefined
        ? []
        : [{ id: { not: query.excludeCustomerId } }];
    const [exactMatches, sameNameMatches] = await Promise.all([
      identityType === null || normalizedIdentityNumber === null
        ? Promise.resolve([])
        : this.database.customer.findMany({
            where: {
              AND: [
                scope,
                { identityType, normalizedIdentityNumber },
                ...exclusion,
              ],
            },
            orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
            take: 20,
          }),
      normalizedName === null
        ? Promise.resolve([])
        : this.database.customer.findMany({
            where: { AND: [scope, { normalizedName }, ...exclusion] },
            orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
            take: 20,
          }),
    ]);
    const minimal = (customer: CustomerRecord) => ({
      id: customer.id,
      name: customer.name,
      category: customer.category,
      region: customer.region,
    });
    return {
      exactIdentity: exactMatches.map(minimal),
      sameName: sameNameMatches.map(minimal),
    };
  }

  async updateDraft(
    actor: ActorContext,
    id: string,
    input: UpdateCustomerDraftDto,
  ): Promise<CustomerSummary> {
    const scope = await this.accessControl.buildCustomerScope(
      actor,
      'customer.edit-routine',
    );
    const readScope = await this.accessControl.tryBuildCustomerScope(
      actor,
      'customer.read',
    );
    const duplicateNameReason = this.normalizeOptional(
      input.duplicateNameReason,
    );

    try {
      return await this.database.$transaction(async (transaction) => {
        const current = await transaction.customer.findFirst({
          where: { id, ...scope },
        });
        if (current === null) throw this.notFound();
        if (current.version !== input.expectedVersion) {
          throw this.versionConflict();
        }

        const normalized = this.mergeEdit(current, input);

        if (
          normalized.identityType !== null &&
          normalized.normalizedIdentityNumber !== null
        ) {
          const exactIdentity = await transaction.customer.findFirst({
            where: {
              departmentId: actor.departmentId,
              identityType: normalized.identityType,
              normalizedIdentityNumber: normalized.normalizedIdentityNumber,
              id: { not: id },
            },
            select: { id: true },
          });
          if (exactIdentity !== null) {
            const visible =
              readScope !== null &&
              (await transaction.customer.findFirst({
                where: { id: exactIdentity.id, ...readScope },
                select: { id: true },
              })) !== null;
            if (!visible) throw this.duplicateConflict();
            throw this.identityDuplicate();
          }
        }

        const nameChanged =
          this.normalizeComparable(current.name) !== normalized.normalizedName;
        if (nameChanged) {
          await transaction.$executeRawUnsafe?.(
            'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
            `${actor.departmentId}:${normalized.normalizedName}`,
          );
        }
        const sameName = nameChanged
          ? readScope === null
            ? null
            : await transaction.customer.findFirst({
                where: {
                  normalizedName: normalized.normalizedName,
                  id: { not: id },
                  ...readScope,
                },
                select: { id: true },
              })
          : null;
        if (sameName !== null) {
          if (duplicateNameReason === null) throw this.nameReasonRequired();
        }

        const changedFields = editableFields.filter(
          (field) => (current[field] ?? null) !== normalized[field],
        );
        if (changedFields.length === 0) return this.toSummary(current);

        const result = await transaction.customer.updateMany({
          where: { id, ...scope, version: input.expectedVersion },
          data: { ...normalized, version: { increment: 1 } },
        });
        if (result.count !== 1) throw this.versionConflict();

        const toVersion = input.expectedVersion + 1;
        await transaction.auditEvent.create({
          data: {
            departmentId: actor.departmentId,
            actorUserId: actor.userId,
            resourceType: 'customer',
            resourceId: id,
            action: 'customer.updated',
            details: {
              fromVersion: input.expectedVersion,
              toVersion,
              changedFields,
              changes: Object.fromEntries(
                changedFields.map((field) => [
                  field,
                  {
                    before: this.auditValue(field, current[field] ?? null),
                    after: this.auditValue(field, normalized[field]),
                  },
                ]),
              ),
            },
          },
        });
        if (sameName !== null && duplicateNameReason !== null) {
          await transaction.auditEvent.create({
            data: {
              departmentId: actor.departmentId,
              actorUserId: actor.userId,
              resourceType: 'customer',
              resourceId: id,
              action: 'customer.duplicate-name-overridden',
              details: {
                fromVersion: input.expectedVersion,
                toVersion,
                reason: duplicateNameReason,
              },
            },
          });
        }

        const updated = await transaction.customer.findUnique({
          where: { id },
        });
        if (updated === null) throw this.notFound();
        return this.toSummary(updated);
      });
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        const current = await this.database.customer.findFirst({
          where: { id, ...scope },
        });
        if (current !== null) {
          const normalized = this.mergeEdit(current, input);
          if (
            readScope !== null &&
            normalized.identityType !== null &&
            normalized.normalizedIdentityNumber !== null
          ) {
            const visible = await this.database.customer.findFirst({
              where: {
                id: { not: id },
                identityType: normalized.identityType,
                normalizedIdentityNumber: normalized.normalizedIdentityNumber,
                ...readScope,
              },
              select: { id: true },
            });
            if (visible !== null) throw this.identityDuplicate();
          }
        }
        throw this.duplicateConflict();
      }
      throw error;
    }
  }

  private mergeEdit(
    current: CustomerRecord,
    input: UpdateCustomerDraftDto,
  ): NormalizedCustomerEdit {
    const name = input.name !== undefined ? input.name?.trim() : current.name;
    if (name === undefined || name.length === 0) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: '客户名称不能为空',
      });
    }
    const identityType =
      input.identityType !== undefined
        ? this.normalizeIdentity(input.identityType)
        : current.identityType;
    const identityNumber =
      input.identityNumber !== undefined
        ? this.normalizeIdentity(input.identityNumber)
        : current.identityNumber;
    this.assertIdentityPair(identityType, identityNumber);
    return {
      name,
      normalizedName: this.normalizeComparable(name),
      customerType:
        input.customerType !== undefined
          ? this.normalizeOptional(input.customerType)
          : current.customerType,
      identityType,
      identityNumber,
      normalizedIdentityNumber:
        identityNumber === null
          ? null
          : this.normalizeComparable(identityNumber).toUpperCase(),
      issuingCountryOrRegion:
        input.issuingCountryOrRegion !== undefined
          ? this.normalizeOptional(input.issuingCountryOrRegion)
          : current.issuingCountryOrRegion,
      category:
        input.category !== undefined
          ? this.normalizeOptional(input.category)
          : current.category,
      region:
        input.region !== undefined
          ? this.normalizeOptional(input.region)
          : current.region,
      ...this.normalizeAdmissionContact(input, current),
    };
  }

  private normalizeAdmissionContact(
    input: Pick<
      CreateCustomerDraftDto | UpdateCustomerDraftDto,
      'admissionContactName' | 'admissionContactPhone' | 'admissionContactEmail'
    >,
    current?: Pick<
      CustomerRecord,
      'admissionContactName' | 'admissionContactPhone' | 'admissionContactEmail'
    >,
  ): Pick<
    CustomerRecord,
    'admissionContactName' | 'admissionContactPhone' | 'admissionContactEmail'
  > {
    const admissionContactName = this.contactValue(
      input.admissionContactName,
      current?.admissionContactName ?? null,
      '联系人姓名不能为空',
    );
    const admissionContactPhone = this.contactValue(
      input.admissionContactPhone,
      current?.admissionContactPhone ?? null,
      '联系人电话不能为空',
    );
    const admissionContactEmail = this.contactValue(
      input.admissionContactEmail,
      current?.admissionContactEmail ?? null,
      '联系人邮箱不能为空',
    );

    if (
      admissionContactName === null &&
      admissionContactPhone === null &&
      admissionContactEmail === null
    ) {
      return {
        admissionContactName: null,
        admissionContactPhone: null,
        admissionContactEmail: null,
      };
    }
    if (admissionContactName === null) {
      throw this.contactValidationError('请填写联系人姓名');
    }
    if (admissionContactPhone === null && admissionContactEmail === null) {
      throw this.contactValidationError('联系人至少填写电话或邮箱');
    }
    if (
      admissionContactPhone !== null &&
      !/^(?=(?:\D*\d){6,20}\D*$)[+()\d\s-]+$/u.test(admissionContactPhone)
    ) {
      throw this.contactValidationError('联系人电话格式不正确');
    }
    if (
      admissionContactEmail !== null &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(admissionContactEmail)
    ) {
      throw this.contactValidationError('联系人邮箱格式不正确');
    }
    return {
      admissionContactName,
      admissionContactPhone,
      admissionContactEmail,
    };
  }

  private contactValue(
    value: string | undefined,
    current: string | null,
    emptyMessage: string,
  ): string | null {
    if (value === undefined) return current;
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw this.contactValidationError(emptyMessage);
    }
    return value.trim();
  }

  private contactValidationError(message: string): BadRequestException {
    return new BadRequestException({ code: 'VALIDATION_ERROR', message });
  }

  private assertIdentityPair(
    identityType: string | null,
    identityNumber: string | null,
  ): void {
    if ((identityType === null) !== (identityNumber === null)) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: '证件类型和证件号码必须同时填写或同时留空',
      });
    }
  }

  private normalizeOptional(value: string | undefined): string | null {
    if (value === undefined) return null;
    const normalized = value.trim();
    return normalized.length === 0 ? null : normalized;
  }

  private normalizeIdentity(value: string | undefined): string | null {
    const normalized = this.normalizeOptional(value);
    return normalized === null
      ? null
      : this.normalizeComparable(normalized).toUpperCase();
  }

  private normalizeComparable(value: string): string {
    return value.normalize('NFKC').trim().replace(/\s+/gu, ' ');
  }

  private auditValue(
    field: keyof NormalizedCustomerEdit,
    value: string | null,
  ): string | null {
    if (value === null) return value;
    if (field === 'admissionContactName') return '***';
    if (field === 'admissionContactEmail') {
      const separator = value.lastIndexOf('@');
      return separator < 0 ? '***' : `***${value.slice(separator)}`;
    }
    if (field !== 'identityNumber' && field !== 'admissionContactPhone') {
      return value;
    }
    if (value.length <= 4) return '***';
    const suffix = value.slice(-4);
    return `***${suffix}`;
  }

  private toSummary(customer: CustomerRecord): CustomerSummary {
    return {
      id: customer.id,
      name: customer.name,
      customerType: customer.customerType,
      identityType: customer.identityType,
      identityNumber: customer.identityNumber,
      issuingCountryOrRegion: customer.issuingCountryOrRegion,
      category: customer.category,
      region: customer.region,
      admissionContactName: customer.admissionContactName ?? null,
      admissionContactPhone: customer.admissionContactPhone ?? null,
      admissionContactEmail: customer.admissionContactEmail ?? null,
      profileStatus: 'draft',
      departmentId: customer.departmentId,
      responsibleUserId: customer.responsibleUserId,
      version: customer.version,
      updatedAt: customer.updatedAt.toISOString(),
    };
  }

  private notFound(): NotFoundException {
    return new NotFoundException({
      code: 'CUSTOMER_NOT_FOUND',
      message: '客户不存在或不可访问',
    });
  }

  private identityDuplicate(): ConflictException {
    return new ConflictException({
      code: 'CUSTOMER_IDENTITY_DUPLICATE',
      message: '本部门已有相同证件号码的客户',
    });
  }

  private nameReasonRequired(): ConflictException {
    return new ConflictException({
      code: 'CUSTOMER_NAME_REASON_REQUIRED',
      message: '本部门已有同名客户，请说明继续原因',
      details: ['name', 'duplicateNameReason'],
    });
  }

  private duplicateConflict(): ConflictException {
    return new ConflictException({
      code: 'CUSTOMER_DUPLICATE_CONFLICT',
      message: '客户信息与现有记录冲突，请核对后再试',
    });
  }

  private versionConflict(): ConflictException {
    return new ConflictException({
      code: 'CUSTOMER_VERSION_CONFLICT',
      message: '客户资料已被他人更新，请重新加载后再提交',
    });
  }

  private isUniqueConstraintError(error: unknown): boolean {
    if (error === null || typeof error !== 'object') return false;
    const record = error as Record<string, unknown>;
    if (record.code === 'P2002') return true;
    return this.isUniqueConstraintError(record.cause);
  }
}
