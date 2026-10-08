const formatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function hearingIsDue(hearingAt: string | null, now: Date): boolean {
  if (hearingAt === null) return false;
  const parts = formatter.formatToParts(now);
  const part = (kind: 'year' | 'month' | 'day') => {
    const value = parts.find((item) => item.type === kind)?.value;
    if (value === undefined) throw new Error('Shanghai date part unavailable');
    return value;
  };
  return hearingAt < `${part('year')}-${part('month')}-${part('day')}`;
}
