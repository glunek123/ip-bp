import { Prisma } from '../../generated/prisma/client';

const Decimal = Prisma.Decimal.clone({
  precision: 36,
  rounding: Prisma.Decimal.ROUND_HALF_UP,
});
const moneyPattern = /^(0|[1-9]\d{0,15})(?:\.\d{1,2})?$/u;
const percentPattern = /^(?:100(?:\.0{1,16})?|\d{1,2}(?:\.\d{1,16})?)$/u;

export type SettlementSide = 'CUSTOMER' | 'LAWYER';
export type LawyerSettlementMode = 'FULL_RISK' | 'HALF_RISK' | 'FIXED_FEE';

export interface SettlementCalculationInput {
  /** The explicit case closure amount takes precedence, including zero. */
  closureAmount: string | null;
  closureAmountState: 'UNRECORDED' | 'KNOWN' | 'PENDING';
  fallbackClaimAmount: string | null;
  customerFormula: string | null;
  lawyerMode: LawyerSettlementMode | null;
  lawyerBaseFee: string | null;
  lawyerSplitPercent: string | null;
  customerManualAmount?: string | null;
  lawyerManualAmount?: string | null;
}

export interface SettlementCalculationResult {
  basis: string | null;
  customerPercent: string | null;
  customerAutomaticAmount: string | null;
  customerAmount: string | null;
  customerSource: 'AUTOMATIC' | 'MANUAL';
  lawyerAutomaticAmount: string | null;
  lawyerAmount: string | null;
  lawyerSource: 'AUTOMATIC' | 'MANUAL';
}

function money(value: string): InstanceType<typeof Decimal> {
  if (!moneyPattern.test(value)) throw new Error('INVALID_SETTLEMENT_MONEY');
  return new Decimal(value);
}

function percent(value: string): InstanceType<typeof Decimal> {
  if (!percentPattern.test(value))
    throw new Error('INVALID_SETTLEMENT_PERCENT');
  return new Decimal(value);
}

function roundedMoney(value: InstanceType<typeof Decimal>): string {
  // Demo displays whole yuan and Math.rounds positive calculations at this point.
  return value.toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toFixed(2);
}

export function customerPercentFromFormula(formula: string): string {
  // Match the Demo's preferred "结案金额 × N%" and its fallback "N%" form.
  const preferred = formula.match(/结案金额[^\d%]{0,8}(\d+(?:\.\d+)?)\s*%/u);
  const fallback = formula.match(/(\d+(?:\.\d+)?)\s*%/u);
  const raw = preferred?.[1] ?? fallback?.[1];
  if (raw === undefined) throw new Error('INVALID_CUSTOMER_FORMULA');
  return percent(raw).toString();
}

export function calculateSettlement(
  input: SettlementCalculationInput,
): SettlementCalculationResult {
  if (
    (input.closureAmountState === 'KNOWN') !==
    (input.closureAmount !== null)
  ) {
    throw new Error('INVALID_CLOSURE_AMOUNT_STATE');
  }
  const basisRaw =
    input.closureAmountState === 'UNRECORDED'
      ? input.fallbackClaimAmount
      : input.closureAmount;
  const basis = basisRaw === null ? null : money(basisRaw);
  const customerPercent =
    input.customerFormula === null
      ? null
      : customerPercentFromFormula(input.customerFormula);
  const split =
    input.lawyerSplitPercent === null
      ? null
      : percent(input.lawyerSplitPercent);
  const baseFee =
    input.lawyerBaseFee === null ? null : money(input.lawyerBaseFee);
  if (
    input.lawyerMode !== null &&
    !['FULL_RISK', 'HALF_RISK', 'FIXED_FEE'].includes(input.lawyerMode)
  ) {
    throw new Error('INVALID_LAWYER_SETTLEMENT_MODE');
  }
  if (input.lawyerMode !== null && (split === null || baseFee === null))
    throw new Error('INCOMPLETE_LAWYER_TERMS');

  const customerAutomaticAmount =
    basis === null || customerPercent === null
      ? null
      : roundedMoney(basis.mul(customerPercent).div(100));
  let lawyerAutomaticAmount: string | null = null;
  if (input.lawyerMode !== null && split !== null && baseFee !== null) {
    if (input.lawyerMode === 'FIXED_FEE')
      lawyerAutomaticAmount = roundedMoney(baseFee);
    else if (basis !== null)
      lawyerAutomaticAmount = roundedMoney(
        input.lawyerMode === 'HALF_RISK'
          ? baseFee.add(basis.mul(split).div(100))
          : basis.mul(split).div(100),
      );
  }
  const customerManual =
    input.customerManualAmount === undefined ||
    input.customerManualAmount === null
      ? null
      : roundedMoney(money(input.customerManualAmount));
  const lawyerManual =
    input.lawyerManualAmount === undefined || input.lawyerManualAmount === null
      ? null
      : roundedMoney(money(input.lawyerManualAmount));

  return {
    basis: basis?.toFixed(2) ?? null,
    customerPercent,
    customerAutomaticAmount,
    customerAmount: customerManual ?? customerAutomaticAmount,
    customerSource: customerManual === null ? 'AUTOMATIC' : 'MANUAL',
    lawyerAutomaticAmount,
    lawyerAmount: lawyerManual ?? lawyerAutomaticAmount,
    lawyerSource: lawyerManual === null ? 'AUTOMATIC' : 'MANUAL',
  };
}
