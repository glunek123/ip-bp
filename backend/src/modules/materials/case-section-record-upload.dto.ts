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

export type CaseSectionRecordUploadTarget =
  | Readonly<{
      kind: 'EXECUTION_MAILING' | 'EXECUTION_FILING' | 'EXECUTION_FINISH';
      targetId: string;
      expectedRevision: number;
    }>
  | Readonly<{
      kind: 'JUDGMENT';
      targetId: string;
      expectedRevision: number;
      trialRoundId: string;
    }>
  | Readonly<{
      kind: 'CLOSURE';
      targetId: string;
      expectedRevision: number;
      expectedClosureVersionId: string;
    }>;

class FileMetadataDto {
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

export class CreateExecutionMailingRecordUploadDto extends FileMetadataDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') mailingId!: string;
  @ApiProperty({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  expectedMailingRevision!: number;
}
export class CreateExecutionFilingRecordUploadDto extends FileMetadataDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') filingId!: string;
  @ApiProperty({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  expectedFilingRevision!: number;
}
export class CreateExecutionFinishRecordUploadDto extends FileMetadataDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') finishId!: string;
  @ApiProperty({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  expectedFinishRevision!: number;
}
export class CreateJudgmentRecordUploadDto extends FileMetadataDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') judgmentId!: string;
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') trialRoundId!: string;
  @ApiProperty({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  expectedJudgmentRevision!: number;
}
export class CreateClosureRecordUploadDto extends FileMetadataDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') closureId!: string;
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  expectedClosureVersionId!: string;
  @ApiProperty({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  expectedClosureRevision!: number;
}

export class CaseSectionRecordUploadDraftResultDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: ['CASE'] }) ownerType!: 'CASE';
  @ApiProperty({ format: 'uuid' }) ownerId!: string;
  @ApiProperty() category!: string;
  @ApiProperty() purpose!: string;
  @ApiProperty() originalFilename!: string;
  @ApiProperty() declaredMimeType!: string;
  @ApiProperty({ format: 'date-time' }) expiresAt!: string;
  @ApiProperty({
    oneOf: [
      {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'targetId', 'expectedRevision'],
        properties: {
          kind: {
            type: 'string',
            enum: ['EXECUTION_MAILING', 'EXECUTION_FILING', 'EXECUTION_FINISH'],
          },
          targetId: { type: 'string', format: 'uuid' },
          expectedRevision: { type: 'integer', minimum: 0 },
        },
      },
      {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'targetId', 'expectedRevision', 'trialRoundId'],
        properties: {
          kind: { type: 'string', enum: ['JUDGMENT'] },
          targetId: { type: 'string', format: 'uuid' },
          expectedRevision: { type: 'integer', minimum: 0 },
          trialRoundId: { type: 'string', format: 'uuid' },
        },
      },
      {
        type: 'object',
        additionalProperties: false,
        required: [
          'kind',
          'targetId',
          'expectedRevision',
          'expectedClosureVersionId',
        ],
        properties: {
          kind: { type: 'string', enum: ['CLOSURE'] },
          targetId: { type: 'string', format: 'uuid' },
          expectedRevision: { type: 'integer', minimum: 0 },
          expectedClosureVersionId: { type: 'string', format: 'uuid' },
        },
      },
    ],
  })
  recordCorrection!: CaseSectionRecordUploadTarget;
}
