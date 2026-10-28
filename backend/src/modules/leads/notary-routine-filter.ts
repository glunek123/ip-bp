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
