import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsInt,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { CaseStage } from '../../generated/prisma/client';

const moneyPattern = /^(0|[1-9]\d{0,15})(?:\.\d{1,2})?$/u;
const positiveMoneyPattern =
  /^(?:[1-9]\d{0,15}(?:\.\d{1,2})?|0\.(?:0[1-9]|[1-9]\d))$/u;
const percentPattern = /^(?:100(?:\.0{1,16})?|\d{1,2}(?:\.\d{1,16})?)$/u;
const dayPattern = /^\d{4}-\d{2}-\d{2}$/u;

export enum SettlementSideDtoValue {
  CUSTOMER = 'CUSTOMER',
  LAWYER = 'LAWYER',
}

export enum LawyerSettlementModeDtoValue {
  FULL_RISK = 'FULL_RISK',
  HALF_RISK = 'HALF_RISK',
  FIXED_FEE = 'FIXED_FEE',
}

export class SettlementPageDto {
  @ApiPropertyOptional({ enum: SettlementSideDtoValue })
  @IsOptional()
  @IsEnum(SettlementSideDtoValue)
  side?: SettlementSideDtoValue;
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
  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  keyword?: string;
  @ApiPropertyOptional({ enum: CaseStage })
  @IsOptional()
  @IsEnum(CaseStage)
  stage?: CaseStage;
  @ApiPropertyOptional({ enum: ['UNBILLED', 'BILLED'] })
  @IsOptional()
  @IsIn(['UNBILLED', 'BILLED'])
  billed?: 'UNBILLED' | 'BILLED';
  @ApiPropertyOptional({ enum: ['ACTIVE', 'CANCELLED'] })
  @IsOptional()
  @IsIn(['ACTIVE', 'CANCELLED'])
  billState?: 'ACTIVE' | 'CANCELLED';
  @ApiPropertyOptional({ format: 'date' })
  @IsOptional()
  @Matches(dayPattern)
  from?: string;
  @ApiPropertyOptional({ format: 'date' })
  @IsOptional()
  @Matches(dayPattern)
  to?: string;
}

export class PreviewSettlementBillDto {
  @ApiProperty({ format: 'date' }) @Matches(dayPattern) billDate!: string;
}

export class UpdateCaseSettlementTermsDto {
  @ApiProperty({ maxLength: 128 })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  idempotencyKey!: string;
  @ApiProperty({
    minimum: 0,
    description: 'Zero means no terms record exists yet',
  })
  @IsInt()
  @Min(0)
  expectedTermsVersion!: number;

  @ApiProperty({ enum: SettlementSideDtoValue })
  @IsEnum(SettlementSideDtoValue)
  side!: SettlementSideDtoValue;

  @ApiPropertyOptional({ maxLength: 500 })
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MaxLength(500)
  customerFormula?: string;

  @ApiPropertyOptional({ enum: LawyerSettlementModeDtoValue })
  @ValidateIf((_object, value) => value !== undefined)
  @IsEnum(LawyerSettlementModeDtoValue)
  lawyerMode?: LawyerSettlementModeDtoValue;

  @ApiPropertyOptional({ pattern: moneyPattern.source })
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @Matches(moneyPattern)
  lawyerBaseFee?: string;

  @ApiPropertyOptional({ pattern: percentPattern.source })
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @Matches(percentPattern)
  lawyerSplitPercent?: string;

  @ApiPropertyOptional({ pattern: moneyPattern.source, nullable: true })
  @IsOptional()
  @IsString()
  @Matches(moneyPattern)
  manualAmount?: string | null;
}

export class LaunchCaseSettlementDto {
  @ApiProperty({ enum: SettlementSideDtoValue })
  @IsEnum(SettlementSideDtoValue)
  side!: SettlementSideDtoValue;

  @ApiPropertyOptional({
    type: String,
    format: 'uuid',
    description: 'Required on the lawyer side when choosing an assigned lawyer',
  })
  @IsOptional()
  @IsUUID('4')
  lawyerId?: string;

  @ApiProperty({ pattern: positiveMoneyPattern.source })
  @IsString()
  @Matches(positiveMoneyPattern)
  amount!: string;

  @ApiProperty({ type: String, format: 'date' })
  @IsString()
  @Matches(dayPattern)
  launchDate!: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  expectedTermsVersion!: number;

  @ApiProperty({ maxLength: 128 })
  @IsString()
  @MinLength(1)
  @Matches(/\S/u)
  @MaxLength(128)
  idempotencyKey!: string;
}

export class CreateSettlementBillDto {
  @ApiProperty({ enum: SettlementSideDtoValue })
  @IsEnum(SettlementSideDtoValue)
  side!: SettlementSideDtoValue;

  @ApiProperty({ type: String, format: 'date' })
  @IsString()
  @Matches(dayPattern)
  billDate!: string;

  @ApiProperty({ type: [String], format: 'uuid' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  launchIds!: string[];

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @ApiProperty({ maxLength: 128 })
  @IsString()
  @MinLength(1)
  @Matches(/\S/u)
  @MaxLength(128)
  idempotencyKey!: string;
}

export class CancelSettlementBillDto {
  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  @ApiProperty({ maxLength: 128 })
  @IsString()
  @MinLength(1)
  @Matches(/\S/u)
  @MaxLength(128)
  idempotencyKey!: string;
}
