import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsInt,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class SubmitCaseExecutionFilingDto {
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion!: number;
  @ApiProperty({ minLength: 1, maxLength: 128 })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  idempotencyKey!: string;
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') expectedMailingId!: string;
  @ApiProperty({ format: 'date' }) @IsDateString() submittedAt!: string;
  @ApiProperty({ type: [String], format: 'uuid', minItems: 1, maxItems: 10 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @IsUUID('4', { each: true })
  executionFilingProofContentVersionIds!: string[];
}

export class SubmitCaseExecutionFilingResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) filingId!: string;
  @ApiProperty({ format: 'uuid' }) mailingId!: string;
  @ApiProperty({ enum: ['EXECUTING'] }) stage!: 'EXECUTING';
  @ApiProperty() version!: number;
  @ApiProperty({ format: 'date' }) submittedAt!: string;
  @ApiProperty({ format: 'date-time' }) recordedAt!: string;
}
