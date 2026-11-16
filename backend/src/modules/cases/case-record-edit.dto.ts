import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayNotEmpty,
  IsArray,
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
  @ApiProperty({
    description:
      '是否具备部门范围的案件查看权限；为 false 时接收案件后无法打开',
  })
  canReadCases!: boolean;
}

export class ChangeResponsibleUserResultDto {
  @ApiProperty({ format: 'uuid' }) caseId!: string;
  @ApiProperty({ format: 'uuid' }) responsibleUserId!: string;
  @ApiProperty() responsibilityEpoch!: number;
  @ApiProperty({ format: 'date-time' }) recordedAt!: string;
}

const LEAD_CASE_TYPES = [
  'CIVIL',
  'CRIMINAL',
  'ADMINISTRATIVE',
  'INVESTIGATION',
  'NOTARIZATION',
  'HEARING_REPRESENTATION',
] as const;
const INFRINGEMENT_TYPES = [
  'TRADEMARK',
  'SOFTWARE_COPYRIGHT',
  'ART_COPYRIGHT',
  'AUDIOVISUAL_COPYRIGHT',
  'TEXT_COPYRIGHT',
  'INVENTION_PATENT',
  'DESIGN_PATENT',
  'UTILITY_MODEL_PATENT',
  'UNFAIR_COMPETITION',
  'NETWORK_DISSEMINATION',
  'PORTRAIT_RIGHT',
  'OTHER',
] as const;

export class ChangeCaseTypesDto {
  @ApiProperty({ enum: LEAD_CASE_TYPES })
  @IsIn(LEAD_CASE_TYPES)
  caseType!: (typeof LEAD_CASE_TYPES)[number];
  @ApiProperty({ enum: INFRINGEMENT_TYPES, isArray: true })
  @IsArray()
  @ArrayNotEmpty()
  @IsIn(INFRINGEMENT_TYPES, { each: true })
  infringementTypes!: Array<(typeof INFRINGEMENT_TYPES)[number]>;
  @ApiProperty({ minLength: 1, maxLength: 500 })
  @IsString()
  @MaxLength(500)
  reason!: string;
  @ApiProperty({ minLength: 1, maxLength: 128 })
  @IsString()
  idempotencyKey!: string;
}

export class ChangeCaseTypesResultDto {
  @ApiProperty({ format: 'uuid' }) caseId!: string;
  @ApiProperty({ format: 'uuid' }) leadId!: string;
  @ApiProperty() caseType!: string;
  @ApiProperty({ type: String, isArray: true }) infringementTypes!: string[];
  @ApiProperty() affectedCaseCount!: number;
  @ApiProperty({ format: 'date-time' }) recordedAt!: string;
}

export class CaseTypesContextDto {
  @ApiProperty({ type: String, nullable: true, format: 'uuid' })
  leadId!: string | null;
  @ApiProperty() affectedCaseCount!: number;
}
