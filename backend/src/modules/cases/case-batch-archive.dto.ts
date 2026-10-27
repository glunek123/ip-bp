import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
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
  ValidateNested,
} from 'class-validator';
import { EarlyArchiveCaseResult } from './case-early-archive.dto';

export class CaseBatchArchiveItemDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') id!: string;
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  expectedVersion!: number;
}

export class CaseBatchArchiveDto {
  @ApiProperty({ minLength: 1, maxLength: 128 })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  @Matches(/^\S(?:[\s\S]*\S)?$/u)
  idempotencyKey!: string;
  @ApiProperty({ format: 'date' })
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/u)
  archiveAt!: string;
  @ApiProperty({ minLength: 1, maxLength: 2000 })
  @IsString()
  @MaxLength(2000)
  @Matches(/\S/u)
  reason!: string;
  @ApiProperty({ type: [CaseBatchArchiveItemDto], minItems: 1, maxItems: 20 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ArrayUnique((item: CaseBatchArchiveItemDto) => item?.id)
  @ValidateNested({ each: true })
  @Type(() => CaseBatchArchiveItemDto)
  items!: CaseBatchArchiveItemDto[];
}

export class CaseBatchArchiveResultItemDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: ['SUCCEEDED', 'FAILED', 'UNKNOWN'] }) status!:
    'SUCCEEDED' | 'FAILED' | 'UNKNOWN';
  @ApiProperty({ required: false }) code?: string;
  @ApiProperty({ required: false, type: EarlyArchiveCaseResult })
  result?: EarlyArchiveCaseResult;
}

export class CaseBatchArchiveResultDto {
  @ApiProperty({ type: [CaseBatchArchiveResultItemDto] })
  items!: CaseBatchArchiveResultItemDto[];
}
