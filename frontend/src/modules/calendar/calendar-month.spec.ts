import { describe, expect, it } from 'vitest';
import {
  buildCalendarMonth,
  calendarEventTitle,
  calendarMonthLabel,
  isCalendarDate,
  moveCalendarMonth,
  type CalendarHearingEvent,
  type CalendarEvent,
} from './calendar-month';

const event: CalendarHearingEvent = {
  eventKey: 'hearing-a',
  caseId: 'case-a',
  hearingAt: '2024-02-29',
  caseLabel: '合成案件',
};

describe('calendar month business dates', () => {
  it('retains explicit multiple trial and unassociated non-court events without inventing metadata', () => {
    const events: CalendarEvent[] = [
      {
        eventKey: 'first',
        date: '2024-02-29',
        type: 'court',
        title: '一审开庭',
        caseId: 'case-a',
      },
      {
        eventKey: 'second',
        date: '2024-02-29',
        type: 'court',
        title: '二审开庭',
        caseId: 'case-a',
      },
      {
        eventKey: 'contract',
        date: '2024-02-29',
        type: 'contract',
        title: null,
        caseId: null,
      },
    ];
    const result = buildCalendarMonth('2024-02', Object.freeze(events)).flatMap(
      (cell) => cell.events,
    );
    expect(result.map((item) => item.eventKey)).toEqual([
      'first',
      'second',
      'contract',
    ]);
    expect(result[2]?.caseId).toBeNull();
    expect(result[2]?.courtDetails).toBeUndefined();
    expect(calendarEventTitle(events[2]!)).toBe('协议到期 · 标题未提供');
    expect(
      buildCalendarMonth('2024-02', [{ ...events[0]!, date: null }]).flatMap(
        (cell) => cell.events,
      ),
    ).toEqual([]);
  });

  it.each([
    ['2024-02-29', true],
    ['2025-02-29', false],
    ['0000-01-01', false],
    ['2024-02-29T12:00:00Z', false],
    [null, false],
  ])(
    'validates an explicit today date %s without a clock or timezone conversion',
    (date, valid) => {
      expect(isCalendarDate(date)).toBe(valid);
    },
  );
  it('moves across years and supports a multi-month offset', () => {
    expect(moveCalendarMonth('2025-12', 1)).toBe('2026-01');
    expect(moveCalendarMonth('2026-01', -1)).toBe('2025-12');
    expect(moveCalendarMonth('2026-01', -13)).toBe('2024-12');
    expect(calendarMonthLabel('2026-01')).toBe('2026年1月');
  });

  it.each(['', '2026-1', '2026-00', '2026-13', '0000-01', '2026-02-01'])(
    'rejects malformed month %s',
    (month) => {
      expect(buildCalendarMonth(month)).toEqual([]);
      expect(moveCalendarMonth(month, 1)).toBeNull();
      expect(calendarMonthLabel(month)).toBeNull();
    },
  );

  it('does not overflow the four-digit supported year range', () => {
    expect(moveCalendarMonth('0001-01', -1)).toBeNull();
    expect(moveCalendarMonth('9999-12', 1)).toBeNull();
    expect(moveCalendarMonth('2026-01', 0.5)).toBeNull();
    expect(buildCalendarMonth('0001-01')[0]?.date).toBeNull();
    expect(buildCalendarMonth('9999-12').at(-1)?.date).toBeNull();
  });

  it.each([
    ['2024-02', 29],
    ['2025-02', 28],
    ['1900-02', 28],
    ['2000-02', 29],
    ['2026-04', 30],
  ])('uses Gregorian days for %s', (month, expectedDays) => {
    const cells = buildCalendarMonth(String(month));
    expect(cells.filter((cell) => cell.inMonth)).toHaveLength(
      Number(expectedDays),
    );
    expect(cells.length % 7).toBe(0);
  });

  it('starts on Sunday and pads complete weeks across a year boundary', () => {
    const january = buildCalendarMonth('2026-01');
    expect(january[0]?.date).toBe('2025-12-28');
    expect(january[4]?.date).toBe('2026-01-01');
    expect(january.at(-1)?.date).toBe('2026-01-31');
    expect(buildCalendarMonth('2026-02')[0]?.date).toBe('2026-02-01');
    expect(buildCalendarMonth('2026-05')).toHaveLength(42);
  });

  it('keeps exact IDs for identically named cases and preserves input order', () => {
    const second = { ...event, eventKey: 'hearing-b', caseId: 'case-b' };
    const events = Object.freeze([Object.freeze(event), Object.freeze(second)]);
    const day = buildCalendarMonth('2024-02', events).find(
      (cell) => cell.date === '2024-02-29',
    );
    expect(day?.events.map((item) => item.caseId)).toEqual([
      'case-a',
      'case-b',
    ]);
    expect(events[0]?.hearingAt).toBe('2024-02-29');
  });

  it('does not render cleared, invalid or adjacent-month dates or missing anchors', () => {
    const inputs = [
      { ...event, hearingAt: null },
      { ...event, hearingAt: '2024-02-30' },
      { ...event, hearingAt: '2024-02-00' },
      { ...event, hearingAt: '2024-02-29T00:00:00Z' },
      { ...event, hearingAt: '2024-01-31' },
      { ...event, caseId: ' ' },
      { ...event, eventKey: '' },
    ];
    expect(
      buildCalendarMonth('2024-02', inputs).flatMap((cell) => cell.events),
    ).toEqual([]);
    expect(
      buildCalendarMonth('2025-02', [
        { ...event, hearingAt: '2025-02-29' },
      ]).flatMap((cell) => cell.events),
    ).toEqual([]);
  });
});
