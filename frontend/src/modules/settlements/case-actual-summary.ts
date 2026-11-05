export type CaseActualSummary =
  | { state: 'UNAVAILABLE' | 'LOADING' | 'DENIED' | 'ERROR' }
  | {
      state: 'READY';
      customerReceiptState: 'RECORDED' | 'UNKNOWN';
      customerReceivedAmount: string | null;
      lawyerInvoiceState: 'RECORDED' | 'UNKNOWN';
      lawyerInvoicedAmount: string | null;
      scope: 'CASE' | 'CONSOLIDATION' | null;
    };
