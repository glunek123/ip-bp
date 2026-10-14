import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  CaseExternalEntryKind,
  CaseStage,
  InfringementType,
  LeadCaseType,
  LeadPlatform,
} from '../../generated/prisma/enums';
import { CaseMatchDefendantDto } from './case-match.dto';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const day = /^\d{4}-\d{2}-\d{2}$/u;

export class CaseExternalKnownDto {
  @ApiProperty({ type: String, nullable: true, format: 'uuid' })
  @ValidateIf((_, value: unknown) => value !== null)
  @IsString() @Matches(uuid) courtId!: string | null;
  @ApiProperty({ type: String, nullable: true, maxLength: 100 })
  @ValidateIf((_, value: unknown) => value !== null)
  @IsString() @MinLength(1) @MaxLength(100) courtCaseNo!: string | null;
  @ApiProperty({ type: String, nullable: true, format: 'date' })
  @ValidateIf((_, value: unknown) => value !== null)
  @IsString() @Matches(day) acceptedOn!: string | null;
  @ApiProperty({ type: String, nullable: true, format: 'date' })
  @ValidateIf((_, value: unknown) => value !== null)
  @IsString() @Matches(day) secondInstanceAcceptedOn!: string | null;
  @ApiProperty({ enum: LeadPlatform, nullable: true })
  @ValidateIf((_, value: unknown) => value !== null)
  @IsEnum(LeadPlatform) platform!: LeadPlatform | null;
  @ApiProperty({ type: String, nullable: true, maxLength: 200 })
  @ValidateIf((_, value: unknown) => value !== null)
  @IsString() @MinLength(1) @MaxLength(200) shopName!: string | null;
  @ApiProperty({ type: String, nullable: true, maxLength: 100 })
  @ValidateIf((_, value: unknown) => value !== null)
  @IsString() @MinLength(1) @MaxLength(100) shopExternalId!: string | null;
  @ApiProperty({ enum: LeadCaseType, nullable: true })
  @ValidateIf((_, value: unknown) => value !== null)
  @IsEnum(LeadCaseType) caseType!: LeadCaseType | null;
  @ApiProperty({ enum: InfringementType, isArray: true, nullable: true })
  @ValidateIf((_, value: unknown) => value !== null)
  @IsArray() @ArrayMaxSize(12) @IsEnum(InfringementType, { each: true })
  infringementTypes!: InfringementType[] | null;
}

export class CreateCaseExternalEntryDto {
  @ApiProperty({ minLength: 1, maxLength: 128 })
  @IsString() @MinLength(1) @MaxLength(128) idempotencyKey!: string;
  @ApiProperty({ enum: CaseExternalEntryKind })
  @IsEnum(CaseExternalEntryKind) entryKind!: CaseExternalEntryKind;
  @ApiProperty({ enum: CaseStage })
  @IsEnum(CaseStage) initialStage!: CaseStage;
  @ApiProperty({ format: 'date' })
  @IsString() @Matches(day) stageReachedOn!: string;
  @ApiProperty({ minLength: 1, maxLength: 500 })
  @IsString() @MinLength(1) @MaxLength(500) source!: string;
  @ApiProperty({ minLength: 1, maxLength: 500 })
  @IsString() @MinLength(1) @MaxLength(500) reason!: string;
  @ApiProperty({ format: 'uuid' })
  @IsString() @Matches(uuid) customerId!: string;
  @ApiProperty({ format: 'uuid' })
  @IsString() @Matches(uuid) rightsHolderId!: string;
  @ApiProperty({ type: [CaseMatchDefendantDto] })
  @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true })
  @Type(() => CaseMatchDefendantDto) defendants!: CaseMatchDefendantDto[];
  @ApiProperty({ type: String, nullable: true, format: 'uuid' })
  @ValidateIf((_, value: unknown) => value !== null)
  @IsString() @Matches(uuid) lawyerAccountId!: string | null;
  @ApiProperty({ type: String, nullable: true, format: 'uuid' })
  @ValidateIf((_, value: unknown) => value !== null)
  @IsString() @Matches(uuid) lawyerProfileId!: string | null;
  @ApiProperty({ type: CaseExternalKnownDto })
  @ValidateNested() @Type(() => CaseExternalKnownDto)
  known!: CaseExternalKnownDto;
}

export class CreateCaseExternalEntryResultDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() businessNo!: string;
  @ApiProperty({ enum: CaseStage }) stage!: CaseStage;
  @ApiProperty() version!: 1;
  @ApiProperty({ format: 'uuid' }) entryId!: string;
  @ApiProperty({ format: 'date-time' }) recordedAt!: string;
}
