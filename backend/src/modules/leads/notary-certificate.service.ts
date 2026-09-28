import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { ActorContext } from '../../access-control/actor-context';
import { DatabaseService } from '../../database/database.service';
import { Prisma } from '../../generated/prisma/client';
import { MaterialService } from '../materials';
import { CaseCreationService } from '../cases';

type FeeInput = { state: 'KNOWN' | 'PENDING'; amount: string | null };
export type CertificateInput = {
  expectedVersion: number;
  certificateNo: string;
  certificateDate: string;
  contentVersionIds: string[];
  needDisclose: boolean;
  disclosureContentVersionIds: string[];
  fees: { notary: FeeInput; investigation: FeeInput; disclosure: FeeInput };
};
type CertificateFile = {
  materialId: string;
  contentVersionId: string;
  originalFilename: string;
  mimeType: string;
};
export type CertificateResult = {
  id: string;
  stage: 'ARCHIVED';
  version: number;
  certificate: {
    certificateNo: string;
    certificateDate: string;
    issuedAt: string;
    files: CertificateFile[];
    needDisclose: boolean;
    disclosureFiles: CertificateFile[];
  };
  case: { id: string; businessNo: string; stage: 'PENDING_MATCH' };
};
const ACTION = 'notary.certificate.issue';
const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const AMOUNT = /^(0|[1-9]\d{0,15})\.\d{2}$/u;

@Injectable()
export class NotaryCertificateService {
  constructor(
    private readonly database: DatabaseService,
    private readonly materials: MaterialService,
    private readonly cases: CaseCreationService,
  ) {}

  async issue(
    actor: ActorContext,
    matterId: string,
    idempotencyKey: string,
    input: CertificateInput,
  ): Promise<CertificateResult> {
    const normalized = this.normalize(input);
    if (
      typeof idempotencyKey !== 'string' ||
      idempotencyKey.trim() !== idempotencyKey ||
      idempotencyKey.length < 1 ||
      idempotencyKey.length > 128
    )
      throw this.validation();
    if (
      actor.notaryOfficeId === undefined ||
      actor.clientCustomerId !== undefined
    )
      throw this.forbidden();
    const fingerprint = createHash('sha256')
      .update(JSON.stringify({ matterId, ...normalized }))
      .digest('hex');
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        return await this.database.$transaction(
          async (tx) => {
            const locked = await tx.$queryRawUnsafe<Array<{ id: string }>>(
              'SELECT "id" FROM "notary_matters" WHERE "id" = $1::uuid AND "department_id" = $2::uuid FOR UPDATE',
              matterId,
              actor.departmentId,
            );
            if (locked.length !== 1) throw this.notFound();
            const matter = await tx.notaryMatter.findFirst({
              where: { id: matterId, departmentId: actor.departmentId },
              select: {
                id: true,
                departmentId: true,
                notaryOfficeId: true,
                stage: true,
                version: true,
                sourceLeadId: true,
                customerId: true,
                rightsHolderId: true,
                responsibleUserId: true,
                sourceLead: { select: { needDisclose: true } },
                evidence: {
                  select: { sampleFeeState: true, sampleFeeAmount: true },
                },
                issuanceDecision: { select: { id: true, decision: true } },
              },
            });
            if (matter === null) throw this.notFound();
            const account = await tx.userAccount.findUnique({
              where: { id: actor.userId },
              select: { accountType: true, active: true },
            });
            if (
              account?.accountType !== 'NOTARY' ||
              !account.active ||
              matter.notaryOfficeId !== actor.notaryOfficeId
            )
              throw this.forbidden();
            const binding = await tx.notaryOfficeAccountBinding.findFirst({
              where: {
                userId: actor.userId,
                departmentId: actor.departmentId,
                notaryOfficeId: actor.notaryOfficeId,
                active: true,
                notaryOffice: { status: 'ACTIVE' },
              },
              select: { id: true },
            });
            if (binding === null) throw this.forbidden();
            const prior = await tx.notaryMatterCommandReceipt.findUnique({
              where: {
                departmentId_actorUserId_action_idempotencyKey: {
                  departmentId: actor.departmentId,
                  actorUserId: actor.userId,
                  action: ACTION,
                  idempotencyKey,
                },
              },
            });
            if (prior !== null)
              return this.replay(tx, prior, matterId, fingerprint);
            if (
              matter.stage !== 'WAITING_CERTIFICATE' ||
              matter.issuanceDecision?.decision !== 'ISSUE' ||
              matter.evidence === null
            )
              throw this.invalidState();
            if (matter.version !== normalized.expectedVersion)
              throw this.versionConflict();
            if (matter.sourceLead.needDisclose !== normalized.needDisclose)
              throw this.validation();
            const certificateFacts =
              await this.materials.assertAvailableVersions(tx, actor, {
                ownerType: 'NOTARY_MATTER',
                ownerId: matterId,
                category: 'NOTARY_CERTIFICATE',
                contentVersionIds: normalized.contentVersionIds,
                minCount: 1,
                maxCount: 20,
              });
            const disclosureFacts = normalized.needDisclose
              ? await this.materials.assertAvailableVersions(tx, actor, {
                  ownerType: 'NOTARY_MATTER',
                  ownerId: matterId,
                  category: 'NOTARY_DISCLOSURE',
                  contentVersionIds: normalized.disclosureContentVersionIds,
                  minCount: 1,
                  maxCount: 20,
                })
              : [];
            const metadata = await tx.contentVersion.findMany({
              where: {
                id: {
                  in: [
                    ...normalized.contentVersionIds,
                    ...normalized.disclosureContentVersionIds,
                  ],
                },
                status: 'AVAILABLE',
              },
              select: { id: true, originalFilename: true, mimeType: true },
            });
            const byId = new Map(metadata.map((item) => [item.id, item]));
            const describe = (
              facts: readonly {
                materialId: string;
                contentVersionId: string;
                mimeType: string;
              }[],
            ): CertificateFile[] =>
              facts.map((fact) => {
                const item = byId.get(fact.contentVersionId);
                if (item === undefined || item.mimeType !== fact.mimeType)
                  throw this.validation();
                return {
                  materialId: fact.materialId,
                  contentVersionId: fact.contentVersionId,
                  originalFilename: item.originalFilename,
                  mimeType: item.mimeType,
                };
              });
            const files = describe(certificateFacts);
            const disclosureFiles = describe(disclosureFacts);
            const changed = await tx.notaryMatter.updateMany({
              where: {
                id: matterId,
                departmentId: actor.departmentId,
                stage: 'WAITING_CERTIFICATE',
                version: normalized.expectedVersion,
              },
              data: {
                stage: 'ARCHIVED',
                version: normalized.expectedVersion + 1,
              },
            });
            if (changed.count !== 1) throw this.versionConflict();
            const issuedAt = new Date();
            const certificate = await tx.notaryCertificate.create({
              data: {
                matterId,
                departmentId: actor.departmentId,
                issuanceDecisionId: matter.issuanceDecision.id,
                notaryOfficeAccountBindingId: binding.id,
                actorUserId: actor.userId,
                certificateNo: normalized.certificateNo,
                certificateDate: new Date(
                  `${normalized.certificateDate}T00:00:00.000Z`,
                ),
                needDisclose: normalized.needDisclose,
                issuedAt,
                fromVersion: normalized.expectedVersion,
                toVersion: normalized.expectedVersion + 1,
              },
            });
            await tx.notaryCertificateFee.createMany({
              data: (['notary', 'investigation', 'disclosure'] as const).map(
                (key) => ({
                  certificateId: certificate.id,
                  category: key.toUpperCase() as
                    'NOTARY' | 'INVESTIGATION' | 'DISCLOSURE',
                  state: normalized.fees[key].state,
                  amount: normalized.fees[key].amount,
                }),
              ),
            });
            const createdCase = await this.cases.createFromNotaryCertificate(
              tx,
              {
                departmentId: actor.departmentId,
                sourceLeadId: matter.sourceLeadId,
                sourceNotaryMatterId: matterId,
                certificateId: certificate.id,
                customerId: matter.customerId,
                rightsHolderId: matter.rightsHolderId,
                responsibleUserId: matter.responsibleUserId,
                issuedAt,
              },
            );
            const result: CertificateResult = {
              id: matterId,
              stage: 'ARCHIVED',
              version: normalized.expectedVersion + 1,
              certificate: {
                certificateNo: normalized.certificateNo,
                certificateDate: normalized.certificateDate,
                issuedAt: issuedAt.toISOString(),
                files,
                needDisclose: normalized.needDisclose,
                disclosureFiles,
              },
              case: {
                id: createdCase.id,
                businessNo: createdCase.businessNo,
                stage: 'PENDING_MATCH',
              },
            };
            const audit = await tx.auditEvent.create({
              data: {
                departmentId: actor.departmentId,
                actorUserId: actor.userId,
                notaryOfficeAccountBindingId: binding.id,
                resourceType: 'notary_matter',
                resourceId: matterId,
                action: 'notary.certificate_issued',
                details: {
                  certificateId: certificate.id,
                  caseId: createdCase.id,
                  certificateNo: normalized.certificateNo,
                  fromStage: 'WAITING_CERTIFICATE',
                  toStage: 'ARCHIVED',
                  fromVersion: normalized.expectedVersion,
                  toVersion: result.version,
                  contentVersionIds: normalized.contentVersionIds,
                  disclosureContentVersionIds:
                    normalized.disclosureContentVersionIds,
                },
              },
            });
            await this.materials.freezeReferences(tx, {
              departmentId: actor.departmentId,
              resourceType: 'notary_matter',
              resourceId: matterId,
              facts: [...certificateFacts, ...disclosureFacts],
              actionEventId: audit.id,
            });
            await tx.notaryMatterCommandReceipt.create({
              data: {
                departmentId: actor.departmentId,
                actorUserId: actor.userId,
                notaryOfficeAccountBindingId: binding.id,
                action: ACTION,
                idempotencyKey,
                requestFingerprint: fingerprint,
                resultMatterId: matterId,
                resultMatterVersion: result.version,
                resultSnapshot: result,
              },
            });
            return result;
          },
          { isolationLevel: 'Serializable' },
        );
      } catch (error) {
        if (this.isRetryable(error)) {
          if (attempt < 3) continue;
          throw this.versionConflict();
        }
        throw error;
      }
    }
    throw this.versionConflict();
  }

  private normalize(input: CertificateInput): CertificateInput {
    const certificateNo =
      typeof input?.certificateNo === 'string'
        ? input.certificateNo.trim()
        : '';
    const date =
      typeof input?.certificateDate === 'string' ? input.certificateDate : '';
    const validDate =
      /^\d{4}-\d{2}-\d{2}$/u.test(date) &&
      !Number.isNaN(Date.parse(`${date}T00:00:00.000Z`)) &&
      new Date(`${date}T00:00:00.000Z`).toISOString().slice(0, 10) === date;
    const ids = input?.contentVersionIds;
    const disclosureIds = input?.disclosureContentVersionIds;
    const validIds = (values: unknown, min: number) =>
      Array.isArray(values) &&
      values.length >= min &&
      values.length <= 20 &&
      values.every((id) => typeof id === 'string' && UUID_V4.test(id)) &&
      new Set(values).size === values.length;
    const validFee = (fee: FeeInput | undefined) =>
      fee !== undefined &&
      ((fee.state === 'KNOWN' &&
        typeof fee.amount === 'string' &&
        AMOUNT.test(fee.amount)) ||
        (fee.state === 'PENDING' && fee.amount === null));
    if (
      !Number.isInteger(input?.expectedVersion) ||
      input.expectedVersion < 1 ||
      certificateNo.length < 1 ||
      certificateNo.length > 200 ||
      Array.from(certificateNo).some((character) => {
        const code = character.codePointAt(0) ?? 0;
        return code < 32 || code === 127;
      }) ||
      !validDate ||
      !validIds(ids, 1) ||
      typeof input.needDisclose !== 'boolean' ||
      !validIds(disclosureIds, input.needDisclose ? 1 : 0) ||
      (!input.needDisclose && disclosureIds.length !== 0) ||
      !validFee(input.fees?.notary) ||
      !validFee(input.fees?.investigation) ||
      !validFee(input.fees?.disclosure)
    )
      throw this.validation();
    return {
      expectedVersion: input.expectedVersion,
      certificateNo,
      certificateDate: date,
      contentVersionIds: [...ids],
      needDisclose: input.needDisclose,
      disclosureContentVersionIds: [...disclosureIds],
      fees: {
        notary: { ...input.fees.notary },
        investigation: { ...input.fees.investigation },
        disclosure: { ...input.fees.disclosure },
      },
    };
  }

  private async replay(
    tx: Prisma.TransactionClient,
    receipt: {
      requestFingerprint: string;
      resultMatterId: string;
      resultMatterVersion: number;
      resultSnapshot: Prisma.JsonValue;
    },
    matterId: string,
    fingerprint: string,
  ): Promise<CertificateResult> {
    if (
      receipt.requestFingerprint !== fingerprint ||
      receipt.resultMatterId !== matterId
    )
      throw new ConflictException({
        code: 'IDEMPOTENCY_CONFLICT',
        message: '该 Idempotency-Key 已用于不同请求',
      });
    const snapshot = receipt.resultSnapshot;
    if (
      snapshot === null ||
      typeof snapshot !== 'object' ||
      Array.isArray(snapshot)
    )
      throw this.corruptReceipt();
    const result = snapshot as Record<string, unknown>;
    const createdCase = result.case;
    if (
      result.id !== matterId ||
      result.stage !== 'ARCHIVED' ||
      result.version !== receipt.resultMatterVersion ||
      createdCase === null ||
      typeof createdCase !== 'object' ||
      Array.isArray(createdCase)
    )
      throw this.corruptReceipt();
    const caseValue = createdCase as Record<string, unknown>;
    const certificate = result.certificate;
    if (
      typeof caseValue.id !== 'string' ||
      typeof caseValue.businessNo !== 'string' ||
      caseValue.stage !== 'PENDING_MATCH'
    )
      throw this.corruptReceipt();
    if (
      certificate === null ||
      typeof certificate !== 'object' ||
      Array.isArray(certificate)
    )
      throw this.corruptReceipt();
    const certificateValue = certificate as Record<string, unknown>;
    if (
      typeof certificateValue.certificateNo !== 'string' ||
      typeof certificateValue.certificateDate !== 'string' ||
      typeof certificateValue.issuedAt !== 'string' ||
      typeof certificateValue.needDisclose !== 'boolean' ||
      !Array.isArray(certificateValue.files) ||
      certificateValue.files.length < 1 ||
      !Array.isArray(certificateValue.disclosureFiles)
    )
      throw this.corruptReceipt();
    const stored = await this.cases.readReceiptIdentity(
      tx,
      caseValue.id,
      matterId,
    );
    if (
      stored === null ||
      stored.businessNo !== caseValue.businessNo ||
      stored.certificate.toVersion !== result.version ||
      stored.certificate.certificateNo !== certificateValue.certificateNo ||
      stored.certificate.certificateDate.toISOString().slice(0, 10) !==
        certificateValue.certificateDate ||
      stored.certificate.issuedAt.toISOString() !== certificateValue.issuedAt ||
      stored.certificate.needDisclose !== certificateValue.needDisclose
    )
      throw this.corruptReceipt();
    return snapshot as CertificateResult;
  }
  private isRetryable(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      (error.code === 'P2034' || error.code === 'P2002')
    );
  }
  private validation() {
    return new BadRequestException({
      code: 'VALIDATION_ERROR',
      message: '出证信息无效',
    });
  }
  private forbidden() {
    return new ForbiddenException({
      code: 'ACTION_FORBIDDEN',
      message: '无权办理出证',
    });
  }
  private notFound() {
    return new NotFoundException({
      code: 'RESOURCE_NOT_FOUND',
      message: '公证事项不存在或不可访问',
    });
  }
  private invalidState() {
    return new ConflictException({
      code: 'INVALID_STATE',
      message: '该公证事项当前不能出证',
    });
  }
  private versionConflict() {
    return new ConflictException({
      code: 'VERSION_CONFLICT',
      message: '公证事项状态或版本已变化',
    });
  }
  private corruptReceipt() {
    return new InternalServerErrorException({
      code: 'RECEIPT_CORRUPT',
      message: '出证回执不可用',
    });
  }
}
