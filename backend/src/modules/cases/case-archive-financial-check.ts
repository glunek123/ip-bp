type CheckState = 'PASSED' | 'BLOCKED' | 'UNKNOWN';
type RefundStatus =
  | 'PENDING'
  | 'SUBMITTED'
  | 'RETURNED_UNSETTLED'
  | 'SETTLED'
  | 'RECEIVED'
  | 'CONVERTED_TO_COST';

/** Missing records are unresolved; the caller must not turn UNKNOWN into success. */
export function checkArchiveFinancialStatuses(input: {
  refunds: readonly {
    party: 'COURT' | 'DEFENDANT';
    status: RefundStatus | null;
    amount?: string | null;
  }[];
  refundNotApplicable?: boolean;
  settlementNotApplicable?: boolean;
  customer: 'PENDING' | 'SETTLED' | 'RECEIVED' | null;
  lawyer: 'PENDING' | 'INVOICED' | null;
}): { refund: CheckState; customer: CheckState; lawyer: CheckState } {
  const refundChecks: CheckState[] = input.refunds.map((row) => {
    if (row.party === 'COURT' && row.status === 'CONVERTED_TO_COST')
      return 'BLOCKED';
    if (
      row.amount === null ||
      row.amount === undefined ||
      !/^(?:0|[1-9]\d{0,13})(?:\.\d{1,2})?$/u.test(row.amount)
    )
      return 'UNKNOWN';
    if (/^0(?:\.0{1,2})?$/u.test(row.amount)) return 'PASSED';
    if (row.status === null) return 'UNKNOWN';
    if (
      row.status === 'RECEIVED' ||
      (row.party === 'DEFENDANT' && row.status === 'CONVERTED_TO_COST')
    )
      return 'PASSED';
    return 'BLOCKED';
  });
  return {
    refund:
      refundChecks.length === 0 && input.refundNotApplicable === true
        ? 'PASSED'
        : refundChecks.includes('BLOCKED')
          ? 'BLOCKED'
          : refundChecks.length === 0 || refundChecks.includes('UNKNOWN')
            ? 'UNKNOWN'
            : 'PASSED',
    customer:
      input.customer === null &&
      input.lawyer === null &&
      input.settlementNotApplicable === true
        ? 'PASSED'
        : input.customer === null
          ? 'UNKNOWN'
          : input.customer === 'RECEIVED'
            ? 'PASSED'
            : 'BLOCKED',
    lawyer:
      input.lawyer === null &&
      input.customer === null &&
      input.settlementNotApplicable === true
        ? 'PASSED'
        : input.lawyer === null
          ? 'UNKNOWN'
          : input.lawyer === 'INVOICED'
            ? 'PASSED'
            : 'BLOCKED',
  };
}
