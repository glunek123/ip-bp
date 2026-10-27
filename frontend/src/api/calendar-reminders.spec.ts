import { afterEach, expect, it, vi } from 'vitest';
import {
  createManualCalendar,
  listDueReminders,
  listManualCalendar,
  listRefundCalendar,
  markReminderRead,
  registerRefundApplication,
  updateManualCalendar,
  type DueReminder,
} from './calendar-reminders';

const manual = {
  id: 'item/1',
  title: '准备材料',
  eventDate: '2026-10-27',
  note: null,
  version: 1,
};
const reminder: DueReminder = {
  sourceType: 'FIRST_INSTANCE_JUDGMENT',
  sourceId: 'fact-1',
  sourceEpoch: 'case-1:0',
  eventDate: '2026-10-27',
  dueAt: '2026-11-11T01:00:00.000Z',
  title: '退费待核',
  note: null,
  caseId: 'case-1',
  customerId: null,
  readAt: null,
};
afterEach(() => vi.unstubAllGlobals());

it('sends every calendar request through the real HTTP prefix exactly once', async () => {
  const fetchMock = vi.fn(async (url: string, _options: RequestInit) => {
    void _options;
    const value = url.includes('refund-dates')
      ? []
      : url.endsWith('/reminders')
        ? [reminder]
        : url.includes('/personal')
          ? url.includes('?')
            ? [manual]
            : manual
          : {};
    return new Response(JSON.stringify(value), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fetchMock);

  await listManualCalendar('2026-10');
  await createManualCalendar({
    title: manual.title,
    eventDate: manual.eventDate,
    note: null,
  });
  await updateManualCalendar(manual, {
    title: '修改标题',
    eventDate: manual.eventDate,
    note: null,
  });
  await listRefundCalendar('2026-11');
  await listDueReminders();
  await markReminderRead(reminder);
  await registerRefundApplication(reminder, '2026-11-11', '已提交');

  expect(
    fetchMock.mock.calls.map(([url, options]) => [
      url,
      options.method,
      options.body,
    ]),
  ).toEqual([
    ['/api/v1/calendar/personal?month=2026-10', 'GET', undefined],
    [
      '/api/v1/calendar/personal',
      'POST',
      JSON.stringify({
        title: manual.title,
        eventDate: manual.eventDate,
        note: null,
      }),
    ],
    [
      '/api/v1/calendar/personal/item%2F1',
      'PATCH',
      JSON.stringify({
        title: '修改标题',
        eventDate: manual.eventDate,
        note: null,
        expectedVersion: 1,
      }),
    ],
    ['/api/v1/calendar/refund-dates?month=2026-11', 'GET', undefined],
    ['/api/v1/calendar/reminders', 'GET', undefined],
    [
      '/api/v1/calendar/reminders/read',
      'POST',
      JSON.stringify({
        sourceType: reminder.sourceType,
        sourceId: reminder.sourceId,
        sourceEpoch: reminder.sourceEpoch,
        eventDate: reminder.eventDate,
      }),
    ],
    [
      '/api/v1/calendar/refund-applications',
      'POST',
      JSON.stringify({
        sourceType: reminder.sourceType,
        sourceId: reminder.sourceId,
        applicationDate: '2026-11-11',
        note: '已提交',
      }),
    ],
  ]);
});
