import { getJson, requestJson, type RequestOptions } from './http';

export type ManualCalendarItem = {
  id: string;
  title: string;
  eventDate: string;
  note: string | null;
  version: number;
};
export type DueReminder = {
  sourceType:
    | 'MANUAL'
    | 'FIRST_INSTANCE_HEARING'
    | 'SECOND_INSTANCE_HEARING'
    | 'CUSTOMER_AGREEMENT_EXPIRY'
    | 'FIRST_INSTANCE_JUDGMENT'
    | 'SECOND_INSTANCE_RESULT';
  sourceId: string;
  sourceEpoch: string;
  eventDate: string;
  dueAt: string;
  title: string;
  note: string | null;
  caseId: string | null;
  customerId: string | null;
  readAt: string | null;
};
export type RefundCalendarDate = {
  sourceType: 'FIRST_INSTANCE_JUDGMENT' | 'SECOND_INSTANCE_RESULT';
  sourceId: string;
  caseId: string;
  dueDate: string;
  title: string;
  businessNo: string | null;
  applied: boolean;
};
type ManualInput = Pick<ManualCalendarItem, 'title' | 'eventDate' | 'note'>;
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const nullableString = (value: unknown): value is string | null =>
  value === null || typeof value === 'string';
const date = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
function manual(value: unknown): ManualCalendarItem {
  if (
    !record(value) ||
    typeof value.id !== 'string' ||
    typeof value.title !== 'string' ||
    !date(value.eventDate) ||
    !nullableString(value.note) ||
    !Number.isSafeInteger(value.version)
  )
    throw new Error('个人日历响应无效');
  return value as ManualCalendarItem;
}
function reminder(value: unknown): DueReminder {
  const types = [
    'MANUAL',
    'FIRST_INSTANCE_HEARING',
    'SECOND_INSTANCE_HEARING',
    'CUSTOMER_AGREEMENT_EXPIRY',
    'FIRST_INSTANCE_JUDGMENT',
    'SECOND_INSTANCE_RESULT',
  ];
  if (
    !record(value) ||
    !types.includes(String(value.sourceType)) ||
    typeof value.sourceId !== 'string' ||
    typeof value.sourceEpoch !== 'string' ||
    !date(value.eventDate) ||
    typeof value.dueAt !== 'string' ||
    typeof value.title !== 'string' ||
    !nullableString(value.note) ||
    !nullableString(value.caseId) ||
    !nullableString(value.customerId) ||
    !nullableString(value.readAt)
  )
    throw new Error('提醒响应无效');
  return value as DueReminder;
}
export async function listManualCalendar(
  month: string,
  options: RequestOptions = {},
): Promise<ManualCalendarItem[]> {
  const value = await getJson(
    `/calendar/personal?month=${encodeURIComponent(month)}`,
    options,
  );
  if (!Array.isArray(value)) throw new Error('个人日历响应无效');
  return value.map(manual);
}
export async function listRefundCalendar(
  month: string,
  options: RequestOptions = {},
): Promise<RefundCalendarDate[]> {
  const value = await getJson(
    `/calendar/refund-dates?month=${encodeURIComponent(month)}`,
    options,
  );
  if (!Array.isArray(value)) throw new Error('判决退费日历响应无效');
  return value.map((entry): RefundCalendarDate => {
    if (
      !record(entry) ||
      (entry.sourceType !== 'FIRST_INSTANCE_JUDGMENT' &&
        entry.sourceType !== 'SECOND_INSTANCE_RESULT') ||
      typeof entry.sourceId !== 'string' ||
      typeof entry.caseId !== 'string' ||
      !date(entry.dueDate) ||
      typeof entry.title !== 'string' ||
      !nullableString(entry.businessNo) ||
      typeof entry.applied !== 'boolean'
    )
      throw new Error('判决退费日历响应无效');
    return entry as RefundCalendarDate;
  });
}
export async function createManualCalendar(
  input: ManualInput,
): Promise<ManualCalendarItem> {
  return manual(
    await requestJson('/calendar/personal', {
      method: 'POST',
      body: input,
    }),
  );
}
export async function updateManualCalendar(
  item: ManualCalendarItem,
  input: ManualInput,
): Promise<ManualCalendarItem> {
  return manual(
    await requestJson(`/calendar/personal/${encodeURIComponent(item.id)}`, {
      method: 'PATCH',
      body: { ...input, expectedVersion: item.version },
    }),
  );
}
export async function listDueReminders(
  options: RequestOptions = {},
): Promise<DueReminder[]> {
  const value = await getJson('/calendar/reminders', options);
  if (!Array.isArray(value)) throw new Error('提醒响应无效');
  return value.map(reminder);
}
export async function markReminderRead(item: DueReminder): Promise<void> {
  await requestJson('/calendar/reminders/read', {
    method: 'POST',
    body: {
      sourceType: item.sourceType,
      sourceId: item.sourceId,
      sourceEpoch: item.sourceEpoch,
      eventDate: item.eventDate,
    },
  });
}
export async function registerRefundApplication(
  item: DueReminder,
  applicationDate: string,
  note: string | null,
): Promise<void> {
  if (
    item.sourceType !== 'FIRST_INSTANCE_JUDGMENT' &&
    item.sourceType !== 'SECOND_INSTANCE_RESULT'
  )
    throw new Error('不是判决待办');
  await requestJson('/calendar/refund-applications', {
    method: 'POST',
    body: {
      sourceType: item.sourceType,
      sourceId: item.sourceId,
      applicationDate,
      note,
    },
  });
}
