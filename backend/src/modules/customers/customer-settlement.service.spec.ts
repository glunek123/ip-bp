import { Prisma } from '../../generated/prisma/client';
import {
  normalizeSettlementMoney,
  parseSettlementDate,
  settlementStats,
} from './customer-settlement.service';

const row = (
  settlementAmount: string,
  invoiceAmount: string | null,
  receivedAmount: string | null,
) => ({
  settlementAmount: new Prisma.Decimal(settlementAmount),
  invoiceAmount:
    invoiceAmount === null ? null : new Prisma.Decimal(invoiceAmount),
  receivedAmount:
    receivedAmount === null ? null : new Prisma.Decimal(receivedAmount),
});

describe('customer settlement exact facts', () => {
  it('normalizes accepted raw strings without rounding', () => {
    expect(
      ['0', '0.0', '1.23', '9999999999999999.99'].map(normalizeSettlementMoney),
    ).toEqual(['0.00', '0.00', '1.23', '9999999999999999.99']);
    for (const value of [
      1.23,
      '-1',
      '+1',
      ' 1',
      '01',
      '1e2',
      '1.001',
      '1.230',
      '10000000000000000',
    ])
      expect(() => normalizeSettlementMoney(value)).toThrow();
  });

  it('rejects unreal calendar dates including year zero', () => {
    for (const value of [
      '0000-01-01',
      '2026-02-29',
      '2026-13-01',
      '2026-04-31',
    ])
      expect(() => parseSettlementDate(value)).toThrow();
    expect(parseSettlementDate('2024-02-29').toISOString()).toBe(
      '2024-02-29T00:00:00.000Z',
    );
  });

  it('keeps unknown distinct from zero and computes negative pending', () => {
    expect(
      settlementStats([row('100.00', null, null), row('0.00', '0.00', '0.00')]),
    ).toMatchObject({
      recordCount: 2,
      invoiceKnownSubtotal: '0.00',
      invoiceUnknownCount: 1,
      receivedKnownSubtotal: '0.00',
      receivedUnknownCount: 1,
      pendingAmount: null,
      recoveryRate: null,
    });
    expect(settlementStats([row('100.00', null, '120.00')])).toMatchObject({
      pendingAmount: '-20.00',
      recoveryRate: '120.00',
    });
    expect(settlementStats([row('0.00', null, '12.00')])).toMatchObject({
      pendingAmount: '-12.00',
      recoveryRate: null,
    });
  });

  it('rounds the 21-row 1.005 percent boundary exactly', () => {
    const first = Array.from({ length: 20 }, () =>
      row('9999999999999999.99', null, '0.00'),
    );
    first[0] = row('9999999999999999.99', null, '2010000000000000.00');
    const below = settlementStats([...first, row('0.21', null, '0.00')]);
    const at = settlementStats([...first, row('0.20', null, '0.00')]);
    expect(below).toMatchObject({
      totalSettlement: '200000000000000000.01',
      recoveryRate: '1.00',
    });
    expect(at).toMatchObject({
      totalSettlement: '200000000000000000.00',
      recoveryRate: '1.01',
    });
  });
});
