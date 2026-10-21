import { Prisma } from '../../generated/prisma/client';
import type { CaseReportAmount } from '../cases';

const Decimal = Prisma.Decimal.clone({
  precision: 36,
  rounding: Prisma.Decimal.ROUND_HALF_UP,
});
const amountPattern = /^(0|[1-9]\d{0,13})(?:\.\d{1,2})?$/u;

export class InvalidReportAmountError extends Error {
  constructor() {
    super('Invalid report amount source');
    this.name = 'InvalidReportAmountError';
  }
}

export type ArchivedCaseAverage =
  | { status: 'VALUE'; amount: string; reason: null }
  | { status: 'NO_RECORDS'; amount: null; reason: 'NO_ARCHIVED_CASES' }
  | { status: 'UNAVAILABLE'; amount: null; reason: 'NO_KNOWN_AMOUNT' };

export function archivedCaseAverage(
  claims: readonly CaseReportAmount[],
): ArchivedCaseAverage {
  if (claims.length === 0)
    return { status: 'NO_RECORDS', amount: null, reason: 'NO_ARCHIVED_CASES' };
  let total = new Decimal(0),
    known = 0;
  for (const claim of claims) {
    if (claim.state === 'KNOWN') {
      if (typeof claim.amount !== 'string' || !amountPattern.test(claim.amount))
        throw new InvalidReportAmountError();
      total = total.plus(claim.amount);
      known++;
    } else if (
      (claim.state !== 'PENDING' && claim.state !== 'UNRECORDED') ||
      claim.amount !== null
    ) {
      throw new InvalidReportAmountError();
    }
  }
  if (known === 0)
    return { status: 'UNAVAILABLE', amount: null, reason: 'NO_KNOWN_AMOUNT' };
  return {
    status: 'VALUE',
    amount: total
      .div(known)
      .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
      .toFixed(2),
    reason: null,
  };
}
