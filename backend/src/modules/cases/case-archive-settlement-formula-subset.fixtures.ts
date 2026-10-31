import type { SettlementCalculationInput } from '../settlements';
export const base: SettlementCalculationInput = {
  closureAmount: '1000.00',
  closureAmountState: 'KNOWN',
  fallbackClaimAmount: null,
  customerFormula: '客户结算金额=结案金额*70%',
  lawyerMode: 'FULL_RISK',
  lawyerBaseFee: '0.00',
  lawyerSplitPercent: '30',
  customerManualAmount: null,
  lawyerManualAmount: null,
};
// Shared reference vectors for a future explicitly authorized PostgreSQL differential
// run. These tests invoke only the existing TS calculator; they do NOT execute SQL.
export const settlementSqlDifferentialVectors: {
  name: string;
  input: SettlementCalculationInput;
  expectedCustomer: string | null;
  expectedLawyer: string | null;
  subset: boolean;
}[] = [
  {
    name: 'sixteen fractional percent digits',
    input: {
      ...base,
      customerFormula: '结案金额*99.1234567890123456%',
      lawyerSplitPercent: '99.1234567890123456',
    },
    expectedCustomer: '991.00',
    expectedLawyer: '991.00',
    subset: true,
  },
  {
    name: 'decimal precision half-risk boundary',
    input: {
      ...base,
      closureAmount: '9999999999999999.99',
      customerFormula: '100%',
      lawyerMode: 'HALF_RISK',
      lawyerBaseFee: '9999999999999999.99',
      lawyerSplitPercent: '99.9999999999999999',
    },
    expectedCustomer: '10000000000000000.00',
    expectedLawyer: '20000000000000000.00',
    subset: true,
  },
  {
    name: 'Demo preferred',
    input: base,
    expectedCustomer: '700.00',
    expectedLawyer: '300.00',
    subset: true,
  },
  {
    name: 'pure fallback',
    input: { ...base, customerFormula: '75.5%' },
    expectedCustomer: '755.00',
    expectedLawyer: '300.00',
    subset: true,
  },
  {
    name: 'half risk',
    input: { ...base, lawyerMode: 'HALF_RISK', lawyerBaseFee: '120.00' },
    expectedCustomer: '700.00',
    expectedLawyer: '420.00',
    subset: true,
  },
  {
    name: 'fixed fee',
    input: { ...base, lawyerMode: 'FIXED_FEE', lawyerBaseFee: '120.50' },
    expectedCustomer: '700.00',
    expectedLawyer: '121.00',
    subset: true,
  },
  {
    name: 'exact half',
    input: {
      ...base,
      closureAmount: '1.00',
      customerFormula: '结案金额 × 50%',
    },
    expectedCustomer: '1.00',
    expectedLawyer: '0.00',
    subset: true,
  },
  {
    name: 'below half',
    input: { ...base, closureAmount: '0.99', customerFormula: '50%' },
    expectedCustomer: '0.00',
    expectedLawyer: '0.00',
    subset: true,
  },
  {
    name: 'zero basis',
    input: { ...base, closureAmount: '0.00' },
    expectedCustomer: '0.00',
    expectedLawyer: '0.00',
    subset: true,
  },
  {
    name: 'pending basis',
    input: { ...base, closureAmount: null, closureAmountState: 'PENDING' },
    expectedCustomer: null,
    expectedLawyer: null,
    subset: true,
  },
  {
    name: 'fixed pending basis',
    input: {
      ...base,
      closureAmount: null,
      closureAmountState: 'PENDING',
      lawyerMode: 'FIXED_FEE',
      lawyerBaseFee: '120.00',
    },
    expectedCustomer: null,
    expectedLawyer: '120.00',
    subset: true,
  },
  {
    name: 'manual zero and cent',
    input: { ...base, customerManualAmount: '0', lawyerManualAmount: '0.01' },
    expectedCustomer: '0.00',
    expectedLawyer: '0.00',
    subset: true,
  },
  {
    name: 'manual largest cents',
    input: {
      ...base,
      customerManualAmount: '9999999999999999.99',
      lawyerManualAmount: '9999999999999999.99',
    },
    expectedCustomer: '10000000000000000.00',
    expectedLawyer: '10000000000000000.00',
    subset: true,
  },
  {
    name: 'manual half-up',
    input: {
      ...base,
      customerManualAmount: '123.50',
      lawyerManualAmount: '100.20',
    },
    expectedCustomer: '124.00',
    expectedLawyer: '100.00',
    subset: true,
  },
  {
    name: 'largest half risk',
    input: {
      ...base,
      closureAmount: '9999999999999999.99',
      lawyerMode: 'HALF_RISK',
      lawyerBaseFee: '9999999999999999.99',
      lawyerSplitPercent: '100',
    },
    expectedCustomer: '7000000000000000.00',
    expectedLawyer: '20000000000000000.00',
    subset: true,
  },
  {
    name: 'preferred beats earlier fallback',
    input: { ...base, customerFormula: '10%;结案金额*70%' },
    expectedCustomer: '700.00',
    expectedLawyer: '300.00',
    subset: false,
  },
  {
    name: 'Unicode whitespace',
    input: { ...base, customerFormula: '70\u00a0%' },
    expectedCustomer: '700.00',
    expectedLawyer: '300.00',
    subset: false,
  },
];
