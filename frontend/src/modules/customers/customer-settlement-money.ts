const canonicalAmount = /^-?(?:0|[1-9]\d*)\.\d{2}$/u;

function toMinorUnits(value: string): bigint {
  if (!canonicalAmount.test(value) || value === '-0.00')
    throw new TypeError('Invalid canonical settlement amount');
  const negative = value.startsWith('-');
  const unsigned = negative ? value.slice(1) : value;
  const [whole, fraction] = unsigned.split('.');
  const cents = BigInt(whole) * 100n + BigInt(fraction);
  return negative ? -cents : cents;
}

function fromMinorUnits(value: bigint): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = absolute / 100n;
  const fraction = String(absolute % 100n).padStart(2, '0');
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

export function formatSettlementAmount(value: string): string {
  const canonical = fromMinorUnits(toMinorUnits(value));
  const negative = canonical.startsWith('-');
  const unsigned = negative ? canonical.slice(1) : canonical;
  const [whole, fraction] = unsigned.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/gu, ',');
  return `${negative ? '-¥' : '¥'}${grouped}.${fraction}`;
}

export function formatSettlementPercent(value: string): string {
  if (!/^(?:0|[1-9]\d*)\.\d{2}$/u.test(value))
    throw new TypeError('Invalid canonical settlement rate');
  return `${value}%`;
}

export function settlementPendingDisplay(value: string | null): {
  label: '待回款' | '超收';
  amount: string;
} {
  if (value === null) return { label: '待回款', amount: '—，回款尚有未录入' };
  const cents = toMinorUnits(value);
  if (cents < 0n)
    return {
      label: '超收',
      amount: formatSettlementAmount(fromMinorUnits(-cents)),
    };
  return { label: '待回款', amount: formatSettlementAmount(value) };
}

export function settlementRecoveryBarWidth(value: string | null): string {
  if (value === null) return '0%';
  if (!/^(?:0|[1-9]\d*)\.\d{2}$/u.test(value))
    throw new TypeError('Invalid canonical settlement rate');
  const [whole, fraction] = value.split('.');
  if (BigInt(whole) > 100n || (BigInt(whole) === 100n && fraction !== '00'))
    return '100%';
  const trimmedFraction = fraction.replace(/0+$/u, '');
  return `${whole}${trimmedFraction ? `.${trimmedFraction}` : ''}%`;
}

export function isSettlementInputAmount(value: string): boolean {
  return /^(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/u.test(value);
}
