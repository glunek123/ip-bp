import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  Allow,
  IsBoolean,
  IsIn,
  IsInt,
  IsString,
  IsOptional,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

export class ConfirmCaseComplaintDto {
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion!: number;
  @ApiProperty({ minLength: 1, maxLength: 128 })
  @IsString()
  @MaxLength(128)
  idempotencyKey!: string;
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  confirmedComplaintContentVersionId!: string;
  @ApiProperty({ enum: ['KNOWN', 'PENDING'] })
  @IsIn(['KNOWN', 'PENDING'])
  amountState!: 'KNOWN' | 'PENDING';
  @ApiPropertyOptional({ type: String, nullable: true }) @Allow() amount!:
    string | null;
  @ApiPropertyOptional({ type: String, nullable: true })
  @Allow()
  pendingReason!: string | null;
  @ApiPropertyOptional({ type: String, maxLength: 500, nullable: true })
  @Allow()
  changeNote?: string | null;
  @ApiPropertyOptional({ type: Boolean, nullable: true })
  @IsOptional()
  @IsBoolean()
  confirmDisclose?: boolean | null;
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: 20000,
    description: '确认时在线预览并修改后的诉状正文快照',
  })
  @IsOptional()
  @IsString()
  @MaxLength(20000)
  bodyText?: string | null;
}

export class ConfirmCaseComplaintResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: ['WAITING_COMPLAINT_STAMP'] })
  stage!: 'WAITING_COMPLAINT_STAMP';
  @ApiProperty() version!: number;
  @ApiProperty({ format: 'date-time' }) confirmedAt!: string;
}
