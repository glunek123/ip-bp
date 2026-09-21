import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  admitCustomer,
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
  identityValidFrom: null,
  identityValidTo: null,
  identityValidityMode: null,
  admittedAt: null,
  category: null,
  region: null,
  admissionContactName: null,
  admissionContactPhone: null,
  admissionContactEmail: null,
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
      items: [{ ...summary, identityValidityMode: 'FOREVER' }],
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

  it('rejects a customer response that omits the admission contact contract', async () => {
    const incomplete: Partial<typeof summary> = { ...summary };
    delete incomplete.admissionContactName;
    delete incomplete.admissionContactPhone;
    delete incomplete.admissionContactEmail;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            items: [incomplete],
            total: 1,
            page: 1,
            pageSize: 20,
            capabilities: { createDraft: true },
          }),
        ),
      ),
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
            capabilities: { editRoutine: true, admit: true },
          }),
        ),
      ),
    );

    await expect(getCustomer('customer-1')).resolves.toMatchObject({
      id: 'customer-1',
      capabilities: { editRoutine: true, admit: true },
      history: [{ action: 'customer.draft-created' }],
    });
  });

  it('admits a customer with an idempotency key and validates the admitted snapshot', async () => {
    const admitted = {
      ...summary,
      customerType: 'ENTERPRISE',
      identityType: 'BUSINESS_LICENSE',
      identityNumber: '91310000ABC123',
      identityValidityMode: 'LONG_TERM',
      admittedAt: '2026-09-21T03:00:00.000Z',
      admissionContactName: '张三',
      admissionContactPhone: '13800138000',
      profileStatus: 'admitted',
      version: 2,
    };
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(admitted)));
    vi.stubGlobal('fetch', fetch);

    await expect(
      admitCustomer(
        'customer-1',
        {
          expectedVersion: 1,
          customerType: 'ENTERPRISE',
          name: '客户甲',
          identityType: 'BUSINESS_LICENSE',
          identityNumber: '91310000ABC123',
          identityValidityMode: 'LONG_TERM',
          admissionContactName: '张三',
          admissionContactPhone: '13800138000',
          identityDocumentContentVersionIds: ['version-1'],
        },
        'admit-command-1',
      ),
    ).resolves.toEqual(admitted);
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/customers/customer-1/admission',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Idempotency-Key': 'admit-command-1',
        }),
      }),
    );
  });

  it('rejects an incomplete admission response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            ...summary,
            profileStatus: 'admitted',
            admittedAt: null,
          }),
        ),
      ),
    );

    await expect(
      admitCustomer(
        'customer-1',
        {
          expectedVersion: 1,
          customerType: 'ENTERPRISE',
          name: '客户甲',
          identityType: 'BUSINESS_LICENSE',
          identityNumber: '91310000ABC123',
          identityValidityMode: 'NOT_STATED',
          admissionContactName: '张三',
          admissionContactEmail: 'contact@example.com',
          identityDocumentContentVersionIds: ['version-1'],
        },
        'admit-command-1',
      ),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('rejects an admitted response with an unknown subject code', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            ...summary,
            customerType: 'UNKNOWN_SUBJECT',
            identityType: 'BUSINESS_LICENSE',
            identityNumber: '91310000ABC123',
            identityValidityMode: 'LONG_TERM',
            admittedAt: '2026-09-21T03:00:00.000Z',
            admissionContactName: '张三',
            admissionContactPhone: '13800138000',
            profileStatus: 'admitted',
          }),
        ),
      ),
    );

    await expect(
      admitCustomer(
        'customer-1',
        {
          expectedVersion: 1,
          customerType: 'ENTERPRISE',
          name: '客户甲',
          identityType: 'BUSINESS_LICENSE',
          identityNumber: '91310000ABC123',
          identityValidityMode: 'LONG_TERM',
          admissionContactName: '张三',
          admissionContactPhone: '13800138000',
          identityDocumentContentVersionIds: ['version-1'],
        },
        'admit-command-1',
      ),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
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
        admissionContactName: '张三',
        admissionContactEmail: 'contact@example.com',
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
          admissionContactName: '张三',
          admissionContactEmail: 'contact@example.com',
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

  it('creates a draft with one admission contact', async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          ...summary,
          admissionContactName: '张三',
          admissionContactPhone: '13800138000',
        }),
      ),
    );
    vi.stubGlobal('fetch', fetch);

    await createCustomerDraft({
      name: '客户甲',
      admissionContactName: '张三',
      admissionContactPhone: '13800138000',
    });
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/customers',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          name: '客户甲',
          admissionContactName: '张三',
          admissionContactPhone: '13800138000',
        }),
      }),
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
