export interface CalendarHearingEvent {
  eventKey: string;
  caseId: string;
  hearingAt: string | null;
  caseLabel: string | null;
}

export const CALENDAR_EVENT_LABELS = {
  court: '开庭',
  pay: '缴费截止',
  contract: '合同到期',
  other: '重要节点',
} as const;

export interface CalendarEvent {
  eventKey: string;
  date: string | null;
  type: keyof typeof CALENDAR_EVENT_LABELS;
  title: string | null;
  sub?: string | null;
  caseId: string | null;
  courtDetails?: {
    party?: string | null;
    defendant?: string | null;
    reason?: string | null;
    time?: string | null;
    place?: string | null;
    judge?: string | null;
  };
  caseDetails?: {
    customer?: string | null;
    rightsHolder?: string | null;
    defendant?: string | null;
    caseNumber?: string | null;
    amount?: string | null;
  };
}

export type CalendarEventInput = CalendarHearingEvent | CalendarEvent;

export function calendarEventTitle(event: CalendarEvent): string {
  return (
    event.title?.trim() || `${CALENDAR_EVENT_LABELS[event.type]} · 标题未提供`
  );
}

function normalizeEvent(event: CalendarEventInput): CalendarEvent | null {
  if ('date' in event) return event;
  if (!event.caseId.trim()) return null;
  return {
    eventKey: event.eventKey,
    caseId: event.caseId,
    date: event.hearingAt,
    type: 'court',
    title: `开庭 · ${event.caseLabel?.trim() || '案件名称未提供'}`,
  };
}

export interface CalendarMonthCell {
  date: string | null;
  day: number | null;
  inMonth: boolean;
  events: readonly CalendarEvent[];
}

function parseMonth(month: string): { year: number; month: number } | null {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/u.test(month)) return null;
  const year = Number(month.slice(0, 4));
  return year >= 1 ? { year, month: Number(month.slice(5)) } : null;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

export function isCalendarDate(date: string | null): date is string {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/u.test(date)) return false;
  const parsed = parseMonth(date.slice(0, 7));
  const day = Number(date.slice(8));
  return (
    parsed !== null && day >= 1 && day <= daysInMonth(parsed.year, parsed.month)
  );
}

function formatMonth(year: number, month: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
}

export function moveCalendarMonth(
  month: string,
  offset: number,
): string | null {
  const parsed = parseMonth(month);
  if (!parsed || !Number.isSafeInteger(offset)) return null;
  const index = (parsed.year - 1) * 12 + parsed.month - 1 + offset;
  if (index < 0 || index >= 9999 * 12) return null;
  return formatMonth(Math.floor(index / 12) + 1, (index % 12) + 1);
}

export function calendarMonthLabel(month: string): string | null {
  const parsed = parseMonth(month);
  return parsed ? `${parsed.year}年${parsed.month}月` : null;
}

// Business dates remain calendar strings; no conversion to an instant or timezone.
export function buildCalendarMonth(
  month: string,
  events: readonly CalendarEventInput[] = [],
): CalendarMonthCell[] {
  const parsed = parseMonth(month);
  if (!parsed) return [];
  const { year, month: monthNumber } = parsed;
  let daysBeforeMonth = 0;
  for (let previous = 1; previous < monthNumber; previous += 1) {
    daysBeforeMonth += daysInMonth(year, previous);
  }
  const previousYear = year - 1;
  const firstWeekday =
    (365 * previousYear +
      Math.floor(previousYear / 4) -
      Math.floor(previousYear / 100) +
      Math.floor(previousYear / 400) +
      daysBeforeMonth +
      1) %
    7;
  const monthDays = daysInMonth(year, monthNumber);
  const byDate = new Map<string, CalendarEvent[]>();
  for (const input of events) {
    const event = normalizeEvent(input);
    if (
      !event ||
      !isCalendarDate(event.date) ||
      !event.date.startsWith(`${month}-`) ||
      !event.eventKey.trim()
    ) {
      continue;
    }
    const group = byDate.get(event.date) ?? [];
    group.push(event);
    byDate.set(event.date, group);
  }
  const length = Math.ceil((firstWeekday + monthDays) / 7) * 7;
  return Array.from({ length }, (_, index) => {
    const currentDay = index - firstWeekday + 1;
    const inMonth = currentDay >= 1 && currentDay <= monthDays;
    const cellMonth = inMonth
      ? month
      : moveCalendarMonth(month, currentDay < 1 ? -1 : 1);
    if (!cellMonth)
      return { date: null, day: null, inMonth: false, events: [] };
    const day =
      currentDay < 1
        ? daysInMonth(
            Number(cellMonth.slice(0, 4)),
            Number(cellMonth.slice(5)),
          ) + currentDay
        : currentDay > monthDays
          ? currentDay - monthDays
          : currentDay;
    const date = `${cellMonth}-${String(day).padStart(2, '0')}`;
    return {
      date,
      day,
      inMonth,
      events: inMonth ? (byDate.get(date) ?? []) : [],
    };
  });
}
