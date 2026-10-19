import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  ValidateBy,
} from 'class-validator';

export const caseListColumns = [
  'businessNo',
  'stage',
  'customerName',
  'rightsHolderName',
  'platform',
  'shopName',
  'shopExternalId',
  'defendants',
  'lawyers',
  'court',
  'courtCaseNo',
  'claimAmount',
  'judgmentAmount',
  'closureAmount',
] as const;
export type CaseListColumn = (typeof caseListColumns)[number];
export const caseListOptionalColumns = caseListColumns.slice(
  2,
) as readonly CaseListColumn[];

export const caseListPreferenceBuckets = [
  'all',
  'PENDING_MATCH',
  'WAITING_COMPLAINT',
  'WAITING_COMPLAINT_CONFIRMATION',
  'WAITING_COMPLAINT_STAMP',
  'WAITING_FILING',
  'WAITING_FORMAL_ACCEPTANCE',
  'WAITING_HEARING',
  'WAITING_JUDGMENT',
  'SECOND_INSTANCE',
  'WAITING_EXECUTION_DOCUMENTS',
  'WAITING_EXECUTION_CONFIRMATION',
  'WAITING_EXECUTION_STAMP',
  'WAITING_EXECUTION_FILING',
  'EXECUTING',
  'WAITING_ARCHIVE',
  'ARCHIVED',
  'COMPLAINT_PREPARATION',
  'EXECUTION_PREPARATION',
] as const;
export type CaseListPreferenceBucket =
  (typeof caseListPreferenceBuckets)[number];

const fixedColumnsFirst = ValidateBy({
  name: 'fixedColumnsFirst',
  validator: {
    validate: (value: unknown) =>
      Array.isArray(value) && value[0] === 'businessNo' && value[1] === 'stage',
  },
});

export class SaveCaseListPreferenceDto {
  @ApiProperty({ enum: caseListColumns, isArray: true })
  @IsArray()
  @ArrayMinSize(14)
  @ArrayMaxSize(14)
  @ArrayUnique()
  @IsIn(caseListColumns, { each: true })
  @fixedColumnsFirst
  order!: CaseListColumn[];

  @ApiProperty({ enum: caseListOptionalColumns, isArray: true })
  @IsArray()
  @ArrayMaxSize(12)
  @ArrayUnique()
  @IsIn(caseListOptionalColumns, { each: true })
  hidden!: CaseListColumn[];
}

export class CaseListPreferenceResponseDto {
  @ApiProperty({ enum: caseListColumns, isArray: true })
  order!: CaseListColumn[];

  @ApiProperty({ enum: caseListOptionalColumns, isArray: true })
  hidden!: CaseListColumn[];
}
