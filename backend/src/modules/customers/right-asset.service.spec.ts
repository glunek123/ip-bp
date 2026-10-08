import { createHash } from 'node:crypto';
import { AccessControlService } from '../../access-control/access-control.service';
import { DatabaseService } from '../../database/database.service';
import { MaterialService } from '../materials/material.service';
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
    {} as MaterialService,
  );
  beforeEach(() => transaction.mockClear());

  it.each(['clientCustomerId', 'notaryOfficeId', 'lawyerAccountId'] as const)(
    'denies %s accounts the internal asset library before database access',
    async (identityField) => {
      const external = { ...actor, [identityField]: customerId };
      await expect(
        service.create(external, customerId, 'key-1', base),
      ).rejects.toMatchObject({
        response: { code: 'CUSTOMER_ACTION_FORBIDDEN' },
      });
      await expect(
        service.list(external, customerId, 1, 20),
      ).rejects.toMatchObject({ response: { code: 'CUSTOMER_NOT_FOUND' } });
      expect(transaction).not.toHaveBeenCalled();
    },
  );

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

describe('RightAssetService accepted receipt compatibility', () => {
  it('replays an omitted-attachment legacy create receipt before dynamic evidence lookup', async () => {
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify({
          action: 'CREATE',
          customerId,
          assetId: null,
          expectedCustomerVersion: 1,
          fields: {
            type: 'TRADEMARK',
            name: '测试商标',
            number: null,
            category: '商标权',
            holderId: base.holderId,
            ownerText: null,
            trademarkClass: '25',
            validFrom: null,
            validTo: null,
            validityMode: 'UNKNOWN',
          },
        }),
      )
      .digest('hex');
    const version = {
      id: '55555555-5555-4555-8555-555555555555',
      version: 1,
      action: 'CREATE',
      ...base,
      validFrom: null,
      validTo: null,
      withdrawReason: null,
      recordedByUserId: actor.userId,
      recordedAt: new Date('2026-10-08T00:00:00.000Z'),
      evidenceReferences: [],
    };
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: customerId }]),
      customer: {
        findFirst: jest.fn().mockResolvedValue({ id: customerId, version: 8 }),
      },
      customerRightAssetReceipt: {
        findUnique: jest.fn().mockResolvedValue({
          departmentId: actor.departmentId,
          customerId,
          assetId: '66666666-6666-4666-8666-666666666666',
          resultVersionId: version.id,
          resultCustomerVersion: 2,
          requestFingerprint: fingerprint,
        }),
      },
      customerRightAssetVersion: {
        findFirst: jest.fn().mockResolvedValue(version),
      },
      customerRightAsset: { findFirst: jest.fn() },
    };
    const database = {
      $transaction: jest.fn(
        async (callback: (client: typeof tx) => Promise<unknown>) =>
          callback(tx),
      ),
    };
    const access = { buildCustomerScope: jest.fn().mockResolvedValue({}) };
    const materials = { assertAvailableVersions: jest.fn() };
    const service = new RightAssetService(
      database as unknown as DatabaseService,
      access as unknown as AccessControlService,
      materials as unknown as MaterialService,
    );
    const result = await service.create(actor, customerId, 'legacy-key', base);
    expect(result).toMatchObject({
      customerVersion: 2,
      fields: { id: version.id, evidence: [] },
    });
    expect(tx.customerRightAsset.findFirst).not.toHaveBeenCalled();
    expect(materials.assertAvailableVersions).not.toHaveBeenCalled();
    expect(tx.customerRightAssetReceipt.findUnique).toHaveBeenCalledTimes(1);
  });
});
