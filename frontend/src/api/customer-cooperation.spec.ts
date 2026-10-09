import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  changeCustomerCooperation,
  listEligibleOperators,
  transferCustomerResponsible,
} from './customer-cooperation';

afterEach(() => vi.unstubAllGlobals());

describe('customer cooperation API', () => {
  it('uses real pagination and preserves operator IDs across pages', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            items: [{ id: 'u1', displayName: '运营甲', teamName: null }],
            total: 21,
            page: 1,
            pageSize: 20,
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            items: [{ id: 'u21', displayName: '运营乙', teamName: '商标组' }],
            total: 21,
            page: 2,
            pageSize: 20,
          }),
        ),
      );
    vi.stubGlobal('fetch', fetch);
    const first = await listEligibleOperators('customer-1', 1, 20);
    const second = await listEligibleOperators('customer-1', 2, 20);
    expect(first.items[0]?.id).toBe('u1');
    expect(second.items[0]?.id).toBe('u21');
    expect(fetch.mock.calls.map((call) => call[0])).toEqual([
      '/api/v1/customers/customer-1/eligible-operators?page=1&pageSize=20',
      '/api/v1/customers/customer-1/eligible-operators?page=2&pageSize=20',
    ]);
  });

  it('sends the original body and idempotency key and rejects an invalid result', async () => {
    const result = {
      customerId: 'customer-1',
      action: 'pause',
      resultVersion: 2,
      occurredAt: '2026-10-09T01:00:00.000Z',
      canReadAfter: true,
    };
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(result), { status: 201 }));
    vi.stubGlobal('fetch', fetch);
    await expect(
      changeCustomerCooperation(
        'customer-1',
        { expectedVersion: 1, action: 'pause', reason: '暂停原因' },
        'key-1',
      ),
    ).resolves.toEqual(result);
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/customers/customer-1/cooperation',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'Idempotency-Key': 'key-1' }),
        body: JSON.stringify({
          expectedVersion: 1,
          action: 'pause',
          reason: '暂停原因',
        }),
      }),
    );
    fetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ ...result, action: 'invented' }), {
        status: 201,
      }),
    );
    await expect(
      transferCustomerResponsible(
        'customer-1',
        { expectedVersion: 1, targetUserId: 'u2', reason: '调整负责运营' },
        'key-2',
      ),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
});
