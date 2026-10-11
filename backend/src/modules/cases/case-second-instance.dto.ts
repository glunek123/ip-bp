import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsDefined,
  IsIn,
  IsInt,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

const datePattern = /^\d{4}-\d{2}-\d{2}$/u;
const amountPattern = /^(?:0|[1-9]\d{0,13})(?:\.\d{1,2})?$/u;

export class SecondInstanceProgressDto {
  @ApiProperty({ type: String, nullable: true, format: 'date' })
  @ValidateIf((_input, value) => value !== null)
  @Matches(datePattern)
  hearingAt!: string | null;

  @ApiProperty({ type: String, nullable: true, maxLength: 500 })
  @ValidateIf((_input, value) => value !== null)
  @IsString()
  @MaxLength(500)
  hearingPlace!: string | null;

  @ApiProperty({ type: String, nullable: true, maxLength: 200 })
  @ValidateIf((_input, value) => value !== null)
  @IsString()
  @MaxLength(200)
  judgeName!: string | null;

  @ApiProperty({ type: [String], format: 'uuid' })
  @IsArray()
  @IsUUID('4', { each: true })
  documentContentVersionIds!: string[];

  @ApiProperty({ type: [String], format: 'uuid' })
  @IsArray()
  @IsUUID('4', { each: true })
  serviceContentVersionIds!: string[];
}

export class KnownMoneyDto {
  @ApiProperty({ enum: ['KNOWN', 'PENDING'] })
  @IsIn(['KNOWN', 'PENDING'])
  state!: 'KNOWN' | 'PENDING';

  @ApiProperty({ type: String, nullable: true })
  @ValidateIf((_input, value) => value !== null)
  @Matches(amountPattern)
  amount!: string | null;
}

class SecondInstanceAnchorDto {
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion!: number;
  @ApiProperty({ minLength: 1, maxLength: 128 })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  idempotencyKey!: string;
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') trialRoundId!: string;
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') choiceId!: string;
  @ApiProperty({ type: String, nullable: true, format: 'uuid' })
  @ValidateIf((_input, value) => value !== null)
  @IsUUID('4')
  expectedProgressId!: string | null;
}

export class SaveSecondInstanceDto extends SecondInstanceAnchorDto {
  @ApiProperty({ type: SecondInstanceProgressDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => SecondInstanceProgressDto)
  progress!: SecondInstanceProgressDto;
}

export class RegisterSecondInstanceResultDto extends SaveSecondInstanceDto {
  @ApiProperty({ enum: ['REMAND', 'CHANGE', 'AFFIRM'] })
  @IsIn(['REMAND', 'CHANGE', 'AFFIRM'])
  result!: 'REMAND' | 'CHANGE' | 'AFFIRM';
  @ApiProperty({ format: 'date' })
  @Matches(datePattern)
  resultReceivedAt!: string;
  @ApiProperty({ type: [String], format: 'uuid' })
  @IsArray()
  @IsUUID('4', { each: true })
  judgmentContentVersionIds!: string[];
  @ApiProperty({ type: KnownMoneyDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => KnownMoneyDto)
  paidLitigationFee!: KnownMoneyDto;
  @ApiPropertyOptional({ type: KnownMoneyDto })
  @ValidateIf(
    (input: RegisterSecondInstanceResultDto) => input.result === 'CHANGE',
  )
  @IsDefined()
  @ValidateNested()
  @Type(() => KnownMoneyDto)
  judgmentAmount?: KnownMoneyDto;
}

export class RevokeSecondInstanceResultDto {
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion!: number;
  @ApiProperty({ minLength: 1, maxLength: 128 })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  idempotencyKey!: string;
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') trialRoundId!: string;
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') resultId!: string;
  @ApiProperty({ minLength: 1, maxLength: 500 })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason!: string;
}

export class SecondInstanceCommandResultDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({
    enum: [
      'SECOND_INSTANCE',
      'WAITING_FORMAL_ACCEPTANCE',
      'WAITING_EXECUTION_DOCUMENTS',
    ],
  })
  stage!:
    | 'SECOND_INSTANCE'
    | 'WAITING_FORMAL_ACCEPTANCE'
    | 'WAITING_EXECUTION_DOCUMENTS';
  @ApiProperty() version!: number;
  @ApiProperty({ format: 'uuid' }) currentTrialRoundId!: string;
  @ApiProperty({ type: String, nullable: true, format: 'uuid' }) progressId!:
    string | null;
  @ApiProperty({ type: String, nullable: true, format: 'uuid' }) resultId!:
    string | null;
  @ApiPropertyOptional({ format: 'uuid' }) revocationId?: string;
  @ApiProperty({ format: 'date-time' }) recordedAt!: string;
}
