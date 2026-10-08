import { hearingIsDue } from './case-hearing-date';

it('在北京时间日期次日零点才到期', () => {
  expect(hearingIsDue('2026-10-08', new Date('2026-10-08T15:59:59.999Z'))).toBe(
    false,
  );
  expect(hearingIsDue('2026-10-08', new Date('2026-10-08T16:00:00.000Z'))).toBe(
    true,
  );
  expect(hearingIsDue(null, new Date('2026-10-08T16:00:00.000Z'))).toBe(false);
});
