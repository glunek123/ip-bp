import { Prisma } from '../../generated/prisma/client';
import type { SettlementSide } from './settlement-calculation';

const Decimal = Prisma.Decimal.clone({ precision: 36 });

export interface LaunchRow {
  id: string;
  side: SettlementSide;
  amount: string;
  billId: string | null;
  payeeId: string;
}

export function settlementBalance(
  total: string | null,
  launches: ReadonlyArray<Pick<LaunchRow, 'amount'>>,
): {
  launched: string;
  remaining: string | null;
  overLaunched: boolean;
} {
  const launched = launches.reduce(
    (sum, row) => sum.plus(row.amount),
    new Decimal(0),
  );
  if (total === null)
    return {
      launched: launched.toFixed(2),
      remaining: null,
      overLaunched: false,
    };
  const difference = new Decimal(total).minus(launched);
  return {
    launched: launched.toFixed(2),
    remaining: Decimal.max(0, difference).toFixed(2),
    overLaunched: difference.isNegative(),
  };
}

export function billSelection(
  side: SettlementSide,
  selectedIds: readonly string[],
  rows: readonly LaunchRow[],
): { ids: string[]; amount: string; payeeIds: string[] } {
  if (
    selectedIds.length === 0 ||
    new Set(selectedIds).size !== selectedIds.length
  )
    throw new Error('INVALID_BILL_SELECTION');
  const byId = new Map(rows.map((row) => [row.id, row]));
  const chosen = selectedIds.map((id) => byId.get(id));
  if (
    chosen.some(
      (row) => row === undefined || row.side !== side || row.billId !== null,
    )
  )
    throw new Error('INVALID_BILL_SELECTION');
  const valid = chosen.filter((row): row is LaunchRow => row !== undefined);
  const amount = valid.reduce(
    (sum, row) => sum.plus(row.amount),
    new Decimal(0),
  );
  if (!amount.greaterThan(0)) throw new Error('INVALID_BILL_SELECTION');
  return {
    ids: [...selectedIds],
    amount: amount.toFixed(2),
    payeeIds: [...new Set(valid.map((row) => row.payeeId))],
  };
}

export function feeSummary(
  rows: readonly {
    type: string;
    direction: '收入' | '支出';
    amount: string;
    status: string;
    sourceKind?: string | null;
  }[],
): { expense: string; income: string; pending: string; pendingCount: number } {
  let expense = new Decimal(0);
  let income = new Decimal(0);
  let pending = new Decimal(0);
  let pendingCount = 0;
  for (const row of rows) {
    if (
      row.sourceKind === 'NOTARY_MATTER_RETURN' &&
      row.type === '样品费退款' &&
      row.status !== '已支付'
    )
      continue;
    if (row.direction === '收入') income = income.plus(row.amount);
    else {
      expense = expense.plus(row.amount);
      if (row.status === '发起') {
        pending = pending.plus(row.amount);
        pendingCount += 1;
      }
    }
  }
  return {
    expense: expense.toFixed(2),
    income: income.toFixed(2),
    pending: pending.toFixed(2),
    pendingCount,
  };
}

export interface FeeDisplayRow {
  id: string;
  caseId: string | null;
  notaryMatterId?: string | null;
  type: string;
  amount: string;
  direction: '收入' | '支出';
  status: string;
  feeDate: string;
  sourceKind?: string | null;
  mergeTypes?: readonly string[];
}

/** Demo's sample fee net presentation; source rows remain separate. */
export function mergeSampleFees<T extends FeeDisplayRow>(
  rows: readonly T[],
): Array<T & { mergeTypes?: readonly string[] }> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const owner = row.caseId ?? row.notaryMatterId ?? row.id;
    groups.set(owner, [...(groups.get(owner) ?? []), row]);
  }
  const merged = new Map<
    string,
    (T & { mergeTypes: readonly string[] }) | null
  >();
  const drop = new Set<string>();
  for (const [owner, group] of groups) {
    const pair = group.filter(
      (row) =>
        row.type === '样品费' ||
        (row.type === '样品费退款' &&
          (row.sourceKind !== 'NOTARY_MATTER_RETURN' ||
            row.status === '已支付')),
    );
    const firstSample = pair.find((row) => row.type === '样品费');
    if (
      firstSample === undefined ||
      !pair.some((row) => row.type === '样品费退款')
    )
      continue;
    const difference = pair.reduce(
      (sum, row) =>
        row.type === '样品费' ? sum.plus(row.amount) : sum.minus(row.amount),
      new Decimal(0),
    );
    for (const row of pair) drop.add(row.id);
    merged.set(
      owner,
      difference.isZero()
        ? null
        : {
            ...firstSample,
            amount: difference.toFixed(2),
            direction: '支出',
            mergeTypes: ['样品费', '样品费退款'],
          },
    );
  }
  const emitted = new Set<string>();
  const output: Array<T & { mergeTypes?: readonly string[] }> = [];
  for (const row of rows) {
    if (!drop.has(row.id)) {
      output.push(row);
      continue;
    }
    const owner = row.caseId ?? row.notaryMatterId ?? row.id;
    if (emitted.has(owner)) continue;
    emitted.add(owner);
    const net = merged.get(owner);
    if (net !== null && net !== undefined) output.push(net);
  }
  return output;
}
