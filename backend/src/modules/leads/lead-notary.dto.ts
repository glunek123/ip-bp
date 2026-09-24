import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  ArrayMinSize,
  ArrayMaxSize,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class CreateNotaryOfficeDto {
  @ApiProperty({ minLength: 1, maxLength: 200 })
  @IsString()
  name!: string;
}

export class SetNotaryOfficeStatusDto {
  @ApiProperty({ enum: ['INACTIVE'] })
  @IsIn(['INACTIVE'])
  status!: 'INACTIVE';
}

export class TransferLeadToNotaryDto {
  @ApiProperty({ type: [String], format: 'uuid', minItems: 1 })
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  selectedProductIds!: string[];

  @ApiProperty({ type: [String], format: 'uuid' })
  @IsArray()
  @IsUUID('4', { each: true })
  selectedContentVersionIds!: string[];

  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  notaryOfficeId!: string;

  @ApiProperty({ enum: ['ONLINE_PURCHASE'] })
  @IsIn(['ONLINE_PURCHASE'])
  evidenceMode!: 'ONLINE_PURCHASE';

  @ApiProperty({ minLength: 1, maxLength: 500 })
  @IsString()
  batchPurpose!: string;

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @ApiPropertyOptional({ description: '后续明确新建取证批次时设置为 true' })
  @IsOptional()
  @IsBoolean()
  createNewBatch?: boolean;
}

export class NotaryLogisticsDto {
  @ApiProperty({ enum: ['PRESENT', 'NONE'] })
  @IsIn(['PRESENT', 'NONE'])
  companyState!: 'PRESENT' | 'NONE';

  @ApiPropertyOptional({ nullable: true, maxLength: 200 })
  @IsOptional()
  @IsString()
  companyValue?: string | null;

  @ApiProperty({ enum: ['PRESENT', 'NONE'] })
  @IsIn(['PRESENT', 'NONE'])
  trackingState!: 'PRESENT' | 'NONE';

  @ApiPropertyOptional({ nullable: true, maxLength: 100 })
  @IsOptional()
  @IsString()
  trackingValue?: string | null;
}

export class RecordNotaryEvidenceDto {
  @ApiProperty({ description: '实际取证日期，YYYY-MM-DD' })
  @IsString()
  evidenceAt!: string;

  @ApiProperty({ enum: ['KNOWN', 'PENDING'] })
  @IsIn(['KNOWN', 'PENDING'])
  sampleFeeState!: 'KNOWN' | 'PENDING';

  @ApiPropertyOptional({
    nullable: true,
    description: '已知时必填，人民币两位小数',
  })
  @IsOptional()
  @IsString()
  sampleFeeAmount?: string | null;

  @ApiProperty({ type: [NotaryLogisticsDto], minItems: 1 })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => NotaryLogisticsDto)
  logistics!: NotaryLogisticsDto[];

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

export class RecordNotaryOpeningDto {
  @ApiProperty({ type: [String], format: 'uuid', minItems: 1, maxItems: 50 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsUUID('4', { each: true })
  contentVersionIds!: string[];

  @ApiPropertyOptional({ nullable: true, maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  senderName?: string | null;

  @ApiPropertyOptional({ nullable: true, maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  senderPhone?: string | null;

  @ApiPropertyOptional({ nullable: true, maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  senderAddress?: string | null;

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}
