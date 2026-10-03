import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class SubmitCaseFilingDto {
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion!: number;
  @ApiProperty({ minLength: 1, maxLength: 128 })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  idempotencyKey!: string;
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') courtId!: string;
  @ApiProperty({ format: 'date' }) @IsString() submittedAt!: string;
  @ApiProperty({ type: [String], format: 'uuid', minItems: 1, maxItems: 50 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsUUID('4', { each: true })
  filingEvidenceContentVersionIds!: string[];
  @ApiPropertyOptional({ type: [String], format: 'uuid', maxItems: 10 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsUUID('4', { each: true })
  filingScreenshotContentVersionIds?: string[];
  @ApiPropertyOptional({ minLength: 1, maxLength: 100 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  mediationNo?: string;
}

export class SubmitCaseFilingResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: ['WAITING_FORMAL_ACCEPTANCE'] })
  stage!: 'WAITING_FORMAL_ACCEPTANCE';
  @ApiProperty() version!: number;
  @ApiProperty({ format: 'date' }) submittedAt!: string;
  @ApiProperty({ format: 'date-time' }) recordedAt!: string;
}

export class CreateFilingCourtDto {
  @ApiProperty({ minLength: 1, maxLength: 200 })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;
}

export class FilingCourtDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
}

export class FilingCourtListDto {
  @ApiProperty({ type: [FilingCourtDto] }) items!: FilingCourtDto[];
}
