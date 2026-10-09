import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createCustomerAgreement,
  createCustomerInvoiceProfile,
  getCustomerAgreement,
  getCustomerInvoiceProfile,
  listCustomerAgreementVersions,
  listCustomerInvoiceVersions,
  reviseCustomerAgreement,
  reviseCustomerInvoiceProfile,
} from './customer-agreements-invoice';

afterEach(() => vi.unstubAllGlobals());

const agreementVersion = {
  id: 'agreement-version-1',
  agreementId: 'agreement-1',
  customerId: 'customer-1',
  departmentId: 'department-1',
  version: 1,
  title: '年度协议',
  model: null,
  settlementMethod: null,
  validityMode: 'FIXED',
  effectiveFrom: '2026-01-01',
  effectiveTo: '2026-12-31',
  contentVersionIds: ['content-version-1'],
  files: [
    {
      materialId: 'material-1',
      contentVersionId: 'content-version-1',
      originalFilename: '年度协议.pdf',
      mimeType: 'application/pdf',
    },
  ],
  recordedByUserId: 'user-1',
  recordedAt: '2026-01-01T00:00:00.000Z',
  auditEventId: 'audit-1',
};

const agreementResponse = {
  agreement: {
    id: 'agreement-1',
    version: 1,
    currentVersion: agreementVersion,
  },
  canEdit: true,
  customerVersion: 2,
};

const invoiceVersion = {
  id: 'invoice-version-1',
  profileId: 'invoice-profile-1',
  customerId: 'customer-1',
  departmentId: 'department-1',
  version: 1,
  invoiceType: null,
  invoiceSubject: null,
  taxNo: null,
  bank: null,
  recordedByUserId: 'user-1',
  recordedAt: '2026-01-01T00:00:00.000Z',
  auditEventId: 'audit-2',
};

const invoiceResponse = {
  profile: {
    id: 'invoice-profile-1',
    version: 1,
    currentVersion: invoiceVersion,
  },
  canEdit: true,
  customerVersion: 2,
};

describe('customer agreements and invoice API', () => {
  it('decodes a stable agreement response and its exact current material version', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(agreementResponse)));
    vi.stubGlobal('fetch', fetch);

    await expect(getCustomerAgreement('customer-1')).resolves.toEqual(
      agreementResponse,
    );
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/customers/customer-1/agreements',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('rejects an agreement response with unknown sensitive fields', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            ...agreementResponse,
            agreement: {
              ...agreementResponse.agreement,
              taxNo: 'must not be here',
            },
          }),
        ),
      ),
    );
    await expect(getCustomerAgreement('customer-1')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });

  it('loads agreement history from its separate paged route and preserves exact file ids', async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          items: [agreementVersion],
          total: 21,
          page: 2,
          pageSize: 20,
        }),
      ),
    );
    vi.stubGlobal('fetch', fetch);

    await expect(
      listCustomerAgreementVersions('customer-1', 'agreement-1', 2, 20),
    ).resolves.toMatchObject({
      items: [
        {
          contentVersionIds: ['content-version-1'],
          files: [
            { materialId: 'material-1', contentVersionId: 'content-version-1' },
          ],
        },
      ],
    });
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/customers/customer-1/agreements/agreement-1/versions?page=2&pageSize=20',
      expect.any(Object),
    );
  });

  it('sends a create idempotency key and keeps explicit empty attachments in the original body', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify(agreementResponse), { status: 201 }),
      );
    vi.stubGlobal('fetch', fetch);
    const body = {
      expectedCustomerVersion: 1,
      title: '年度协议',
      validityMode: 'UNKNOWN' as const,
      contentVersionIds: [] as string[],
    };

    await expect(
      createCustomerAgreement('customer-1', body, 'same-key'),
    ).resolves.toEqual(agreementResponse);
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/customers/customer-1/agreements',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(body),
        headers: expect.objectContaining({ 'Idempotency-Key': 'same-key' }),
      }),
    );
  });

  it('preserves omitted agreement attachment fields when revising', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify(agreementResponse), { status: 200 }),
      );
    vi.stubGlobal('fetch', fetch);
    const body = {
      expectedCustomerVersion: 2,
      expectedAgreementVersion: 1,
      title: '年度协议修订',
      validityMode: 'LONG_TERM' as const,
    };

    await reviseCustomerAgreement(
      'customer-1',
      'agreement-1',
      body,
      'revise-key',
    );
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/customers/customer-1/agreements/agreement-1/revisions',
      expect.objectContaining({ body: JSON.stringify(body) }),
    );
  });

  it('distinguishes an uncreated invoice profile from an all-unknown profile', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ profile: null, canEdit: false, customerVersion: 1 }),
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify(invoiceResponse)));
    vi.stubGlobal('fetch', fetch);

    await expect(
      getCustomerInvoiceProfile('customer-1'),
    ).resolves.toMatchObject({
      profile: null,
    });
    await expect(
      getCustomerInvoiceProfile('customer-1'),
    ).resolves.toMatchObject({
      profile: {
        currentVersion: {
          invoiceType: null,
          invoiceSubject: null,
          taxNo: null,
          bank: null,
        },
      },
    });
  });

  it('loads invoice history separately and validates its page envelope', async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          items: [invoiceVersion],
          total: 1,
          page: 1,
          pageSize: 20,
        }),
      ),
    );
    vi.stubGlobal('fetch', fetch);
    await expect(
      listCustomerInvoiceVersions('customer-1'),
    ).resolves.toMatchObject({
      items: [{ bank: null, recordedByUserId: 'user-1' }],
    });
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/customers/customer-1/invoice-profile/versions?page=1&pageSize=20',
      expect.any(Object),
    );
  });

  it('creates and revises invoice profiles with explicit nulls and unchanged idempotency keys', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(invoiceResponse), { status: 201 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(invoiceResponse), { status: 200 }),
      );
    vi.stubGlobal('fetch', fetch);
    const createBody = {
      expectedCustomerVersion: 1,
      invoiceType: null,
      invoiceSubject: null,
      taxNo: null,
      bank: null,
    };
    const reviseBody = {
      expectedCustomerVersion: 2,
      expectedInvoiceVersion: 1,
      bank: null,
    };

    await createCustomerInvoiceProfile('customer-1', createBody, 'invoice-key');
    await reviseCustomerInvoiceProfile(
      'customer-1',
      reviseBody,
      'invoice-revise-key',
    );
    expect(fetch).toHaveBeenNthCalledWith(
      1,
      '/api/v1/customers/customer-1/invoice-profile',
      expect.objectContaining({
        body: JSON.stringify(createBody),
        headers: expect.objectContaining({ 'Idempotency-Key': 'invoice-key' }),
      }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      '/api/v1/customers/customer-1/invoice-profile/revisions',
      expect.objectContaining({
        body: JSON.stringify(reviseBody),
        headers: expect.objectContaining({
          'Idempotency-Key': 'invoice-revise-key',
        }),
      }),
    );
  });
});
