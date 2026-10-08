import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class RegisterCaseJudgmentDto {
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion!: number;
  @ApiProperty({ minLength: 1, maxLength: 128 })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  idempotencyKey!: string;
  @ApiProperty({ format: 'date' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/u)
  judgmentReceivedAt!: string;
  @ApiProperty({ enum: ['KNOWN', 'PENDING'] })
  @IsIn(['KNOWN', 'PENDING'])
  judgmentAmountState!: 'KNOWN' | 'PENDING';
  @ApiProperty({ type: String, nullable: true })
  @ValidateIf((_object, value: unknown) => value !== null)
  @IsString()
  judgmentAmount!: string | null;
  @ApiProperty({ enum: ['KNOWN', 'PENDING'] })
  @IsIn(['KNOWN', 'PENDING'])
  paidLitigationFeeState!: 'KNOWN' | 'PENDING';
  @ApiProperty({ type: String, nullable: true })
  @ValidateIf((_object, value: unknown) => value !== null)
  @IsString()
  paidLitigationFee!: string | null;
  @ApiProperty({ type: [String], minItems: 1, maxItems: 10 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @IsUUID('4', { each: true })
  judgmentContentVersionIds!: string[];
}

export class CorrectCaseJudgmentDto extends RegisterCaseJudgmentDto {
  @ApiProperty({ minLength: 1, maxLength: 500 })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason!: string;
}

export class CaseJudgmentCommandResultDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: ['WAITING_JUDGMENT'] }) stage!: 'WAITING_JUDGMENT';
  @ApiProperty() version!: number;
  @ApiProperty({ format: 'uuid' }) judgmentId!: string;
  @ApiProperty({ format: 'date-time' }) recordedAt!: string;
}
