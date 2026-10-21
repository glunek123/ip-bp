import { ApiProperty, OmitType, getSchemaPath } from '@nestjs/swagger';
import { LeadCaseType, LeadPlatform } from '../../generated/prisma/enums';
import { ArchivedCaseAverageMetadataDto } from './reports.dto';
import type { ReportView } from '../../access-control/access-control.service';

export class ReportTypeCountDto {
  @ApiProperty({ enum: LeadCaseType, nullable: true })
  value!: LeadCaseType | null;
  @ApiProperty({ type: 'integer', minimum: 1 })
  count!: number;
}
export class ReportPlatformCountDto {
  @ApiProperty({ enum: LeadPlatform, nullable: true })
  value!: LeadPlatform | null;
  @ApiProperty({ type: 'integer', minimum: 1 })
  count!: number;
}
export class ReportCourtCountDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;
  @ApiProperty()
  name!: string;
  @ApiProperty({ type: 'integer', minimum: 1 })
  count!: number;
}
export class ReportDistributionsDto {
  @ApiProperty({ type: [ReportTypeCountDto] })
  types!: ReportTypeCountDto[];
  @ApiProperty({ type: [ReportPlatformCountDto] })
  platforms!: ReportPlatformCountDto[];
  @ApiProperty({ type: [ReportCourtCountDto], maxItems: 5 })
  courts!: ReportCourtCountDto[];
  @ApiProperty({ type: 'integer', minimum: 0 })
  unrecordedCourtCases!: number;
}
export class ReportKnownAmountValueDto {
  @ApiProperty({ enum: ['VALUE'] })
  readonly status = 'VALUE' as const;
  @ApiProperty({ pattern: '^(0|[1-9][0-9]*)\\.[0-9]{2}$' })
  amount!: string;
}
export class ReportKnownAmountEmptyDto {
  @ApiProperty({ enum: ['NO_RECORDS', 'NO_KNOWN_AMOUNT'] })
  status!: 'NO_RECORDS' | 'NO_KNOWN_AMOUNT';
  @ApiProperty({ type: String, nullable: true, enum: [null] })
  readonly amount: null = null;
}
export class ReportAmountBucketDto {
  @ApiProperty({ enum: ['0.00', '100000.00', '300000.00', '500000.00'] })
  lowerInclusive!: string;
  @ApiProperty({
    type: String,
    nullable: true,
    enum: ['100000.00', '300000.00', '500000.00', null],
  })
  upperExclusive!: string | null;
  @ApiProperty({ type: 'integer', minimum: 0 })
  count!: number;
}
export class ReportMoneyDto {
  @ApiProperty({
    oneOf: [
      { $ref: getSchemaPath(ReportKnownAmountValueDto) },
      { $ref: getSchemaPath(ReportKnownAmountEmptyDto) },
    ],
  })
  total!: ReportKnownAmountValueDto | ReportKnownAmountEmptyDto;
  @ApiProperty({ type: 'integer', minimum: 0 })
  knownCases!: number;
  @ApiProperty({ type: 'integer', minimum: 0 })
  unknownCases!: number;
  @ApiProperty({ type: [ReportAmountBucketDto], minItems: 4, maxItems: 4 })
  buckets!: ReportAmountBucketDto[];
}
export class ReportClosureRateValueDto {
  @ApiProperty({ enum: ['VALUE'] })
  readonly status = 'VALUE' as const;
  @ApiProperty({ pattern: '^(100|[1-9]?[0-9])$' })
  percent!: string;
}
export class ReportClosureRateEmptyDto {
  @ApiProperty({ enum: ['NO_RECORDS'] })
  readonly status = 'NO_RECORDS' as const;
  @ApiProperty({ type: String, nullable: true, enum: [null] })
  readonly percent: null = null;
}
export class ReportsCenterMetadataDto extends OmitType(
  ArchivedCaseAverageMetadataDto,
  ['scope', 'definitionVersion'] as const,
) {
  @ApiProperty({ enum: ['RP001-2'] })
  readonly definitionVersion = 'RP001-2' as const;
  @ApiProperty({ type: String, enum: ['SELF', 'DEPARTMENT'] })
  scope!: 'SELF' | 'DEPARTMENT';
  @ApiProperty({ enum: ['mine', 'department'] })
  view!: ReportView;
  @ApiProperty({
    enum: ['mine', 'department'],
    isArray: true,
    minItems: 1,
    maxItems: 2,
  })
  availableViews!: ReportView[];
  @ApiProperty({
    enum: ['mine', 'department'],
    isArray: true,
    maxItems: 2,
    description: '导出未开放时为空',
  })
  exportViews!: ReportView[];
  @ApiProperty({ type: ReportDistributionsDto })
  distributions!: ReportDistributionsDto;
  @ApiProperty({ type: ReportMoneyDto })
  money!: ReportMoneyDto;
  @ApiProperty({
    oneOf: [
      { $ref: getSchemaPath(ReportClosureRateValueDto) },
      { $ref: getSchemaPath(ReportClosureRateEmptyDto) },
    ],
    description: 'Demo结案率，ARCHIVED/total，整数百分比；空分母无数据',
  })
  closureRate!: ReportClosureRateValueDto | ReportClosureRateEmptyDto;
}
export class ReportsCenterValueDto extends ReportsCenterMetadataDto {
  @ApiProperty({ enum: ['VALUE'] })
  readonly status = 'VALUE' as const;
  @ApiProperty({ pattern: '^(0|[1-9][0-9]*)\\.[0-9]{2}$' })
  amount!: string;
  @ApiProperty({ type: String, nullable: true, enum: [null] })
  readonly reason: null = null;
}
export class ReportsCenterNoRecordsDto extends ReportsCenterMetadataDto {
  @ApiProperty({ enum: ['NO_RECORDS'] })
  readonly status = 'NO_RECORDS' as const;
  @ApiProperty({ type: String, nullable: true, enum: [null] })
  readonly amount: null = null;
  @ApiProperty({ enum: ['NO_ARCHIVED_CASES'] })
  readonly reason = 'NO_ARCHIVED_CASES' as const;
}
export class ReportsCenterUnavailableDto extends ReportsCenterMetadataDto {
  @ApiProperty({ enum: ['UNAVAILABLE'] })
  readonly status = 'UNAVAILABLE' as const;
  @ApiProperty({ type: String, nullable: true, enum: [null] })
  readonly amount: null = null;
  @ApiProperty({ enum: ['NO_KNOWN_AMOUNT'] })
  readonly reason = 'NO_KNOWN_AMOUNT' as const;
}
export type ReportsCenterResponse =
  | ReportsCenterValueDto
  | ReportsCenterNoRecordsDto
  | ReportsCenterUnavailableDto;
