import { checkArchiveFinancialStatuses } from './case-archive-financial-check';
import { checkArchivePayment } from './case-archive-payment-check';

type FinancialInput = Parameters<typeof checkArchiveFinancialStatuses>[0];
type Status = 'PASSED' | 'BLOCKED' | 'UNKNOWN' | 'EXEMPT';

/**
 * Calculates a preview from already authorized, valid case facts. This does not
 * fetch facts or lock them and must not authorize or perform an archive write.
 */
export function previewCaseArchiveReadiness(input: {
  closureAmount: string | null;
  validPayments: readonly string[];
  financial: FinancialInput;
}): {
  canArchive: boolean;
  payment: ReturnType<typeof checkArchivePayment>;
  refund: Status;
  customer: Status;
  lawyer: Status;
} {
  const payment = checkArchivePayment(input.closureAmount, input.validPayments);
  const financial = checkArchiveFinancialStatuses(input.financial);
  const exempt = payment.state === 'ZERO_AMOUNT';
  const refund = financial.refund;
  const customer = exempt ? 'EXEMPT' : financial.customer;
  const lawyer = exempt ? 'EXEMPT' : financial.lawyer;
  return {
    canArchive:
      (exempt || payment.state === 'PAYMENT_COMPLETE') &&
      refund === 'PASSED' &&
      (exempt || (customer === 'PASSED' && lawyer === 'PASSED')),
    payment,
    refund,
    customer,
    lawyer,
  };
}
