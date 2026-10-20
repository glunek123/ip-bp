import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  Allow,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { NotaryLogisticsDto } from './lead-notary.dto';

export class CorrectNotaryEvidenceDto {
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion!: number;
  @ApiProperty({ minimum: 0 }) @IsInt() @Min(0) expectedRevision!: number;
  @ApiProperty({ minLength: 1, maxLength: 500 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(500)
  correctionReason!: string;
  @ApiProperty({ format: 'date' }) @IsString() evidenceAt!: string;
  @ApiProperty({ type: [NotaryLogisticsDto], minItems: 1 })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => NotaryLogisticsDto)
  logistics!: NotaryLogisticsDto[];
}

export class CorrectNotaryOpeningSenderDto {
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion!: number;
  @ApiProperty({ minimum: 0 }) @IsInt() @Min(0) expectedRevision!: number;
  @ApiProperty({ minLength: 1, maxLength: 500 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(500)
  correctionReason!: string;
  @ApiProperty({ type: String, nullable: true, maxLength: 200 })
  @Allow()
  senderName!: string | null;
  @ApiProperty({ type: String, nullable: true, maxLength: 100 })
  @Allow()
  senderPhone!: string | null;
  @ApiProperty({ type: String, nullable: true, maxLength: 500 })
  @Allow()
  senderAddress!: string | null;
}

export class NotaryRecordCorrectionResponseDto {
  @ApiProperty({ format: 'uuid' }) matterId!: string;
  @ApiProperty({ format: 'uuid' }) correctionId!: string;
  @ApiProperty({ enum: ['EVIDENCE', 'OPENING_SENDER'] }) kind!:
    'EVIDENCE' | 'OPENING_SENDER';
  @ApiProperty({ minimum: 1 }) revision!: number;
  @ApiProperty({ format: 'date-time' }) recordedAt!: string;
}
