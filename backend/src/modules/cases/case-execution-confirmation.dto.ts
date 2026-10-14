import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
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

export class ConfirmExecutionRequestDto {
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
  expectedSubmissionId!: string | null;
  @ApiPropertyOptional({ type: [String], format: 'uuid', minItems: 1, maxItems: 10 })
  @ValidateIf((_input, value) => value !== undefined)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  executionApplicationContentVersionIds?: string[];
}

export class ConfirmExecutionResultDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) confirmationId!: string;
  @ApiProperty({ type: String, nullable: true, format: 'uuid' })
  submissionId!: string | null;
  @ApiProperty({ enum: ['WAITING_EXECUTION_STAMP'] })
  stage!: 'WAITING_EXECUTION_STAMP';
  @ApiProperty() version!: number;
  @ApiProperty({ format: 'date-time' }) confirmedAt!: string;
}
