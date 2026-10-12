export interface CalendarHearingEvent {
  eventKey: string;
  caseId: string;
  hearingAt: string | null;
  caseLabel: string | null;
}

export interface CalendarMonthCell {
  date: string | null;
  day: number | null;
  inMonth: boolean;
  events: readonly CalendarHearingEvent[];
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
  events: readonly CalendarHearingEvent[] = [],
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
  const byDate = new Map<string, CalendarHearingEvent[]>();
  for (const event of events) {
    if (
      !event.hearingAt ||
      !event.hearingAt.startsWith(`${month}-`) ||
      !/^\d{4}-\d{2}-\d{2}$/u.test(event.hearingAt) ||
      !event.eventKey.trim() ||
      !event.caseId.trim()
    ) {
      continue;
    }
    const day = Number(event.hearingAt.slice(8));
    if (day < 1 || day > monthDays) continue;
    const group = byDate.get(event.hearingAt) ?? [];
    group.push(event);
    byDate.set(event.hearingAt, group);
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
