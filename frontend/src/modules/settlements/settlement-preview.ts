import type {
  LawyerSettlementMode,
  SettlementSide,
} from '../../api/settlements';
const scale = 10n ** 16n;
function cents(value: string): bigint {
  if (!/^(0|[1-9]\d{0,15})(?:\.\d{1,2})?$/u.test(value))
    throw new Error('金额须为非负数，最多16位整数和2位小数');
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, '0'));
}
function percent(value: string): bigint {
  if (!/^(?:100(?:\.0{1,16})?|\d{1,2}(?:\.\d{1,16})?)$/u.test(value))
    throw new Error('比例须在0至100之间，最多16位小数');
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole!) * scale + BigInt(fraction.padEnd(16, '0'));
}
function roundedYuan(numerator: bigint, denominator: bigint): string {
  return `${(numerator * 2n + denominator) / (2n * denominator)}.00`;
}
export function roundManualSettlement(value: string): string {
  return roundedYuan(cents(value), 100n);
}
/** Presentation preview only. The backend recomputes every saved/launch amount. */
export function previewSettlement(
  basis: string | null,
  side: SettlementSide,
  terms: {
    formula: string;
    mode: LawyerSettlementMode;
    baseFee: string;
    splitPercent: string;
  },
): { amount: string | null; error: string | null } {
  try {
    if (side === 'LAWYER' && terms.mode === 'FIXED_FEE')
      return { amount: roundedYuan(cents(terms.baseFee), 100n), error: null };
    const raw =
      side === 'CUSTOMER'
        ? (terms.formula.match(
            /结案金额[^\d%]{0,8}(\d+(?:\.\d+)?)\s*%/u,
          )?.[1] ?? terms.formula.match(/(\d+(?:\.\d+)?)\s*%/u)?.[1])
        : terms.splitPercent;
    if (raw === undefined)
      throw new Error('公式无法解析，请填写结案金额与百分比');
    const split = percent(raw);
    if (side === 'LAWYER' && terms.mode === 'FULL_RISK' && split === 0n)
      throw new Error('全风险比例必须大于0');
    if (basis === null) return { amount: null, error: null };
    const basisCents = cents(basis);
    const numerator =
      basisCents * split +
      (side === 'LAWYER' && terms.mode === 'HALF_RISK'
        ? cents(terms.baseFee) * 100n * scale
        : 0n);
    return { amount: roundedYuan(numerator, 10000n * scale), error: null };
  } catch (cause) {
    return {
      amount: null,
      error: cause instanceof Error ? cause.message : '结算条件无效',
    };
  }
}
