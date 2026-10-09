import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './http';

const http = vi.hoisted(() => ({
  getJson: vi.fn(),
  requestJson: vi.fn(),
}));
vi.mock('./http', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./http')>()),
  ...http,
}));

import {
  correctCustomerSettlement,
  getCustomerSettlement,
  listCustomerSettlementVersions,
  listCustomerSettlements,
  registerCustomerSettlement,
} from './customer-settlements';

const version = {
  id: 'version-1',
  recordId: 'record-1',
  customerId: 'customer-1',
  departmentId: 'department-1',
  version: 1,
  action: 'REGISTER',
  settlementDate: '2026-10-01',
  settlementAmount: '100.00',
  invoiceAmount: null,
  receivedAmount: '0.00',
  receivedDate: null,
  correctionReason: null,
  recordedByUserId: 'user-1',
  recordedAt: '2026-10-01T03:00:00.000Z',
  auditEventId: 'audit-1',
};
const record = { id: 'record-1', version: 1, currentVersion: version };
const stats = {
  recordCount: 1,
  totalSettlement: '100.00',
  invoiceKnownSubtotal: '0.00',
  invoiceUnknownCount: 1,
  receivedKnownSubtotal: '0.00',
  receivedUnknownCount: 0,
  pendingAmount: '100.00',
  recoveryRate: '0.00',
};
const capabilities = { read: true, register: true, correct: true };
const page = {
  items: [record],
  total: 1,
  page: 1,
  pageSize: 20,
  stats,
  capabilities,
  customerVersion: 2,
};

beforeEach(() => vi.resetAllMocks());

describe('customer settlement API', () => {
  it('decodes a list only when its records, stats and exact capabilities match the requested customer', async () => {
    http.getJson.mockResolvedValue(page);
    await expect(listCustomerSettlements('customer-1')).resolves.toEqual(page);
    expect(http.getJson).toHaveBeenCalledWith(
      '/customers/customer-1/settlements?page=1&pageSize=20',
      {},
    );
  });

  it.each([
    [
      'boolean capability encoded as text',
      { ...page, capabilities: { ...capabilities, read: 'true' } },
    ],
    [
      'extra sensitive capability field',
      {
        ...page,
        capabilities: { ...capabilities, settlementAmount: '100.00' },
      },
    ],
    [
      'foreign record owner',
      {
        ...page,
        items: [
          {
            ...record,
            currentVersion: { ...version, customerId: 'customer-2' },
          },
        ],
      },
    ],
    ['number amount', { ...page, stats: { ...stats, totalSettlement: 100 } }],
    [
      'noncanonical amount',
      { ...page, stats: { ...stats, totalSettlement: '01.00' } },
    ],
    [
      'extra version fact',
      {
        ...page,
        items: [{ ...record, currentVersion: { ...version, secret: 'leak' } }],
      },
    ],
  ])('rejects %s', async (_label, response) => {
    http.getJson.mockResolvedValue(response);
    await expect(listCustomerSettlements('customer-1')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });

  it('validates the stable record and every version page against the owner', async () => {
    http.getJson
      .mockResolvedValueOnce({ record, capabilities, customerVersion: 2 })
      .mockResolvedValueOnce({
        items: [version],
        total: 1,
        page: 1,
        pageSize: 20,
      });
    await expect(
      getCustomerSettlement('customer-1', 'record-1'),
    ).resolves.toMatchObject({ record });
    await expect(
      listCustomerSettlementVersions('customer-1', 'record-1'),
    ).resolves.toMatchObject({ total: 1 });
  });

  it('posts the exact original body and idempotency key for register and correction', async () => {
    const result = {
      recordId: 'record-1',
      version: 1,
      customerVersion: 2,
      snapshot: version,
    };
    http.requestJson.mockResolvedValue(result);
    const body = {
      expectedCustomerVersion: 1,
      settlementDate: '2026-10-01',
      settlementAmount: '0.0',
      invoiceAmount: null,
      receivedAmount: '0.00',
      receivedDate: null,
    };
    await expect(
      registerCustomerSettlement('customer-1', body, 'key-1'),
    ).resolves.toEqual(result);
    expect(http.requestJson).toHaveBeenCalledWith(
      '/customers/customer-1/settlements',
      expect.objectContaining({
        method: 'POST',
        body,
        headers: { 'Idempotency-Key': 'key-1' },
      }),
    );
    const correction = {
      ...body,
      expectedCustomerVersion: 2,
      expectedRecordVersion: 1,
      reason: '核对原始登记后更正',
    };
    await expect(
      correctCustomerSettlement('customer-1', 'record-1', correction, 'key-2'),
    ).resolves.toEqual(result);
    expect(http.requestJson).toHaveBeenLastCalledWith(
      '/customers/customer-1/settlements/record-1/corrections',
      expect.objectContaining({
        method: 'POST',
        body: correction,
        headers: { 'Idempotency-Key': 'key-2' },
      }),
    );
  });

  it('rejects malformed aggregate values instead of rounding them', async () => {
    http.getJson.mockResolvedValue({
      ...page,
      stats: { ...stats, pendingAmount: '-0.00' },
    });
    await expect(listCustomerSettlements('customer-1')).rejects.toBeInstanceOf(
      ApiError,
    );
  });

  it.each(['-0.01', '-0.99'])(
    'accepts canonical sub-yuan overcollection %s',
    async (pendingAmount) => {
      const response = {
        ...page,
        stats: { ...stats, pendingAmount, recoveryRate: '101.00' },
      };
      http.getJson.mockResolvedValue(response);
      await expect(listCustomerSettlements('customer-1')).resolves.toEqual(
        response,
      );
    },
  );

  it.each(['-0.00', '-00.01', '-01.00', '-0.001', '-0.1', '- 0.01'])(
    'rejects noncanonical negative aggregate %s',
    async (pendingAmount) => {
      http.getJson.mockResolvedValue({
        ...page,
        stats: { ...stats, pendingAmount },
      });
      await expect(listCustomerSettlements('customer-1')).rejects.toMatchObject(
        { code: 'INVALID_RESPONSE' },
      );
    },
  );
});
