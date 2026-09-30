import { ApiError, getJson, requestJson, type RequestOptions } from './http';

export const notaryListPreferenceColumns = [
  'businessNo',
  'stage',
  'sourceLead',
  'notaryOffice',
  'createdAt',
] as const;
export type NotaryListPreferenceColumn =
  (typeof notaryListPreferenceColumns)[number];
export type NotaryListPreference = {
  order: NotaryListPreferenceColumn[];
  hidden: Array<Exclude<NotaryListPreferenceColumn, 'businessNo' | 'stage'>>;
};

const fixedColumns = ['businessNo', 'stage'] as const;
const optionalColumns = ['sourceLead', 'notaryOffice', 'createdAt'] as const;

export const defaultNotaryListPreference: NotaryListPreference = {
  order: [...notaryListPreferenceColumns],
  hidden: [],
};

function invalidResponse(): ApiError {
  return new ApiError(
    '服务返回了无效的公证列表列设置',
    200,
    'INVALID_RESPONSE',
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function decodePreference(value: unknown): NotaryListPreference {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== 2 ||
    !Object.hasOwn(value, 'order') ||
    !Object.hasOwn(value, 'hidden') ||
    !Array.isArray(value.order) ||
    !Array.isArray(value.hidden) ||
    !value.order.every(
      (column): column is NotaryListPreferenceColumn =>
        typeof column === 'string' &&
        notaryListPreferenceColumns.some((known) => known === column),
    ) ||
    !value.hidden.every(
      (
        column,
      ): column is Exclude<
        NotaryListPreferenceColumn,
        'businessNo' | 'stage'
      > =>
        typeof column === 'string' &&
        optionalColumns.some((known) => known === column),
    )
  )
    throw invalidResponse();

  const order = value.order;
  const hidden = value.hidden;
  if (
    order.length !== notaryListPreferenceColumns.length ||
    new Set(order).size !== order.length ||
    order[0] !== fixedColumns[0] ||
    order[1] !== fixedColumns[1] ||
    hidden.length !== new Set(hidden).size
  )
    throw invalidResponse();

  return {
    order: [...order],
    hidden: [...hidden],
  };
}

export function getNotaryListPreference(
  options: RequestOptions = {},
): Promise<NotaryListPreference> {
  return getJson('/notary-matters/list-preference', options).then(
    decodePreference,
  );
}

export async function saveNotaryListPreference(
  preference: NotaryListPreference,
  options: RequestOptions = {},
): Promise<NotaryListPreference> {
  const body = decodePreference(preference);
  return decodePreference(
    await requestJson('/notary-matters/list-preference', {
      ...options,
      method: 'PUT',
      body,
    }),
  );
}
