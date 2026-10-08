import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import {
  AccessControlService,
  CustomerAction,
} from '../../access-control/access-control.service';
import { ActorContext } from '../../access-control/actor-context';
import { DatabaseService } from '../../database/database.service';
import type { Prisma } from '../../generated/prisma/client';
import { MaterialService } from '../materials';
import type {
  CustomerRightAssetAction,
  CustomerRightAssetType,
  CustomerRightAssetValidityMode,
} from '../../generated/prisma/enums';
import {
  CreateRightAssetDto,
  ReviseRightAssetDto,
  RightAssetFieldsDto,
  WithdrawRightAssetDto,
} from './right-asset.dto';
import {
  RightAssetCommandResult,
  RightAssetDetail,
  RightAssetSummary,
  RightAssetVersionView,
} from './right-asset.response.dto';

type Fields = {
  type: CustomerRightAssetType;
  name: string;
  number: string | null;
  category: string;
  holderId: string;
  ownerText: string | null;
  trademarkClass: string | null;
  validFrom: Date | null;
  validTo: Date | null;
  validityMode: CustomerRightAssetValidityMode;
};
type VersionRecord = Fields & {
  id: string;
  version: number;
  action: CustomerRightAssetAction;
  withdrawReason: string | null;
  recordedByUserId: string;
  recordedAt: Date;
  evidenceContentVersionIds: string[];
  evidenceReferences?: Array<{
    materialId: string;
    contentVersionId: string;
    contentVersion: {
      originalFilename: string;
      mimeType: string;
      sizeBytes: bigint;
      createdAt: Date;
    };
  }>;
};
type AssetRecord = {
  id: string;
  customerId: string;
  departmentId: string;
  version: number;
  withdrawn: boolean;
  currentVersion: VersionRecord | null;
};
type CommandInput =
  CreateRightAssetDto | ReviseRightAssetDto | WithdrawRightAssetDto;
type ReceiptRecord = {
  requestFingerprint: string;
  customerId: string;
  assetId: string;
  departmentId: string;
  resultVersionId: string;
  resultCustomerVersion: number;
};

@Injectable()
export class RightAssetService {
  constructor(
    private readonly database: DatabaseService,
    private readonly accessControl: AccessControlService,
    private readonly materials: MaterialService,
  ) {}

  create(
    actor: ActorContext,
    customerId: string,
    key: string,
    input: CreateRightAssetDto,
  ) {
    return this.command(actor, customerId, undefined, key, 'CREATE', input);
  }

  revise(
    actor: ActorContext,
    customerId: string,
    assetId: string,
    key: string,
    input: ReviseRightAssetDto,
  ) {
    return this.command(actor, customerId, assetId, key, 'REVISE', input);
  }

  withdraw(
    actor: ActorContext,
    customerId: string,
    assetId: string,
    key: string,
    input: WithdrawRightAssetDto,
  ) {
    return this.command(actor, customerId, assetId, key, 'WITHDRAW', input);
  }

  async list(
    actor: ActorContext,
    customerId: string,
    page: number,
    pageSize: number,
  ) {
    if (this.isExternal(actor))
      throw this.notFound('CUSTOMER_NOT_FOUND', '客户不存在或不可访问');
    const readScope = await this.accessControl.buildCustomerScope(
      actor,
      'customer.read',
    );
    const customer = await this.database.customer.findFirst({
      where: { id: customerId, ...readScope },
      select: { id: true },
    });
    if (!customer)
      throw this.notFound('CUSTOMER_NOT_FOUND', '客户不存在或不可访问');
    const editScope = await this.accessControl.tryBuildCustomerScope(
      actor,
      'customer.edit-routine',
    );
    const canCreate =
      editScope !== null &&
      !!(await this.database.customer.findFirst({
        where: { id: customerId, ...editScope },
        select: { id: true },
      }));
    const where = { customerId, departmentId: actor.departmentId };
    const [rows, total] = await this.database.$transaction([
      this.database.customerRightAsset.findMany({
        where,
        include: {
          currentVersion: {
            include: {
              evidenceReferences: { include: { contentVersion: true } },
            },
          },
        },
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.database.customerRightAsset.count({ where }),
    ]);
    return {
      items: rows.map((row) => this.summary(row)),
      total,
      page,
      pageSize,
      capabilities: { create: canCreate },
    };
  }

  async get(
    actor: ActorContext,
    customerId: string,
    assetId: string,
  ): Promise<RightAssetDetail> {
    if (this.isExternal(actor))
      throw this.notFound('CUSTOMER_NOT_FOUND', '客户不存在或不可访问');
    const readScope = await this.accessControl.buildCustomerScope(
      actor,
      'customer.read',
    );
    const customer = await this.database.customer.findFirst({
      where: { id: customerId, ...readScope },
      select: {
        id: true,
        departmentId: true,
        responsibleUserId: true,
        teamId: true,
      },
    });
    if (!customer)
      throw this.notFound('CUSTOMER_NOT_FOUND', '客户不存在或不可访问');
    const asset = await this.database.customerRightAsset.findFirst({
      where: { id: assetId, customerId, departmentId: actor.departmentId },
      include: {
        currentVersion: {
          include: {
            evidenceReferences: { include: { contentVersion: true } },
          },
        },
        versions: {
          orderBy: { version: 'desc' },
          include: {
            evidenceReferences: { include: { contentVersion: true } },
          },
        },
      },
    });
    if (!asset)
      throw this.notFound('RIGHT_ASSET_NOT_FOUND', '权利资产不存在或不可访问');
    const facts = {
      departmentId: customer.departmentId,
      responsibleUserId: customer.responsibleUserId,
      teamId: customer.teamId ?? undefined,
    };
    const [canRevise, canWithdraw] = await Promise.all([
      this.accessControl.canAuthorizeCustomer(
        actor,
        'customer.edit-routine',
        facts,
      ),
      this.accessControl.canAuthorizeCustomer(
        actor,
        'customer.right-asset.withdraw',
        facts,
      ),
    ]);
    return {
      ...this.summary(asset),
      history: asset.versions.map((version) => this.version(version)),
      capabilities: {
        revise: !asset.withdrawn && canRevise,
        withdraw: !asset.withdrawn && canWithdraw,
      },
    };
  }

  private async command(
    actor: ActorContext,
    customerId: string,
    assetId: string | undefined,
    key: string,
    action: CustomerRightAssetAction,
    input: CommandInput,
  ): Promise<RightAssetCommandResult> {
    if (this.isExternal(actor))
      throw new ForbiddenException({
        code: 'CUSTOMER_ACTION_FORBIDDEN',
        message: '无权执行此客户操作',
      });
    const attachmentCommand =
      action === 'WITHDRAW'
        ? { mode: 'PRESERVE' as const }
        : action === 'CREATE'
          ? {
              mode: 'SET' as const,
              ids: this.normalizeEvidence(
                (input as CreateRightAssetDto).contentVersionIds ?? [],
              ),
            }
          : (input as ReviseRightAssetDto).contentVersionIds === undefined
            ? { mode: 'PRESERVE' as const }
            : {
                mode: 'SET' as const,
                ids: this.normalizeEvidence(
                  (input as ReviseRightAssetDto).contentVersionIds ?? [],
                ),
              };
    const normalized =
      action === 'WITHDRAW'
        ? {
            expectedCustomerVersion: input.expectedCustomerVersion,
            expectedAssetVersion: (input as WithdrawRightAssetDto)
              .expectedAssetVersion,
            reason: this.required(
              (input as WithdrawRightAssetDto).reason,
              500,
              '撤下原因',
            ),
          }
        : {
            expectedCustomerVersion: input.expectedCustomerVersion,
            ...(action === 'REVISE'
              ? {
                  expectedAssetVersion: (input as ReviseRightAssetDto)
                    .expectedAssetVersion,
                }
              : {}),
            fields: this.normalizeFields(input as RightAssetFieldsDto),
          };
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify({
          action,
          customerId,
          assetId: assetId ?? null,
          ...(action !== 'WITHDRAW' &&
          'contentVersionIds' in input &&
          input.contentVersionIds !== undefined
            ? { attachmentCommand }
            : {}),
          ...normalized,
        }),
      )
      .digest('hex');
    try {
      return await this.database.$transaction(async (tx) => {
        const locked = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM customers WHERE id = ${customerId}::uuid AND department_id = ${actor.departmentId}::uuid FOR UPDATE`;
        if (locked.length === 0)
          throw this.notFound('CUSTOMER_NOT_FOUND', '客户不存在或不可访问');
        const requiredAction: CustomerAction =
          action === 'WITHDRAW'
            ? 'customer.right-asset.withdraw'
            : 'customer.edit-routine';
        const [readScope, writeScope] = await Promise.all([
          this.accessControl.buildCustomerScope(actor, 'customer.read', tx),
          this.accessControl.buildCustomerScope(actor, requiredAction, tx),
        ]);
        const customer = await tx.customer.findFirst({
          where: { id: customerId, AND: [readScope, writeScope] },
          select: { id: true, version: true },
        });
        if (!customer)
          throw this.notFound('CUSTOMER_NOT_FOUND', '客户不存在或不可访问');

        const receipt = await tx.customerRightAssetReceipt.findUnique({
          where: this.receiptWhere(actor, action, key),
        });
        if (receipt)
          return this.rebuildReceipt(
            tx,
            receipt,
            fingerprint,
            customerId,
            assetId,
          );

        const current =
          assetId === undefined
            ? null
            : await tx.customerRightAsset.findFirst({
                where: {
                  id: assetId,
                  customerId,
                  departmentId: actor.departmentId,
                },
                include: { currentVersion: true },
              });
        if (assetId !== undefined && !current)
          throw this.notFound(
            'RIGHT_ASSET_NOT_FOUND',
            '权利资产不存在或不可访问',
          );
        if (current?.withdrawn)
          throw this.conflict('RIGHT_ASSET_WITHDRAWN', '该权利资产已撤下');
        const expectedAssetVersion =
          'expectedAssetVersion' in normalized
            ? normalized.expectedAssetVersion
            : undefined;
        if (current && current.version !== expectedAssetVersion)
          throw this.conflict(
            'RIGHT_ASSET_VERSION_CONFLICT',
            '权利资产版本已变化，请刷新后重试',
          );
        if (customer.version !== input.expectedCustomerVersion)
          throw this.conflict(
            'CUSTOMER_VERSION_CONFLICT',
            '客户资料已变化，请刷新后重试',
          );

        const fields =
          action === 'WITHDRAW'
            ? this.fieldsFromVersion(current?.currentVersion)
            : (normalized as { fields: Fields }).fields;
        const holder = await tx.customerRightsHolderLink.findFirst({
          where: {
            customerId,
            rightsHolderId: fields.holderId,
            departmentId: actor.departmentId,
          },
          select: { id: true },
        });
        if (!holder)
          throw this.notFound(
            'RIGHTS_HOLDER_NOT_FOUND',
            '权利主体未关联当前客户',
          );

        const selectedEvidenceIds =
          attachmentCommand.mode === 'SET'
            ? attachmentCommand.ids
            : (current?.currentVersion?.evidenceContentVersionIds ?? []);
        const evidenceFacts = await this.materials.assertAvailableVersions(
          tx,
          actor,
          {
            ownerType: 'CUSTOMER',
            ownerId: customerId,
            category: 'CUSTOMER_RIGHT_EVIDENCE',
            contentVersionIds: selectedEvidenceIds,
            minCount: 0,
            maxCount: 10,
          },
        );
        if (
          evidenceFacts.some(
            (fact) => fact.purpose !== 'CUSTOMER_RIGHT_EVIDENCE',
          )
        )
          throw this.validation('权属证明类别无效');

        const updatedCustomer = await tx.customer.updateMany({
          where: {
            id: customerId,
            departmentId: actor.departmentId,
            version: input.expectedCustomerVersion,
          },
          data: { version: { increment: 1 } },
        });
        if (updatedCustomer.count !== 1)
          throw this.conflict(
            'CUSTOMER_VERSION_CONFLICT',
            '客户资料已变化，请刷新后重试',
          );
        const resolvedAssetId = assetId ?? randomUUID();
        const nextVersion = (current?.version ?? 0) + 1;
        const versionId = randomUUID();
        if (!current) {
          await tx.customerRightAsset.create({
            data: {
              id: resolvedAssetId,
              customerId,
              departmentId: actor.departmentId,
              holderId: fields.holderId,
              version: 1,
            },
          });
        } else {
          const updated = await tx.customerRightAsset.updateMany({
            where: {
              id: resolvedAssetId,
              customerId,
              departmentId: actor.departmentId,
              version: expectedAssetVersion,
              withdrawn: false,
            },
            data: {
              version: { increment: 1 },
              holderId: fields.holderId,
              withdrawn: action === 'WITHDRAW',
            },
          });
          if (updated.count !== 1)
            throw this.conflict(
              'RIGHT_ASSET_VERSION_CONFLICT',
              '权利资产版本已变化，请刷新后重试',
            );
        }
        const audit = await tx.auditEvent.create({
          data: {
            departmentId: actor.departmentId,
            actorUserId: actor.userId,
            resourceType: 'right-asset',
            resourceId: resolvedAssetId,
            action:
              action === 'CREATE'
                ? 'right-asset.created'
                : action === 'REVISE'
                  ? 'right-asset.revised'
                  : 'right-asset.withdrawn',
            details: {
              customerId,
              assetId: resolvedAssetId,
              version: nextVersion,
            },
          },
        });
        await tx.customerRightAssetVersion.create({
          data: {
            id: versionId,
            assetId: resolvedAssetId,
            customerId,
            departmentId: actor.departmentId,
            version: nextVersion,
            action,
            ...fields,
            withdrawReason:
              action === 'WITHDRAW'
                ? (normalized as { reason: string }).reason
                : null,
            recordedByUserId: actor.userId,
            auditEventId: audit.id,
            evidenceContentVersionIds: selectedEvidenceIds,
          },
        });
        if (evidenceFacts.length > 0) {
          const frozen = await this.materials.freezeReferences(tx, {
            departmentId: actor.departmentId,
            resourceType: 'right_asset_version',
            resourceId: versionId,
            assetVersionId: versionId,
            actionEventId: audit.id,
            facts: evidenceFacts,
          });
          if (frozen.count !== evidenceFacts.length)
            throw this.conflict(
              'RIGHT_ASSET_EVIDENCE_CONFLICT',
              '权属证明引用未完整冻结',
            );
        }
        await tx.customerRightAsset.update({
          where: { id: resolvedAssetId },
          data: { currentVersionId: versionId },
        });
        await tx.customerRightAssetReceipt.create({
          data: {
            departmentId: actor.departmentId,
            actorUserId: actor.userId,
            customerId,
            assetId: resolvedAssetId,
            resultVersionId: versionId,
            action,
            idempotencyKey: key,
            requestFingerprint: fingerprint,
            resultCustomerVersion: input.expectedCustomerVersion + 1,
          },
        });
        const storedVersion =
          await tx.customerRightAssetVersion.findUniqueOrThrow({
            where: { id: versionId },
            include: {
              evidenceReferences: { include: { contentVersion: true } },
            },
          });
        return {
          assetId: resolvedAssetId,
          customerId,
          departmentId: actor.departmentId,
          version: nextVersion,
          withdrawn: action === 'WITHDRAW',
          fields: this.version(storedVersion),
          customerVersion: input.expectedCustomerVersion + 1,
        };
      });
    } catch (error) {
      if (!this.isUniqueError(error)) throw error;
      const receipt = await this.database.customerRightAssetReceipt.findUnique({
        where: this.receiptWhere(actor, action, key),
      });
      if (!receipt)
        throw this.conflict(
          'RIGHT_ASSET_VERSION_CONFLICT',
          '权利资产版本已变化，请刷新后重试',
        );
      const requiredAction: CustomerAction =
        action === 'WITHDRAW'
          ? 'customer.right-asset.withdraw'
          : 'customer.edit-routine';
      const [readScope, writeScope] = await Promise.all([
        this.accessControl.buildCustomerScope(actor, 'customer.read'),
        this.accessControl.buildCustomerScope(actor, requiredAction),
      ]);
      const customer = await this.database.customer.findFirst({
        where: { id: customerId, AND: [readScope, writeScope] },
        select: { id: true },
      });
      if (!customer)
        throw this.notFound('CUSTOMER_NOT_FOUND', '客户不存在或不可访问');
      return this.rebuildReceipt(
        this.database,
        receipt,
        fingerprint,
        customerId,
        assetId,
      );
    }
  }

  private async rebuildReceipt(
    reader: DatabaseService | Prisma.TransactionClient,
    receipt: ReceiptRecord,
    fingerprint: string,
    customerId: string,
    assetId: string | undefined,
  ): Promise<RightAssetCommandResult> {
    if (receipt.requestFingerprint !== fingerprint)
      throw this.conflict(
        'IDEMPOTENCY_CONFLICT',
        '该 Idempotency-Key 已用于不同请求',
      );
    if (
      receipt.customerId !== customerId ||
      (assetId !== undefined && receipt.assetId !== assetId)
    ) {
      throw this.conflict(
        'IDEMPOTENCY_CONFLICT',
        '该 Idempotency-Key 已用于不同请求',
      );
    }
    const version = await reader.customerRightAssetVersion.findFirst({
      where: {
        id: receipt.resultVersionId,
        assetId: receipt.assetId,
        customerId,
        departmentId: receipt.departmentId,
      },
      include: { evidenceReferences: { include: { contentVersion: true } } },
    });
    if (!version)
      throw this.notFound('RIGHT_ASSET_NOT_FOUND', '权利资产不存在或不可访问');
    return {
      assetId: receipt.assetId,
      customerId,
      departmentId: receipt.departmentId,
      version: version.version,
      withdrawn: version.action === 'WITHDRAW',
      fields: this.version(version),
      customerVersion: receipt.resultCustomerVersion,
    };
  }

  private normalizeFields(input: RightAssetFieldsDto): Fields {
    const validFrom = this.date(input.validFrom, '起始日期');
    const validTo = this.date(input.validTo, '截止日期');
    if (input.validityMode === 'FIXED' && !validTo)
      throw this.validation('固定期限必须填写真实截止日期');
    if (input.validityMode !== 'FIXED' && validTo)
      throw this.validation('长期或未知期限不能填写截止日期');
    if (validFrom && validTo && validFrom > validTo)
      throw this.validation('起始日期不能晚于截止日期');
    return {
      type: input.type,
      name: this.required(input.name, 200, '资产名称'),
      number: this.optional(input.number, 200, '资产号码'),
      category: this.required(input.category, 200, '资产类别'),
      holderId: input.holderId,
      ownerText: this.optional(input.ownerText, 200, '权利人文字'),
      trademarkClass: this.optional(input.trademarkClass, 100, '商标分类'),
      validFrom,
      validTo,
      validityMode: input.validityMode,
    };
  }

  private isExternal(actor: ActorContext): boolean {
    return (
      actor.clientCustomerId !== undefined ||
      actor.notaryOfficeId !== undefined ||
      actor.lawyerAccountId !== undefined
    );
  }

  private normalizeEvidence(ids: string[]): string[] {
    if (
      !Array.isArray(ids) ||
      ids.length > 10 ||
      ids.some(
        (id) =>
          typeof id !== 'string' ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
            id,
          ),
      ) ||
      new Set(ids).size !== ids.length
    )
      throw this.validation('单次最多选择 10 份不同的真实权属证明');
    return [...ids].sort();
  }

  private fieldsFromVersion(version: VersionRecord | null | undefined): Fields {
    if (!version)
      throw this.notFound('RIGHT_ASSET_NOT_FOUND', '权利资产不存在或不可访问');
    return {
      type: version.type,
      name: version.name,
      number: version.number,
      category: version.category,
      holderId: version.holderId,
      ownerText: version.ownerText,
      trademarkClass: version.trademarkClass,
      validFrom: version.validFrom,
      validTo: version.validTo,
      validityMode: version.validityMode,
    };
  }

  private version(row: VersionRecord): RightAssetVersionView {
    return {
      id: row.id,
      version: row.version,
      action: row.action,
      type: row.type,
      name: row.name,
      number: row.number,
      category: row.category,
      holderId: row.holderId,
      ownerText: row.ownerText,
      trademarkClass: row.trademarkClass,
      validFrom: row.validFrom?.toISOString().slice(0, 10) ?? null,
      validTo: row.validTo?.toISOString().slice(0, 10) ?? null,
      validityMode: row.validityMode,
      withdrawReason: row.withdrawReason,
      recordedByUserId: row.recordedByUserId,
      recordedAt: row.recordedAt.toISOString(),
      evidence: (row.evidenceReferences ?? [])
        .map((reference) => ({
          materialId: reference.materialId,
          contentVersionId: reference.contentVersionId,
          originalFilename: reference.contentVersion.originalFilename,
          mimeType: reference.contentVersion.mimeType,
          sizeBytes: Number(reference.contentVersion.sizeBytes),
          createdAt: reference.contentVersion.createdAt.toISOString(),
        }))
        .sort((left, right) =>
          left.contentVersionId.localeCompare(right.contentVersionId),
        ),
    };
  }

  private summary(row: AssetRecord): RightAssetSummary {
    if (!row.currentVersion)
      throw this.notFound('RIGHT_ASSET_NOT_FOUND', '权利资产当前版本缺失');
    return {
      assetId: row.id,
      customerId: row.customerId,
      departmentId: row.departmentId,
      version: row.version,
      withdrawn: row.withdrawn,
      fields: this.version(row.currentVersion),
    };
  }

  private date(value: string | null | undefined, label: string): Date | null {
    if (value === null || value === undefined || value === '') return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
      throw this.validation(`${label}必须为 YYYY-MM-DD`);
    if (value.startsWith('0000-'))
      throw this.validation(`${label}不是有效公历日期`);
    const parsed = new Date(`${value}T00:00:00.000Z`);
    if (
      Number.isNaN(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== value
    )
      throw this.validation(`${label}不是有效公历日期`);
    return parsed;
  }

  private required(value: string, max: number, label: string): string {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    if (!trimmed || trimmed.length > max)
      throw this.validation(`${label}长度必须为 1 至 ${max} 个字符`);
    return trimmed;
  }

  private optional(
    value: string | null | undefined,
    max: number,
    label: string,
  ): string | null {
    if (value === null || value === undefined) return null;
    const trimmed = value.trim();
    if (trimmed.length > max)
      throw this.validation(`${label}不能超过 ${max} 个字符`);
    return trimmed || null;
  }

  private receiptWhere(
    actor: ActorContext,
    action: CustomerRightAssetAction,
    key: string,
  ) {
    return {
      departmentId_actorUserId_action_idempotencyKey: {
        departmentId: actor.departmentId,
        actorUserId: actor.userId,
        action,
        idempotencyKey: key,
      },
    };
  }

  private isUniqueError(error: unknown): boolean {
    if (error === null || typeof error !== 'object') return false;
    const record = error as Record<string, unknown>;
    return record.code === 'P2002' || this.isUniqueError(record.cause);
  }

  private validation(message: string): BadRequestException {
    return new BadRequestException({ code: 'VALIDATION_ERROR', message });
  }

  private conflict(code: string, message: string): ConflictException {
    return new ConflictException({ code, message });
  }

  private notFound(code: string, message: string): NotFoundException {
    return new NotFoundException({ code, message });
  }
}
