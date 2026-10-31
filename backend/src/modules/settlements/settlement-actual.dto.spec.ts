import { validate } from 'class-validator';
import {
  AllocateSettlementActualFactDto,
  CreateSettlementActualFactDto,
  RegisterCaseSettlementActualDto,
} from './settlement-actual.dto';
import { SettlementSideDtoValue } from './settlement.dto';

describe.each([
  CreateSettlementActualFactDto,
  RegisterCaseSettlementActualDto,
  AllocateSettlementActualFactDto,
])('actual money DTO %s', (Dto) => {
  const build = (amount: string) =>
    Object.assign(new Dto(), {
      caseId: '00000000-0000-4000-8000-000000000001',
      ...(Dto === AllocateSettlementActualFactDto
        ? { factId: '00000000-0000-4000-8000-000000000002' }
        : { side: SettlementSideDtoValue.CUSTOMER, occurredOn: '2026-10-29' }),
      amount,
      idempotencyKey: 'dto-test',
    });

  it.each(['0.1', '0.9', '0.10', '0.01', '1', '9999999999999999.99'])(
    'accepts %s through actual class-validator decorators',
    async (amount) => {
      expect(await validate(build(amount))).toEqual([]);
    },
  );
  it.each([
    '0',
    '0.0',
    '0.00',
    '0.001',
    '-0.1',
    '01',
    '1e2',
    '10000000000000000',
    '.1',
  ])('rejects %s', async (amount) => {
    expect(
      (await validate(build(amount))).some(
        (error) => error.property === 'amount',
      ),
    ).toBe(true);
  });
});
