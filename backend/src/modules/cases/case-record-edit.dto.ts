import { ApiProperty } from '@nestjs/swagger';
import {
  IsInt,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

export class UpdateDefendantContactDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  defendantId!: string;
  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  expectedContactRevision!: number;
  @ApiProperty({ minLength: 1, maxLength: 128 })
  @IsString()
  idempotencyKey!: string;
  @ApiProperty({ type: String, nullable: true, maxLength: 100 })
  @ValidateIf((_object, value) => value !== null)
  @IsString()
  @MaxLength(100)
  phone!: string | null;
  @ApiProperty({ type: String, nullable: true, maxLength: 500 })
  @ValidateIf((_object, value) => value !== null)
  @IsString()
  @MaxLength(500)
  address!: string | null;
}

export class CorrectCaseAcceptanceDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  acceptanceId!: string;
  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  expectedAcceptanceRevision!: number;
  @ApiProperty({ minLength: 1, maxLength: 128 })
  @IsString()
  idempotencyKey!: string;
  @ApiProperty({ format: 'date' })
  @IsString()
  acceptedAt!: string;
  @ApiProperty({ minLength: 1, maxLength: 100 })
  @IsString()
  @MaxLength(100)
  courtCaseNo!: string;
  @ApiProperty({ minLength: 1, maxLength: 500 })
  @IsString()
  @MaxLength(500)
  reason!: string;
}

export class DefendantContactUpdateResultDto {
  @ApiProperty({ format: 'uuid' }) caseId!: string;
  @ApiProperty({ format: 'uuid' }) defendantId!: string;
  @ApiProperty({ format: 'uuid' }) changeId!: string;
  @ApiProperty() contactRevision!: number;
  @ApiProperty({ type: String, nullable: true }) phone!: string | null;
  @ApiProperty({ type: String, nullable: true }) address!: string | null;
  @ApiProperty({ format: 'date-time' }) recordedAt!: string;
}

export class AcceptanceCorrectionResultDto {
  @ApiProperty({ format: 'uuid' }) caseId!: string;
  @ApiProperty({ format: 'uuid' }) acceptanceId!: string;
  @ApiProperty({ format: 'uuid' }) correctionId!: string;
  @ApiProperty() acceptanceRevision!: number;
  @ApiProperty({ format: 'date' }) acceptedAt!: string;
  @ApiProperty() courtCaseNo!: string;
  @ApiProperty({ format: 'date-time' }) recordedAt!: string;
}
