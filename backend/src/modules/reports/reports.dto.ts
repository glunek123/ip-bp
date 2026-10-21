import { ApiProperty } from '@nestjs/swagger';

export const ARCHIVED_CASE_AVERAGE_VERSION = 'RP001-1' as const;

export class ReportsCapabilityDto {
  @ApiProperty()
  canRead!: boolean;
}

export class ArchivedCaseAverageMetadataDto {
  @ApiProperty({ enum: ['ARCHIVED_CASE_AVERAGE_CLAIM_AMOUNT'] })
  readonly metric = 'ARCHIVED_CASE_AVERAGE_CLAIM_AMOUNT' as const;

  @ApiProperty({ enum: ['CNY'] })
  readonly currency = 'CNY' as const;

  @ApiProperty({ enum: ['DEPARTMENT'] })
  readonly scope = 'DEPARTMENT' as const;

  @ApiProperty({ enum: ['ALL_TIME'] })
  readonly period = 'ALL_TIME' as const;

  @ApiProperty({ enum: [ARCHIVED_CASE_AVERAGE_VERSION] })
  readonly definitionVersion = ARCHIVED_CASE_AVERAGE_VERSION;

  @ApiProperty({ format: 'date-time' })
  generatedAt!: string;

  @ApiProperty({ type: 'integer', minimum: 0 })
  totalCases!: number;

  @ApiProperty({ type: 'integer', minimum: 0 })
  inProgressCases!: number;

  @ApiProperty({ type: 'integer', minimum: 0 })
  archivedCases!: number;
}

export class ArchivedCaseAverageValueDto extends ArchivedCaseAverageMetadataDto {
  @ApiProperty({ enum: ['VALUE'] })
  readonly status = 'VALUE' as const;

  @ApiProperty({ pattern: '^(0|[1-9][0-9]*)\\.[0-9]{2}$' })
  amount!: string;

  @ApiProperty({ type: String, nullable: true, enum: [null] })
  readonly reason: null = null;
}

export class ArchivedCaseAverageNoRecordsDto extends ArchivedCaseAverageMetadataDto {
  @ApiProperty({ enum: ['NO_RECORDS'] })
  readonly status = 'NO_RECORDS' as const;

  @ApiProperty({ type: String, nullable: true, enum: [null] })
  readonly amount: null = null;

  @ApiProperty({ enum: ['NO_ARCHIVED_CASES'] })
  readonly reason = 'NO_ARCHIVED_CASES' as const;
}

export class ArchivedCaseAverageUnavailableDto extends ArchivedCaseAverageMetadataDto {
  @ApiProperty({ enum: ['UNAVAILABLE'] })
  readonly status = 'UNAVAILABLE' as const;

  @ApiProperty({ type: String, nullable: true, enum: [null] })
  readonly amount: null = null;

  @ApiProperty({ enum: ['NO_KNOWN_AMOUNT'] })
  readonly reason = 'NO_KNOWN_AMOUNT' as const;
}

export type ArchivedCaseAverageResponse =
  | ArchivedCaseAverageValueDto
  | ArchivedCaseAverageNoRecordsDto
  | ArchivedCaseAverageUnavailableDto;

export type ReportsOverviewResponse = ArchivedCaseAverageResponse;
