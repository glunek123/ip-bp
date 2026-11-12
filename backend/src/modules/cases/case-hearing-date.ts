const formatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * 开庭当天的推进时点（上海时间，0-23）。
 * 默认 0：开庭日当天即推进。设为 18 则当天 18:00 之后才推进，
 * 留出白天改期／补材料的时间。
 */
export function hearingAdvanceCutoffHour(): number {
  const raw = Number(process.env.HEARING_ADVANCE_CUTOFF_HOUR ?? '');
  return Number.isInteger(raw) && raw >= 0 && raw <= 23 ? raw : 0;
}

function shanghaiParts(now: Date): {
  date: string;
  hour: number;
  minute: number;
} {
  const parts = formatter.formatToParts(now);
  const part = (kind: 'year' | 'month' | 'day') => {
    const value = parts.find((item) => item.type === kind)?.value;
    if (value === undefined) throw new Error('Shanghai date part unavailable');
    return value;
  };
  const hourPart = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const pick = (kind: 'hour' | 'minute') =>
    Number(hourPart.find((item) => item.type === kind)?.value ?? '0');
  return {
    date: `${part('year')}-${part('month')}-${part('day')}`,
    hour: pick('hour'),
    minute: pick('minute'),
  };
}

/** 开庭日到达（或已过）即视为到期；当天按推进时点判断。 */
export function hearingIsDue(hearingAt: string | null, now: Date): boolean {
  if (hearingAt === null) return false;
  const { date, hour } = shanghaiParts(now);
  if (hearingAt < date) return true;
  if (hearingAt > date) return false;
  return hour >= hearingAdvanceCutoffHour();
}
