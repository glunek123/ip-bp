import {
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { RoutineBusinessProductDto } from './routine-business-edit.dto';

export type RoutineProduct = {
  id: string;
  position: number;
  title: string | null;
  url: string | null;
  quantity: number;
  unitPrice: string;
  commentCount: number;
  estimatedAmount: string;
};

export function corruptRoutineSource() {
  return new InternalServerErrorException({
    code: 'INVALID_SOURCE',
    message: '来源资料不完整',
  });
}

export function isRoutineSerializationConflict(
  value: unknown,
  seen = new Set<object>(),
): boolean {
  if (!value || typeof value !== 'object' || seen.has(value)) return false;
  seen.add(value);
  const error = value as Record<string, unknown>;
  if (
    error.code === 'P2034' ||
    error.sqlState === '40001' ||
    error.originalCode === '40001'
  )
    return true;
  return ['cause', 'meta', 'driverAdapterError'].some((key) =>
    isRoutineSerializationConflict(error[key], seen),
  );
}

export function parseRoutineProducts(
  value: unknown,
  ids: string[],
): RoutineProduct[] {
  if (
    !Array.isArray(value) ||
    value.length !== ids.length ||
    new Set(ids).size !== ids.length
  )
    throw corruptRoutineSource();
  const remaining = new Set(ids);
  return value.map((raw: unknown) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
      throw corruptRoutineSource();
    const item = raw as Record<string, unknown>;
    if (
      typeof item.id !== 'string' ||
      !remaining.delete(item.id) ||
      !Number.isSafeInteger(item.position) ||
      (item.title !== null && typeof item.title !== 'string') ||
      (item.url !== null && typeof item.url !== 'string') ||
      !Number.isSafeInteger(item.quantity) ||
      typeof item.unitPrice !== 'string' ||
      !Number.isSafeInteger(item.commentCount) ||
      typeof item.estimatedAmount !== 'string' ||
      (item.position as number) < 1 ||
      (item.quantity as number) < 0 ||
      (item.commentCount as number) < 0 ||
      !/^(0|[1-9]\d{0,15})(\.\d{1,2})?$/u.test(item.unitPrice) ||
      !/^(0|[1-9]\d{0,15})(\.\d{1,2})?$/u.test(item.estimatedAmount)
    )
      throw corruptRoutineSource();
    return {
      id: item.id,
      position: item.position as number,
      title: item.title as string | null,
      url: item.url as string | null,
      quantity: item.quantity as number,
      unitPrice: item.unitPrice,
      commentCount: item.commentCount as number,
      estimatedAmount: item.estimatedAmount,
    };
  });
}

export function applyRoutineProducts(
  current: RoutineProduct[],
  input: RoutineBusinessProductDto[],
): RoutineProduct[] {
  const invalid = () =>
    new BadRequestException({
      code: 'VALIDATION_ERROR',
      message: '资料不符合要求',
    });
  const incoming = new Map(input.map((product) => [product.id, product]));
  if (
    incoming.size !== current.length ||
    current.some((item) => !incoming.has(item.id))
  )
    throw invalid();
  return current.map((before) => {
    const item = incoming.get(before.id)!;
    const title = item.title === null ? null : item.title.trim();
    if (title === '' || (title === null && item.url === null)) throw invalid();
    const basis = item.quantity > 0 ? item.quantity : before.commentCount;
    const total = new Prisma.Decimal(item.unitPrice).mul(basis);
    if (total.gt('9999999999999999.99')) throw invalid();
    return {
      ...before,
      title,
      url: item.url,
      quantity: item.quantity,
      unitPrice: new Prisma.Decimal(item.unitPrice).toFixed(2),
      estimatedAmount: total.toFixed(2),
    };
  });
}

/** Preserve exact source references while presenting this case's current labels. */
export function applyRoutineProductLabels<
  T extends {
    id: string;
    position: number;
    title: string | null;
    url: string | null;
  },
>(source: T[], profile: unknown): T[] {
  if (!Array.isArray(profile)) throw corruptRoutineSource();
  const originals = new Map(source.map((item) => [item.id, item]));
  const ids = profile.map((value: unknown) => {
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      !('id' in value) ||
      typeof value.id !== 'string' ||
      !originals.has(value.id)
    )
      throw corruptRoutineSource();
    return value.id;
  });
  return parseRoutineProducts(profile, ids).map((value) => ({
    ...originals.get(value.id)!,
    position: value.position,
    title: value.title,
    url: value.url,
  }));
}
