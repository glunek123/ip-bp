import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsDateString,
  IsDefined,
  IsIn,
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

export class RecordCaseClosureInput {
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
  @ApiProperty({ type: String, nullable: true, format: 'uuid' })
  @IsDefined()
  @ValidateIf((_input, value) => value !== null)
  @IsUUID('4')
  expectedFinishId!: string | null;
  @ApiProperty({ type: String, nullable: true, format: 'date' })
  @ValidateIf((_o, value) => value !== null)
  @IsDateString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/u)
  closeAt!: string | null;
  @ApiProperty({ enum: ['KNOWN', 'PENDING'] })
  @IsIn(['KNOWN', 'PENDING'])
  closeAmountState!: 'KNOWN' | 'PENDING';
  @ApiProperty({ type: String, nullable: true })
  @ValidateIf((_o, value) => value !== null)
  @IsString()
  @Matches(/^\d{1,14}(?:\.\d{1,2})?$/u)
  closeAmt!: string | null;
  @ApiProperty({ type: String, nullable: true, maxLength: 2000 })
  @ValidateIf((_o, value) => value !== null)
  @IsString()
  @MaxLength(2000)
  @Matches(/\S/u)
  note!: string | null;
  @ApiProperty({ type: [String], format: 'uuid', maxItems: 10 })
  @IsArray()
  @ArrayMaxSize(10)
  @ArrayUnique((id: unknown) =>
    typeof id === 'string' ? id.toLowerCase() : id,
  )
  @IsUUID('4', { each: true })
  closeContentVersionIds!: string[];
}
export class CorrectCaseClosureInput extends RecordCaseClosureInput {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  expectedClosureVersionId!: string;
  @ApiProperty({ maxLength: 500 })
  @IsString()
  @MaxLength(500)
  @Matches(/\S/u)
  correctionReason!: string;
}
export class CaseClosureResult {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) closureId!: string;
  @ApiProperty({ format: 'uuid' }) closureVersionId!: string;
  @ApiProperty({ type: String, nullable: true, format: 'uuid' })
  finishId!: string | null;
  @ApiProperty({ enum: ['WAITING_ARCHIVE'] }) stage!: 'WAITING_ARCHIVE';
  @ApiProperty() version!: number;
  @ApiProperty({ format: 'date-time' }) recordedAt!: string;
}
