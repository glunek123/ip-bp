import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsDateString,
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
export class FinishCaseExecutionDto {
  @ApiProperty({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER })
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  expectedVersion!: number;
  @ApiProperty({ minLength: 1, maxLength: 128 })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  @Matches(/^\S(?:[\s\S]*\S)?$/u)
  idempotencyKey!: string;
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') expectedFilingId!: string;
  @ApiProperty({ format: 'date' })
  @IsDateString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/u)
  finishedAt!: string;
  @ApiProperty({ minLength: 1, maxLength: 2000 })
  @IsString()
  @MaxLength(2000)
  @Matches(/\S/u)
  reason!: string;
  @ApiProperty({ type: String, nullable: true, minLength: 1, maxLength: 2000 })
  @ValidateIf((_o, value) => value !== null)
  @IsString()
  @MaxLength(2000)
  @Matches(/\S/u)
  basisNote!: string | null;
  @ApiProperty({ type: [String], format: 'uuid', minItems: 0, maxItems: 10 })
  @IsArray()
  @ArrayMaxSize(10)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  basisContentVersionIds!: string[];
}
export class FinishCaseExecutionResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) finishId!: string;
  @ApiProperty({ format: 'uuid' }) filingId!: string;
  @ApiProperty({ enum: ['WAITING_ARCHIVE'] }) stage!: 'WAITING_ARCHIVE';
  @ApiProperty() version!: number;
  @ApiProperty({ format: 'date' }) finishedAt!: string;
  @ApiProperty({ format: 'date-time' }) recordedAt!: string;
}
