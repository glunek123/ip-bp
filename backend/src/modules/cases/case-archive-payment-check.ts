import { Prisma } from '../../generated/prisma/client';

const Decimal = Prisma.Decimal.clone({ precision: 50 });
const moneyPattern = /^(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/u;

function money(value: string) {
  if (!moneyPattern.test(value)) throw new Error('INVALID_AMOUNT');
  return new Decimal(value);
}

/** Callers must supply only the same case's valid, persisted payment facts. */
export function checkArchivePayment(
  closureAmount: string | null,
  validPayments: readonly string[],
): {
  state:
    | 'AMOUNT_UNKNOWN'
    | 'ZERO_AMOUNT'
    | 'PAYMENT_INCOMPLETE'
    | 'PAYMENT_COMPLETE';
  paidAmount: string | null;
} {
  if (closureAmount === null)
    return { state: 'AMOUNT_UNKNOWN', paidAmount: null };

  const required = money(closureAmount);
  const paid = validPayments.reduce(
    (sum, value) => sum.plus(money(value)),
    new Decimal(0),
  );
  return {
    state: required.isZero()
      ? 'ZERO_AMOUNT'
      : paid.lessThan(required)
        ? 'PAYMENT_INCOMPLETE'
        : 'PAYMENT_COMPLETE',
    paidAmount: paid.toFixed(2),
  };
}
