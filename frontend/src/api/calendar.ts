import { ApiError, getJson, type RequestOptions } from './http';

export type CalendarMetric = {
  state: 'AVAILABLE' | 'NOT_CONNECTED' | 'FORBIDDEN';
  count: number | null;
  nearestDate: string | null;
};

export type CalendarSummary = {
  today: string;
  timeZone: 'Asia/Shanghai';
  window: { from: string; through: string };
  metrics: {
    next30: CalendarMetric;
    court: CalendarMetric;
    pay: CalendarMetric;
    contract: CalendarMetric;
    other: CalendarMetric;
  };
};

export type CalendarDateEvent = {
  eventKey: string;
  sourceType:
    | 'FIRST_INSTANCE_HEARING'
    | 'SECOND_INSTANCE_HEARING'
    | 'CUSTOMER_AGREEMENT_EXPIRY';
  sourceId: string;
  date: string;
  type: 'court' | 'contract';
  title: string;
  sub: string | null;
  caseId: string | null;
  customerId: string | null;
  courtDetails: null | {
    party: string | null;
    defendant: string | null;
    reason: string | null;
    time: string | null;
    place: string | null;
    judge: string | null;
  };
  caseDetails: null | {
    customer: string | null;
    rightsHolder: string | null;
    defendant: string | null;
    caseNumber: string | null;
    amount: string | null;
  };
};

export type CalendarSnapshot = CalendarSummary & {
  month: string;
  events: CalendarDateEvent[];
};

const SUMMARY_KEYS = ['today', 'timeZone', 'window', 'metrics'] as const;
const SNAPSHOT_KEYS = [...SUMMARY_KEYS, 'month', 'events'] as const;
const METRIC_NAMES = ['next30', 'court', 'pay', 'contract', 'other'] as const;
const METRIC_KEYS = ['state', 'count', 'nearestDate'] as const;
const COURT_DETAIL_KEYS = [
  'party',
  'defendant',
  'reason',
  'time',
  'place',
  'judge',
] as const;
const CASE_DETAIL_KEYS = [
  'customer',
  'rightsHolder',
  'defendant',
  'caseNumber',
  'amount',
] as const;
const EVENT_KEYS = [
  'eventKey',
  'sourceType',
  'sourceId',
  'date',
  'type',
  'title',
  'sub',
  'caseId',
  'customerId',
  'courtDetails',
  'caseDetails',
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isDateOnly(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value))
    return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  if (year < 1 || year > 9999 || month < 1 || month > 12) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthLengths = [
    31,
    leap ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  return day >= 1 && day <= monthLengths[month - 1];
}

function isMonth(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}$/u.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  return year >= 1 && year <= 9999 && month >= 1 && month <= 12;
}

function addDays(value: string, days: number): string | null {
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day + days);
  const nextYear = date.getUTCFullYear();
  if (nextYear < 1 || nextYear > 9999) return null;
  return [
    String(nextYear).padStart(4, '0'),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

function isMetric(value: unknown): value is CalendarMetric {
  if (!isRecord(value) || !exactKeys(value, METRIC_KEYS)) return false;
  if (
    value.state !== 'AVAILABLE' &&
    value.state !== 'NOT_CONNECTED' &&
    value.state !== 'FORBIDDEN'
  )
    return false;
  if (value.state === 'AVAILABLE') {
    return (
      typeof value.count === 'number' &&
      Number.isSafeInteger(value.count) &&
      value.count >= 0 &&
      (value.nearestDate === null || isDateOnly(value.nearestDate))
    );
  }
  return value.count === null && value.nearestDate === null;
}

function isSummary(value: unknown): value is CalendarSummary {
  if (!isRecord(value) || !exactKeys(value, SUMMARY_KEYS)) return false;
  if (
    !isDateOnly(value.today) ||
    value.timeZone !== 'Asia/Shanghai' ||
    !isRecord(value.window) ||
    !exactKeys(value.window, ['from', 'through']) ||
    value.window.from !== value.today ||
    !isRecord(value.metrics) ||
    !exactKeys(value.metrics, METRIC_NAMES)
  )
    return false;

  const through = addDays(value.today, 30);
  if (through === null || value.window.through !== through) return false;

  for (const name of METRIC_NAMES) {
    const metric = value.metrics[name];
    if (!isMetric(metric)) return false;
    if (
      metric.nearestDate !== null &&
      (metric.nearestDate < value.today ||
        (name === 'next30' && metric.nearestDate > through))
    )
      return false;
    if (
      metric.state === 'AVAILABLE' &&
      metric.count === 0 &&
      metric.nearestDate !== null
    )
      return false;
  }
  const next30Metric = value.metrics.next30;
  const courtMetric = value.metrics.court;
  const contractMetric = value.metrics.contract;
  const payMetric = value.metrics.pay;
  const otherMetric = value.metrics.other;
  return (
    isMetric(next30Metric) &&
    next30Metric.state === 'AVAILABLE' &&
    isMetric(courtMetric) &&
    courtMetric.state === 'AVAILABLE' &&
    isMetric(contractMetric) &&
    (contractMetric.state === 'AVAILABLE' ||
      contractMetric.state === 'FORBIDDEN') &&
    isMetric(payMetric) &&
    payMetric.state === 'NOT_CONNECTED' &&
    isMetric(otherMetric) &&
    otherMetric.state === 'NOT_CONNECTED'
  );
}

function decodeSummary(value: unknown): CalendarSummary {
  if (!isSummary(value)) throw invalidResponse();
  return {
    today: value.today,
    timeZone: 'Asia/Shanghai',
    window: { from: value.window.from, through: value.window.through },
    metrics: {
      next30: { ...value.metrics.next30 },
      court: { ...value.metrics.court },
      pay: { ...value.metrics.pay },
      contract: { ...value.metrics.contract },
      other: { ...value.metrics.other },
    },
  };
}

function isNullableDetailRecord(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> | null {
  return (
    value === null ||
    (isRecord(value) &&
      exactKeys(value, keys) &&
      keys.every((key) => isNullableString(value[key])))
  );
}

function isCalendarEvent(value: unknown): value is CalendarDateEvent {
  if (!isRecord(value) || !exactKeys(value, EVENT_KEYS)) return false;
  if (
    !isNonEmptyString(value.sourceId) ||
    !isDateOnly(value.date) ||
    !isNonEmptyString(value.title) ||
    !isNullableString(value.sub) ||
    !(value.caseId === null || isNonEmptyString(value.caseId)) ||
    !(value.customerId === null || isNonEmptyString(value.customerId)) ||
    !isNullableDetailRecord(value.courtDetails, COURT_DETAIL_KEYS) ||
    !isNullableDetailRecord(value.caseDetails, CASE_DETAIL_KEYS)
  )
    return false;

  if (
    value.sourceType === 'FIRST_INSTANCE_HEARING' ||
    value.sourceType === 'SECOND_INSTANCE_HEARING'
  ) {
    return (
      value.type === 'court' &&
      value.caseId !== null &&
      value.eventKey === `${value.sourceType}:${value.sourceId}`
    );
  }
  return (
    value.sourceType === 'CUSTOMER_AGREEMENT_EXPIRY' &&
    value.type === 'contract' &&
    value.caseId === null &&
    value.customerId !== null &&
    value.courtDetails === null &&
    value.caseDetails === null &&
    value.eventKey === `${value.sourceType}:${value.sourceId}`
  );
}

function isSnapshot(
  value: unknown,
  requestedMonth: string,
): value is CalendarSnapshot {
  if (
    !isRecord(value) ||
    !exactKeys(value, SNAPSHOT_KEYS) ||
    value.month !== requestedMonth ||
    !Array.isArray(value.events)
  )
    return false;
  if (
    !isSummary({
      today: value.today,
      timeZone: value.timeZone,
      window: value.window,
      metrics: value.metrics,
    })
  )
    return false;

  const eventKeys = new Set<string>();
  let previous: CalendarDateEvent | undefined;
  for (const event of value.events) {
    if (!isCalendarEvent(event) || event.date.slice(0, 7) !== requestedMonth)
      return false;
    if (eventKeys.has(event.eventKey)) return false;
    if (
      previous !== undefined &&
      (event.date < previous.date ||
        (event.date === previous.date && event.eventKey < previous.eventKey))
    )
      return false;
    eventKeys.add(event.eventKey);
    previous = event;
  }
  return true;
}

function decodeEvent(value: CalendarDateEvent): CalendarDateEvent {
  return {
    eventKey: value.eventKey,
    sourceType: value.sourceType,
    sourceId: value.sourceId,
    date: value.date,
    type: value.type,
    title: value.title,
    sub: value.sub,
    caseId: value.caseId,
    customerId: value.customerId,
    courtDetails:
      value.courtDetails === null ? null : { ...value.courtDetails },
    caseDetails: value.caseDetails === null ? null : { ...value.caseDetails },
  };
}

function invalidResponse(): ApiError {
  return new ApiError('服务返回了无效的日历数据', 200, 'INVALID_RESPONSE');
}

export async function getCalendarSummary(
  options: RequestOptions = {},
): Promise<CalendarSummary> {
  return decodeSummary(await getJson('/calendar/summary', options));
}

export async function getCalendarSnapshot(
  month: string,
  options: RequestOptions = {},
): Promise<CalendarSnapshot> {
  if (!isMonth(month))
    throw new RangeError('month must be a real YYYY-MM value');
  const response = await getJson(
    `/calendar?month=${encodeURIComponent(month)}`,
    options,
  );
  if (!isSnapshot(response, month)) throw invalidResponse();
  return {
    ...decodeSummary({
      today: response.today,
      timeZone: response.timeZone,
      window: response.window,
      metrics: response.metrics,
    }),
    month: response.month,
    events: response.events.map(decodeEvent),
  };
}
