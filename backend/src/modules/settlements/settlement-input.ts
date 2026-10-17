import { createHash } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';

export function parseFinancialDay(value: unknown): Date {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/u.test(value) ||
    value.startsWith('0000-')
  ) {
    throw new BadRequestException({
      code: 'INVALID_DATE',
      message: '日期无效',
    });
  }
  const day = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(day.getTime()) || day.toISOString().slice(0, 10) !== value) {
    throw new BadRequestException({
      code: 'INVALID_DATE',
      message: '日期无效',
    });
  }
  return day;
}

export function assertFinancialKey(value: unknown): asserts value is string {
  if (
    typeof value !== 'string' ||
    value.length > 128 ||
    value.trim().length === 0
  ) {
    throw new BadRequestException({
      code: 'INVALID_IDEMPOTENCY_KEY',
      message: '请求键无效',
    });
  }
}

/** Callers construct an enumerated, ordered business body, excluding its key. */
export function financialFingerprint(value: object): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
