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

export class ReviewNotaryOpeningDto {
  @ApiProperty({ enum: ['INFRINGEMENT', 'NO_INFRINGEMENT'] })
  @IsIn(['INFRINGEMENT', 'NO_INFRINGEMENT'])
  result!: 'INFRINGEMENT' | 'NO_INFRINGEMENT';

  @ApiPropertyOptional({
    description: '不侵权时必填，1 至 2000 字符',
    maxLength: 2000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reason?: string | null;

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

export class NotaryOpeningReviewDecisionResponseDto {
  @ApiProperty({ enum: ['INFRINGEMENT', 'NO_INFRINGEMENT'] })
  result!: 'INFRINGEMENT' | 'NO_INFRINGEMENT';

  @ApiProperty({ nullable: true })
  reason!: string | null;

  @ApiProperty({ enum: ['INTERNAL', 'CLIENT'] })
  actorKind!: 'INTERNAL' | 'CLIENT';

  @ApiProperty()
  actorDisplayName!: string;

  @ApiProperty({ format: 'date-time' })
  decidedAt!: string;

  @ApiProperty({ nullable: true, format: 'date-time' })
  archivedAt!: string | null;
}

export class NotaryOpeningReviewResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: ['ISSUANCE_DECISION', 'ARCHIVED'] })
  stage!: 'ISSUANCE_DECISION' | 'ARCHIVED';

  @ApiProperty()
  version!: number;

  @ApiProperty({ type: NotaryOpeningReviewDecisionResponseDto })
  reviewDecision!: NotaryOpeningReviewDecisionResponseDto;
}

export class DecideNotaryIssuanceDto {
  @ApiProperty({ enum: ['ISSUE', 'NO_ISSUE'] })
  @IsIn(['ISSUE', 'NO_ISSUE'])
  decision!: 'ISSUE' | 'NO_ISSUE';

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

export class NotaryIssuanceDecisionSummaryDto {
  @ApiProperty({ enum: ['ISSUE', 'NO_ISSUE'] }) decision!: 'ISSUE' | 'NO_ISSUE';
  @ApiProperty() actorDisplayName!: string;
  @ApiProperty({ format: 'date-time' }) decidedAt!: string;
}

export class NotaryIssuanceDecisionResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: ['WAITING_CERTIFICATE', 'WAITING_RETURN'] })
  stage!: 'WAITING_CERTIFICATE' | 'WAITING_RETURN';
  @ApiProperty() version!: number;
  @ApiProperty({ type: NotaryIssuanceDecisionSummaryDto })
  issuanceDecision!: NotaryIssuanceDecisionSummaryDto;
}
