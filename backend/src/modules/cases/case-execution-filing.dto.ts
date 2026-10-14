import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsDefined,
  IsInt,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class SubmitCaseExecutionFilingDto {
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion!: number;
  @ApiProperty({ minLength: 1, maxLength: 128 })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  idempotencyKey!: string;
  @ApiProperty({ type: String, nullable: true, format: 'uuid' })
  @IsDefined()
  @ValidateIf((_input, value) => value !== null)
  @IsUUID('4')
  expectedMailingId!: string | null;
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
  @ApiProperty({ type: String, nullable: true, format: 'uuid' })
  mailingId!: string | null;
  @ApiProperty({ enum: ['EXECUTING'] }) stage!: 'EXECUTING';
  @ApiProperty() version!: number;
  @ApiProperty({ format: 'date' }) submittedAt!: string;
  @ApiProperty({ format: 'date-time' }) recordedAt!: string;
}
