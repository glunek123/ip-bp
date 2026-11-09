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
  registrationDate: '2026-10-08',
  status: 'VALID',
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
  ownerText: '主体甲',
  registrationDate: '2026-10-08',
  validTo: null,
  status: 'VALID' as const,
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

  it('requests the selected in-use or withdrawn list view', async () => {
    const fetch = respond({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
      capabilities: { create: true },
    });
    await listRightAssets('customer-1', 2, 20, {}, 'withdrawn');
    expect(fetch.mock.calls[0][0]).toContain(
      'page=2&pageSize=20&view=withdrawn',
    );
  });

  it('omits the view query for the default list request', async () => {
    const fetch = respond({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
      capabilities: { create: true },
    });
    await listRightAssets('customer-1');
    expect(fetch.mock.calls[0][0]).toContain(
      '/customers/customer-1/right-assets?page=1&pageSize=20',
    );
    expect(fetch.mock.calls[0][0]).not.toContain('view=');
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
    const createBody = JSON.parse(String(fetch.mock.calls[0][1].body));
    expect(createBody).toMatchObject({
      ownerText: '主体甲',
      registrationDate: '2026-10-08',
      status: 'VALID',
    });
    expect(createBody).not.toHaveProperty('holderId');
    expect(createBody).not.toHaveProperty('trademarkClass');
    expect(createBody).not.toHaveProperty('validFrom');
    expect(createBody).not.toHaveProperty('validityMode');
  });
});
