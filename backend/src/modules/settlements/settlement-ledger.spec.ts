import {
  billSelection,
  mergeSampleFees,
  settlementBalance,
} from './settlement-ledger';

describe('settlement launch and bill source rows', () => {
  it('tracks launched amounts independently of bill membership', () => {
    expect(settlementBalance('100.00', [{ amount: '40.00' }])).toEqual({
      launched: '40.00',
      remaining: '60.00',
      overLaunched: false,
    });
    expect(settlementBalance('0.00', [{ amount: '40.00' }])).toEqual({
      launched: '40.00',
      remaining: '0.00',
      overLaunched: true,
    });
  });

  it('selects stable rows across payees and rejects billed or duplicate rows', () => {
    const rows = [
      {
        id: 'b',
        side: 'CUSTOMER' as const,
        amount: '200.00',
        billId: null,
        payeeId: 'second',
      },
      {
        id: 'a',
        side: 'CUSTOMER' as const,
        amount: '100.00',
        billId: null,
        payeeId: 'first',
      },
      {
        id: 'c',
        side: 'LAWYER' as const,
        amount: '40.00',
        billId: null,
        payeeId: 'lawyer',
      },
    ];
    expect(billSelection('CUSTOMER', ['a', 'b'], rows)).toEqual({
      ids: ['a', 'b'],
      amount: '300.00',
      payeeIds: ['first', 'second'],
    });
    expect(() => billSelection('CUSTOMER', ['a', 'a'], rows)).toThrow();
    expect(() => billSelection('CUSTOMER', ['c'], rows)).toThrow();
    expect(() =>
      billSelection('CUSTOMER', ['a'], [{ ...rows[1], billId: 'bill' }]),
    ).toThrow();
  });
});

describe('fee center display', () => {
  const base = {
    caseId: 'case',
    status: '未发起',
    feeDate: '2026-10-16',
    direction: '支出' as const,
  };
  it('nets sample fees without hiding unrelated source rows', () => {
    expect(
      mergeSampleFees([
        { ...base, id: 'sample', type: '样品费', amount: '120.00' },
        { ...base, id: 'return', type: '样品费退款', amount: '20.00' },
        { ...base, id: 'freight', type: '退货运费', amount: '10.00' },
      ]),
    ).toMatchObject([
      { id: 'sample', amount: '100.00', mergeTypes: ['样品费', '样品费退款'] },
      { id: 'freight', amount: '10.00' },
    ]);
  });
});
