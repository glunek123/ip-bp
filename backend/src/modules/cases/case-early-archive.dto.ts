import { ApiProperty } from '@nestjs/swagger';
import {
  IsDateString,
  IsInt,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import type { CaseStage } from '../../generated/prisma/client';

export class EarlyArchiveCaseInput {
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

  @ApiProperty({ format: 'date' })
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/u)
  archiveAt!: string;

  @ApiProperty({ minLength: 1, maxLength: 2000 })
  @IsString()
  @MaxLength(2000)
  @Matches(/\S/u)
  reason!: string;
}

export class EarlyArchiveCaseResult {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) earlyArchiveId!: string;
  @ApiProperty() fromStage!: Exclude<CaseStage, 'ARCHIVED'>;
  @ApiProperty({ enum: ['ARCHIVED'] }) stage!: 'ARCHIVED';
  @ApiProperty() version!: number;
  @ApiProperty({ format: 'date-time' }) recordedAt!: string;
}
