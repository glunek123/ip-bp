import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  Equals,
  IsArray,
  IsDateString,
  IsDefined,
  IsInt,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

class FollowupCommandDto {
  @ApiProperty({ minLength: 1, maxLength: 128 })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  idempotencyKey!: string;
}

class FeedbackFieldsDto extends FollowupCommandDto {
  @ApiProperty({ type: String, nullable: true, format: 'date' })
  @IsDefined()
  @ValidateIf((_input, value) => value !== null)
  @Matches(/^\d{4}-\d{2}-\d{2}$/u)
  @IsDateString({ strict: true })
  feedbackOn!: string | null;

  @ApiProperty({ type: String, nullable: true, minLength: 1, maxLength: 100 })
  @Transform(trim)
  @IsDefined()
  @ValidateIf((_input, value) => value !== null)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  courtCaseNo!: string | null;

  @ApiProperty({ minLength: 1, maxLength: 2000 })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  content!: string;
}

export class RecordExecutionFilingFeedbackDto extends FeedbackFieldsDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') feedbackId!: string;
  @ApiProperty({ enum: [0] }) @IsInt() @Equals(0) expectedRevision!: number;
}

export class CorrectExecutionFilingFeedbackDto extends FeedbackFieldsDto {
  @ApiProperty({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER })
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  expectedRevision!: number;
  @ApiProperty({ minLength: 1, maxLength: 500 })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  correctionReason!: string;
}

class SupplementFieldsDto extends FollowupCommandDto {
  @ApiProperty({ type: String, nullable: true, format: 'date' })
  @IsDefined()
  @ValidateIf((_input, value) => value !== null)
  @Matches(/^\d{4}-\d{2}-\d{2}$/u)
  @IsDateString({ strict: true })
  submittedOn!: string | null;

  @ApiProperty({ type: String, nullable: true, minLength: 1, maxLength: 2000 })
  @Transform(trim)
  @IsDefined()
  @ValidateIf((_input, value) => value !== null)
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  note!: string | null;

  @ApiProperty({ type: [String], format: 'uuid', minItems: 1, maxItems: 10 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  contentVersionIds!: string[];
}

export class SubmitExecutionFilingSupplementDto extends SupplementFieldsDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') supplementId!: string;
  @ApiProperty({ enum: [0] }) @IsInt() @Equals(0) expectedRevision!: number;
}

export class CorrectExecutionFilingSupplementDto extends SupplementFieldsDto {
  @ApiProperty({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER })
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  expectedRevision!: number;
  @ApiProperty({ minLength: 1, maxLength: 500 })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  correctionReason!: string;
}

class FollowupResultDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) filingId!: string;
  @ApiProperty({ minimum: 1 }) revision!: number;
  @ApiProperty({ format: 'date-time' }) recordedAt!: string;
}

export class ExecutionFilingFeedbackResultDto extends FollowupResultDto {
  @ApiProperty({ format: 'uuid' }) feedbackId!: string;
}
export class ExecutionFilingSupplementResultDto extends FollowupResultDto {
  @ApiProperty({ format: 'uuid' }) supplementId!: string;
}
