import { Prisma } from '../../generated/prisma/client';

/** Match the current matter value, falling back to the legacy source only if
 * no independent profile exists. Callers must separately add their scopes. */
export function notaryRoutineShopWhere(
  value: string,
): Prisma.NotaryMatterWhereInput {
  const match = {
    contains: value.trim().replace(/[\\%_]/g, '\\$&'),
    mode: 'insensitive' as const,
  };
  return {
    OR: [
      { routineProfile: { is: { shopName: match } } },
      { routineProfile: { is: null }, sourceLead: { is: { shopName: match } } },
    ],
  };
}

/** Search only the current matter, its source number and its current shop. */
export function notaryKeywordWhere(
  value: string,
): Prisma.NotaryMatterWhereInput {
  const match = {
    contains: value.trim().replace(/[\\%_]/g, '\\$&'),
    mode: 'insensitive' as const,
  };
  return {
    OR: [
      { businessNo: match },
      { sourceLead: { is: { businessNo: match } } },
      notaryRoutineShopWhere(value),
    ],
  };
}
