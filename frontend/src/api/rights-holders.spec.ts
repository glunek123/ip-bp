import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createCustomerRightsHolder,
  findLinkableRightsHolders,
  getCustomerRightsHolder,
  linkCustomerRightsHolder,
  listCustomerRightsHolders,
} from './rights-holders';

afterEach(() => vi.unstubAllGlobals());

const holder = {
  id: 'holder-1',
  name: '主体甲',
  credit: null,
  address: null,
  legalRepresentative: null,
  duty: null,
  updatedAt: '2026-09-17T01:00:00.000Z',
};

function respond(body: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response(JSON.stringify(body))),
  );
}

describe('rights-holder API', () => {
  it('decodes the customer-scoped list and write capabilities', async () => {
    respond({
      items: [holder],
      total: 1,
      page: 1,
      pageSize: 20,
      capabilities: { create: true, link: true },
    });

    await expect(listCustomerRightsHolders('customer-1')).resolves.toEqual({
      items: [holder],
      total: 1,
      page: 1,
      pageSize: 20,
      capabilities: { create: true, link: true },
    });
  });

  it.each([
    { ...holder, credit: undefined },
    { ...holder, customerIds: ['customer-secret'] },
    { ...holder, links: [{ customerId: 'customer-secret' }] },
  ])('rejects incomplete or leaked holder data %#', async (invalidHolder) => {
    respond({
      items: [invalidHolder],
      total: 1,
      page: 1,
      pageSize: 20,
      capabilities: { create: true, link: true },
    });
    await expect(listCustomerRightsHolders('customer-1')).rejects.toMatchObject(
      { code: 'INVALID_RESPONSE' },
    );
  });

  it.each([
    {
      items: [],
      total: -1,
      page: 1,
      pageSize: 20,
      capabilities: { create: true, link: true },
    },
    {
      items: [],
      total: 0,
      page: 0,
      pageSize: 20,
      capabilities: { create: true, link: true },
    },
    {
      items: [],
      total: 0,
      page: 1,
      pageSize: '20',
      capabilities: { create: true, link: true },
    },
    {
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
      capabilities: { create: true },
    },
    {
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
      capabilities: { create: true, link: true, edit: true },
    },
  ])('rejects malformed pagination or capabilities %#', async (body) => {
    respond(body);
    await expect(listCustomerRightsHolders('customer-1')).rejects.toMatchObject(
      { code: 'INVALID_RESPONSE' },
    );
  });

  it('decodes a nested read and linkable search without association metadata', async () => {
    respond(holder);
    await expect(
      getCustomerRightsHolder('customer/1', 'holder/1'),
    ).resolves.toEqual(holder);
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/customers/customer%2F1/rights-holders/holder%2F1',
      expect.any(Object),
    );

    respond({ items: [holder], total: 1, page: 2, pageSize: 10 });
    await expect(
      findLinkableRightsHolders('customer-1', {
        query: '甲 乙',
        page: 2,
        pageSize: 10,
      }),
    ).resolves.toMatchObject({ items: [holder], total: 1, page: 2 });
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/customers/customer-1/linkable-rights-holders?query=%E7%94%B2+%E4%B9%99&page=2&pageSize=10',
      expect.any(Object),
    );
  });

  it('creates a holder using the command idempotency key', async () => {
    const result = { holder, linkId: 'link-1', customerVersion: 2 };
    respond(result);
    await expect(
      createCustomerRightsHolder(
        'customer-1',
        {
          expectedCustomerVersion: 1,
          name: '主体甲',
          credit: '91310000',
          address: '上海',
          legalRepresentative: '张三',
          duty: '执行董事',
        },
        'create-key',
      ),
    ).resolves.toEqual(result);
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/customers/customer-1/rights-holders',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'Idempotency-Key': 'create-key' }),
      }),
    );
  });

  it('links an existing holder using the command idempotency key', async () => {
    const result = { holder, linkId: 'link-1', customerVersion: 2 };
    respond(result);
    await expect(
      linkCustomerRightsHolder(
        'customer-1',
        { expectedCustomerVersion: 1, rightsHolderId: 'holder-1' },
        'link-key',
      ),
    ).resolves.toEqual(result);
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/customers/customer-1/rights-holder-links',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'Idempotency-Key': 'link-key' }),
      }),
    );
  });

  it.each([
    { holder, linkId: 'link-1', customerVersion: 0 },
    { holder, linkId: 1, customerVersion: 2 },
    {
      holder: { ...holder, associationCount: 2 },
      linkId: 'link-1',
      customerVersion: 2,
    },
  ])('rejects invalid command result %#', async (body) => {
    respond(body);
    await expect(
      createCustomerRightsHolder(
        'customer-1',
        { expectedCustomerVersion: 1, name: '主体甲' },
        'key',
      ),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
});
