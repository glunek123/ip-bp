import { beforeEach, describe, expect, it, vi } from 'vitest';
const http = vi.hoisted(() => ({ getJson: vi.fn() }));
vi.mock('./http', async (original) => ({
  ...(await original<typeof import('./http')>()),
  getJson: http.getJson,
}));
import { ApiError } from './http';
import { getReportsCapability, getReportsOverview } from './reports';
const value = () => ({
  metric: 'ARCHIVED_CASE_AVERAGE_CLAIM_AMOUNT',
  currency: 'CNY',
  scope: 'DEPARTMENT',
  period: 'ALL_TIME',
  definitionVersion: 'RP001-1',
  generatedAt: '2026-10-21T08:00:00.000Z',
  totalCases: 5,
  inProgressCases: 3,
  archivedCases: 2,
  status: 'VALUE',
  amount: '2000.00',
  reason: null,
});
beforeEach(() => vi.resetAllMocks());
describe('frozen RP001 API', () => {
  it('uses only fixed query-free endpoints and forwards the signal', async () => {
    http.getJson
      .mockResolvedValueOnce({ canRead: true })
      .mockResolvedValueOnce(value());
    const signal = new AbortController().signal;
    await expect(getReportsCapability({ signal })).resolves.toEqual({
      canRead: true,
    });
    await expect(getReportsOverview({ signal })).resolves.toEqual(value());
    expect(http.getJson.mock.calls).toEqual([
      ['/reports/capability', { signal }],
      ['/reports/overview', { signal }],
    ]);
  });
  it.each(['0.00', '2000.00', '90071992547409931234567890.01'])(
    'preserves the server decimal %s',
    async (amount) => {
      http.getJson.mockResolvedValue({ ...value(), amount });
      await expect(getReportsOverview()).resolves.toMatchObject({ amount });
    },
  );
  it('keeps real counts when there are no archived records or no known amount', async () => {
    const empty = {
      ...value(),
      archivedCases: 0,
      inProgressCases: 5,
      status: 'NO_RECORDS',
      amount: null,
      reason: 'NO_ARCHIVED_CASES',
    };
    const unavailable = {
      ...value(),
      status: 'UNAVAILABLE',
      amount: null,
      reason: 'NO_KNOWN_AMOUNT',
    };
    http.getJson
      .mockResolvedValueOnce(empty)
      .mockResolvedValueOnce(unavailable);
    await expect(getReportsOverview()).resolves.toEqual(empty);
    await expect(getReportsOverview()).resolves.toEqual(unavailable);
  });
  it.each([{ canRead: 1 }, { canRead: true, scope: 'ALL' }, null, []])(
    'rejects invalid capability %j',
    async (data) => {
      http.getJson.mockResolvedValue(data);
      await expect(getReportsCapability()).rejects.toMatchObject({
        code: 'INVALID_RESPONSE',
      });
    },
  );
  it.each([
    { scope: 'ALL' },
    { currency: 'USD' },
    { period: 'THIS_MONTH' },
    { definitionVersion: 'RP001-2' },
    { metric: 'AVERAGE_CLOSURE_AMOUNT' },
    { generatedAt: '2026-02-30T08:00:00.000Z' },
    { generatedAt: '2026-10-21' },
    { totalCases: 6 },
    { totalCases: -1 },
    { totalCases: Number.MAX_SAFE_INTEGER + 1 },
    { inProgressCases: 2.5 },
    { archivedCases: '2' },
    { status: 'UNKNOWN' },
    { amount: 0 },
    { amount: '1.001' },
    { amount: '01.00' },
    { amount: '-1.00' },
    { amount: null },
    { reason: 'NO_KNOWN_AMOUNT' },
    { hiddenDepartmentCount: 1 },
    { customerId: 'extra' },
    { status: 'NO_RECORDS', amount: null, reason: 'NO_ARCHIVED_CASES' },
    { status: 'UNAVAILABLE', amount: '0.00', reason: 'NO_KNOWN_AMOUNT' },
    { status: 'VALUE', archivedCases: 0, inProgressCases: 5 },
  ])('rejects inconsistent or non-contract overview case %#', async (patch) => {
    http.getJson.mockResolvedValue({ ...value(), ...patch });
    await expect(getReportsOverview()).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });
  it.each([401, 403, 500])(
    'preserves HTTP %i as failure rather than empty data',
    async (status) => {
      const failure = new ApiError('private', status, 'DENIED');
      http.getJson.mockRejectedValue(failure);
      await expect(getReportsOverview()).rejects.toBe(failure);
      expect(http.getJson).toHaveBeenCalledTimes(1);
    },
  );
});
