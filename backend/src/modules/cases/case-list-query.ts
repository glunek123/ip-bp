import { Prisma } from '../../generated/prisma/client';
import { LeadCaseType } from '../../generated/prisma/enums';

export const caseListCaseTypes = Object.values(LeadCaseType);

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
  shopName?: string;
  defendantName?: string;
  courtName?: string;
  lawyerName?: string;
  caseType?: LeadCaseType;
  sortBy?: CaseListSortBy;
  sortDirection?: CaseListSortDirection;
}

export function caseListMembershipWhere(): Prisma.CaseWhereInput {
  return {
    OR: [
      { consolidationMembership: { is: null } },
      { consolidationMembership: { is: { isMain: true } } },
    ],
  };
}

const literalContains = (value: string) => ({
  contains: value.replace(/[\\%_]/g, '\\$&'),
  mode: 'insensitive' as const,
});

export function caseListTextWhere(
  query: CaseListTextQuery,
  knownCourtIds: readonly string[] = [],
  courtNameIds: readonly string[] = [],
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
        {
          consolidationAsMain: {
            is: {
              members: { some: { isMain: false, case: { businessNo: match } } },
            },
          },
        },
        { courtCaseNo: match },
        { customer: { is: { name: match } } },
        { rightsHolder: { is: { name: match } } },
        { defendants: { some: { name: match } } },
        { sourceLead: { is: { shopName: match } } },
        {
          externalEntry: {
            is: {
              known: {
                path: ['shopName'],
                string_contains: match.contains,
                mode: 'insensitive',
              },
            },
          },
        },
        { filingSubmission: { is: { courtName: match } } },
        { acceptance: { is: { court: { is: { name: match } } } } },
        ...(knownCourtIds.length > 0
          ? [
              {
                externalEntry: {
                  is: {
                    OR: knownCourtIds.map((id) => ({
                      known: { path: ['courtId'], equals: id },
                    })),
                  },
                },
              },
            ]
          : []),
        {
          lawyers: {
            some: {
              role: 'PRIMARY',
              endedAt: null,
              lawyer: { is: { fullName: match } },
            },
          },
        },
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
  const normalSource: Prisma.CaseWhereInput = {
    sourceLeadId: { not: null },
    sourceNotaryMatterId: { not: null },
    certificateId: { not: null },
    externalEntry: { is: null },
  };
  const externalSource: Prisma.CaseWhereInput = {
    sourceLeadId: null,
    sourceNotaryMatterId: null,
    certificateId: null,
    externalEntry: { isNot: null },
  };
  const shopName = query.shopName?.trim();
  if (shopName)
    and.push({
      OR: [
        {
          AND: [
            normalSource,
            { sourceLead: { is: { shopName: literalContains(shopName) } } },
          ],
        },
        {
          AND: [
            externalSource,
            {
              externalEntry: {
                is: {
                  known: {
                    path: ['shopName'],
                    string_contains: literalContains(shopName).contains,
                    mode: 'insensitive',
                  },
                },
              },
            },
          ],
        },
      ],
    });
  if (query.caseType)
    and.push({
      OR: [
        {
          AND: [
            normalSource,
            { sourceLead: { is: { caseType: query.caseType } } },
          ],
        },
        {
          AND: [
            externalSource,
            {
              externalEntry: {
                is: { known: { path: ['caseType'], equals: query.caseType } },
              },
            },
          ],
        },
      ],
    });
  const defendantName = query.defendantName?.trim();
  if (defendantName)
    and.push({
      defendants: { some: { name: literalContains(defendantName) } },
    });
  const lawyerName = query.lawyerName?.trim();
  if (lawyerName)
    and.push({
      lawyers: {
        some: {
          role: 'PRIMARY',
          endedAt: null,
          lawyer: { is: { fullName: literalContains(lawyerName) } },
        },
      },
    });
  const courtName = query.courtName?.trim();
  if (courtName) {
    const noAcceptanceCourt: Prisma.CaseWhereInput = {
      OR: [
        { acceptance: { is: null } },
        { acceptance: { is: { courtId: null } } },
      ],
    };
    and.push({
      OR: [
        {
          acceptance: {
            is: { court: { is: { name: literalContains(courtName) } } },
          },
        },
        {
          AND: [
            noAcceptanceCourt,
            {
              filingSubmission: {
                is: { courtName: literalContains(courtName) },
              },
            },
          ],
        },
        {
          AND: [
            noAcceptanceCourt,
            { filingSubmission: { is: null } },
            externalSource,
            {
              externalEntry: {
                is: {
                  OR: courtNameIds.map((id) => ({
                    known: { path: ['courtId'], equals: id },
                  })),
                },
              },
            },
          ],
        },
      ],
    });
  }
  return and.length === 0 ? {} : { AND: and };
}

export async function caseListDepartmentTextWhere(
  database: Pick<Prisma.TransactionClient, 'filingCourt'>,
  departmentId: string,
  query: CaseListTextQuery,
): Promise<Prisma.CaseWhereInput> {
  const courtName = query.courtName?.trim();
  const keyword = query.q?.trim();
  const findCourts = (name?: string) =>
    name
      ? database.filingCourt.findMany({
          where: { departmentId, OR: [{ name: literalContains(name) }] },
          select: { id: true },
        })
      : Promise.resolve([]);
  const [keywordCourts, namedCourts] = await Promise.all([
    findCourts(keyword),
    keyword === courtName ? Promise.resolve([]) : findCourts(courtName),
  ]);
  const courtNameIds =
    keyword === courtName
      ? keywordCourts.map(({ id }) => id)
      : namedCourts.map(({ id }) => id);
  return caseListTextWhere(
    query,
    keywordCourts.map(({ id }) => id),
    courtNameIds,
  );
}

export function caseListOrderBy(
  _query: CaseListTextQuery,
): Prisma.CaseOrderByWithRelationInput[] {
  void _query;
  return [{ createdAt: 'desc' }, { id: 'asc' }];
}
