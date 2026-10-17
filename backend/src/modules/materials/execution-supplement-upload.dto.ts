import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsInt,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/** Stable route anchors plus an optimistic revision; no owner/category overrides. */
export type ExecutionSupplementUploadTarget = Readonly<{
  filingId: string;
  supplementId: string;
  expectedRevision: number;
}>;

/** Filing and supplement UUIDs are supplied exclusively by the nested route. */
export class CreateExecutionSupplementUploadDto {
  @ApiProperty({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  expectedRevision!: number;

  @ApiProperty({ minLength: 1, maxLength: 200 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  originalFilename!: string;

  @ApiProperty({ minLength: 1, maxLength: 100 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  declaredMimeType!: string;
}

export class ExecutionSupplementUploadTargetDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') filingId!: string;
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') supplementId!: string;
  @ApiProperty({ minimum: 0 }) @IsInt() @Min(0) expectedRevision!: number;
}

export class ExecutionSupplementUploadDraftResultDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: ['CASE'] }) ownerType!: 'CASE';
  @ApiProperty({ format: 'uuid' }) ownerId!: string;
  @ApiProperty({ enum: ['EXECUTION_SUPPLEMENT'] })
  category!: 'EXECUTION_SUPPLEMENT';
  @ApiProperty({ enum: ['EXECUTION_SUPPLEMENT'] })
  purpose!: 'EXECUTION_SUPPLEMENT';
  @ApiProperty() originalFilename!: string;
  @ApiProperty() declaredMimeType!: string;
  @ApiProperty({ format: 'date-time' }) expiresAt!: string;
  @ApiProperty({ type: ExecutionSupplementUploadTargetDto })
  executionSupplement!: ExecutionSupplementUploadTarget;
}
