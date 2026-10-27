import {
  allocateCustomerBusinessId,
  allocateCustomerDailyNumber,
  assertReadyCustomerBusinessId,
  formatCustomerBusinessId,
  resolveHistoricalNumber,
} from './business-numbering.service';

describe('business numbering', () => {
  it('pads only to three digits and naturally expands beyond 999', () => {
    expect(formatCustomerBusinessId(1n)).toBe('001');
    expect(formatCustomerBusinessId(999n)).toBe('999');
    expect(formatCustomerBusinessId(1000n)).toBe('1000');
  });

  it('allocates the global customer id in the caller transaction', async () => {
    const tx = {
      $queryRawUnsafe: jest.fn().mockResolvedValue([{ last_value: 1000n }]),
    };
    await expect(allocateCustomerBusinessId(tx as never)).resolves.toBe('1000');
    expect(tx.$queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE "customer_business_number_counters"'),
    );
  });

  it('rejects customer creation before the historical counter is seeded', async () => {
    const tx = { $queryRawUnsafe: jest.fn().mockResolvedValue([]) };
    await expect(allocateCustomerBusinessId(tx as never)).rejects.toMatchObject(
      {
        response: { code: 'CUSTOMER_NUMBER_NOT_INITIALIZED' },
      },
    );
    expect(tx.$queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('"last_value" >= 0'),
    );
  });

  it('uses database Shanghai date and shared daily sequence including 1000', async () => {
    const tx = {
      $queryRawUnsafe: jest
        .fn()
        .mockResolvedValueOnce([{ last_value: 1000n }])
        .mockResolvedValueOnce([
          { sequence: 1000n, business_date: '2026-10-26' },
        ]),
    };
    await expect(
      allocateCustomerDailyNumber(tx as never, {
        customerId: '33333333-3333-4333-8333-333333333333',
        businessId: '1000',
      }),
    ).resolves.toBe('1000202610261000');
    expect(tx.$queryRawUnsafe).toHaveBeenLastCalledWith(
      expect.stringContaining("CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai'"),
      '33333333-3333-4333-8333-333333333333',
    );
  });

  it('does not consume a daily sequence while the global cutover is unready', async () => {
    const tx = {
      $queryRawUnsafe: jest.fn().mockResolvedValue([{ last_value: -1n }]),
    };
    await expect(
      allocateCustomerDailyNumber(tx as never, {
        customerId: '33333333-3333-4333-8333-333333333333',
        businessId: '001',
      }),
    ).rejects.toMatchObject({
      response: { code: 'CUSTOMER_NUMBER_NOT_INITIALIZED' },
    });
    expect(tx.$queryRawUnsafe).toHaveBeenCalledTimes(1);
    expect(tx.$queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('customer_business_number_counters'),
    );
  });

  it('rejects a legacy customer before touching the shared counter', async () => {
    const tx = { $queryRawUnsafe: jest.fn() };
    await expect(
      allocateCustomerDailyNumber(tx as never, {
        customerId: '33333333-3333-4333-8333-333333333333',
        businessId: null,
      }),
    ).rejects.toMatchObject({
      response: { code: 'CUSTOMER_NUMBER_NOT_INITIALIZED' },
    });
    expect(tx.$queryRawUnsafe).not.toHaveBeenCalled();
  });

  it('checks both the global ready state and the explicit source customer id', async () => {
    const tx = {
      $queryRawUnsafe: jest.fn().mockResolvedValue([{ last_value: -1n }]),
    };
    await expect(
      assertReadyCustomerBusinessId(tx as never, '001'),
    ).rejects.toMatchObject({
      response: { code: 'CUSTOMER_NUMBER_NOT_INITIALIZED' },
    });
    expect(tx.$queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('customer_business_number_counters'),
    );
    tx.$queryRawUnsafe.mockClear();
    await expect(
      assertReadyCustomerBusinessId(tx as never, null),
    ).rejects.toMatchObject({
      response: { code: 'CUSTOMER_NUMBER_NOT_INITIALIZED' },
    });
    expect(tx.$queryRawUnsafe).not.toHaveBeenCalled();
    tx.$queryRawUnsafe.mockResolvedValue([{ last_value: 0n }]);
    await expect(
      assertReadyCustomerBusinessId(tx as never, '001'),
    ).resolves.toBeUndefined();
    tx.$queryRawUnsafe.mockResolvedValue([]);
    await expect(
      assertReadyCustomerBusinessId(tx as never, '001'),
    ).rejects.toMatchObject({
      response: { code: 'CUSTOMER_NUMBER_NOT_INITIALIZED' },
    });
  });

  it('accepts a receipt old number only for the same entity UUID alias', async () => {
    const tx = {
      businessNumberAlias: {
        findUnique: jest.fn().mockResolvedValue({ oldNumber: 'CA-OLD' }),
      },
    };
    await expect(
      resolveHistoricalNumber(tx as never, {
        entityType: 'CASE',
        entityId: 'case-id',
        receiptNumber: 'CA-OLD',
        currentNumber: '00120261026001',
      }),
    ).resolves.toBe(true);
    await expect(
      resolveHistoricalNumber(tx as never, {
        entityType: 'CASE',
        entityId: 'case-id',
        receiptNumber: 'CA-OTHER',
        currentNumber: '00120261026001',
      }),
    ).resolves.toBe(false);
    expect(tx.businessNumberAlias.findUnique).toHaveBeenCalledWith({
      where: {
        entityType_entityId: { entityType: 'CASE', entityId: 'case-id' },
      },
      select: { oldNumber: true },
    });
  });
});
