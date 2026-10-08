import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createRightAsset,
  getRightAsset,
  listRightAssets,
  reviseRightAsset,
  withdrawRightAsset,
} from './right-assets';

afterEach(() => vi.unstubAllGlobals());
const version = {
  id: 'version-1',
  version: 1,
  action: 'CREATE',
  type: 'TRADEMARK',
  name: '测试商标',
  number: null,
  category: '商标权',
  holderId: 'holder-1',
  ownerText: null,
  trademarkClass: '25',
  validFrom: null,
  validTo: null,
  validityMode: 'UNKNOWN',
  withdrawReason: null,
  recordedByUserId: 'user-1',
  recordedAt: '2026-10-08T01:00:00.000Z',
  evidence: [],
};
const summary = {
  assetId: 'asset-1',
  customerId: 'customer-1',
  departmentId: 'department-1',
  version: 1,
  withdrawn: false,
  fields: version,
};
const fields = {
  type: 'TRADEMARK' as const,
  name: '测试商标',
  number: null,
  category: '商标权',
  holderId: 'holder-1',
  ownerText: null,
  trademarkClass: '25',
  validFrom: null,
  validTo: null,
  validityMode: 'UNKNOWN' as const,
};

function respond(body: unknown): ReturnType<typeof vi.fn> {
  const fetch = vi
    .fn()
    .mockImplementation(async () => new Response(JSON.stringify(body)));
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

describe('right asset API', () => {
  it('decodes list and exact historical details', async () => {
    respond({
      items: [summary],
      total: 1,
      page: 1,
      pageSize: 20,
      capabilities: { create: true },
    });
    await expect(listRightAssets('customer-1')).resolves.toMatchObject({
      items: [summary],
    });
    respond({
      ...summary,
      history: [version],
      capabilities: { revise: true, withdraw: false },
    });
    await expect(getRightAsset('customer-1', 'asset-1')).resolves.toMatchObject(
      { history: [version] },
    );
  });

  it('rejects leaked relationships and malformed versions', async () => {
    respond({
      items: [{ ...summary, otherCustomerIds: ['secret'] }],
      total: 1,
      page: 1,
      pageSize: 20,
      capabilities: { create: true },
    });
    await expect(listRightAssets('customer-1')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
    respond({
      ...summary,
      fields: { ...version, validTo: 0 },
      history: [],
      capabilities: { revise: true, withdraw: true },
    });
    await expect(getRightAsset('customer-1', 'asset-1')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
    respond({
      ...summary,
      history: [version],
      capabilities: { revise: true, withdraw: true },
      otherCustomerIds: ['secret'],
    });
    await expect(getRightAsset('customer-1', 'asset-1')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });

  it('sends scoped create, revise and withdraw commands with exact keys', async () => {
    const fetch = respond({ ...summary, customerVersion: 2 });
    await createRightAsset(
      'customer-1',
      { ...fields, expectedCustomerVersion: 1 },
      'create-key',
    );
    await reviseRightAsset(
      'customer-1',
      'asset-1',
      { ...fields, expectedCustomerVersion: 2, expectedAssetVersion: 1 },
      'revise-key',
    );
    await withdrawRightAsset(
      'customer-1',
      'asset-1',
      { expectedCustomerVersion: 3, expectedAssetVersion: 2, reason: '误登记' },
      'withdraw-key',
    );
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(
      fetch.mock.calls.map((call) =>
        new Headers(call[1].headers).get('Idempotency-Key'),
      ),
    ).toEqual(['create-key', 'revise-key', 'withdraw-key']);
    expect(fetch.mock.calls[2][0]).toContain(
      '/customers/customer-1/right-assets/asset-1/withdraw',
    );
  });
});
