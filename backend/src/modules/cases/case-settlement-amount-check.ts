const amountPattern = /^(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/u;

type AmountCheckState = 'UNKNOWN' | 'INSUFFICIENT' | 'REACHED';

function parseCents(amount: string): bigint {
  if (typeof amount !== 'string' || !amountPattern.test(amount))
    throw new Error('INVALID_AMOUNT');

  const [whole, fraction = ''] = amount.split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
}

function formatCents(cents: bigint): string {
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, '0')}`;
}

/**
 * Checks one case's required settlement amount against allocations the caller has already
 * confirmed belong to that case. It does not load, store, authorize, or verify
 * the truth of those financial facts. An empty zero requirement is UNKNOWN;
 * exemption requires a separate explicit non-applicability decision.
 */
export function checkCaseSettlementAmount(
  requiredAmount: string | null,
  confirmedCaseAllocations: readonly string[],
): {
  state: AmountCheckState;
  requiredAmount: string | null;
  allocatedAmount: string;
} {
  const requiredCents =
    requiredAmount === null ? null : parseCents(requiredAmount);
  const allocatedCents = confirmedCaseAllocations.reduce(
    (sum, amount) => sum + parseCents(amount),
    0n,
  );

  return {
    state:
      requiredCents === null ||
      (requiredCents === 0n && confirmedCaseAllocations.length === 0)
        ? 'UNKNOWN'
        : allocatedCents >= requiredCents
          ? 'REACHED'
          : 'INSUFFICIENT',
    requiredAmount: requiredCents === null ? null : formatCents(requiredCents),
    allocatedAmount: formatCents(allocatedCents),
  };
}
