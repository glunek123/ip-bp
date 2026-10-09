import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  admitCustomer,
  createCustomerDraft,
  findCustomerDuplicates,
  getCustomer,
  listCustomerContacts,
  listCustomerContactVersions,
  createCustomerContact,
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
  cooperationStatus: 'COOPERATING',
  departmentId: 'department-1',
  responsibleUserId: 'user-1',
  version: 1,
  updatedAt: '2026-09-17T01:00:00.000Z',
};

describe('customer API', () => {
  const contact = {
    id: 'contact-1',
    customerId: 'customer-1',
    name: '联系人甲',
    phone: null,
    email: 'a@example.com',
    duty: null,
    isPrimary: false,
    endedAt: null,
    endReason: null,
    version: 1,
    origin: 'MANUAL',
    createdAt: '2026-09-17T00:00:00.000Z',
    updatedAt: '2026-09-17T00:00:00.000Z',
  };

  it('strictly decodes contact pages and rejects missing nullable contract fields', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            items: [contact],
            total: 1,
            page: 1,
            pageSize: 20,
            primaryContactId: null,
          }),
        ),
      ),
    );
    await expect(listCustomerContacts('customer-1')).resolves.toMatchObject({
      items: [{ id: 'contact-1' }],
      primaryContactId: null,
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            items: [{ ...contact, endReason: undefined }],
            total: 1,
            page: 1,
            pageSize: 20,
            primaryContactId: null,
          }),
        ),
      ),
    );
    await expect(listCustomerContacts('customer-1')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });

  it('sends an idempotency key and rejects an invalid command result', async () => {
    const result = { contact, customerVersion: 2, primaryContactId: null };
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(result), { status: 201 }));
    vi.stubGlobal('fetch', fetch);
    await expect(
      createCustomerContact(
        'customer-1',
        { expectedCustomerVersion: 1, name: '联系人甲' },
        'contact-key',
      ),
    ).resolves.toEqual(result);
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/customers/customer-1/contacts',
      expect.objectContaining({
        headers: expect.objectContaining({ 'Idempotency-Key': 'contact-key' }),
      }),
    );
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ ...result, primaryContactId: undefined }),
            { status: 201 },
          ),
        ),
    );
    await expect(
      createCustomerContact(
        'customer-1',
        { expectedCustomerVersion: 1, name: '联系人甲' },
        'contact-key',
      ),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('accepts the legacy migration actor shape and rejects inconsistent actor nullability', async () => {
    const version = {
      id: 'contact-version-1',
      contactId: 'contact-1',
      version: 1,
      action: 'CREATED',
      before: null,
      after: {
        name: '联系人甲',
        phone: null,
        email: 'a@example.com',
        duty: null,
        isPrimary: false,
        endedAt: null,
        endReason: null,
      },
      actor: { kind: 'LEGACY_MIGRATION', userId: null },
      occurredAt: '2026-09-17T00:00:00.000Z',
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            items: [version],
            total: 1,
            page: 1,
            pageSize: 20,
          }),
        ),
      ),
    );
    await expect(
      listCustomerContactVersions('customer-1', 'contact-1'),
    ).resolves.toMatchObject({
      items: [{ actor: { kind: 'LEGACY_MIGRATION', userId: null } }],
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            items: [{ ...version, actor: { kind: 'HUMAN', userId: null } }],
            total: 1,
            page: 1,
            pageSize: 20,
          }),
        ),
      ),
    );
    await expect(
      listCustomerContactVersions('customer-1', 'contact-1'),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it.each([undefined, null, 'UNKNOWN'])(
    'rejects a missing or invalid cooperation status %#',
    async (cooperationStatus) => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({
              items: [{ ...summary, cooperationStatus }],
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
    },
  );

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
            primaryContactId: null,
            admissionContactSnapshot: null,
            responsibleOperator: { id: 'user-1', displayName: '运营甲' },
            cooperationCapabilities: {
              transfer: false,
              pause: true,
              terminate: true,
              resume: false,
            },
            history: [
              {
                action: 'customer.draft-created',
                actorUserId: 'user-1',
                occurredAt: '2026-09-17T00:59:00.000Z',
              },
            ],
            capabilities: {
              editRoutine: true,
              admit: true,
              agreement: { read: false, edit: false },
              invoice: { read: false, edit: false },
            },
          }),
        ),
      ),
    );

    await expect(getCustomer('customer-1')).resolves.toMatchObject({
      id: 'customer-1',
      capabilities: {
        editRoutine: true,
        admit: true,
        agreement: { read: false, edit: false },
        invoice: { read: false, edit: false },
      },
      history: [{ action: 'customer.draft-created' }],
    });
  });

  it('strictly decodes agreement and invoice capability bits on customer detail', async () => {
    const detail = {
      ...summary,
      primaryContactId: null,
      admissionContactSnapshot: null,
      responsibleOperator: { id: 'user-1', displayName: '运营甲' },
      cooperationCapabilities: {
        transfer: false,
        pause: true,
        terminate: true,
        resume: false,
      },
      history: [],
      capabilities: {
        editRoutine: true,
        admit: true,
        agreement: { read: true, edit: false },
        invoice: { read: false, edit: false },
      },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify(detail))),
    );
    await expect(getCustomer('customer-1')).resolves.toMatchObject({
      capabilities: {
        agreement: { read: true, edit: false },
        invoice: { read: false, edit: false },
      },
    });

    for (const capabilities of [
      {
        editRoutine: true,
        admit: true,
        agreement: { read: true },
        invoice: { read: false, edit: false },
      },
      {
        editRoutine: true,
        admit: true,
        agreement: { read: 'true', edit: false },
        invoice: { read: false, edit: false },
      },
      {
        editRoutine: true,
        admit: true,
        agreement: { read: true, edit: false, taxNo: 'sensitive' },
        invoice: { read: false, edit: false },
      },
    ]) {
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValue(
            new Response(JSON.stringify({ ...detail, capabilities })),
          ),
      );
      await expect(getCustomer('customer-1')).rejects.toMatchObject({
        code: 'INVALID_RESPONSE',
      });
    }
  });

  it('requires the complete current cooperation projection on detail', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            ...summary,
            primaryContactId: null,
            admissionContactSnapshot: null,
            history: [],
            capabilities: {
              editRoutine: true,
              admit: true,
              agreement: { read: false, edit: false },
              invoice: { read: false, edit: false },
            },
          }),
        ),
      ),
    );
    await expect(getCustomer('customer-1')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });

  it('rejects extra fields in new detail cooperation projections', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            ...summary,
            primaryContactId: null,
            admissionContactSnapshot: null,
            responsibleOperator: {
              id: 'user-1',
              displayName: '运营甲',
              username: 'private-field',
            },
            cooperationCapabilities: {
              transfer: false,
              pause: true,
              terminate: true,
              resume: false,
            },
            capabilities: {
              editRoutine: true,
              admit: true,
              agreement: { read: false, edit: false },
              invoice: { read: false, edit: false },
            },
            history: [],
          }),
        ),
      ),
    );
    await expect(getCustomer('customer-1')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
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
          admissionContactId: 'contact-1',
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
          admissionContactId: 'contact-1',
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
          admissionContactId: 'contact-1',
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
