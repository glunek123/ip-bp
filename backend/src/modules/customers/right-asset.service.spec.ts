import { AccessControlService } from '../../access-control/access-control.service';
import { DatabaseService } from '../../database/database.service';
import { CreateRightAssetDto } from './right-asset.dto';
import { RightAssetService } from './right-asset.service';

const actor = {
  userId: '11111111-1111-4111-8111-111111111111',
  departmentId: '22222222-2222-4222-8222-222222222222',
  authorizationRevision: 1,
};
const customerId = '33333333-3333-4333-8333-333333333333';
const base: CreateRightAssetDto = {
  expectedCustomerVersion: 1,
  type: 'TRADEMARK',
  name: '测试商标',
  number: null,
  category: '商标权',
  holderId: '44444444-4444-4444-8444-444444444444',
  ownerText: null,
  trademarkClass: '25',
  validFrom: null,
  validTo: null,
  validityMode: 'UNKNOWN',
};

describe('RightAssetService field validation', () => {
  const transaction = jest.fn();
  const service = new RightAssetService(
    { $transaction: transaction } as unknown as DatabaseService,
    {} as AccessControlService,
  );
  beforeEach(() => transaction.mockClear());

  it.each([
    [{ validityMode: 'FIXED' as const, validTo: null }, '固定期限'],
    [
      { validityMode: 'LONG_TERM' as const, validTo: '2026-10-10' },
      '不能填写截止日期',
    ],
    [
      { validityMode: 'FIXED' as const, validTo: '2026-02-30' },
      '不是有效公历日期',
    ],
    [
      { validityMode: 'FIXED' as const, validTo: '0000-01-01' },
      '不是有效公历日期',
    ],
    [
      {
        validityMode: 'FIXED' as const,
        validFrom: '2026-10-11',
        validTo: '2026-10-10',
      },
      '不能晚于',
    ],
  ])(
    'rejects invalid actual dates before any database write',
    async (fields, message) => {
      await expect(
        service.create(actor, customerId, 'key-1', { ...base, ...fields }),
      ).rejects.toMatchObject({
        response: {
          code: 'VALIDATION_ERROR',
          message: expect.stringContaining(message),
        },
      });
      expect(transaction).not.toHaveBeenCalled();
    },
  );
});
