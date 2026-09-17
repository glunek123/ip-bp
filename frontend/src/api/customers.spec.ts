import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createCustomerDraft,
  findCustomerDuplicates,
  getCustomer,
  listCustomers,
  updateCustomerDraft,
} from './customers';

afterEach(() => vi.unstubAllGlobals());

const summary = {
  id: 'customer-1',
  name: '客户甲',
  customerType: null,
  identityType: null,
  identityNumber: null,
  issuingCountryOrRegion: null,
  category: null,
  region: null,
  profileStatus: 'draft',
  departmentId: 'department-1',
  responsibleUserId: 'user-1',
  version: 1,
  updatedAt: '2026-09-17T01:00:00.000Z',
};

describe('customer API', () => {
  it('decodes a scoped customer list and its allowed actions', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            items: [summary],
            total: 1,
            page: 1,
            pageSize: 20,
            capabilities: { createDraft: true },
          }),
        ),
      ),
    );

    await expect(listCustomers()).resolves.toMatchObject({
      items: [{ id: 'customer-1', name: '客户甲' }],
      capabilities: { createDraft: true },
    });
  });

  it.each([
    {},
    { items: [], total: '0', page: 1, pageSize: 20 },
    {
      items: [{ ...summary, profileStatus: 'admitted' }],
      total: 1,
      page: 1,
      pageSize: 20,
      capabilities: { createDraft: true },
    },
  ])('rejects malformed list response %#', async (body) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify(body))),
    );
    await expect(listCustomers()).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });

  it('decodes detail history from the shared audit stream', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            ...summary,
            history: [
              {
                action: 'customer.draft-created',
                actorUserId: 'user-1',
                occurredAt: '2026-09-17T00:59:00.000Z',
              },
            ],
            capabilities: { editRoutine: true },
          }),
        ),
      ),
    );

    await expect(getCustomer('customer-1')).resolves.toMatchObject({
      id: 'customer-1',
      history: [{ action: 'customer.draft-created' }],
    });
  });

  it('patches a draft with its expected version and decoded fields', async () => {
    const updated = {
      ...summary,
      name: '客户甲（更新）',
      customerType: 'enterprise',
      identityType: 'CREDIT-CODE',
      identityNumber: '91310000ABC123',
      version: 2,
    };
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify(updated), { status: 200 }),
      );
    vi.stubGlobal('fetch', fetch);

    await expect(
      updateCustomerDraft('customer-1', {
        expectedVersion: 1,
        name: '客户甲（更新）',
        customerType: 'enterprise',
        identityType: 'credit-code',
        identityNumber: '91310000abc123',
      }),
    ).resolves.toEqual(updated);
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/customers/customer-1',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({
          expectedVersion: 1,
          name: '客户甲（更新）',
          customerType: 'enterprise',
          identityType: 'credit-code',
          identityNumber: '91310000abc123',
        }),
      }),
    );
  });

  it('creates a name-only draft once and decodes the result', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(summary)));
    vi.stubGlobal('fetch', fetch);

    await expect(createCustomerDraft({ name: '客户甲' })).resolves.toEqual(
      summary,
    );
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/customers',
      expect.objectContaining({ method: 'POST', body: '{"name":"客户甲"}' }),
    );
  });

  it('preserves backend authorization errors for page behavior', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            code: 'CUSTOMER_ACTION_FORBIDDEN',
            message: '无权执行此客户操作',
            requestId: 'request-1',
          }),
          { status: 403 },
        ),
      ),
    );

    await expect(createCustomerDraft({ name: '客户甲' })).rejects.toMatchObject(
      {
        status: 403,
        code: 'CUSTOMER_ACTION_FORBIDDEN',
        requestId: 'request-1',
      },
    );
  });

  it('passes the current customer exclusion to duplicate lookup', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ exactIdentity: [], sameName: [] })),
      );
    vi.stubGlobal('fetch', fetch);

    await findCustomerDuplicates({
      name: '客户甲',
      excludeCustomerId: 'customer-1',
    });
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/customers/duplicates?name=%E5%AE%A2%E6%88%B7%E7%94%B2&excludeCustomerId=customer-1',
      expect.any(Object),
    );
  });
});
