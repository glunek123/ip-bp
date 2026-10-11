import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsDefined,
  IsInt,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class SubmitExecutionRequestDto {
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion!: number;
  @ApiProperty({ minLength: 1, maxLength: 128 })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  idempotencyKey!: string;
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') trialRoundId!: string;
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') judgmentNextStepId!: string;
  @ApiProperty({ type: String, nullable: true, format: 'uuid' })
  @IsDefined()
  @ValidateIf((_input, value) => value !== null)
  @IsUUID('4')
  secondInstanceResultId!: string | null;
  @ApiProperty({ type: String, nullable: true, format: 'uuid' })
  @IsDefined()
  @ValidateIf((_input, value) => value !== null)
  @IsUUID('4')
  expectedSubmissionId!: string | null;
  @ApiProperty({ type: [String], format: 'uuid', minItems: 1, maxItems: 10 })
  @IsArray()
  @IsUUID('4', { each: true })
  executionApplicationContentVersionIds!: string[];
  @ApiPropertyOptional({ minLength: 1, maxLength: 500 })
  @ValidateIf((_input, value) => value !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  changeReason?: string;
}

export class SubmitExecutionResultDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) submissionId!: string;
  @ApiProperty({ enum: ['WAITING_EXECUTION_CONFIRMATION'] })
  stage!: 'WAITING_EXECUTION_CONFIRMATION';
  @ApiProperty() version!: number;
  @ApiProperty({ format: 'date-time' }) submittedAt!: string;
}
