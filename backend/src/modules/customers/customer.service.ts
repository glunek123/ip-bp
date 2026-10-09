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
import { OrganizationService } from '../../access-control/organization.service';
import {
  isCustomerContactRetryable,
  lockVisibleCustomerForRoutineEdit,
} from './customer-contact-locks';
import { recordContactVersion } from './customer-contact.service';
import {
  CreateCustomerDraftDto,
  CustomerDuplicatesQueryDto,
  UpdateCustomerDraftDto,
} from './customer.dto';
import { normalizeCustomerIdentityNumber } from './customer-identity';

export type CustomerRecord = {
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
  compatibilityContactId: string | null;
  admissionContactSnapshotName: string | null;
  admissionContactSnapshotPhone: string | null;
  admissionContactSnapshotEmail: string | null;
  admissionContactSnapshotSource: string | null;
  admissionContactSnapshotFrozenAt: Date | null;
  identityValidFrom: Date | null;
  identityValidTo: Date | null;
  identityValidityMode: 'FIXED' | 'LONG_TERM' | 'NOT_STATED' | null;
  admittedAt: Date | null;
  deletedAt: Date | null;
  profileStatus: 'DRAFT' | 'ADMITTED';
  cooperationStatus: 'COOPERATING' | 'PAUSED' | 'TERMINATED';
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
  identityValidFrom: string | null;
  identityValidTo: string | null;
  identityValidityMode: 'FIXED' | 'LONG_TERM' | 'NOT_STATED' | null;
  admittedAt: string | null;
  profileStatus: 'draft' | 'admitted';
  cooperationStatus: 'COOPERATING' | 'PAUSED' | 'TERMINATED';
  departmentId: string;
  responsibleUserId: string;
  version: number;
  updatedAt: string;
};

export type CustomerDetail = CustomerSummary & {
  primaryContactId: string | null;
  admissionContactSnapshot: {
    name: string;
    phone: string | null;
    email: string | null;
    source: string;
    frozenAt: string;
  } | null;
  capabilities: {
    editRoutine: boolean;
    admit: boolean;
    deleteDraft: boolean;
    agreement: { read: boolean; edit: boolean };
    invoice: { read: boolean; edit: boolean };
  };
  responsibleOperator: { id: string; displayName: string };
  cooperationCapabilities: {
    transfer: boolean;
    pause: boolean;
    terminate: boolean;
    resume: boolean;
  };
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
    private readonly organization: OrganizationService,
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
      if (facts.teamId !== undefined) {
        const teams = await transaction.$queryRawUnsafe<
          Array<{ status: 'ACTIVE' | 'INACTIVE' }>
        >(
          `SELECT "status" FROM "teams"
           WHERE "id" = $1::uuid AND "department_id" = $2::uuid
           FOR SHARE`,
          facts.teamId,
          actor.departmentId,
        );
        if (teams.length !== 1 || teams[0]?.status !== 'ACTIVE') {
          throw new ForbiddenException({
            code: 'CUSTOMER_ACTION_FORBIDDEN',
            message: '无权执行此客户操作',
          });
        }
      }
      const sameName =
        readScope === null
          ? null
          : await transaction.customer.findFirst({
              where: { normalizedName, ...readScope, deletedAt: null },
              select: { id: true },
            });
      if (sameName !== null) {
        if (duplicateNameReason === null) throw this.nameReasonRequired();
      }

      let created = await transaction.customer.create({
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
      if (admissionContact.admissionContactName !== null) {
        const contact = await transaction.customerContact.create({
          data: {
            customerId: created.id,
            departmentId: actor.departmentId,
            name: admissionContact.admissionContactName,
            phone: admissionContact.admissionContactPhone,
            email: admissionContact.admissionContactEmail,
            origin: 'LEGACY_CREATE',
            createdByUserId: actor.userId,
            updatedByUserId: actor.userId,
          },
        });
        await recordContactVersion(
          transaction,
          contact,
          'CREATED',
          null,
          actor.userId,
        );
        created = await transaction.customer.update({
          where: { id: created.id },
          data: { compatibilityContactId: contact.id },
        });
      }
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
        where: { ...where, deletedAt: null },
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.database.customer.count({ where: { ...where, deletedAt: null } }),
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
      where: { id, ...scope, deletedAt: null },
      include: {
        responsibleMembership: {
          select: { user: { select: { displayName: true } } },
        },
      },
    });
    if (customer === null) throw this.notFound();

    const facts = {
      departmentId: customer.departmentId,
      responsibleUserId: customer.responsibleUserId,
      ...(customer.teamId === null ? {} : { teamId: customer.teamId }),
    };
    const [
      history,
      editRoutine,
      admit,
      deleteDraft,
      transfer,
      pause,
      terminate,
      resume,
      agreementRead,
      agreementEdit,
      invoiceRead,
      invoiceEdit,
    ] = await Promise.all([
      this.database.auditEvent.findMany({
        where: {
          departmentId: actor.departmentId,
          resourceType: 'customer',
          resourceId: customer.id,
          actorKind: 'HUMAN',
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { action: true, actorUserId: true, createdAt: true },
      }),
      this.accessControl.canAuthorizeCustomer(
        actor,
        'customer.edit-routine',
        facts,
      ),
      this.accessControl.canAuthorizeCustomer(actor, 'customer.admit', facts),
      this.accessControl.canAuthorizeCustomer(
        actor,
        'customer.delete-draft',
        facts,
      ),
      this.accessControl.canAuthorizeCustomer(
        actor,
        'customer.responsible.transfer',
        facts,
      ),
      this.accessControl.canAuthorizeCustomer(
        actor,
        'customer.cooperation.pause',
        facts,
      ),
      this.accessControl.canAuthorizeCustomer(
        actor,
        'customer.cooperation.terminate',
        facts,
      ),
      this.accessControl.canAuthorizeCustomer(
        actor,
        'customer.cooperation.resume',
        facts,
      ),
      this.accessControl.canAuthorizeCustomer(
        actor,
        'customer.agreement.read',
        facts,
      ),
      this.accessControl.canAuthorizeCustomer(
        actor,
        'customer.agreement.edit',
        facts,
      ),
      this.accessControl.canAuthorizeCustomer(
        actor,
        'customer.invoice.read',
        facts,
      ),
      this.accessControl.canAuthorizeCustomer(
        actor,
        'customer.invoice.edit',
        facts,
      ),
    ]);
    const primaryContact = await this.database.customerContact.findFirst({
      where: {
        customerId: id,
        departmentId: actor.departmentId,
        isPrimary: true,
        endedAt: null,
      },
      select: { id: true },
    });
    return {
      ...this.toSummary(customer),
      primaryContactId: primaryContact?.id ?? null,
      admissionContactSnapshot:
        customer.profileStatus === 'ADMITTED' &&
        customer.admissionContactSnapshotName != null &&
        customer.admissionContactSnapshotSource != null &&
        customer.admissionContactSnapshotFrozenAt instanceof Date
          ? {
              name: customer.admissionContactSnapshotName,
              phone: customer.admissionContactSnapshotPhone,
              email: customer.admissionContactSnapshotEmail,
              source: customer.admissionContactSnapshotSource,
              frozenAt: customer.admissionContactSnapshotFrozenAt.toISOString(),
            }
          : null,
      responsibleOperator: {
        id: customer.responsibleUserId,
        displayName: customer.responsibleMembership.user.displayName,
      },
      cooperationCapabilities: {
        transfer,
        pause: pause && customer.cooperationStatus === 'COOPERATING',
        terminate: terminate && customer.cooperationStatus !== 'TERMINATED',
        resume: resume && customer.cooperationStatus !== 'COOPERATING',
      },
      capabilities: {
        editRoutine,
        admit,
        agreement: {
          read: agreementRead,
          edit: agreementRead && agreementEdit,
        },
        invoice: { read: invoiceRead, edit: invoiceRead && invoiceEdit },
        deleteDraft:
          deleteDraft &&
          customer.profileStatus === 'DRAFT' &&
          !customer.everAdmitted,
      },
      history: history.map((event) => {
        if (event.actorUserId === null)
          throw new Error('Human customer audit has no actor account');
        return {
          action: event.action,
          actorUserId: event.actorUserId,
          occurredAt: event.createdAt.toISOString(),
        };
      }),
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
    const normalizedIdentityNumber = normalizeCustomerIdentityNumber(
      query.identityNumber,
    ).normalized;
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
                { deletedAt: null },
                ...exclusion,
              ],
            },
            orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
            take: 20,
          }),
      normalizedName === null
        ? Promise.resolve([])
        : this.database.customer.findMany({
            where: {
              AND: [scope, { normalizedName, deletedAt: null }, ...exclusion],
            },
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

    for (let attempt = 1; attempt <= 6; attempt += 1) {
      try {
        return await this.database.$transaction(async (transaction) => {
          const current = await lockVisibleCustomerForRoutineEdit(
            transaction,
            this.organization,
            this.accessControl,
            actor,
            id,
          );
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
              select: { id: true, deletedAt: true },
            });
            if (exactIdentity !== null) {
              if (exactIdentity.deletedAt !== null && readScope !== null) {
                const restoreScope =
                  await this.accessControl.tryBuildCustomerScope(
                    actor,
                    'customer.restore-draft',
                    transaction,
                  );
                if (
                  restoreScope !== null &&
                  (await transaction.customer.findFirst({
                    where: {
                      id: exactIdentity.id,
                      deletedAt: { not: null },
                      AND: [readScope, restoreScope],
                    },
                    select: { id: true },
                  }))
                )
                  throw this.identityRestoreAvailable(exactIdentity.id);
              }
              const visible =
                readScope !== null &&
                (await transaction.customer.findFirst({
                  where: {
                    id: exactIdentity.id,
                    ...readScope,
                    deletedAt: null,
                  },
                  select: { id: true },
                })) !== null;
              if (!visible) throw this.duplicateConflict();
              throw this.identityDuplicate();
            }
          }

          const nameChanged =
            this.normalizeComparable(current.name) !==
            normalized.normalizedName;
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
                    deletedAt: null,
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
          const contactChanged = changedFields.some(
            (field) =>
              field === 'admissionContactName' ||
              field === 'admissionContactPhone' ||
              field === 'admissionContactEmail',
          );
          let existingContact = null;
          if (contactChanged) {
            existingContact =
              current.compatibilityContactId === null
                ? null
                : await transaction.customerContact.findFirst({
                    where: {
                      id: current.compatibilityContactId,
                      customerId: id,
                      departmentId: actor.departmentId,
                      endedAt: null,
                    },
                  });
            if (
              existingContact === null &&
              (await transaction.customerContact.count({
                where: { customerId: id },
              })) > 0
            )
              throw new ConflictException({
                code: 'CUSTOMER_CONTACT_SELECTION_REQUIRED',
                message: '请先选择要维护的联系人',
              });
          }

          const result = await transaction.customer.updateMany({
            where: {
              id,
              ...scope,
              deletedAt: null,
              version: input.expectedVersion,
            },
            data: { ...normalized, version: { increment: 1 } },
          });
          if (result.count !== 1) throw this.versionConflict();

          if (contactChanged && normalized.admissionContactName !== null) {
            if (existingContact !== null) {
              const before = {
                name: existingContact.name,
                phone: existingContact.phone,
                email: existingContact.email,
                duty: existingContact.duty,
                isPrimary: existingContact.isPrimary,
                endedAt: existingContact.endedAt?.toISOString() ?? null,
                endReason: existingContact.endReason,
              };
              const contact = await transaction.customerContact.update({
                where: { id: existingContact.id },
                data: {
                  name: normalized.admissionContactName,
                  phone: normalized.admissionContactPhone,
                  email: normalized.admissionContactEmail,
                  version: { increment: 1 },
                  updatedByUserId: actor.userId,
                },
              });
              await recordContactVersion(
                transaction,
                contact,
                'UPDATED',
                before,
                actor.userId,
              );
            } else {
              const contact = await transaction.customerContact.create({
                data: {
                  customerId: id,
                  departmentId: actor.departmentId,
                  name: normalized.admissionContactName,
                  phone: normalized.admissionContactPhone,
                  email: normalized.admissionContactEmail,
                  origin: 'LEGACY_CREATE',
                  createdByUserId: actor.userId,
                  updatedByUserId: actor.userId,
                },
              });
              await recordContactVersion(
                transaction,
                contact,
                'CREATED',
                null,
                actor.userId,
              );
              await transaction.customer.update({
                where: { id },
                data: { compatibilityContactId: contact.id },
              });
            }
          }

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
        if (isCustomerContactRetryable(error)) {
          if (attempt === 6)
            throw new ConflictException({
              code: 'CUSTOMER_CONTACT_BUSY',
              message: '联系人操作繁忙，请使用原请求重试',
            });
          await new Promise((resolve) => setTimeout(resolve, attempt * 15));
          continue;
        }
        if (this.isUniqueConstraintError(error)) {
          const current = await this.database.customer.findFirst({
            where: { id, ...scope, deletedAt: null },
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
                  deletedAt: null,
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
    throw new ConflictException({
      code: 'CUSTOMER_CONTACT_BUSY',
      message: '联系人操作繁忙，请使用原请求重试',
    });
  }

  private mergeEdit(
    current: CustomerRecord,
    input: UpdateCustomerDraftDto,
  ): NormalizedCustomerEdit {
    let name = input.name !== undefined ? input.name?.trim() : current.name;
    if (name === undefined || name.length === 0) {
      if (current.profileStatus === 'ADMITTED') throw this.invalidState();
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: '客户名称不能为空',
      });
    }
    let customerType =
      input.customerType !== undefined
        ? this.normalizeOptional(input.customerType)
        : current.customerType;
    let identityType =
      input.identityType !== undefined
        ? this.normalizeIdentity(input.identityType)
        : current.identityType;
    let identityNumber = current.identityNumber ?? null;
    let normalizedIdentityNumber = current.normalizedIdentityNumber ?? null;
    if (input.identityNumber !== undefined) {
      const identity = normalizeCustomerIdentityNumber(input.identityNumber);
      identityNumber = identity.display;
      normalizedIdentityNumber = identity.normalized;
    }

    if (current.profileStatus === 'ADMITTED') {
      const identityChanged =
        (input.name !== undefined &&
          this.normalizeComparable(name) !== current.normalizedName) ||
        (input.customerType !== undefined &&
          customerType !== current.customerType) ||
        (input.identityType !== undefined &&
          identityType !== current.identityType) ||
        (input.identityNumber !== undefined &&
          normalizedIdentityNumber !== current.normalizedIdentityNumber);
      if (identityChanged) throw this.invalidState();

      name = current.name;
      customerType = current.customerType;
      identityType = current.identityType;
      identityNumber = current.identityNumber;
      normalizedIdentityNumber = current.normalizedIdentityNumber;
    }

    this.assertIdentityPair(identityType, normalizedIdentityNumber);
    return {
      name,
      normalizedName: this.normalizeComparable(name),
      customerType,
      identityType,
      identityNumber,
      normalizedIdentityNumber,
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
    if (
      (identityType === null) !== (identityNumber === null) ||
      identityNumber === ''
    ) {
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
    return toCustomerSummary(customer);
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

  private identityRestoreAvailable(customerId: string): ConflictException {
    return new ConflictException({
      code: 'CUSTOMER_IDENTITY_RESTORE_AVAILABLE',
      message: '本部门已有相同证件号码的已删除客户草稿，请恢复原客户',
      details: { customerId },
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

  private invalidState(): ConflictException {
    return new ConflictException({
      code: 'INVALID_STATE',
      message: '已准入客户的主体和证件信息不可通过日常编辑修改',
    });
  }

  private isUniqueConstraintError(error: unknown): boolean {
    if (error === null || typeof error !== 'object') return false;
    const record = error as Record<string, unknown>;
    if (record.code === 'P2002') return true;
    return this.isUniqueConstraintError(record.cause);
  }
}

export function toCustomerSummary(customer: CustomerRecord): CustomerSummary {
  return {
    id: customer.id,
    name: customer.name,
    customerType: customer.customerType ?? null,
    identityType: customer.identityType ?? null,
    identityNumber: customer.identityNumber ?? null,
    issuingCountryOrRegion: customer.issuingCountryOrRegion ?? null,
    category: customer.category ?? null,
    region: customer.region ?? null,
    admissionContactName: customer.admissionContactName ?? null,
    admissionContactPhone: customer.admissionContactPhone ?? null,
    admissionContactEmail: customer.admissionContactEmail ?? null,
    identityValidFrom:
      customer.identityValidFrom === null ||
      customer.identityValidFrom === undefined
        ? null
        : customer.identityValidFrom.toISOString().slice(0, 10),
    identityValidTo:
      customer.identityValidTo === null ||
      customer.identityValidTo === undefined
        ? null
        : customer.identityValidTo.toISOString().slice(0, 10),
    identityValidityMode: customer.identityValidityMode ?? null,
    admittedAt: customer.admittedAt?.toISOString() ?? null,
    profileStatus: customer.profileStatus === 'ADMITTED' ? 'admitted' : 'draft',
    cooperationStatus: customer.cooperationStatus,
    departmentId: customer.departmentId,
    responsibleUserId: customer.responsibleUserId,
    version: customer.version,
    updatedAt: customer.updatedAt.toISOString(),
  };
}
