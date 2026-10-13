import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './http';

const http = vi.hoisted(() => ({ getJson: vi.fn() }));
vi.mock('./http', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./http')>()),
  ...http,
}));

import { getCalendarSnapshot, getCalendarSummary } from './calendar';

const summary = {
  today: '2026-10-13',
  timeZone: 'Asia/Shanghai',
  window: { from: '2026-10-13', through: '2026-11-12' },
  metrics: {
    next30: { state: 'AVAILABLE', count: 0, nearestDate: null },
    court: { state: 'AVAILABLE', count: 2, nearestDate: '2026-10-13' },
    pay: { state: 'NOT_CONNECTED', count: null, nearestDate: null },
    contract: { state: 'AVAILABLE', count: 1, nearestDate: '2026-10-31' },
    other: { state: 'NOT_CONNECTED', count: null, nearestDate: null },
  },
};

const hearing = {
  eventKey: 'FIRST_INSTANCE_HEARING:hearing-1',
  sourceType: 'FIRST_INSTANCE_HEARING',
  sourceId: 'hearing-1',
  date: '2026-10-20',
  type: 'court',
  title: '一审开庭',
  sub: null,
  caseId: 'case-1',
  customerId: null,
  courtDetails: {
    party: null,
    defendant: '被告甲',
    reason: null,
    time: '09:00',
    place: null,
    judge: null,
  },
  caseDetails: {
    customer: null,
    rightsHolder: '权利人甲',
    defendant: '被告甲',
    caseNumber: null,
    amount: null,
  },
};

const secondHearing = {
  ...hearing,
  eventKey: 'SECOND_INSTANCE_HEARING:hearing-2',
  sourceType: 'SECOND_INSTANCE_HEARING',
  sourceId: 'hearing-2',
  title: '二审开庭',
};

const agreement = {
  eventKey: 'CUSTOMER_AGREEMENT_EXPIRY:agreement-1',
  sourceType: 'CUSTOMER_AGREEMENT_EXPIRY',
  sourceId: 'agreement-1',
  date: '2026-10-31',
  type: 'contract',
  title: '协议到期',
  sub: '客户协议',
  caseId: null,
  customerId: 'customer-1',
  courtDetails: null,
  caseDetails: null,
};

function snapshot(events: unknown[] = [hearing, secondHearing, agreement]) {
  return { ...summary, month: '2026-10', events };
}

beforeEach(() => vi.resetAllMocks());

describe('calendar API', () => {
  it('decodes the exact summary shape and preserves zero counts', async () => {
    http.getJson.mockResolvedValue(summary);
    await expect(getCalendarSummary()).resolves.toEqual(summary);
    expect(http.getJson).toHaveBeenCalledWith('/calendar/summary', {});
  });

  it('requests a month and returns sorted events with their exact display fields', async () => {
    http.getJson.mockResolvedValue(snapshot());
    await expect(getCalendarSnapshot('2026-10')).resolves.toEqual(snapshot());
    expect(http.getJson).toHaveBeenCalledWith('/calendar?month=2026-10', {});
  });

  it('rejects invalid month inputs before making a request', async () => {
    for (const month of [
      '2026-13',
      '2026-00',
      '0000-01',
      '2026-2',
      '10000-01',
    ]) {
      await expect(getCalendarSnapshot(month)).rejects.toBeInstanceOf(
        RangeError,
      );
    }
    expect(http.getJson).not.toHaveBeenCalled();
  });

  it.each([
    ['extra summary field', { ...summary, secret: 'sensitive' }],
    [
      'extra nested metric field',
      {
        ...summary,
        metrics: {
          ...summary.metrics,
          court: { ...summary.metrics.court, secret: 'sensitive' },
        },
      },
    ],
    ['invalid calendar date', { ...summary, today: '2026-02-30' }],
    ['year zero', { ...summary, today: '0000-01-01' }],
    ['incorrect timezone', { ...summary, timeZone: 'UTC' }],
    [
      'window not based on today',
      { ...summary, window: { ...summary.window, from: '2026-10-12' } },
    ],
    [
      'wrong window length',
      { ...summary, window: { ...summary.window, through: '2026-11-11' } },
    ],
    [
      'next30 nearest date beyond window',
      {
        ...summary,
        metrics: {
          ...summary.metrics,
          next30: {
            state: 'AVAILABLE',
            count: 1,
            nearestDate: '2026-11-13',
          },
        },
      },
    ],
    [
      'zero available count with a nearest date',
      {
        ...summary,
        metrics: {
          ...summary.metrics,
          court: {
            state: 'AVAILABLE',
            count: 0,
            nearestDate: '2026-10-13',
          },
        },
      },
    ],
    [
      'past nearest date',
      {
        ...summary,
        metrics: {
          ...summary.metrics,
          court: { ...summary.metrics.court, nearestDate: '2026-10-12' },
        },
      },
    ],
    [
      'negative count',
      {
        ...summary,
        metrics: {
          ...summary.metrics,
          court: { ...summary.metrics.court, count: -1 },
        },
      },
    ],
    [
      'fractional count',
      {
        ...summary,
        metrics: {
          ...summary.metrics,
          court: { ...summary.metrics.court, count: 1.5 },
        },
      },
    ],
    [
      'available count cannot be null',
      {
        ...summary,
        metrics: {
          ...summary.metrics,
          court: { ...summary.metrics.court, count: null },
        },
      },
    ],
    [
      'unavailable state requires null metrics',
      {
        ...summary,
        metrics: {
          ...summary.metrics,
          court: { state: 'FORBIDDEN', count: 0, nearestDate: null },
        },
      },
    ],
    [
      'pay cannot be available',
      {
        ...summary,
        metrics: {
          ...summary.metrics,
          pay: { state: 'AVAILABLE', count: 0, nearestDate: null },
        },
      },
    ],
    [
      'next30 cannot be unavailable',
      {
        ...summary,
        metrics: {
          ...summary.metrics,
          next30: { state: 'FORBIDDEN', count: null, nearestDate: null },
        },
      },
    ],
    [
      'court is available when the API succeeds',
      {
        ...summary,
        metrics: {
          ...summary.metrics,
          court: { state: 'FORBIDDEN', count: null, nearestDate: null },
        },
      },
    ],
    [
      'contract cannot be not connected',
      {
        ...summary,
        metrics: {
          ...summary.metrics,
          contract: { state: 'NOT_CONNECTED', count: null, nearestDate: null },
        },
      },
    ],
  ])('rejects %s', async (_label, response) => {
    http.getJson.mockResolvedValue(response);
    await expect(getCalendarSummary()).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });

  it.each([
    ['extra event field', [{ ...hearing, internalNote: 'secret' }]],
    [
      'extra detail field',
      [
        {
          ...hearing,
          courtDetails: { ...hearing.courtDetails, email: 'private' },
        },
      ],
    ],
    ['invalid date', [{ ...hearing, date: '2026-02-30' }]],
    ['event outside requested month', [{ ...hearing, date: '2026-11-01' }]],
    [
      'mismatched source key',
      [{ ...hearing, eventKey: 'SECOND_INSTANCE_HEARING:hearing-1' }],
    ],
    ['source and display type mismatch', [{ ...hearing, type: 'contract' }]],
    ['missing hearing case foreign key', [{ ...hearing, caseId: null }]],
    [
      'agreement missing customer foreign key',
      [{ ...agreement, customerId: null }],
    ],
    ['agreement linked to a case', [{ ...agreement, caseId: 'case-1' }]],
    [
      'agreement exposes case details',
      [{ ...agreement, caseDetails: hearing.caseDetails }],
    ],
    ['duplicate event key', [{ ...hearing }, { ...hearing }]],
    ['events not ordered by date and key', [secondHearing, hearing]],
  ])('rejects %s', async (_label, events) => {
    http.getJson.mockResolvedValue(snapshot(events));
    await expect(getCalendarSnapshot('2026-10')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });

  it('allows the same source ID in different source types', async () => {
    const secondSource = {
      ...secondHearing,
      eventKey: 'SECOND_INSTANCE_HEARING:hearing-1',
      sourceId: 'hearing-1',
    };
    const response = snapshot([hearing, secondSource]);
    http.getJson.mockResolvedValue(response);
    await expect(getCalendarSnapshot('2026-10')).resolves.toEqual(response);
  });

  it('keeps next30 and court metrics available when contract access is forbidden', async () => {
    const response = {
      ...summary,
      metrics: {
        ...summary.metrics,
        next30: {
          state: 'AVAILABLE',
          count: 2,
          nearestDate: '2026-10-20',
        },
        court: {
          state: 'AVAILABLE',
          count: 1,
          nearestDate: '2026-10-20',
        },
        contract: { state: 'FORBIDDEN', count: null, nearestDate: null },
      },
    };
    http.getJson.mockResolvedValue(response);
    await expect(getCalendarSummary()).resolves.toEqual(response);
  });

  it('rejects a response for a different month', async () => {
    http.getJson.mockResolvedValue({ ...snapshot(), month: '2026-11' });
    await expect(getCalendarSnapshot('2026-10')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });

  it('forwards abort options and passes through HTTP errors', async () => {
    const controller = new AbortController();
    http.getJson.mockResolvedValue(summary);
    await getCalendarSummary({ signal: controller.signal });
    expect(http.getJson).toHaveBeenCalledWith('/calendar/summary', {
      signal: controller.signal,
    });

    const error = new ApiError('denied', 403, 'FORBIDDEN');
    http.getJson.mockRejectedValue(error);
    await expect(
      getCalendarSnapshot('2026-10', { signal: controller.signal }),
    ).rejects.toBe(error);
  });
});
