import { ApiProperty } from '@nestjs/swagger';
import {
  IsInt,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class SaveCaseHearingDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  expectedVersion!: number;
  @ApiProperty({ minLength: 1, maxLength: 128 })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  idempotencyKey!: string;
  @ApiProperty({ type: String, nullable: true, format: 'date' })
  @ValidateIf((_object, value: unknown) => value !== null)
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/u)
  hearingAt!: string | null;
}

export class CorrectCaseHearingDto extends SaveCaseHearingDto {
  @ApiProperty({ minLength: 1, maxLength: 500 })
  @IsString()
  reason!: string;
}

export class CaseHearingCommandResultDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: ['WAITING_HEARING', 'WAITING_JUDGMENT'] })
  stage!: 'WAITING_HEARING' | 'WAITING_JUDGMENT';
  @ApiProperty() version!: number;
  @ApiProperty({ format: 'uuid' }) arrangementId!: string;
  @ApiProperty({ type: String, nullable: true, format: 'date' }) hearingAt!:
    string | null;
  @ApiProperty({ format: 'date-time' }) recordedAt!: string;
}
