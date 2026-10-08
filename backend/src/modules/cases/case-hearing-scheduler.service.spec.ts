import { CaseHearingSchedulerService } from './case-hearing-scheduler.service';

it('scans on startup, wakes after a committed schedule, and stops its own timer', async () => {
  jest.useFakeTimers();
  try {
    const service = {
      advanceDue: jest.fn().mockResolvedValue({ advanced: 1, failed: 0 }),
    };
    const listeners: { wake?: () => void } = {};
    const signal = {
      subscribe: jest.fn((listener: () => void) => {
        listeners.wake = listener;
        return () => {
          delete listeners.wake;
        };
      }),
    };
    const clock = { now: () => new Date('2026-10-09T00:00:00.000Z') };
    const scheduler = new CaseHearingSchedulerService(
      service as never,
      signal as never,
      clock as never,
    );
    await scheduler.onModuleInit();
    expect(service.advanceDue).toHaveBeenCalledTimes(1);
    listeners.wake?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(service.advanceDue).toHaveBeenCalledTimes(2);
    scheduler.onModuleDestroy();
    await jest.advanceTimersByTimeAsync(120_000);
    expect(service.advanceDue).toHaveBeenCalledTimes(2);
    expect(listeners.wake).toBeUndefined();
  } finally {
    jest.useRealTimers();
  }
});
