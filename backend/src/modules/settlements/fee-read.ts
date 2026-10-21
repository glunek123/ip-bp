import { ForbiddenException } from '@nestjs/common';
import { AccessControlService } from '../../access-control/access-control.service';
import { ActorContext } from '../../access-control/actor-context';
import { Prisma } from '../../generated/prisma/client';

export const feeReadInclude = {
  proofContentVersion: { select: { originalFilename: true } },
  case: {
    select: {
      businessNo: true,
      stage: true,
      courtCaseNo: true,
      sourceLead: { select: { platform: true, shopName: true } },
      defendants: { select: { name: true }, orderBy: { id: 'asc' } },
    },
  },
} satisfies Prisma.FeeRecordInclude;

type FeeReadRow = Prisma.FeeRecordGetPayload<{
  include: typeof feeReadInclude;
}>;

export function projectFeeReadRow(row: FeeReadRow) {
  return {
    id: row.id,
    caseId: row.caseId,
    businessNo: row.case.businessNo,
    courtCaseNo: row.case.courtCaseNo,
    platform: row.case.sourceLead?.platform ?? null,
    shopName: row.case.sourceLead?.shopName ?? null,
    defendantNames: row.case.defendants.map((item) => item.name),
    stage: row.case.stage,
    type: row.type,
    direction: row.direction as '收入' | '支出',
    status: row.status,
    amount: row.amount.toFixed(2),
    feeDate: row.feeDate.toISOString().slice(0, 10),
    source: row.source,
    note: row.note,
    version: row.version,
    proofMaterialId: row.proofMaterialId,
    proofContentVersionId: row.proofContentVersionId,
    proofOriginalFilename:
      row.proofMaterialId !== null && row.proofContentVersionId !== null
        ? (row.proofContentVersion?.originalFilename ?? null)
        : null,
  };
}

// The caller derives caseIds and caseScope from the same current group read transaction.
export async function readScopedCaseFeePage(
  tx: Prisma.TransactionClient,
  access: AccessControlService,
  actor: ActorContext,
  caseIds: readonly string[],
  caseScope: Prisma.CaseWhereInput,
  page: number,
  pageSize: number,
) {
  try {
    await access.authorizeDepartmentAction(actor, 'fee.read', tx);
  } catch (error) {
    if (error instanceof ForbiddenException)
      return { canReadLedger: false as const, ledger: null };
    throw error;
  }
  const where: Prisma.FeeRecordWhereInput = {
    departmentId: actor.departmentId,
    caseId: { in: [...caseIds] },
    deletedAt: null,
    case: { is: caseScope },
  };
  const total = await tx.feeRecord.count({ where });
  const rows = await tx.feeRecord.findMany({
    where,
    include: feeReadInclude,
    orderBy: [{ feeDate: 'desc' }, { id: 'desc' }],
    skip: (page - 1) * pageSize,
    take: pageSize,
  });
  return {
    canReadLedger: true as const,
    ledger: {
      items: rows.map((row) => ({
        ...projectFeeReadRow(row),
        sourceKind: row.sourceKind,
        sourceId: row.sourceId,
      })),
      total,
      page,
      pageSize,
    },
  };
}
