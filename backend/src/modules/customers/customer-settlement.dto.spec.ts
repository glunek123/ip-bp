import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  CorrectCustomerSettlementDto,
  RegisterCustomerSettlementDto,
} from './customer-settlement.dto';

describe('Customer settlement DTO', () => {
  const common = {
    settlementDate: '2026-10-01',
    settlementAmount: '1.23',
    expectedCustomerVersion: 1,
  };

  it.each(['0', '0.0', '1.23', '9999999999999999.99'])(
    'accepts exact money %s',
    (amount) => {
      expect(
        validateSync(
          plainToInstance(RegisterCustomerSettlementDto, {
            ...common,
            settlementAmount: amount,
          }),
        ),
      ).toHaveLength(0);
    },
  );

  it.each([
    1.23,
    '-1',
    '+1',
    ' 1',
    '01',
    '1e2',
    '1.001',
    '1.230',
    '10000000000000000',
  ])('rejects invalid raw money %s', (amount) => {
    expect(
      validateSync(
        plainToInstance(RegisterCustomerSettlementDto, {
          ...common,
          settlementAmount: amount,
        }),
      ),
    ).not.toHaveLength(0);
  });

  it('requires every nullable correction fact to be present', () => {
    const correction = {
      ...common,
      invoiceAmount: null,
      receivedAmount: '0.00',
      receivedDate: null,
      reason: '核对原始登记后更正',
      expectedRecordVersion: 1,
    };
    expect(
      validateSync(plainToInstance(CorrectCustomerSettlementDto, correction)),
    ).toHaveLength(0);
    for (const field of [
      'invoiceAmount',
      'receivedAmount',
      'receivedDate',
    ] as const) {
      const missing = { ...correction };
      delete missing[field];
      expect(
        validateSync(plainToInstance(CorrectCustomerSettlementDto, missing)),
      ).not.toHaveLength(0);
    }
  });
});
