import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  Equals,
  IsIn,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { CaseStage } from '../../generated/prisma/enums';
import { EVIDENCE_STATUSES, PAPER_STATUSES } from './evidence-rules';

const dayPattern = /^\d{4}-\d{2}-\d{2}$/u;

export class EvidenceListQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 20, maximum: 100 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;

  @ApiPropertyOptional({ enum: EVIDENCE_STATUSES })
  @IsOptional()
  @IsIn(EVIDENCE_STATUSES)
  status?: (typeof EVIDENCE_STATUSES)[number];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? [value] : value,
  )
  @IsArray()
  @ArrayMaxSize(30)
  @ArrayUnique()
  @IsEnum(CaseStage, { each: true })
  stages?: CaseStage[];

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(dayPattern)
  @IsDateString({ strict: true })
  hearFrom?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(dayPattern)
  @IsDateString({ strict: true })
  hearTo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(dayPattern)
  @IsDateString({ strict: true })
  closeFrom?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(dayPattern)
  @IsDateString({ strict: true })
  closeTo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  lawyerQuery?: string;
}

export class EvidenceDraftRowDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  id?: string;

  @ApiProperty()
  @IsString()
  @MaxLength(200)
  displayCode!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(200)
  shelfLocation!: string;

  @ApiProperty({ enum: EVIDENCE_STATUSES })
  @IsIn(EVIDENCE_STATUSES)
  status!: (typeof EVIDENCE_STATUSES)[number];

  @ApiProperty()
  @IsBoolean()
  manualStatus!: boolean;
}

export class EvidencePaperStatusDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  id!: string;

  @ApiProperty({ enum: PAPER_STATUSES })
  @IsIn(PAPER_STATUSES)
  status!: (typeof PAPER_STATUSES)[number];
}

export class SaveEvidenceGroupDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  expectedGroupVersion!: number;

  @ApiProperty({ type: [EvidenceDraftRowDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EvidenceDraftRowDto)
  rows!: EvidenceDraftRowDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  remark?: string;

  @ApiPropertyOptional({ type: [EvidencePaperStatusDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EvidencePaperStatusDto)
  paperCertificates?: EvidencePaperStatusDto[];
}

export class BulkEvidenceStatusDto {
  @ApiProperty({ type: [String], format: 'uuid' })
  @IsArray()
  @ArrayUnique()
  @IsUUID('all', { each: true })
  evidenceIds!: string[];

  @ApiProperty({ type: [String], format: 'uuid' })
  @IsArray()
  @ArrayUnique()
  @IsUUID('all', { each: true })
  paperCertificateIds!: string[];

  @ApiPropertyOptional({ enum: EVIDENCE_STATUSES })
  @IsOptional()
  @IsIn(EVIDENCE_STATUSES)
  evidenceStatus?: (typeof EVIDENCE_STATUSES)[number];

  @ApiPropertyOptional({ enum: PAPER_STATUSES })
  @IsOptional()
  @IsIn(PAPER_STATUSES)
  paperStatus?: (typeof PAPER_STATUSES)[number];
}

export class ExportEvidenceDto {
  @ApiProperty({ type: [String], format: 'uuid' })
  @IsArray()
  @ArrayUnique()
  @IsUUID('all', { each: true })
  evidenceIds!: string[];
}

export class EvidenceGroupQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 20, maximum: 100 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  query?: string;
}

export class CreateEvidenceSourceGroupDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  expectedSourceVersion!: number;

  @ApiProperty({ enum: [0] })
  @Equals(0)
  expectedGroupVersion!: 0;

  @ApiProperty({ type: [EvidenceDraftRowDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EvidenceDraftRowDto)
  rows!: EvidenceDraftRowDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  remark?: string;
}
