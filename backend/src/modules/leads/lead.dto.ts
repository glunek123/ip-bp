import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type, Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  CASE_TYPES,
  INFRINGEMENT_TYPES,
  LeadCaseType,
  LeadStatus,
  InfringementType,
  LeadPlatform,
  LeadSource,
  LEAD_STATUSES,
  PLATFORMS,
  SOURCES,
} from './lead.constants';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;
const moneyPattern = /^(0|[1-9]\d{0,15})(\.\d{1,2})?$/u;

export class LeadProductDto {
  @ApiPropertyOptional({ maxLength: 2048 })
  @Transform(trim)
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(2048)
  @IsUrl({
    protocols: ['http', 'https'],
    require_protocol: true,
    require_valid_protocol: true,
  })
  url?: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @Transform(trim)
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title?: string;

  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  @Max(2147483647)
  quantity!: number;
  @ApiProperty({ pattern: moneyPattern.source })
  @IsString()
  @Matches(moneyPattern)
  unitPrice!: string;
  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  @Max(2147483647)
  commentCount!: number;
}

export class LeadBusinessFieldsDto {
  @ApiProperty({ enum: CASE_TYPES }) @IsIn(CASE_TYPES) caseType!: LeadCaseType;
  @ApiProperty({ enum: INFRINGEMENT_TYPES, isArray: true })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(12)
  @ArrayUnique()
  @IsIn(INFRINGEMENT_TYPES, { each: true })
  infringementTypes!: InfringementType[];
  @ApiProperty({ enum: SOURCES }) @IsIn(SOURCES) source!: LeadSource;
  @ApiProperty({ enum: PLATFORMS }) @IsIn(PLATFORMS) platform!: LeadPlatform;
  @ApiProperty({ format: 'date-time' })
  @IsString()
  @IsDateString({ strict: true })
  foundAt!: string;
  @ApiProperty({ maxLength: 200 })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  shopName!: string;
  @ApiPropertyOptional({ maxLength: 100 })
  @Transform(trim)
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  shopExternalId?: string;
  @ApiProperty() @IsBoolean() needDisclose!: boolean;
  @ApiPropertyOptional({ maxLength: 5000 })
  @Transform(trim)
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  remark?: string;
  @ApiProperty({ type: [LeadProductDto], minItems: 1 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => LeadProductDto)
  products!: LeadProductDto[];
  @ApiProperty({
    type: [String],
    maxItems: 20,
    description:
      '创建时仅接受预留 Lead 草稿版本；编辑时必须完整提交当前已属于该 Lead 的可变截图版本集合。',
  })
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  leadScreenshotContentVersionIds!: string[];
}

export class CreateLeadDto extends LeadBusinessFieldsDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  reservedLeadId?: string;
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') customerId!: string;
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') rightsHolderId!: string;
}

export class UpdateLeadDto extends LeadBusinessFieldsDto {
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion!: number;
}

export class LeadListQueryDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page = 1;
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  pageSize = 20;
  @ApiPropertyOptional({ enum: LEAD_STATUSES })
  @IsIn(LEAD_STATUSES)
  @IsOptional()
  status?: LeadStatus;
}

export type CreateLeadCommand = CreateLeadDto;
