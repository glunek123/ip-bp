// The server decides whether a reminder is due. This timer only asks at the
// next Beijing 09:00 boundary while the current page stays open.
export function nextBeijingNineDelay(now: Date): number {
  const local = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const date = local.toISOString().slice(0, 10);
  let target = Date.parse(`${date}T01:00:00.000Z`);
  if (target <= now.getTime()) target += 24 * 60 * 60 * 1000;
  return target - now.getTime();
}
