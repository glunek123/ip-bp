import { createHash } from 'node:crypto';
import { AccessControlService } from '../../access-control/access-control.service';
import { DatabaseService } from '../../database/database.service';
import { MaterialService } from '../materials';
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

  it('requires an owner source and a status for a new asset', () => {
    expect(() =>
      service['resolveFields']({
        ...base,
        holderId: null,
        ownerText: null,
        status: 'VALID',
      }),
    ).toThrow();
    expect(() => service['resolveFields']({ ...base, status: null })).toThrow();
    expect(() =>
      service['resolveFields']({
        ...base,
        holderId: null,
        ownerText: '手工权利人',
        status: 'VALID',
      }),
    ).not.toThrow();
  });

  it('keeps omitted legacy fields on revision and maps a supplied end date to FIXED', () => {
    const current = {
      ...base,
      holderId: base.holderId!,
      ownerText: null,
      number: null,
      trademarkClass: '25',
      id: '55555555-5555-4555-8555-555555555555',
      version: 1,
      action: 'CREATE' as const,
      withdrawReason: null,
      recordedByUserId: actor.userId,
      recordedAt: new Date('2026-10-08T00:00:00.000Z'),
      evidenceContentVersionIds: [],
      registrationDate: new Date('2020-01-01T00:00:00.000Z'),
      status: 'VALID' as const,
      validFrom: new Date('2019-01-01T00:00:00.000Z'),
      validTo: null,
      validityMode: 'LONG_TERM' as const,
    };
    const unchanged = service['resolveFields'](
      {
        ...base,
        holderId: undefined,
        ownerText: undefined,
        validFrom: undefined,
        validTo: undefined,
        validityMode: undefined,
        trademarkClass: undefined,
        registrationDate: undefined,
        status: undefined,
      },
      current,
    );
    expect(unchanged).toMatchObject({
      holderId: base.holderId,
      registrationDate: current.registrationDate,
      status: 'VALID',
      validFrom: current.validFrom,
      trademarkClass: '25',
      validityMode: 'LONG_TERM',
    });
    const unchangedExpiry = service['resolveFields'](
      {
        ...base,
        holderId: undefined,
        ownerText: '修改后的权利人',
        validTo: null,
        validityMode: undefined,
        status: undefined,
      },
      current,
    );
    expect(unchangedExpiry.validityMode).toBe('LONG_TERM');
    expect(() =>
      service['resolveFields'](
        { ...base, holderId: null, ownerText: '手工权利人', status: undefined },
        current,
      ),
    ).toThrow('已有正式权利主体不能在修订时解除关联');
    const fixed = service['resolveFields'](
      {
        ...base,
        holderId: undefined,
        validTo: '2027-01-01',
        validityMode: undefined,
        status: undefined,
      },
      current,
    );
    expect(fixed.validityMode).toBe('FIXED');
  });

  it('rejects registration dates later than expiry', () => {
    expect(() =>
      service['resolveFields']({
        ...base,
        validTo: '2026-01-01',
        registrationDate: '2026-01-02',
        status: 'VALID',
        validityMode: undefined,
      }),
    ).toThrow();
  });

  it('rejects invalid actual dates before any database write', async () => {
    await expect(
      service.create(actor, customerId, 'invalid-date', {
        ...base,
        validTo: '2026-02-30',
        validityMode: 'FIXED',
      }),
    ).rejects.toMatchObject({
      response: {
        code: 'VALIDATION_ERROR',
        message: expect.stringContaining('不是有效公历日期'),
      },
    });
    expect(transaction).not.toHaveBeenCalled();
  });

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
  it('rejects changed owner text against a modern revision receipt', async () => {
    const assetId = '66666666-6666-4666-8666-666666666666';
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify({
          contractVersion: 2,
          action: 'REVISE',
          customerId,
          assetId,
          expectedCustomerVersion: 1,
          expectedAssetVersion: 1,
          fields: {
            type: base.type,
            name: base.name,
            number: null,
            category: base.category,
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
      version: 2,
      action: 'REVISE',
      ...base,
      validFrom: null,
      validTo: null,
      registrationDate: null,
      status: 'VALID',
      withdrawReason: null,
      recordedByUserId: actor.userId,
      recordedAt: new Date('2026-10-08T00:00:00.000Z'),
      evidenceReferences: [],
    };
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: customerId }]),
      customer: {
        findFirst: jest.fn().mockResolvedValue({ id: customerId, version: 2 }),
      },
      customerRightAssetReceipt: {
        findUnique: jest.fn().mockResolvedValue({
          departmentId: actor.departmentId,
          customerId,
          assetId,
          resultVersionId: version.id,
          resultCustomerVersion: 2,
          requestFingerprint: fingerprint,
        }),
      },
      customerRightAssetVersion: {
        findFirst: jest.fn().mockResolvedValue(version),
      },
    };
    const database = {
      $transaction: jest.fn(
        async (callback: (client: typeof tx) => Promise<unknown>) =>
          callback(tx),
      ),
    };
    const access = { buildCustomerScope: jest.fn().mockResolvedValue({}) };
    const service = new RightAssetService(
      database as unknown as DatabaseService,
      access as unknown as AccessControlService,
      {} as MaterialService,
    );
    const input = { ...base, expectedAssetVersion: 1 };
    await expect(
      service.revise(actor, customerId, assetId, 'modern-key', input),
    ).resolves.toMatchObject({ version: 2 });
    await expect(
      service.revise(actor, customerId, assetId, 'modern-key', {
        ...input,
        ownerText: '不同权利人',
      }),
    ).rejects.toMatchObject({ response: { code: 'IDEMPOTENCY_CONFLICT' } });
    expect(tx.customerRightAssetVersion.findFirst).toHaveBeenCalledTimes(1);
    tx.customerRightAssetReceipt.findUnique.mockResolvedValue({
      departmentId: actor.departmentId,
      customerId,
      assetId,
      resultVersionId: version.id,
      resultCustomerVersion: 2,
      requestFingerprint: createHash('sha256')
        .update(
          JSON.stringify({
            action: 'REVISE',
            customerId,
            assetId,
            expectedCustomerVersion: 1,
            expectedAssetVersion: 1,
            fields: {
              type: base.type,
              name: base.name,
              number: null,
              category: base.category,
              holderId: base.holderId,
              ownerText: null,
              trademarkClass: '25',
              validFrom: null,
              validTo: null,
              validityMode: 'UNKNOWN',
            },
          }),
        )
        .digest('hex'),
    });
    await expect(
      service.revise(actor, customerId, assetId, 'old-key', {
        ...input,
        ownerText: '旧请求文字',
      }),
    ).resolves.toMatchObject({ version: 2 });
  });

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
