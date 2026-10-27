import { expect, it } from 'vitest';
import { nextBeijingNineDelay } from './reminder-clock';

it('targets Beijing 09:00 and the following day after the boundary', () => {
  expect(nextBeijingNineDelay(new Date('2026-10-27T00:59:59Z'))).toBe(1000);
  expect(nextBeijingNineDelay(new Date('2026-10-27T01:00:00Z'))).toBe(
    86_400_000,
  );
  expect(nextBeijingNineDelay(new Date('2026-10-26T16:00:00Z'))).toBe(
    9 * 3_600_000,
  );
});
