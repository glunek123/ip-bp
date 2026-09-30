import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  Allow,
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

export class SubmitCaseComplaintDto {
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion!: number;
  @ApiProperty({ maxLength: 128 })
  @IsString()
  @MaxLength(128)
  idempotencyKey!: string;
  @ApiProperty({ enum: ['KNOWN', 'PENDING'] })
  @IsIn(['KNOWN', 'PENDING'])
  amountState!: 'KNOWN' | 'PENDING';
  @ApiPropertyOptional({ type: String, nullable: true })
  @Allow()
  amount!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true })
  @Allow()
  pendingReason!: string | null;
  @ApiProperty({ type: [String], minItems: 1, maxItems: 10, format: 'uuid' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @IsUUID('4', { each: true })
  complaintContentVersionIds!: string[];
  @ApiProperty({ type: [String], minItems: 1, maxItems: 10, format: 'uuid' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @IsUUID('4', { each: true })
  authorizationContentVersionIds!: string[];
}

export class SubmitCaseComplaintResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: ['WAITING_COMPLAINT_CONFIRMATION'] })
  stage!: 'WAITING_COMPLAINT_CONFIRMATION';
  @ApiProperty() version!: number;
  @ApiProperty({ format: 'date-time' }) submittedAt!: string;
}
