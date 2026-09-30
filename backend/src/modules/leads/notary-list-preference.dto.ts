import { ApiProperty } from '@nestjs/swagger';
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

export class NotaryListPreferenceDto {
  @ApiProperty({ enum: NOTARY_LIST_COLUMN_ORDER, isArray: true })
  @ValidateBy({
    name: 'notaryListColumnOrder',
    validator: { validate: isValidOrder },
  })
  order!: NotaryListColumn[];

  @ApiProperty({ enum: NOTARY_LIST_OPTIONAL_COLUMNS, isArray: true })
  @ValidateBy({
    name: 'notaryListHiddenColumns',
    validator: { validate: isValidHidden },
  })
  hidden!: NotaryListOptionalColumn[];
}
