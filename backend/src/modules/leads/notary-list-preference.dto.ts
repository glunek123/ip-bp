import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { ValidateBy } from 'class-validator';

export const NOTARY_LIST_COLUMN_ORDER = [
  'businessNo',
  'stage',
  'sourceLead',
  'notaryOffice',
  'createdAt',
] as const;
export const NOTARY_LIST_OPTIONAL_COLUMNS = [
  'sourceLead',
  'notaryOffice',
  'createdAt',
] as const;

export type NotaryListColumn = (typeof NOTARY_LIST_COLUMN_ORDER)[number];
export type NotaryListOptionalColumn =
  (typeof NOTARY_LIST_OPTIONAL_COLUMNS)[number];

function isColumn(value: unknown): value is NotaryListColumn {
  return (
    typeof value === 'string' &&
    NOTARY_LIST_COLUMN_ORDER.some((column) => column === value)
  );
}

function isOptionalColumn(value: unknown): value is NotaryListOptionalColumn {
  return (
    typeof value === 'string' &&
    NOTARY_LIST_OPTIONAL_COLUMNS.some((column) => column === value)
  );
}

export function isValidOrder(value: unknown): value is NotaryListColumn[] {
  return (
    Array.isArray(value) &&
    value.length === NOTARY_LIST_COLUMN_ORDER.length &&
    value[0] === 'businessNo' &&
    value[1] === 'stage' &&
    value.every(isColumn) &&
    new Set(value).size === value.length
  );
}

export function isValidHidden(
  value: unknown,
): value is NotaryListOptionalColumn[] {
  return (
    Array.isArray(value) &&
    value.every(isOptionalColumn) &&
    new Set(value).size === value.length
  );
}

@ApiSchema({
  description:
    '本人公证列表列设置。PUT 必须完整提交 order 和 hidden；不接受额外字段。',
})
export class NotaryListPreferenceDto {
  @ApiProperty({
    enum: NOTARY_LIST_COLUMN_ORDER,
    isArray: true,
    minItems: 5,
    maxItems: 5,
    uniqueItems: true,
    description:
      '前两项必须依次为 businessNo、stage；后三项为 sourceLead、notaryOffice、createdAt 的无重复排列。',
  })
  @ValidateBy({
    name: 'notaryListColumnOrder',
    validator: { validate: isValidOrder },
  })
  order!: NotaryListColumn[];

  @ApiProperty({
    enum: NOTARY_LIST_OPTIONAL_COLUMNS,
    isArray: true,
    minItems: 0,
    maxItems: 3,
    uniqueItems: true,
    description:
      '仅可隐藏 sourceLead、notaryOffice、createdAt；固定列不可隐藏。',
  })
  @ValidateBy({
    name: 'notaryListHiddenColumns',
    validator: { validate: isValidHidden },
  })
  hidden!: NotaryListOptionalColumn[];
}
