import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsOptional,
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
  @ApiProperty({
    type: String,
    nullable: true,
    description: '去除首尾空格后最多100字符；空串保存为null',
  })
  @ValidateIf((_object, value) => value !== null)
  @IsString()
  phone!: string | null;
  @ApiProperty({
    type: String,
    nullable: true,
    description: '去除首尾空格后最多500字符；空串保存为null',
  })
  @ValidateIf((_object, value) => value !== null)
  @IsString()
  address!: string | null;
}

export class CorrectCaseAcceptanceDto {
  @ApiPropertyOptional({ type: String, nullable: true, format: 'date' })
  @IsOptional()
  @IsString()
  paymentDueAt?: string | null;

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
  @ApiProperty({ description: '去除首尾空格后1至100字符' })
  @IsString()
  courtCaseNo!: string;
  @ApiProperty({ description: '去除首尾空格后1至500字符' })
  @IsString()
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

export class SaveSecondInstanceAcceptanceDto {
  @ApiProperty({ type: String, nullable: true, format: 'uuid' })
  @ValidateIf((_object, value) => value !== null)
  @IsUUID('4')
  choiceId!: string | null;
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') trialRoundId!: string;
  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  expectedAcceptanceRevision!: number;
  @ApiProperty({ minLength: 1, maxLength: 128 })
  @IsString()
  idempotencyKey!: string;
  @ApiProperty({ type: String, nullable: true, format: 'date' })
  @ValidateIf((_object, value) => value !== null)
  @IsString()
  acceptedAt!: string | null;
  @ApiProperty({ type: String, nullable: true, maxLength: 100 })
  @ValidateIf((_object, value) => value !== null)
  @IsString()
  courtCaseNo!: string | null;
  @ApiProperty({ type: String, nullable: true, maxLength: 500 })
  @ValidateIf((_object, value) => value !== null)
  @IsString()
  reason!: string | null;
}

export class SaveSecondInstanceAcceptanceResultDto {
  @ApiProperty({ format: 'uuid' }) caseId!: string;
  @ApiProperty({ type: String, nullable: true, format: 'uuid' }) choiceId!:
    string | null;
  @ApiProperty({ format: 'uuid' }) trialRoundId!: string;
  @ApiProperty({ format: 'uuid' }) changeId!: string;
  @ApiProperty() acceptanceRevision!: number;
  @ApiProperty({ type: String, nullable: true, format: 'date' }) acceptedAt!:
    string | null;
  @ApiProperty({ type: String, nullable: true }) courtCaseNo!: string | null;
  @ApiProperty({ format: 'date-time' }) recordedAt!: string;
}

export class AddCaseDefendantDto {
  @ApiProperty({ enum: ['PERSON', 'ORGANIZATION'] })
  @IsIn(['PERSON', 'ORGANIZATION'])
  kind!: 'PERSON' | 'ORGANIZATION';
  @ApiProperty({ minLength: 1, maxLength: 200 })
  @IsString()
  @MaxLength(200)
  name!: string;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 100 })
  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsString()
  @MaxLength(100)
  idNo?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 100 })
  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsString()
  @MaxLength(100)
  phone?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 500 })
  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsString()
  @MaxLength(500)
  address?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 200 })
  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsString()
  @MaxLength(200)
  legalRepresentative?: string | null;
  @ApiProperty({ minLength: 1, maxLength: 128 })
  @IsString()
  idempotencyKey!: string;
}

export class AddCaseDefendantResultDto {
  @ApiProperty({ format: 'uuid' }) caseId!: string;
  @ApiProperty({ format: 'uuid' }) defendantId!: string;
  @ApiProperty() contactRevision!: number;
  @ApiProperty({ format: 'date-time' }) recordedAt!: string;
}

export class ChangeResponsibleUserDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  userId!: string;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 500 })
  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsString()
  @MaxLength(500)
  reason?: string | null;
  @ApiProperty({ minLength: 1, maxLength: 128 })
  @IsString()
  idempotencyKey!: string;
}

export class ResponsibleUserCandidateDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() displayName!: string;
}

export class ChangeResponsibleUserResultDto {
  @ApiProperty({ format: 'uuid' }) caseId!: string;
  @ApiProperty({ format: 'uuid' }) responsibleUserId!: string;
  @ApiProperty() responsibilityEpoch!: number;
  @ApiProperty({ format: 'date-time' }) recordedAt!: string;
}
