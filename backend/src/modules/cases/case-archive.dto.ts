import { ApiProperty } from '@nestjs/swagger';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export const caseArchiveTypes = [
  'VOIDED',
  'SETTLEMENT',
  'MEDIATION',
  'JUDGMENT_PERFORMED',
  'EXECUTION_COLLECTED',
  'EXECUTION_CLOSED',
] as const;
export class ArchiveCaseInput {
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
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  expectedClosureVersionId!: string;
  @ApiProperty({ format: 'date' })
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/u)
  archiveAt!: string;
  @ApiProperty({ enum: caseArchiveTypes })
  @IsIn(caseArchiveTypes)
  archiveType!: (typeof caseArchiveTypes)[number];
  @ApiProperty({ minLength: 1, maxLength: 2000 })
  @IsString()
  @MaxLength(2000)
  @Matches(/\S/u)
  archiveReason!: string;
}
export class CorrectCaseArchiveInput extends ArchiveCaseInput {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  expectedArchiveVersionId!: string;
  @ApiProperty({ minLength: 1, maxLength: 500 })
  @IsString()
  @MaxLength(500)
  @Matches(/\S/u)
  correctionReason!: string;
}
export class CaseArchiveResult {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) archiveId!: string;
  @ApiProperty({ format: 'uuid' }) archiveVersionId!: string;
  @ApiProperty({ format: 'uuid' }) closureId!: string;
  @ApiProperty({ format: 'uuid' }) closureVersionId!: string;
  @ApiProperty({ enum: ['ARCHIVED'] }) stage!: 'ARCHIVED';
  @ApiProperty() version!: number;
  @ApiProperty({ format: 'date-time' }) recordedAt!: string;
}
