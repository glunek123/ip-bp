export const workflowChangedEvent = 'dev-cor:workflow-changed';
export const calendarSummaryReadEvent = 'dev-cor:calendar-summary-read';

export function notifyCalendarSummaryRead(
  identity: string,
  count: number | null,
): void {
  globalThis.window.dispatchEvent(
    new CustomEvent(calendarSummaryReadEvent, {
      detail: { identity, count },
    }),
  );
}

export function notifyWorkflowChanged(): void {
  globalThis.window.dispatchEvent(new Event(workflowChangedEvent));
}
