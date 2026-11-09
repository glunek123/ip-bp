import { ConflictException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';

type SourceTransaction = Prisma.TransactionClient;
type CostCategory = 'SAMPLE' | 'NOTARY';

export type SyncNotaryMatterCost = Readonly<{
  departmentId: string;
  matterId: string;
  category: CostCategory;
  state: 'KNOWN' | 'PENDING';
  amount: string | null;
  feeDate: Date;
  sourceActionEventId: string;
}>;

const invalid = () =>
  new ConflictException({
    code: 'FEE_SOURCE_INVALID',
    message: '公证费用来源与费用明细不一致',
  });

const sourceFor = (category: CostCategory, matterId: string) =>
  category === 'SAMPLE'
    ? {
        type: '样品费',
        sourceKind: 'NOTARY_MATTER_EVIDENCE',
        sourceId: `${matterId}:sample`,
      }
    : {
        type: '公证费',
        sourceKind: 'NOTARY_MATTER_COST',
        sourceId: `${matterId}:notary`,
      };

async function recordSourceChange(
  tx: SourceTransaction,
  data: {
    departmentId: string;
    matterId: string;
    feeId: string;
    sourceKind: string;
    sourceId: string;
    amount: string;
    feeDate: Date;
    sourceActionEventId: string;
  },
) {
  const source = await tx.auditEvent.findFirst({
    where: {
      id: data.sourceActionEventId,
      departmentId: data.departmentId,
      resourceType: 'notary_matter',
      resourceId: data.matterId,
      action: {
        in: [
          'notary.evidence_recorded',
          'notary.return.archive.succeeded',
          'notary.certificate_issued',
        ],
      },
    },
  });
  if (source === null) throw invalid();
  await tx.auditEvent.create({
    data: {
      departmentId: data.departmentId,
      actorKind: source.actorKind,
      actorUserId: source.actorUserId,
      internalActorUserId: source.internalActorUserId,
      notaryOfficeAccountBindingId: source.notaryOfficeAccountBindingId,
      customerAccountBindingId: source.customerAccountBindingId,
      lawyerAccountBindingId: source.lawyerAccountBindingId,
      resourceType: 'FEE',
      resourceId: data.feeId,
      action: 'fee.source-synced',
      details: {
        matterId: data.matterId,
        sourceKind: data.sourceKind,
        sourceId: data.sourceId,
        sourceActionEventId: data.sourceActionEventId,
        amount: data.amount,
        feeDate: data.feeDate.toISOString().slice(0, 10),
      },
    },
  });
}

export async function syncNotaryMatterCost(
  tx: SourceTransaction,
  facts: SyncNotaryMatterCost,
): Promise<{ created: boolean }> {
  const amount =
    facts.amount === null ? null : new Prisma.Decimal(facts.amount);
  if (
    (facts.state === 'KNOWN') !== (amount !== null) ||
    (amount !== null &&
      (!amount.isFinite() ||
        amount.isNegative() ||
        amount.decimalPlaces() > 2)) ||
    Number.isNaN(facts.feeDate.getTime())
  )
    throw invalid();
  const matter = await tx.notaryMatter.findFirst({
    where: { id: facts.matterId, departmentId: facts.departmentId },
    select: { case: { select: { id: true } } },
  });
  if (matter === null) throw invalid();
  const priorCost = await tx.notaryMatterCost.findUnique({
    where: {
      matterId_category: { matterId: facts.matterId, category: facts.category },
    },
  });
  if (priorCost === null) {
    await tx.notaryMatterCost.create({
      data: {
        matterId: facts.matterId,
        departmentId: facts.departmentId,
        category: facts.category,
        state: facts.state,
        amount,
        feeDate: facts.feeDate,
      },
    });
  } else if (
    priorCost.departmentId !== facts.departmentId ||
    priorCost.state !== facts.state ||
    !(priorCost.amount === null
      ? amount === null
      : amount !== null && priorCost.amount.equals(amount)) ||
    priorCost.feeDate.getTime() !== facts.feeDate.getTime()
  ) {
    if (priorCost.departmentId !== facts.departmentId) throw invalid();
    await tx.notaryMatterCost.update({
      where: {
        matterId_category: {
          matterId: facts.matterId,
          category: facts.category,
        },
      },
      data: {
        state: facts.state,
        amount,
        feeDate: facts.feeDate,
        revision: { increment: 1 },
      },
    });
  }
  const source = sourceFor(facts.category, facts.matterId);
  const identity = {
    departmentId: facts.departmentId,
    sourceKind: source.sourceKind,
    sourceId: source.sourceId,
  };
  const fee = await tx.feeRecord.findUnique({
    where: { departmentId_sourceKind_sourceId: identity },
  });
  if (amount === null) {
    if (fee !== null) throw invalid();
    return { created: false };
  }
  if (fee !== null) {
    if (
      fee.notaryMatterId !== facts.matterId &&
      !(fee.notaryMatterId === null && fee.caseId === matter.case?.id)
    )
      throw invalid();
    if (
      fee.type !== source.type ||
      fee.direction !== '支出' ||
      fee.source !== 'auto'
    )
      throw invalid();
    if (fee.deletedAt !== null) return { created: false };
    if (
      fee.amount.equals(amount) &&
      fee.feeDate.getTime() === facts.feeDate.getTime()
    )
      return { created: false };
    if (fee.status !== '未发起') throw invalid();
    await tx.feeRecord.update({
      where: { id: fee.id },
      data: {
        amount,
        feeDate: facts.feeDate,
        version: { increment: 1 },
      },
    });
    await recordSourceChange(tx, {
      ...facts,
      feeId: fee.id,
      ...source,
      amount: amount.toFixed(2),
    });
    return { created: false };
  }
  if (facts.category === 'NOTARY') {
    const legacy = await tx.feeRecord.findFirst({
      where: {
        departmentId: facts.departmentId,
        case: { sourceNotaryMatterId: facts.matterId },
        sourceKind: 'NOTARY_CERTIFICATE_FEE',
        type: '公证费',
      },
    });
    if (legacy !== null) {
      if (
        !legacy.amount.equals(amount) ||
        legacy.feeDate.getTime() !== facts.feeDate.getTime()
      )
        throw invalid();
      return { created: false };
    }
  }
  const created = await tx.feeRecord.create({
    data: {
      ...identity,
      caseId: matter.case?.id ?? null,
      notaryMatterId: facts.matterId,
      type: source.type,
      direction: '支出',
      status: '未发起',
      amount,
      feeDate: facts.feeDate,
      source: 'auto',
    },
  });
  await recordSourceChange(tx, {
    ...facts,
    feeId: created.id,
    ...source,
    amount: amount.toFixed(2),
  });
  return { created: true };
}

export async function linkNotaryFeesToCase(
  tx: SourceTransaction,
  facts: Readonly<{ departmentId: string; matterId: string; caseId: string }>,
): Promise<void> {
  const linkedCase = await tx.case.findFirst({
    where: {
      id: facts.caseId,
      departmentId: facts.departmentId,
      sourceNotaryMatterId: facts.matterId,
    },
    select: { id: true },
  });
  if (linkedCase === null) throw invalid();
  const fees = await tx.feeRecord.findMany({
    where: { departmentId: facts.departmentId, notaryMatterId: facts.matterId },
  });
  for (const fee of fees) {
    if (fee.caseId === facts.caseId) continue;
    if (fee.caseId !== null) throw invalid();
    await tx.feeRecord.update({
      where: { id: fee.id },
      data: { caseId: facts.caseId, version: { increment: 1 } },
    });
  }
}

export async function syncNotaryReturnFees(
  tx: SourceTransaction,
  facts: Readonly<{
    departmentId: string;
    matterId: string;
    archiveId: string;
    sourceActionEventId: string;
  }>,
): Promise<void> {
  const archive = await tx.notaryReturnArchive.findFirst({
    where: {
      id: facts.archiveId,
      matterId: facts.matterId,
      departmentId: facts.departmentId,
    },
    include: {
      amounts: true,
      matter: { select: { case: { select: { id: true } } } },
    },
  });
  if (archive === null) throw invalid();
  for (const item of archive.amounts) {
    if (item.state !== 'KNOWN') continue;
    if (item.amount === null) throw invalid();
    const refund = item.kind === 'REFUND';
    const sourceKind = 'NOTARY_MATTER_RETURN';
    const sourceId = `${facts.matterId}:${refund ? 'refund' : 'freight'}`;
    const identity = { departmentId: facts.departmentId, sourceKind, sourceId };
    const type = refund ? '样品费退款' : '退货运费';
    const direction = refund ? '收入' : '支出';
    const feeDate =
      archive.archiveDate ??
      new Date(
        `${archive.archivedAt.toISOString().slice(0, 10)}T00:00:00.000Z`,
      );
    const prior = await tx.feeRecord.findUnique({
      where: { departmentId_sourceKind_sourceId: identity },
    });
    if (prior !== null) {
      if (
        prior.notaryMatterId !== facts.matterId ||
        prior.type !== type ||
        prior.direction !== direction ||
        !prior.amount.equals(item.amount)
      )
        throw invalid();
      continue;
    }
    const created = await tx.feeRecord.create({
      data: {
        ...identity,
        caseId: archive.matter.case?.id ?? null,
        notaryMatterId: facts.matterId,
        type,
        direction,
        status: '未发起',
        amount: item.amount,
        feeDate,
        source: 'auto',
        note: refund ? '应退样品费，实际到账另行核对' : null,
      },
    });
    await recordSourceChange(tx, {
      ...facts,
      feeId: created.id,
      sourceKind,
      sourceId,
      amount: item.amount.toFixed(2),
      feeDate,
    });
  }
}
