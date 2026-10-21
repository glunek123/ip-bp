import { beforeEach, describe, expect, it, vi } from 'vitest';
const http = vi.hoisted(() => ({ getJson: vi.fn() }));
vi.mock('./http', async (original) => ({
  ...(await original<typeof import('./http')>()),
  getJson: http.getJson,
}));
import { ApiError } from './http';
import {
  getReportsCapability,
  getReportsOverview,
  getReportsCenter,
} from './reports';
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
const centerValue = () => ({
  ...value(),
  definitionVersion: 'RP001-2',
  view: 'department',
  availableViews: ['mine', 'department'],
  exportViews: [],
  distributions: {
    types: [
      { value: 'CIVIL', count: 4 },
      { value: null, count: 1 },
    ],
    platforms: [
      { value: 'JD', count: 4 },
      { value: null, count: 1 },
    ],
    courts: [
      {
        id: '11111111-1111-4111-8111-111111111111',
        name: '合成法院',
        count: 4,
      },
    ],
    unrecordedCourtCases: 1,
  },
  money: {
    total: { status: 'VALUE', amount: '40000.00' },
    knownCases: 4,
    unknownCases: 1,
    buckets: [
      { lowerInclusive: '0.00', upperExclusive: '100000.00', count: 1 },
      { lowerInclusive: '100000.00', upperExclusive: '300000.00', count: 1 },
      { lowerInclusive: '300000.00', upperExclusive: '500000.00', count: 1 },
      { lowerInclusive: '500000.00', upperExclusive: null, count: 1 },
    ],
  },
  closureRate: { status: 'VALUE', percent: '40' },
});

describe('RP001-2 reports center strict contract', () => {
  it.each(['platform', 'court'])(
    'rejects non-contract %s identity',
    async (kind) => {
      const data = centerValue();
      if (kind === 'platform')
        data.distributions.platforms = [{ value: '自由平台名', count: 5 }];
      else
        data.distributions.courts = [
          { id: 'non-uuid', name: '合成法院', count: 4 },
        ];
      http.getJson.mockResolvedValue(data);
      await expect(getReportsCenter()).rejects.toMatchObject({
        code: 'INVALID_RESPONSE',
      });
    },
  );
  it('uses one center snapshot, optional view only, and forwards lifecycle options', async () => {
    const signal = new AbortController().signal;
    http.getJson.mockResolvedValue(centerValue());
    await expect(getReportsCenter(undefined, { signal })).resolves.toEqual(
      centerValue(),
    );
    await getReportsCenter('department', { signal });
    http.getJson.mockResolvedValue({
      ...centerValue(),
      view: 'mine',
      scope: 'SELF',
      availableViews: ['mine'],
    });
    await getReportsCenter('mine', { signal });
    expect(http.getJson.mock.calls).toEqual([
      ['/reports/center', { signal }],
      ['/reports/center?view=department', { signal }],
      ['/reports/center?view=mine', { signal }],
    ]);
  });
  it('rejects an invalid local view without HTTP and never silently switches an explicit view', async () => {
    await expect(getReportsCenter('all' as 'mine')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    expect(http.getJson).not.toHaveBeenCalled();
    http.getJson.mockResolvedValue(centerValue());
    await expect(getReportsCenter('mine')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });
  it('preserves huge precise amounts and same-name courts with stable distinct IDs', async () => {
    const data = centerValue();
    data.money.total.amount = '90071992547409931234567890.01';
    data.distributions.courts = [
      {
        id: '11111111-1111-4111-8111-111111111111',
        name: '同名法院',
        count: 2,
      },
      {
        id: '22222222-2222-4222-8222-222222222222',
        name: '同名法院',
        count: 2,
      },
    ];
    http.getJson.mockResolvedValue(data);
    await expect(getReportsCenter()).resolves.toEqual(data);
  });
  it('validates no-records and all-unknown states without converting them to0', async () => {
    const empty = {
      ...centerValue(),
      totalCases: 0,
      inProgressCases: 0,
      archivedCases: 0,
      status: 'NO_RECORDS',
      amount: null,
      reason: 'NO_ARCHIVED_CASES',
      distributions: {
        types: [],
        platforms: [],
        courts: [],
        unrecordedCourtCases: 0,
      },
      money: {
        ...centerValue().money,
        total: { status: 'NO_RECORDS', amount: null },
        knownCases: 0,
        unknownCases: 0,
        buckets: centerValue().money.buckets.map((row) => ({
          ...row,
          count: 0,
        })),
      },
      closureRate: { status: 'NO_RECORDS', percent: null },
    };
    http.getJson.mockResolvedValue(empty);
    await expect(getReportsCenter()).resolves.toEqual(empty);
    const unknown = {
      ...centerValue(),
      status: 'UNAVAILABLE',
      amount: null,
      reason: 'NO_KNOWN_AMOUNT',
      money: {
        ...empty.money,
        total: { status: 'NO_KNOWN_AMOUNT', amount: null },
        unknownCases: 5,
      },
    };
    http.getJson.mockResolvedValue(unknown);
    await expect(getReportsCenter()).resolves.toEqual(unknown);
  });
  it.each([401, 403, 500])(
    'propagates HTTP%i without fallback requests',
    async (status) => {
      const error = new ApiError(
        'private',
        status,
        status === 403 ? 'ACTION_FORBIDDEN' : 'INTERNAL_ERROR',
      );
      http.getJson.mockRejectedValue(error);
      await expect(getReportsCenter('mine')).rejects.toBe(error);
      expect(http.getJson).toHaveBeenCalledTimes(1);
    },
  );
  it.each([
    { scope: 'SELF' },
    { definitionVersion: 'RP001-1' },
    { availableViews: [] },
    { availableViews: ['department'] },
    { availableViews: ['department', 'mine'] },
    { availableViews: ['mine'] },
    { exportViews: ['other'] },
    { exportViews: ['department', 'department'] },
    { exportViews: ['department', 'mine'] },
    { totalCases: 6 },
    { archivedCases: -1 },
    { generatedAt: '2026-02-30T00:00:00Z' },
    { extra: true },
    { status: 'VALUE', amount: '-1.00' },
    { status: 'NO_RECORDS', amount: null, reason: 'NO_ARCHIVED_CASES' },
    { money: { ...centerValue().money, knownCases: 5 } },
    {
      money: {
        ...centerValue().money,
        total: { status: 'VALUE', amount: 40000 },
      },
    },
    {
      money: {
        ...centerValue().money,
        total: { status: 'NO_KNOWN_AMOUNT', amount: null },
      },
    },
    {
      money: {
        ...centerValue().money,
        buckets: centerValue().money.buckets.map((row, i) =>
          i === 0 ? { ...row, lowerInclusive: '1.00' } : row,
        ),
      },
    },
    {
      money: {
        ...centerValue().money,
        buckets: centerValue().money.buckets.map((row, i) =>
          i === 3 ? { ...row, upperExclusive: '999999.00' } : row,
        ),
      },
    },
    {
      money: {
        ...centerValue().money,
        buckets: centerValue().money.buckets.map((row) => ({
          ...row,
          count: 2,
        })),
      },
    },
    {
      distributions: {
        ...centerValue().distributions,
        types: [{ value: 'OTHER', count: 5 }],
      },
    },
    {
      distributions: {
        ...centerValue().distributions,
        platforms: [
          { value: null, count: 3 },
          { value: null, count: 2 },
        ],
      },
    },
    {
      distributions: {
        ...centerValue().distributions,
        platforms: [{ value: '', count: 5 }],
      },
    },
    {
      distributions: {
        ...centerValue().distributions,
        types: [{ value: 'CIVIL', count: 4 }],
      },
    },
    {
      distributions: {
        ...centerValue().distributions,
        courts: [
          { id: '11111111-1111-4111-8111-111111111111', name: '甲', count: 2 },
          { id: '11111111-1111-4111-8111-111111111111', name: '乙', count: 2 },
        ],
      },
    },
    {
      distributions: {
        ...centerValue().distributions,
        unrecordedCourtCases: 2,
      },
    },
    { closureRate: { status: 'VALUE', percent: '41' } },
    { closureRate: { status: 'VALUE', percent: '40.0' } },
    { closureRate: { status: 'VALUE', percent: '101' } },
    { closureRate: { status: 'VALUE', percent: 40 } },
    { closureRate: { status: 'NO_RECORDS', percent: null } },
  ])('rejects malformed or cross-snapshot center case %#', async (patch) => {
    http.getJson.mockResolvedValue({ ...centerValue(), ...patch });
    await expect(getReportsCenter()).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });
});
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
