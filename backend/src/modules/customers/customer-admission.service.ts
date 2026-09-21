import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { AccessControlService } from '../../access-control/access-control.service';
import { ActorContext } from '../../access-control/actor-context';
import { DatabaseService } from '../../database/database.service';
import type { Prisma } from '../../generated/prisma/client';
import { MaterialService, ValidatedMaterialVersionFact } from '../materials';
import {
  AdmitCustomerDto,
  CUSTOMER_IDENTITY_COMPATIBILITY,
  CUSTOMER_TYPE_CODES,
  CustomerTypeCode,
  IDENTITY_TYPE_CODES,
  IDENTITY_VALIDITY_MODES,
  IdentityTypeCode,
  IdentityValidityModeCode,
} from './customer-admission.dto';
import { CustomerSummary, toCustomerSummary } from './customer.service';
import { normalizeCustomerIdentityNumber } from './customer-identity';

type NormalizedAdmission = {
  expectedVersion: number;
  customerType: CustomerTypeCode;
  name: string;
  normalizedName: string;
  identityType: IdentityTypeCode;
  identityNumber: string;
  normalizedIdentityNumber: string;
  issuingCountryOrRegion: string | null;
  identityValidFrom: Date | null;
  identityValidTo: Date | null;
  identityValidityMode: IdentityValidityModeCode;
  admissionContactName: string;
  admissionContactPhone: string | null;
  admissionContactEmail: string | null;
  identityDocumentContentVersionIds: string[];
};

type CanonicalAdmissionFingerprint = {
  expectedVersion: number;
  customerType: string;
  name: string;
  normalizedName: string;
  identityType: string;
  identityNumber: string;
  normalizedIdentityNumber: string;
  issuingCountryOrRegion: string | null;
  identityValidFrom: string | null;
  identityValidTo: string | null;
  identityValidityMode: string;
  admissionContactName: string;
  admissionContactPhone: string | null;
  admissionContactEmail: string | null;
  identityDocumentContentVersionIds: string[];
};

type AdmissionReceipt = {
  requestFingerprint: string;
  resultCustomerId: string;
  resultCustomerVersion: number;
  resultSnapshot: unknown;
};

const MAX_SERIALIZABLE_ATTEMPTS = 3;

@Injectable()
export class CustomerAdmissionService {
  constructor(
    private readonly database: DatabaseService,
    private readonly accessControl: AccessControlService,
    private readonly materials: MaterialService,
  ) {}

  async admit(
    actor: ActorContext,
    customerId: string,
    idempotencyKey: string,
    input: AdmitCustomerDto,
  ): Promise<CustomerSummary> {
    const canonical = this.canonicalizeForFingerprint(input);
    const fingerprint = this.fingerprint(customerId, canonical);
    for (let attempt = 1; attempt <= MAX_SERIALIZABLE_ATTEMPTS; attempt += 1) {
      try {
        return await this.database.$transaction(
          async (transaction) => {
            const scope = await this.accessControl.buildCustomerScope(
              actor,
              'customer.admit',
              transaction,
            );
            const visible = await transaction.customer.findFirst({
              where: { id: customerId, ...scope },
            });
            if (visible === null) throw this.notFound();

            const locked = await transaction.$queryRawUnsafe<
              Array<{ id: string }>
            >(
              `SELECT "id" FROM "customers"
             WHERE "id" = $1::uuid AND "department_id" = $2::uuid
             FOR UPDATE`,
              customerId,
              actor.departmentId,
            );
            if (locked.length !== 1) throw this.notFound();
            const current = await transaction.customer.findFirst({
              where: { id: customerId, ...scope },
            });
            if (current === null) throw this.notFound();

            const receipt =
              await transaction.customerAdmissionReceipt.findUnique({
                where: this.receiptWhere(actor, idempotencyKey),
              });
            if (receipt !== null) {
              return this.rebuildReceiptResult(actor, receipt, fingerprint);
            }

            if (current.version !== input.expectedVersion) {
              throw this.versionConflict();
            }
            if (current.profileStatus !== 'DRAFT') {
              throw this.stateConflict();
            }

            const normalized = this.validateAndNormalizeDomain(input);

            const duplicate = await transaction.customer.findFirst({
              where: {
                departmentId: actor.departmentId,
                identityType: normalized.identityType,
                normalizedIdentityNumber: normalized.normalizedIdentityNumber,
                id: { not: customerId },
              },
              select: { id: true },
            });
            if (duplicate !== null) throw this.identityDuplicate();

            const facts = await this.materials.assertAvailableVersions(
              transaction,
              actor,
              {
                ownerType: 'CUSTOMER',
                ownerId: customerId,
                category: 'CUSTOMER_IDENTITY',
                contentVersionIds: normalized.identityDocumentContentVersionIds,
                minCount: 1,
                maxCount: 10,
              },
            );
            this.assertIdentityDocuments(normalized.identityType, facts);
            await this.materials.freezeReferences(transaction, {
              departmentId: actor.departmentId,
              resourceType: 'customer',
              resourceId: customerId,
              facts,
            });

            const admittedAt = new Date();
            const changed = await transaction.customer.updateMany({
              where: {
                id: customerId,
                departmentId: actor.departmentId,
                version: normalized.expectedVersion,
                profileStatus: 'DRAFT',
              },
              data: {
                customerType: normalized.customerType,
                name: normalized.name,
                normalizedName: normalized.normalizedName,
                identityType: normalized.identityType,
                identityNumber: normalized.identityNumber,
                normalizedIdentityNumber: normalized.normalizedIdentityNumber,
                issuingCountryOrRegion: normalized.issuingCountryOrRegion,
                identityValidFrom: normalized.identityValidFrom,
                identityValidTo: normalized.identityValidTo,
                identityValidityMode: normalized.identityValidityMode,
                admissionContactName: normalized.admissionContactName,
                admissionContactPhone: normalized.admissionContactPhone,
                admissionContactEmail: normalized.admissionContactEmail,
                profileStatus: 'ADMITTED',
                admittedAt,
                version: { increment: 1 },
              },
            });
            if (changed.count !== 1) throw this.versionConflict();

            const resultCustomerVersion = normalized.expectedVersion + 1;
            await transaction.auditEvent.create({
              data: {
                departmentId: actor.departmentId,
                actorUserId: actor.userId,
                resourceType: 'customer',
                resourceId: customerId,
                action: 'customer.admitted',
                details: {
                  fromVersion: normalized.expectedVersion,
                  toVersion: resultCustomerVersion,
                  customerType: normalized.customerType,
                  identityType: normalized.identityType,
                  identityValidityMode: normalized.identityValidityMode,
                  identityDocumentCount: facts.length,
                },
              },
            });
            const admitted = await transaction.customer.findUnique({
              where: { id: customerId },
            });
            if (admitted === null) throw this.notFound();
            const result = toCustomerSummary(admitted);
            await transaction.customerAdmissionReceipt.create({
              data: {
                departmentId: actor.departmentId,
                actorUserId: actor.userId,
                idempotencyKey,
                requestFingerprint: fingerprint,
                resultCustomerId: customerId,
                resultCustomerVersion,
                resultSnapshot: this.resultSnapshot(result),
              },
            });
            return result;
          },
          { isolationLevel: 'Serializable' },
        );
      } catch (error) {
        if (this.isSerializationConflict(error)) {
          if (attempt === MAX_SERIALIZABLE_ATTEMPTS) {
            throw this.versionConflict();
          }
          continue;
        }
        if (!this.isUniqueConstraintError(error)) throw error;
        const receipt = await this.database.customerAdmissionReceipt.findUnique(
          {
            where: this.receiptWhere(actor, idempotencyKey),
          },
        );
        if (receipt === null) throw this.identityDuplicate();
        return this.rebuildReceiptResult(actor, receipt, fingerprint);
      }
    }
    throw this.versionConflict();
  }

  private canonicalizeForFingerprint(
    input: AdmitCustomerDto,
  ): CanonicalAdmissionFingerprint {
    const name = this.canonicalText(input.name);
    const identity =
      typeof input.identityNumber === 'string'
        ? normalizeCustomerIdentityNumber(input.identityNumber)
        : { display: null, normalized: null };
    return {
      expectedVersion: input.expectedVersion,
      customerType: this.canonicalText(input.customerType),
      name,
      normalizedName: name,
      identityType: this.canonicalText(input.identityType),
      identityNumber: identity.display ?? '',
      normalizedIdentityNumber: identity.normalized ?? '',
      issuingCountryOrRegion: this.canonicalOptionalText(
        input.issuingCountryOrRegion,
      ),
      identityValidFrom: this.canonicalOptionalText(input.identityValidFrom),
      identityValidTo: this.canonicalOptionalText(input.identityValidTo),
      identityValidityMode: this.canonicalText(input.identityValidityMode),
      admissionContactName: this.canonicalText(input.admissionContactName),
      admissionContactPhone: this.canonicalOptionalText(
        input.admissionContactPhone,
      ),
      admissionContactEmail: this.canonicalOptionalText(
        input.admissionContactEmail,
      ),
      identityDocumentContentVersionIds: Array.isArray(
        input.identityDocumentContentVersionIds,
      )
        ? input.identityDocumentContentVersionIds.map((value) =>
            this.canonicalText(value),
          )
        : [],
    };
  }

  private validateAndNormalizeDomain(
    input: AdmitCustomerDto,
  ): NormalizedAdmission {
    const name = this.required(input.name);
    const identity = normalizeCustomerIdentityNumber(input.identityNumber);
    if (
      identity.display === null ||
      identity.normalized === null ||
      identity.normalized.length === 0
    ) {
      throw this.admissionIncomplete();
    }
    const admissionContactName = this.required(input.admissionContactName);
    const admissionContactPhone = this.optional(input.admissionContactPhone);
    const admissionContactEmail = this.optional(input.admissionContactEmail);
    if (admissionContactPhone === null && admissionContactEmail === null) {
      throw this.admissionIncomplete();
    }
    if (
      admissionContactPhone !== null &&
      !/^(?=(?:\D*\d){6,20}\D*$)[+()\d\s-]+$/u.test(admissionContactPhone)
    ) {
      throw this.validationError();
    }
    if (
      admissionContactEmail !== null &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(admissionContactEmail)
    ) {
      throw this.validationError();
    }
    if (
      !CUSTOMER_TYPE_CODES.includes(input.customerType as never) ||
      !IDENTITY_TYPE_CODES.includes(input.identityType as never) ||
      !IDENTITY_VALIDITY_MODES.includes(input.identityValidityMode as never)
    ) {
      throw this.admissionIncomplete();
    }
    const compatibleIdentityTypes = CUSTOMER_IDENTITY_COMPATIBILITY[
      input.customerType as CustomerTypeCode
    ] as readonly IdentityTypeCode[];
    if (!compatibleIdentityTypes.includes(input.identityType)) {
      throw this.admissionIncomplete();
    }

    const identityValidFrom = this.date(input.identityValidFrom);
    const identityValidTo = this.date(input.identityValidTo);
    if (input.identityValidityMode === 'FIXED') {
      if (
        identityValidTo === null ||
        (identityValidFrom !== null && identityValidTo < identityValidFrom)
      ) {
        throw this.admissionIncomplete();
      }
    } else if (identityValidTo !== null) {
      throw this.admissionIncomplete();
    }

    const contentVersionIds = [...input.identityDocumentContentVersionIds];
    if (
      contentVersionIds.length < 1 ||
      contentVersionIds.length > 10 ||
      new Set(contentVersionIds).size !== contentVersionIds.length
    ) {
      throw this.documentInvalid();
    }
    return {
      expectedVersion: input.expectedVersion,
      customerType: input.customerType,
      name,
      normalizedName: this.normalizeComparable(name),
      identityType: input.identityType,
      identityNumber: identity.display,
      normalizedIdentityNumber: identity.normalized,
      issuingCountryOrRegion: this.optional(input.issuingCountryOrRegion),
      identityValidFrom,
      identityValidTo,
      identityValidityMode: input.identityValidityMode,
      admissionContactName,
      admissionContactPhone,
      admissionContactEmail,
      identityDocumentContentVersionIds: contentVersionIds,
    };
  }

  private assertIdentityDocuments(
    identityType: IdentityTypeCode,
    facts: readonly ValidatedMaterialVersionFact[],
  ): void {
    if (identityType !== 'NATIONAL_ID') {
      if (facts.some((fact) => fact.purpose !== 'IDENTITY_FULL')) {
        throw this.documentInvalid();
      }
      return;
    }
    const oneFullPdf =
      facts.length === 1 &&
      facts[0]?.purpose === 'IDENTITY_FULL' &&
      facts[0].mimeType === 'application/pdf';
    const frontAndBackImages =
      facts.length === 2 &&
      new Set(facts.map((fact) => fact.purpose)).size === 2 &&
      facts.some((fact) => fact.purpose === 'IDENTITY_FRONT') &&
      facts.some((fact) => fact.purpose === 'IDENTITY_BACK') &&
      facts.every(
        (fact) =>
          fact.mimeType === 'image/jpeg' || fact.mimeType === 'image/png',
      );
    if (!oneFullPdf && !frontAndBackImages) throw this.documentInvalid();
  }

  private rebuildReceiptResult(
    actor: ActorContext,
    receipt: AdmissionReceipt,
    fingerprint: string,
  ): CustomerSummary {
    if (receipt.requestFingerprint !== fingerprint) {
      throw this.idempotencyConflict();
    }
    const snapshot = receipt.resultSnapshot;
    if (
      !this.isCustomerSummary(snapshot) ||
      snapshot.id !== receipt.resultCustomerId ||
      snapshot.version !== receipt.resultCustomerVersion ||
      snapshot.departmentId !== actor.departmentId
    ) {
      throw this.corruptReceipt();
    }
    return {
      id: snapshot.id,
      name: snapshot.name,
      customerType: snapshot.customerType,
      identityType: snapshot.identityType,
      identityNumber: snapshot.identityNumber,
      issuingCountryOrRegion: snapshot.issuingCountryOrRegion,
      category: snapshot.category,
      region: snapshot.region,
      admissionContactName: snapshot.admissionContactName,
      admissionContactPhone: snapshot.admissionContactPhone,
      admissionContactEmail: snapshot.admissionContactEmail,
      identityValidFrom: snapshot.identityValidFrom,
      identityValidTo: snapshot.identityValidTo,
      identityValidityMode: snapshot.identityValidityMode,
      admittedAt: snapshot.admittedAt,
      profileStatus: snapshot.profileStatus,
      departmentId: snapshot.departmentId,
      responsibleUserId: snapshot.responsibleUserId,
      version: snapshot.version,
      updatedAt: snapshot.updatedAt,
    };
  }

  private resultSnapshot(result: CustomerSummary): Prisma.InputJsonObject {
    return {
      id: result.id,
      name: result.name,
      customerType: result.customerType,
      identityType: result.identityType,
      identityNumber: result.identityNumber,
      issuingCountryOrRegion: result.issuingCountryOrRegion,
      category: result.category,
      region: result.region,
      admissionContactName: result.admissionContactName,
      admissionContactPhone: result.admissionContactPhone,
      admissionContactEmail: result.admissionContactEmail,
      identityValidFrom: result.identityValidFrom,
      identityValidTo: result.identityValidTo,
      identityValidityMode: result.identityValidityMode,
      admittedAt: result.admittedAt,
      profileStatus: result.profileStatus,
      departmentId: result.departmentId,
      responsibleUserId: result.responsibleUserId,
      version: result.version,
      updatedAt: result.updatedAt,
    };
  }

  private isCustomerSummary(value: unknown): value is CustomerSummary {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return false;
    }
    const snapshot = value as Record<string, unknown>;
    const nullableStrings = [
      'customerType',
      'identityType',
      'identityNumber',
      'issuingCountryOrRegion',
      'category',
      'region',
      'admissionContactName',
      'admissionContactPhone',
      'admissionContactEmail',
      'identityValidFrom',
      'identityValidTo',
      'admittedAt',
    ];
    return (
      typeof snapshot.id === 'string' &&
      typeof snapshot.name === 'string' &&
      nullableStrings.every(
        (field) =>
          snapshot[field] === null || typeof snapshot[field] === 'string',
      ) &&
      (snapshot.identityValidityMode === null ||
        snapshot.identityValidityMode === 'FIXED' ||
        snapshot.identityValidityMode === 'LONG_TERM' ||
        snapshot.identityValidityMode === 'NOT_STATED') &&
      snapshot.profileStatus === 'admitted' &&
      typeof snapshot.departmentId === 'string' &&
      typeof snapshot.responsibleUserId === 'string' &&
      Number.isInteger(snapshot.version) &&
      typeof snapshot.updatedAt === 'string'
    );
  }

  private receiptWhere(actor: ActorContext, idempotencyKey: string) {
    return {
      departmentId_actorUserId_idempotencyKey: {
        departmentId: actor.departmentId,
        actorUserId: actor.userId,
        idempotencyKey,
      },
    };
  }

  private fingerprint(
    customerId: string,
    input: CanonicalAdmissionFingerprint,
  ): string {
    return createHash('sha256')
      .update(JSON.stringify({ customerId, ...input }))
      .digest('hex');
  }

  private canonicalText(value: unknown): string {
    return typeof value === 'string' ? this.normalizeComparable(value) : '';
  }

  private canonicalOptionalText(value: unknown): string | null {
    if (value === undefined || value === null) return null;
    const canonical = this.canonicalText(value);
    return canonical.length === 0 ? null : canonical;
  }

  private date(value: string | undefined): Date | null {
    if (value === undefined) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) throw this.validationError();
    const date = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime()) || this.dateString(date) !== value) {
      throw this.validationError();
    }
    return date;
  }

  private dateString(value: Date | null): string | null {
    return value === null ? null : value.toISOString().slice(0, 10);
  }

  private required(value: string): string {
    const normalized = this.normalizeComparable(
      typeof value === 'string' ? value : '',
    );
    if (normalized.length === 0) throw this.admissionIncomplete();
    return normalized;
  }

  private optional(value: string | undefined): string | null {
    if (value === undefined) return null;
    const normalized = this.normalizeComparable(value);
    return normalized.length === 0 ? null : normalized;
  }

  private normalizeComparable(value: string): string {
    return value.normalize('NFKC').trim().replace(/\s+/gu, ' ');
  }

  private notFound(): NotFoundException {
    return new NotFoundException({
      code: 'CUSTOMER_NOT_FOUND',
      message: '客户不存在或不可访问',
    });
  }

  private versionConflict(): ConflictException {
    return new ConflictException({
      code: 'CUSTOMER_VERSION_CONFLICT',
      message: '客户资料已被他人更新，请重新加载后再提交',
    });
  }

  private stateConflict(): ConflictException {
    return new ConflictException({
      code: 'CUSTOMER_ADMISSION_STATE_CONFLICT',
      message: '仅草稿客户可以正式准入',
    });
  }

  private admissionIncomplete(): ConflictException {
    return new ConflictException({
      code: 'CUSTOMER_ADMISSION_INCOMPLETE',
      message: '客户准入资料不完整或不符合主体规则',
    });
  }

  private documentInvalid(): ConflictException {
    return new ConflictException({
      code: 'CUSTOMER_DOCUMENT_INVALID',
      message: '身份证明材料不符合准入规则',
    });
  }

  private identityDuplicate(): ConflictException {
    return new ConflictException({
      code: 'CUSTOMER_IDENTITY_DUPLICATE',
      message: '本部门已有相同证件号码的客户',
    });
  }

  private idempotencyConflict(): ConflictException {
    return new ConflictException({
      code: 'IDEMPOTENCY_CONFLICT',
      message: '该 Idempotency-Key 已用于不同请求',
    });
  }

  private corruptReceipt(): InternalServerErrorException {
    return new InternalServerErrorException({
      code: 'INTERNAL_ERROR',
      message: '客户准入回执数据损坏',
    });
  }

  private validationError(): BadRequestException {
    return new BadRequestException({
      code: 'VALIDATION_ERROR',
      message: '请求字段不符合接口要求',
    });
  }

  private isUniqueConstraintError(error: unknown): boolean {
    if (error === null || typeof error !== 'object') return false;
    const record = error as Record<string, unknown>;
    if (record.code === 'P2002') return true;
    return this.isUniqueConstraintError(record.cause);
  }

  private isSerializationConflict(error: unknown): boolean {
    if (error === null || typeof error !== 'object') return false;
    const record = error as Record<string, unknown>;
    if (record.code === 'P2034') return true;
    return this.isSerializationConflict(record.cause);
  }
}
