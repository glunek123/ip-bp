import {
  ApiProperty,
  ApiPropertyOptional,
  OmitType,
  PartialType,
} from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class RegisterCaseAcceptanceDto {
  @ApiPropertyOptional({ type: String, nullable: true, format: 'date' })
  @IsOptional()
  @IsString()
  paymentDueAt?: string | null;

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  expectedVersion!: number;
  @ApiProperty({ minLength: 1, maxLength: 128 })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  idempotencyKey!: string;
  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Required when an external-entry acceptance has no filing submission',
  })
  @IsOptional()
  @IsUUID('4')
  courtId?: string;
  @ApiProperty({ format: 'date' })
  @IsString()
  acceptedAt!: string;
  @ApiProperty({ minLength: 1, maxLength: 100 })
  @IsString()
  @MinLength(1)
  courtCaseNo!: string;
  @ApiPropertyOptional({ type: [String], format: 'uuid', maxItems: 10 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsUUID('4', { each: true })
  acceptanceNoticeContentVersionIds?: string[];
  @ApiPropertyOptional({ type: [String], format: 'uuid', maxItems: 10 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsUUID('4', { each: true })
  paymentListContentVersionIds?: string[];
  @ApiPropertyOptional({ type: [String], format: 'uuid', maxItems: 10 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsUUID('4', { each: true })
  serviceDocumentContentVersionIds?: string[];
  @ApiPropertyOptional({
    type: String,
    format: 'date',
    nullable: true,
    description:
      '法院通知的开庭日期；登记时一并建立真实开庭安排，不早于本次受理日期',
  })
  @IsOptional()
  @IsString()
  hearingAt?: string | null;
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: 500,
    description: '法院通知的开庭地点，随开庭安排一并登记',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  hearingPlace?: string | null;
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: 200,
    description: '承办法官，随开庭安排一并登记',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  judgeName?: string | null;
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: 2000,
    description: '法院披露文本，复用 COURT_DISCLOSURE 补充材料',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  courtDisclosureText?: string | null;
  @ApiPropertyOptional({
    type: [String],
    format: 'uuid',
    maxItems: 10,
    description: '法院披露附件内容版本，复用 COURT_DISCLOSURE 补充材料',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsUUID('4', { each: true })
  courtDisclosureContentVersionIds?: string[];
}

export class SaveCaseAcceptanceDraftDto extends PartialType(
  OmitType(RegisterCaseAcceptanceDto, [
    'expectedVersion',
    'idempotencyKey',
  ] as const),
) {
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion!: number;
}

class CaseAcceptanceDraftFieldsDto {
  @ApiProperty({ type: String, format: 'date', nullable: true })
  acceptedAt!: string | null;
  @ApiPropertyOptional({ type: String, format: 'date', nullable: true })
  paymentDueAt?: string | null;
  @ApiProperty({ type: String, nullable: true }) courtCaseNo!: string | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  courtId!: string | null;
  @ApiProperty({ type: [String] }) acceptanceNoticeContentVersionIds!: string[];
  @ApiProperty({ type: [String] }) paymentListContentVersionIds!: string[];
  @ApiProperty({ type: [String] }) serviceDocumentContentVersionIds!: string[];
  @ApiProperty({ type: String, format: 'date', nullable: true })
  hearingAt!: string | null;
  @ApiProperty({ type: String, nullable: true }) hearingPlace!: string | null;
  @ApiProperty({ type: String, nullable: true }) judgeName!: string | null;
  @ApiProperty({ type: String, nullable: true })
  courtDisclosureText!: string | null;
  @ApiProperty({ type: [String] })
  courtDisclosureContentVersionIds!: string[];
}

export class CaseAcceptanceDraftResponseDto {
  @ApiProperty({ type: CaseAcceptanceDraftFieldsDto, nullable: true })
  draft!: CaseAcceptanceDraftFieldsDto | null;
  @ApiProperty() version!: number;
}

export class RegisterCaseAcceptanceResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;
  @ApiProperty({ enum: ['WAITING_HEARING'] })
  stage!: 'WAITING_HEARING';
  @ApiProperty()
  version!: number;
  @ApiProperty({ format: 'date' })
  acceptedAt!: string;
  @ApiProperty()
  courtCaseNo!: string;
  @ApiProperty({ format: 'date-time' })
  recordedAt!: string;
}
