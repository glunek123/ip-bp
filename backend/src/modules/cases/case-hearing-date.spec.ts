import { hearingAdvanceCutoffHour, hearingIsDue } from './case-hearing-date';

describe('hearingIsDue', () => {
  afterEach(() => {
    delete process.env.HEARING_ADVANCE_CUTOFF_HOUR;
  });

  it('开庭当天零点起即到期', () => {
    // 上海时间 10-07 23:59
    expect(
      hearingIsDue('2026-10-08', new Date('2026-10-07T15:59:59.999Z')),
    ).toBe(false);
    // 上海时间 10-08 00:00
    expect(
      hearingIsDue('2026-10-08', new Date('2026-10-07T16:00:00.000Z')),
    ).toBe(true);
    // 之后的日期仍然到期
    expect(
      hearingIsDue('2026-10-08', new Date('2026-10-09T02:00:00.000Z')),
    ).toBe(true);
    expect(hearingIsDue(null, new Date('2026-10-08T16:00:00.000Z'))).toBe(
      false,
    );
  });

  it('未到开庭日不推进', () => {
    expect(
      hearingIsDue('2026-10-09', new Date('2026-10-08T02:00:00.000Z')),
    ).toBe(false);
  });

  it('设置推进时点后，当天要等过了时点', () => {
    process.env.HEARING_ADVANCE_CUTOFF_HOUR = '18';
    expect(hearingAdvanceCutoffHour()).toBe(18);
    // 上海时间 09:00
    expect(
      hearingIsDue('2026-10-08', new Date('2026-10-08T01:00:00.000Z')),
    ).toBe(false);
    // 上海时间 18:00
    expect(
      hearingIsDue('2026-10-08', new Date('2026-10-08T10:00:00.000Z')),
    ).toBe(true);
  });
});
