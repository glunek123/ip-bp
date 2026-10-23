import { BadRequestException } from '@nestjs/common';

/** Keep absent keys absent so previously committed request fingerprints stay valid. */
export function keyDetailDate(input: { paymentDueAt?: string | null }) {
  if (!Object.hasOwn(input, 'paymentDueAt') || input.paymentDueAt === undefined)
    return {};
  const value = input.paymentDueAt;
  if (value !== null) {
    const parsed =
      typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(value)
        ? new Date(`${value}T00:00:00.000Z`)
        : null;
    if (
      parsed === null ||
      Number.isNaN(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== value
    )
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: '缴费截止日无效',
      });
  }
  return { paymentDueAt: value as string | null };
}

export function keyDetailHearing(input: {
  hearingPlace?: string | null;
  judgeName?: string | null;
}) {
  const result: { hearingPlace?: string | null; judgeName?: string | null } =
    {};
  for (const [key, limit] of [
    ['hearingPlace', 500],
    ['judgeName', 200],
  ] as const) {
    if (!Object.hasOwn(input, key) || input[key] === undefined) continue;
    const value = input[key];
    if (
      value !== null &&
      (typeof value !== 'string' || value.trim().length > limit)
    )
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: '开庭资料无效',
      });
    result[key] = value === null ? null : value!.trim() || null;
  }
  return result;
}
