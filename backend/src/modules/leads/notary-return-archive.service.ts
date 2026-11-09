import { createHash } from 'node:crypto';
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
import { ArchiveNotaryReturnDto } from './notary-return-archive.dto';

import { syncNotaryMatterCost, syncNotaryReturnFees } from '../settlements';
import {
  NOTARY_ARCHIVE_TYPES,
  type NotaryArchiveType,
} from './notary-return-archive.dto';

type Choice = NonNullable<ArchiveNotaryReturnDto['returnChoice']>;
type ArchiveFields = {
  archiveType: NotaryArchiveType;
  archiveDate?: string;
  notaryFeeAmount: string;
  sampleFeeAmount?: string;
};
const returnChoices: Partial<Record<NotaryArchiveType, Choice>> = {
  NOT_SHIPPED_REFUND_ONLY: 'REFUND_ONLY',
  RECEIVED_KEEP: 'KEEP',
  RECEIVED_RETURN_REFUND: 'RETURN',
};
const businessDay = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
type AmountInput = NonNullable<ArchiveNotaryReturnDto['refund']>;
type AmountSummary = {
  state: 'KNOWN' | 'PENDING';
  amount: string | null;
  partyKind: AmountInput['partyKind'] | null;
  partyName: string | null;
};
type Normalized = {
  returnChoice: Choice | null;
  archiveFields?: ArchiveFields;
  refund: AmountSummary | null;
  freight: AmountSummary | null;
  archiveReason: string;
  expectedVersion: number;
};
export type ReturnArchiveResult = {
  id: string;
  stage: 'ARCHIVED';
  version: number;
  returnArchive: Omit<Normalized, 'expectedVersion' | 'archiveFields'> & {
    archiveType?: NotaryArchiveType;
    archiveDate?: string;
    notaryFeeAmount?: string;
    sampleFeeAmount?: string | null;
    archivedAt: string;
    actorDisplayName: string;
  };
};
const ACTION = 'notary.return.archive';
const AMOUNT = /^(0|[1-9]\d{0,15})\.\d{2}$/u;
const keys = (value: object) => Object.keys(value).sort().join();

@Injectable()
export class NotaryReturnArchiveService {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: AccessControlService,
  ) {}

  async archive(
    actor: ActorContext,
    matterId: string,
    idempotencyKey: string,
    input: ArchiveNotaryReturnDto,
  ): Promise<ReturnArchiveResult> {
    const normalized = this.normalize(input);
    if (
      typeof idempotencyKey !== 'string' ||
      idempotencyKey.trim() !== idempotencyKey ||
      idempotencyKey.length < 1 ||
      idempotencyKey.length > 128
    )
      throw this.validation();
    if (
      actor.clientCustomerId !== undefined ||
      actor.notaryOfficeId !== undefined
    )
      throw this.forbidden();
    const fingerprint = createHash('sha256')
      .update(JSON.stringify({ matterId, ...normalized }))
      .digest('hex');
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      let receiptUniqueCollision = false;
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
                departmentId: true,
                sourceLead: {
                  select: { responsibleUserId: true, teamId: true },
                },
              },
            });
            if (matter === null) throw this.notFound();
            const account = await tx.userAccount.findUnique({
              where: { id: actor.userId },
              select: { accountType: true, active: true, displayName: true },
            });
            if (account?.accountType !== 'INTERNAL' || !account.active)
              throw this.forbidden();
            try {
              await this.access.authorizeLead(
                actor,
                ACTION,
                {
                  departmentId: matter.departmentId,
                  responsibleUserId: matter.sourceLead.responsibleUserId,
                  ...(matter.sourceLead.teamId === null
                    ? {}
                    : { teamId: matter.sourceLead.teamId }),
                },
                tx,
              );
            } catch (error) {
              if (error instanceof ForbiddenException) throw this.forbidden();
              throw error;
            }
            const prior = await tx.notaryMatterCommandReceipt.findUnique({
              where: {
                departmentId_actorUserId_action_idempotencyKey: {
                  departmentId: matter.departmentId,
                  actorUserId: actor.userId,
                  action: ACTION,
                  idempotencyKey,
                },
              },
            });
            if (prior !== null)
              return this.replay(tx, prior, matterId, fingerprint);
            const result = await this.archiveLocked(
              tx,
              actor,
              matterId,
              normalized,
              account.displayName.trim(),
            );
            try {
              await tx.notaryMatterCommandReceipt.create({
                data: {
                  departmentId: matter.departmentId,
                  actorUserId: actor.userId,
                  internalActorUserId: actor.userId,
                  action: ACTION,
                  idempotencyKey,
                  requestFingerprint: fingerprint,
                  resultMatterId: matterId,
                  resultMatterVersion: result.version,
                  resultSnapshot: result,
                },
              });
            } catch (error) {
              receiptUniqueCollision = this.isUnique(error);
              throw error;
            }
            return result;
          },
          { isolationLevel: 'Serializable' },
        );
      } catch (error) {
        if (this.isSerializationConflict(error)) {
          if (attempt < 3) continue;
          throw this.versionConflict();
        }
        if (this.isUnique(error)) {
          if (receiptUniqueCollision && attempt < 3) continue;
          throw this.versionConflict();
        }
        throw error;
      }
    }
    throw this.versionConflict();
  }

  async authorizeLocked(
    tx: Prisma.TransactionClient,
    actor: ActorContext,
    matterId: string,
  ): Promise<void> {
    const matter = await tx.notaryMatter.findFirst({
      where: { id: matterId, departmentId: actor.departmentId },
      select: {
        departmentId: true,
        sourceLead: { select: { responsibleUserId: true, teamId: true } },
      },
    });
    if (matter === null) throw this.notFound();
    try {
      await this.access.authorizeLead(
        actor,
        ACTION,
        {
          departmentId: matter.departmentId,
          responsibleUserId: matter.sourceLead.responsibleUserId,
          ...(matter.sourceLead.teamId === null
            ? {}
            : { teamId: matter.sourceLead.teamId }),
        },
        tx,
      );
    } catch (error) {
      if (error instanceof ForbiddenException) throw this.forbidden();
      throw error;
    }
  }

  async archiveLocked(
    tx: Prisma.TransactionClient,
    actor: ActorContext,
    matterId: string,
    normalized: Normalized,
    actorDisplayName: string,
  ): Promise<ReturnArchiveResult> {
    const matter = await tx.notaryMatter.findFirst({
      where: { id: matterId, departmentId: actor.departmentId },
      select: {
        departmentId: true,
        stage: true,
        version: true,
        openingReviewDecision: {
          select: { result: true, reason: true, archivedAt: true },
        },
        issuanceDecision: { select: { id: true, decision: true } },
        costs: {
          where: { category: 'SAMPLE' },
          select: { amount: true, feeDate: true },
        },
        evidence: {
          select: {
            matterId: true,
            evidenceAt: true,
            sampleFeeState: true,
            sampleFeeAmount: true,
          },
        },
      },
    });
    if (matter === null) throw this.notFound();
    const isReturn = matter.stage === 'WAITING_RETURN';
    const fields = normalized.archiveFields;
    if (
      matter.stage === 'ARCHIVED' ||
      (isReturn
        ? normalized.returnChoice === null ||
          matter.openingReviewDecision === null ||
          matter.openingReviewDecision.archivedAt !== null ||
          matter.issuanceDecision?.decision !== 'NO_ISSUE' ||
          matter.evidence === null
        : normalized.returnChoice !== null ||
          fields?.archiveDate === undefined ||
          fields.sampleFeeAmount === undefined)
    )
      throw this.invalidState();
    if (matter.version !== normalized.expectedVersion)
      throw this.versionConflict();
    if (
      normalized.refund !== null &&
      normalized.refund.amount !== null &&
      new Prisma.Decimal(normalized.refund.amount).gt(0)
    ) {
      const sampleAmount =
        fields?.sampleFeeAmount ??
        matter.costs?.[0]?.amount ??
        matter.evidence?.sampleFeeAmount;
      if (sampleAmount == null || matter.evidence === null)
        throw this.originalAmountUnknown();
      const previous = await tx.notaryReturnAmount.findMany({
        where: {
          sourceEvidenceMatterId: matter.evidence.matterId,
          departmentId: matter.departmentId,
          kind: 'REFUND',
          state: 'KNOWN',
        },
        select: { amount: true },
      });
      const total = previous.reduce(
        (sum, row) => sum.plus(row.amount ?? 0),
        new Prisma.Decimal(normalized.refund.amount),
      );
      if (total.gt(sampleAmount)) throw this.refundExceeded();
    }
    const changed = await tx.notaryMatter.updateMany({
      where: {
        id: matterId,
        departmentId: matter.departmentId,
        stage: matter.stage,
        version: normalized.expectedVersion,
      },
      data: { stage: 'ARCHIVED', version: normalized.expectedVersion + 1 },
    });
    if (changed.count !== 1) throw this.versionConflict();
    const archivedAt = new Date();
    const archiveDate =
      fields && (fields.archiveDate ?? businessDay.format(archivedAt));
    const archiveFacts =
      fields && archiveDate
        ? {
            fromStage: matter.stage,
            archiveType: fields.archiveType,
            archiveDate: new Date(archiveDate + 'T00:00:00.000Z'),
            notaryFeeAmount: fields.notaryFeeAmount,
            sampleFeeAmount: fields.sampleFeeAmount ?? null,
          }
        : undefined;
    const archive = await tx.notaryReturnArchive.create({
      data: {
        matterId,
        departmentId: matter.departmentId,
        issuanceDecisionId: isReturn ? matter.issuanceDecision?.id : null,
        ...(isReturn ? {} : { issuanceDecisionChoice: null }),
        ...archiveFacts,
        actorUserId: actor.userId,
        actorDisplayNameSnapshot: actorDisplayName,
        returnChoice: normalized.returnChoice,
        archiveReason: normalized.archiveReason,
        archivedAt,
        fromVersion: normalized.expectedVersion,
        toVersion: normalized.expectedVersion + 1,
      },
    });
    for (const [kind, amount] of [
      ['REFUND', normalized.refund],
      ['FREIGHT', normalized.freight],
    ] as const) {
      if (amount === null || normalized.returnChoice === null) continue;
      await tx.notaryReturnAmount.create({
        data: {
          archiveId: archive.id,
          matterId,
          departmentId: matter.departmentId,
          returnChoice: normalized.returnChoice,
          kind,
          state: amount.state,
          amount: amount.amount,
          partyKind: amount.partyKind,
          partyName: amount.partyName,
          sourceEvidenceMatterId:
            kind === 'REFUND' ? matter.evidence?.matterId : null,
        },
      });
    }
    const result: ReturnArchiveResult = {
      id: matterId,
      stage: 'ARCHIVED',
      version: normalized.expectedVersion + 1,
      returnArchive: {
        returnChoice: normalized.returnChoice,
        ...(archiveFacts && archiveDate
          ? {
              archiveType: archiveFacts.archiveType,
              archiveDate,
              notaryFeeAmount: archiveFacts.notaryFeeAmount,
              sampleFeeAmount: archiveFacts.sampleFeeAmount,
            }
          : {}),
        archiveReason: normalized.archiveReason,
        archivedAt: archive.archivedAt.toISOString(),
        actorDisplayName,
        refund: normalized.refund,
        freight: normalized.freight,
      },
    };
    const event = await tx.auditEvent.create({
      data: {
        departmentId: matter.departmentId,
        actorUserId: actor.userId,
        internalActorUserId: actor.userId,
        resourceType: 'notary_matter',
        resourceId: matterId,
        action: 'notary.return.archive.succeeded',
        details: {
          archiveId: archive.id,
          returnChoice: normalized.returnChoice,
          fromVersion: normalized.expectedVersion,
          toVersion: result.version,
        },
      },
    });
    if (archiveFacts) {
      await syncNotaryMatterCost(tx, {
        departmentId: matter.departmentId,
        matterId,
        category: 'NOTARY',
        state: 'KNOWN',
        amount: archiveFacts.notaryFeeAmount,
        feeDate: archiveFacts.archiveDate,
        sourceActionEventId: event.id,
      });
      if (archiveFacts.sampleFeeAmount !== null)
        await syncNotaryMatterCost(tx, {
          departmentId: matter.departmentId,
          matterId,
          category: 'SAMPLE',
          state: 'KNOWN',
          amount: archiveFacts.sampleFeeAmount,
          feeDate:
            matter.costs?.[0]?.feeDate ??
            matter.evidence?.evidenceAt ??
            archiveFacts.archiveDate,
          sourceActionEventId: event.id,
        });
      if (isReturn)
        await syncNotaryReturnFees(tx, {
          departmentId: matter.departmentId,
          matterId,
          archiveId: archive.id,
          sourceActionEventId: event.id,
        });
    }
    return result;
  }

  normalize(input: ArchiveNotaryReturnDto): Normalized {
    if (
      input === null ||
      typeof input !== 'object' ||
      Array.isArray(input) ||
      Object.keys(input).some(
        (key) =>
          ![
            'archiveReason',
            'expectedVersion',
            'returnChoice',
            'refund',
            'freight',
            'archiveType',
            'archiveDate',
            'notaryFeeAmount',
            'sampleFeeAmount',
          ].includes(key),
      ) ||
      (input.returnChoice !== undefined &&
        !['RETURN', 'KEEP', 'REFUND_ONLY'].includes(input.returnChoice)) ||
      !Number.isInteger(input.expectedVersion) ||
      input.expectedVersion < 1 ||
      typeof input.archiveReason !== 'string'
    )
      throw this.validation();
    const { archiveType, archiveDate, notaryFeeAmount, sampleFeeAmount } =
      input;
    const modern =
      archiveType !== undefined ||
      archiveDate !== undefined ||
      notaryFeeAmount !== undefined ||
      sampleFeeAmount !== undefined;
    let archiveFields: ArchiveFields | undefined;
    if (modern) {
      if (
        archiveType === undefined ||
        !NOTARY_ARCHIVE_TYPES.includes(archiveType) ||
        typeof notaryFeeAmount !== 'string' ||
        !AMOUNT.test(notaryFeeAmount) ||
        (sampleFeeAmount !== undefined &&
          (typeof sampleFeeAmount !== 'string' ||
            !AMOUNT.test(sampleFeeAmount))) ||
        (archiveDate !== undefined && !this.isBusinessDate(archiveDate)) ||
        (input.returnChoice === undefined
          ? returnChoices[archiveType] !== undefined ||
            archiveDate === undefined ||
            sampleFeeAmount === undefined
          : input.returnChoice !== (returnChoices[archiveType] ?? 'KEEP'))
      )
        throw this.validation();
      archiveFields = {
        archiveType,
        archiveDate,
        notaryFeeAmount,
        sampleFeeAmount,
      };
    } else if (input.returnChoice === undefined) {
      throw this.validation();
    }
    if (
      modern &&
      (input.refund?.state === 'PENDING' || input.freight?.state === 'PENDING')
    )
      throw this.validation();
    const archiveReason = input.archiveReason.trim();
    if (!archiveReason || Array.from(archiveReason).length > 5000)
      throw this.validation();
    if (
      ((input.returnChoice === 'KEEP' || input.returnChoice === undefined) &&
        (input.refund !== undefined || input.freight !== undefined)) ||
      (input.returnChoice === 'REFUND_ONLY' &&
        (input.refund === undefined || input.freight !== undefined)) ||
      (input.returnChoice === 'RETURN' &&
        (input.refund === undefined || input.freight === undefined))
    )
      throw this.validation();
    return {
      returnChoice: input.returnChoice ?? null,
      ...(archiveFields ? { archiveFields } : {}),
      refund:
        input.refund === undefined ? null : this.normalizeAmount(input.refund),
      freight:
        input.freight === undefined
          ? null
          : this.normalizeAmount(input.freight),
      archiveReason,
      expectedVersion: input.expectedVersion,
    };
  }

  private normalizeAmount(input: AmountInput): AmountSummary {
    if (
      input === null ||
      typeof input !== 'object' ||
      Array.isArray(input) ||
      ![
        'state',
        'amount,state',
        'partyKind,state',
        'amount,partyKind,state',
        'amount,partyKind,partyName,state',
      ].includes(keys(input)) ||
      (input.state !== 'KNOWN' && input.state !== 'PENDING')
    )
      throw this.validation();
    if (input.state === 'PENDING') {
      if (
        input.amount !== undefined ||
        input.partyKind !== undefined ||
        input.partyName !== undefined
      )
        throw this.validation();
      return {
        state: 'PENDING',
        amount: null,
        partyKind: null,
        partyName: null,
      };
    }
    if (typeof input.amount !== 'string' || !AMOUNT.test(input.amount))
      throw this.validation();
    const positive = new Prisma.Decimal(input.amount).gt(0);
    if (!positive) {
      if (input.partyKind !== undefined || input.partyName !== undefined)
        throw this.validation();
      return {
        state: 'KNOWN',
        amount: input.amount,
        partyKind: null,
        partyName: null,
      };
    }
    if (
      !['CUSTOMER', 'FIRM', 'MERCHANT', 'OTHER'].includes(input.partyKind ?? '')
    )
      throw this.validation();
    const partyName =
      input.partyKind === 'OTHER' ? input.partyName?.trim() : null;
    if (
      input.partyKind === 'OTHER' &&
      (!partyName || Array.from(partyName).length > 200)
    )
      throw this.validation();
    if (input.partyKind !== 'OTHER' && input.partyName !== undefined)
      throw this.validation();
    return {
      state: 'KNOWN',
      amount: input.amount,
      partyKind: input.partyKind ?? null,
      partyName: partyName ?? null,
    };
  }

  async replay(
    tx: Pick<Prisma.TransactionClient, 'notaryReturnArchive'>,
    receipt: {
      departmentId: string;
      actorUserId: string;
      requestFingerprint: string;
      resultMatterId: string;
      resultMatterVersion: number;
      resultSnapshot: Prisma.JsonValue;
    },
    matterId: string,
    fingerprint: string,
  ): Promise<ReturnArchiveResult> {
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
    const summary = result.returnArchive;
    if (
      keys(result) !== 'id,returnArchive,stage,version' ||
      result.id !== matterId ||
      result.stage !== 'ARCHIVED' ||
      result.version !== receipt.resultMatterVersion ||
      summary === null ||
      typeof summary !== 'object' ||
      Array.isArray(summary)
    )
      throw this.corruptReceipt();
    const detail = summary as Record<string, unknown>;
    if (
      ![
        'actorDisplayName,archiveReason,archivedAt,freight,refund,returnChoice',
        'actorDisplayName,archiveDate,archiveReason,archiveType,archivedAt,freight,notaryFeeAmount,refund,returnChoice,sampleFeeAmount',
      ].includes(keys(detail)) ||
      typeof detail.actorDisplayName !== 'string' ||
      !detail.actorDisplayName.trim() ||
      typeof detail.archivedAt !== 'string' ||
      !this.isIsoDate(detail.archivedAt)
    )
      throw this.corruptReceipt();
    const stored = await tx.notaryReturnArchive.findUnique({
      where: { matterId },
      select: {
        departmentId: true,
        actorUserId: true,
        actorDisplayNameSnapshot: true,
        returnChoice: true,
        archiveReason: true,
        archivedAt: true,
        archiveDate: true,
        archiveType: true,
        notaryFeeAmount: true,
        sampleFeeAmount: true,
        fromVersion: true,
        toVersion: true,
        amounts: {
          select: {
            kind: true,
            state: true,
            amount: true,
            partyKind: true,
            partyName: true,
            sourceEvidenceMatterId: true,
          },
        },
      },
    });
    if (
      stored === null ||
      stored.departmentId !== receipt.departmentId ||
      stored.actorUserId !== receipt.actorUserId ||
      stored.actorDisplayNameSnapshot !== detail.actorDisplayName ||
      stored.returnChoice !== detail.returnChoice ||
      stored.archiveReason !== detail.archiveReason ||
      stored.archivedAt.toISOString() !== detail.archivedAt ||
      (stored.archiveType ?? undefined) !== detail.archiveType ||
      stored.archiveDate?.toISOString().slice(0, 10) !== detail.archiveDate ||
      stored.notaryFeeAmount?.toFixed(2) !== detail.notaryFeeAmount ||
      (stored.archiveType
        ? (stored.sampleFeeAmount?.toFixed(2) ?? null)
        : undefined) !== detail.sampleFeeAmount ||
      stored.toVersion !== result.version ||
      stored.fromVersion !== receipt.resultMatterVersion - 1
    )
      throw this.corruptReceipt();
    const facts: Record<'REFUND' | 'FREIGHT', AmountSummary | null> = {
      REFUND: null,
      FREIGHT: null,
    };
    for (const row of stored.amounts) {
      if (row.kind !== 'REFUND' && row.kind !== 'FREIGHT')
        throw this.corruptReceipt();
      if (
        facts[row.kind] !== null ||
        (row.kind === 'REFUND' && row.sourceEvidenceMatterId !== matterId) ||
        (row.kind === 'FREIGHT' && row.sourceEvidenceMatterId !== null)
      )
        throw this.corruptReceipt();
      facts[row.kind] = {
        state: row.state,
        amount: row.amount?.toFixed(2) ?? null,
        partyKind: row.partyKind,
        partyName: row.partyName,
      };
    }
    if (
      !this.sameAmount(facts.REFUND, detail.refund) ||
      !this.sameAmount(facts.FREIGHT, detail.freight) ||
      (stored.returnChoice === 'KEEP' &&
        (facts.REFUND !== null || facts.FREIGHT !== null)) ||
      (stored.returnChoice === 'REFUND_ONLY' &&
        (facts.REFUND === null || facts.FREIGHT !== null)) ||
      (stored.returnChoice === 'RETURN' &&
        (facts.REFUND === null || facts.FREIGHT === null))
    )
      throw this.corruptReceipt();
    return snapshot as ReturnArchiveResult;
  }

  private sameAmount(stored: AmountSummary | null, snapshot: unknown): boolean {
    if (stored === null) return snapshot === null;
    if (
      snapshot === null ||
      typeof snapshot !== 'object' ||
      Array.isArray(snapshot) ||
      keys(snapshot) !== 'amount,partyKind,partyName,state'
    )
      return false;
    const value = snapshot as Record<string, unknown>;
    return (
      stored.state === value.state &&
      stored.amount === value.amount &&
      stored.partyKind === value.partyKind &&
      stored.partyName === value.partyName
    );
  }

  private isBusinessDate(value: string) {
    return (
      typeof value === 'string' &&
      /^\d{4}-\d{2}-\d{2}$/u.test(value) &&
      this.isIsoDate(value + 'T00:00:00.000Z')
    );
  }

  private isIsoDate(value: string) {
    const date = new Date(value);
    return !Number.isNaN(date.getTime()) && date.toISOString() === value;
  }
  validation() {
    return new BadRequestException({
      code: 'VALIDATION_ERROR',
      message: '退货归档参数无效',
    });
  }
  forbidden() {
    return new ForbiddenException({
      code: 'ACTION_FORBIDDEN',
      message: '无权办理退货归档',
    });
  }
  notFound() {
    return new NotFoundException({
      code: 'RESOURCE_NOT_FOUND',
      message: '公证事项不存在或不可访问',
    });
  }
  invalidState() {
    return new ConflictException({
      code: 'INVALID_STATE',
      message: '该公证事项当前不能退货归档',
    });
  }
  versionConflict() {
    return new ConflictException({
      code: 'VERSION_CONFLICT',
      message: '公证事项状态或版本已变化',
    });
  }
  originalAmountUnknown() {
    return new ConflictException({
      code: 'ORIGINAL_AMOUNT_UNKNOWN',
      message: '原样品费用待定，不能登记已知正退款',
    });
  }
  refundExceeded() {
    return new ConflictException({
      code: 'REFUND_EXCEEDS_ORIGINAL',
      message: '退款累计金额超过原样品费用',
    });
  }
  corruptReceipt() {
    return new InternalServerErrorException({
      code: 'RECEIPT_CORRUPT',
      message: '退货归档回执不可用',
    });
  }
  isUnique(error: unknown): boolean {
    return (
      error !== null &&
      typeof error === 'object' &&
      ((error as { code?: unknown }).code === 'P2002' ||
        this.isUnique((error as { cause?: unknown }).cause))
    );
  }
  isSerializationConflict(error: unknown): boolean {
    if (error === null || typeof error !== 'object') return false;
    const e = error as {
      code?: unknown;
      cause?: unknown;
      meta?: {
        driverAdapterError?: {
          cause?: { originalCode?: unknown; sqlState?: unknown };
        };
      };
    };
    return (
      e.code === 'P2034' ||
      e.code === '40001' ||
      e.meta?.driverAdapterError?.cause?.originalCode === '40001' ||
      e.meta?.driverAdapterError?.cause?.sqlState === '40001' ||
      this.isSerializationConflict(e.cause)
    );
  }
}
