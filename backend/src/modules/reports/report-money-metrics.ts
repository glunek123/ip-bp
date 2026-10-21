import { Prisma } from '../../generated/prisma/client';
import type { CaseReportAmount } from '../cases';
import { InvalidReportAmountError } from './archived-case-average';

const Decimal = Prisma.Decimal.clone({
  precision: 36,
  rounding: Prisma.Decimal.ROUND_HALF_UP,
});
const amountPattern = /^(0|[1-9]\d{0,13})(?:\.\d{1,2})?$/u;
export type ReportAmountBucket = {
  lowerInclusive: string;
  upperExclusive: string | null;
  count: number;
};
export type ReportKnownMoney = {
  total:
    | { status: 'VALUE'; amount: string }
    | { status: 'NO_RECORDS' | 'NO_KNOWN_AMOUNT'; amount: null };
  knownCases: number;
  unknownCases: number;
  buckets: ReportAmountBucket[];
};

// Pure facts only. Public exposure still requires the separately assigned money
// authorization and shared page/export scope; this function grants no access.
export function reportKnownMoney(
  claims: readonly CaseReportAmount[],
): ReportKnownMoney {
  const buckets: ReportAmountBucket[] = [
    { lowerInclusive: '0.00', upperExclusive: '100000.00', count: 0 },
    { lowerInclusive: '100000.00', upperExclusive: '300000.00', count: 0 },
    { lowerInclusive: '300000.00', upperExclusive: '500000.00', count: 0 },
    { lowerInclusive: '500000.00', upperExclusive: null, count: 0 },
  ];
  let total = new Decimal(0),
    knownCases = 0,
    unknownCases = 0;
  for (const claim of claims) {
    if (claim.state !== 'KNOWN') {
      if (
        (claim.state !== 'PENDING' && claim.state !== 'UNRECORDED') ||
        claim.amount !== null
      )
        throw new InvalidReportAmountError();
      unknownCases++;
      continue;
    }
    if (typeof claim.amount !== 'string' || !amountPattern.test(claim.amount))
      throw new InvalidReportAmountError();
    const amount = new Decimal(claim.amount);
    total = total.plus(amount);
    knownCases++;
    const bucket = buckets.find(
      (row) => row.upperExclusive === null || amount.lt(row.upperExclusive),
    );
    if (!bucket) throw new InvalidReportAmountError();
    bucket.count++;
  }
  return {
    total:
      knownCases > 0
        ? { status: 'VALUE', amount: total.toFixed(2) }
        : {
            status: claims.length === 0 ? 'NO_RECORDS' : 'NO_KNOWN_AMOUNT',
            amount: null,
          },
    knownCases,
    unknownCases,
    buckets,
  };
}

export class InvalidReportCountError extends Error {
  constructor() {
    super('Invalid report count source');
    this.name = 'InvalidReportCountError';
  }
}
export type DemoClosureRate =
  | { status: 'VALUE'; percent: string }
  | { status: 'NO_RECORDS'; percent: null };

// Keep the Demo label "结案率": its approved numerator is ARCHIVED, not a
// newly invented CaseClosure definition. Nonnegative Math.round matches HALF_UP.
export function demoClosureRate(
  totalCases: number,
  archivedCases: number,
): DemoClosureRate {
  if (
    !Number.isSafeInteger(totalCases) ||
    !Number.isSafeInteger(archivedCases) ||
    totalCases < 0 ||
    archivedCases < 0 ||
    archivedCases > totalCases
  )
    throw new InvalidReportCountError();
  if (totalCases === 0) return { status: 'NO_RECORDS', percent: null };
  return {
    status: 'VALUE',
    percent: new Decimal(archivedCases)
      .times(100)
      .div(totalCases)
      .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
      .toFixed(0),
  };
}
