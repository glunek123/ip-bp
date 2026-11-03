import { Prisma } from '../../generated/prisma/client';

function literalMatch(value: string) {
  return {
    contains: value.trim().replace(/[\\%_]/g, '\\$&'),
    mode: 'insensitive' as const,
  };
}

export async function matchingNotaryRightsHolderIds(
  reader: Pick<Prisma.TransactionClient, 'rightsHolder'>,
  departmentId: string,
  value: string,
): Promise<string[]> {
  const holders = await reader.rightsHolder.findMany({
    where: { departmentId, name: literalMatch(value) },
    select: { id: true },
  });
  return holders.map((holder) => holder.id);
}

/** Match the current matter value, falling back to the legacy source only if
 * no independent profile exists. Callers must separately add their scopes. */
export function notaryRoutineShopWhere(
  value: string,
): Prisma.NotaryMatterWhereInput {
  const match = literalMatch(value);
  return {
    OR: [
      { routineProfile: { is: { shopName: match } } },
      { routineProfile: { is: null }, sourceLead: { is: { shopName: match } } },
    ],
  };
}

/** Search the matter, its parties, its source number and its current shop. */
export function notaryKeywordWhere(
  value: string,
  matchingRightsHolderIds: string[],
): Prisma.NotaryMatterWhereInput {
  const match = literalMatch(value);
  return {
    OR: [
      { businessNo: match },
      { sourceLead: { is: { customer: { is: { name: match } } } } },
      { rightsHolderId: { in: matchingRightsHolderIds } },
      { sourceLead: { is: { businessNo: match } } },
      notaryRoutineShopWhere(value),
    ],
  };
}
