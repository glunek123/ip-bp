import { InternalServerErrorException } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';
import { projectSectionRecord } from './case-section-record-edit-read';

function invalidSource(): InternalServerErrorException {
  return new InternalServerErrorException({
    code: 'INVALID_RECORD_SOURCE',
    message: '结算金额来源不一致',
  });
}

function amount(state: 'KNOWN' | 'PENDING', value: Prisma.Decimal | null) {
  if (state === 'PENDING' && value === null) return { state, amount: null };
  if (state === 'KNOWN' && value !== null && value.gte(0))
    return { state, amount: value.toFixed(2) };
  throw invalidSource();
}

/** Public, read-only case facts. The caller supplies its authorized snapshot. */
export async function readCaseSettlementSource(
  reader: Pick<Prisma.TransactionClient, 'case'>,
  identity: { caseId: string; departmentId: string },
) {
  const row = await reader.case.findFirst({
    where: { id: identity.caseId, departmentId: identity.departmentId },
    select: {
      id: true,
      departmentId: true,
      businessNo: true,
      customerId: true,
      stage: true,
      version: true,
      complaintAmountState: true,
      complaintAmount: true,
      complaintConfirmation: {
        select: { id: true, amountState: true, amount: true },
      },
      customer: { select: { id: true, departmentId: true, name: true } },
      lawyers: {
        where: { role: 'PRIMARY', endedAt: null },
        orderBy: { id: 'asc' },
        select: {
          id: true,
          caseId: true,
          departmentId: true,
          lawyerId: true,
          lawyer: {
            select: {
              id: true,
              departmentId: true,
              fullName: true,
              lawFirm: true,
            },
          },
        },
      },
      closure: {
        select: {
          id: true,
          caseId: true,
          departmentId: true,
          currentVersion: {
            select: {
              id: true,
              closureId: true,
              caseId: true,
              departmentId: true,
              closeAmountState: true,
              closeAmt: true,
            },
          },
          recordCorrections: {
            orderBy: { toRevision: 'asc' },
            select: {
              id: true,
              closureId: true,
              caseId: true,
              departmentId: true,
              sourceClosureVersionId: true,
              priorCorrectionId: true,
              fromRevision: true,
              toRevision: true,
              correctionReason: true,
              recordedAt: true,
              recordedByUserId: true,
              closeAmountState: true,
              closeAmt: true,
            },
          },
        },
      },
    },
  });
  if (row === null) return null;
  if (
    row.id !== identity.caseId ||
    row.departmentId !== identity.departmentId ||
    row.customer.id !== row.customerId ||
    row.customer.departmentId !== row.departmentId ||
    row.lawyers.some(
      (item) =>
        item.caseId !== row.id ||
        item.departmentId !== row.departmentId ||
        item.lawyer.id !== item.lawyerId ||
        item.lawyer.departmentId !== row.departmentId,
    )
  )
    throw invalidSource();

  let closure: {
    rootId: string | null;
    sourceVersionId: string | null;
    revision: number;
    state: 'UNRECORDED' | 'KNOWN' | 'PENDING';
    amount: string | null;
  } = {
    rootId: null,
    sourceVersionId: null,
    revision: 0,
    state: 'UNRECORDED',
    amount: null,
  };
  if (row.closure !== null) {
    const root = row.closure;
    const original = root.currentVersion;
    if (
      root.caseId !== row.id ||
      root.departmentId !== row.departmentId ||
      original === null ||
      original.closureId !== root.id ||
      original.caseId !== row.id ||
      original.departmentId !== row.departmentId ||
      root.recordCorrections.some(
        (correction) =>
          correction.closureId !== root.id ||
          correction.caseId !== row.id ||
          correction.departmentId !== row.departmentId ||
          correction.sourceClosureVersionId !== original.id,
      )
    )
      throw invalidSource();
    const projection = projectSectionRecord(
      amount(original.closeAmountState, original.closeAmt),
      root.recordCorrections,
      (correction) => amount(correction.closeAmountState, correction.closeAmt),
    );
    closure = {
      rootId: root.id,
      sourceVersionId: original.id,
      revision: projection.revision,
      ...projection.effective,
    };
  }
  const claim =
    row.complaintConfirmation !== null
      ? amount(
          row.complaintConfirmation.amountState,
          row.complaintConfirmation.amount,
        )
      : row.complaintAmountState === null
        ? null
        : amount(row.complaintAmountState, row.complaintAmount);
  if (
    row.complaintAmountState === null &&
    row.complaintAmount !== null &&
    row.complaintConfirmation === null
  )
    throw invalidSource();
  return {
    caseId: row.id,
    departmentId: row.departmentId,
    businessNo: row.businessNo,
    stage: row.stage,
    caseVersion: row.version,
    customer: { id: row.customer.id, name: row.customer.name },
    lawyers: row.lawyers.map((assignment) => ({
      assignmentId: assignment.id,
      id: assignment.lawyer.id,
      name: assignment.lawyer.fullName,
      firm: assignment.lawyer.lawFirm,
    })),
    closure,
    claimAmount: claim?.amount ?? null,
  };
}

export type CaseSettlementSource = NonNullable<
  Awaited<ReturnType<typeof readCaseSettlementSource>>
>;

/** Minimal authorized-source picker for financial forms; never creates a row. */
export async function searchCaseSettlementSources(
  reader: Pick<Prisma.TransactionClient, 'case'>,
  input: {
    departmentId: string;
    query: string;
    page: number;
    pageSize: number;
  },
) {
  const query = input.query.trim();
  const contains = { contains: query, mode: 'insensitive' as const };
  const where: Prisma.CaseWhereInput = {
    departmentId: input.departmentId,
    ...(query.length === 0
      ? {}
      : {
          OR: [
            { businessNo: contains },
            { courtCaseNo: contains },
            { customer: { name: contains } },
            { rightsHolder: { name: contains } },
            { sourceLead: { shopName: contains } },
            { defendants: { some: { name: contains } } },
          ],
        }),
  };
  const total = await reader.case.count({ where });
  const rows = await reader.case.findMany({
    where,
    select: {
      id: true,
      businessNo: true,
      courtCaseNo: true,
      customer: { select: { name: true } },
      rightsHolder: { select: { name: true } },
      sourceLead: { select: { shopName: true } },
      defendants: { select: { name: true }, orderBy: { id: 'asc' } },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    skip: (input.page - 1) * input.pageSize,
    take: input.pageSize,
  });
  return {
    items: rows.map((row) => ({
      id: row.id,
      businessNo: row.businessNo,
      courtCaseNo: row.courtCaseNo,
      customerName: row.customer.name,
      rightsHolderName: row.rightsHolder.name,
      shopName: row.sourceLead?.shopName ?? null,
      defendantNames: row.defendants.map((item) => item.name),
    })),
    total,
    page: input.page,
    pageSize: input.pageSize,
  };
}
