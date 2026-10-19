import { Prisma } from '../../generated/prisma/client';

export const caseListSortBy = [
  'createdAt',
  'businessNo',
  'rightsHolderName',
] as const;
export type CaseListSortBy = (typeof caseListSortBy)[number];

export const caseListSortDirections = ['asc', 'desc'] as const;
export type CaseListSortDirection = (typeof caseListSortDirections)[number];

export interface CaseListTextQuery {
  q?: string;
  customerName?: string;
  rightsHolderName?: string;
  courtCaseNo?: string;
  sortBy?: CaseListSortBy;
  sortDirection?: CaseListSortDirection;
}

const literalContains = (value: string) => ({
  contains: value.replace(/[\\%_]/g, '\\$&'),
  mode: 'insensitive' as const,
});

export function caseListTextWhere(
  query: CaseListTextQuery,
): Prisma.CaseWhereInput {
  const q = query.q?.trim();
  const customerName = query.customerName?.trim();
  const rightsHolderName = query.rightsHolderName?.trim();
  const courtCaseNo = query.courtCaseNo?.trim();
  const and: Prisma.CaseWhereInput[] = [];
  if (q) {
    const match = literalContains(q);
    and.push({
      OR: [
        { businessNo: match },
        { courtCaseNo: match },
        { customer: { is: { name: match } } },
        { rightsHolder: { is: { name: match } } },
        { defendants: { some: { name: match } } },
      ],
    });
  }
  if (customerName)
    and.push({ customer: { is: { name: literalContains(customerName) } } });
  if (rightsHolderName)
    and.push({
      rightsHolder: { is: { name: literalContains(rightsHolderName) } },
    });
  if (courtCaseNo) and.push({ courtCaseNo: literalContains(courtCaseNo) });
  return and.length === 0 ? {} : { AND: and };
}

export function caseListOrderBy(
  query: CaseListTextQuery,
): Prisma.CaseOrderByWithRelationInput[] {
  const direction = query.sortDirection === 'asc' ? 'asc' : 'desc';
  const field = query.sortBy ?? 'createdAt';
  const first: Prisma.CaseOrderByWithRelationInput =
    field === 'rightsHolderName'
      ? { rightsHolder: { name: direction } }
      : field === 'businessNo'
        ? { businessNo: direction }
        : { createdAt: direction };
  return [first, { id: 'asc' }];
}
