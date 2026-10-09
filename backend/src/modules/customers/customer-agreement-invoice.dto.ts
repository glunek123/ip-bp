import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;
const optionalText = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() || null : value;

export class CustomerDocumentVersionQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;
  @ApiPropertyOptional({ default: 20 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;
}

class AgreementFieldsDto {
  @ApiPropertyOptional({ maxLength: 200 })
  @Transform(trim)
  @ValidateIf((_o, v) => v !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title?: string;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 100 })
  @Transform(optionalText)
  @ValidateIf((_o, v) => v !== undefined && v !== null)
  @IsString()
  @MaxLength(100)
  model?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 200 })
  @Transform(optionalText)
  @ValidateIf((_o, v) => v !== undefined && v !== null)
  @IsString()
  @MaxLength(200)
  settlementMethod?: string | null;
  @ApiPropertyOptional({ enum: ['FIXED', 'LONG_TERM', 'UNKNOWN'] })
  @ValidateIf((_o, v) => v !== undefined)
  @IsIn(['FIXED', 'LONG_TERM', 'UNKNOWN'])
  validityMode?: 'FIXED' | 'LONG_TERM' | 'UNKNOWN';
  @ApiPropertyOptional({ type: String, format: 'date', nullable: true })
  @ValidateIf((_o, v) => v !== undefined && v !== null)
  @Matches(/^\d{4}-\d{2}-\d{2}$/u)
  effectiveFrom?: string | null;
  @ApiPropertyOptional({ type: String, format: 'date', nullable: true })
  @ValidateIf((_o, v) => v !== undefined && v !== null)
  @Matches(/^\d{4}-\d{2}-\d{2}$/u)
  effectiveTo?: string | null;
  @ApiPropertyOptional({ type: [String], maxItems: 10 })
  @ValidateIf((_o, v) => v !== undefined)
  @IsArray()
  @ArrayMaxSize(10)
  @IsUUID('4', { each: true })
  contentVersionIds?: string[];
}

export class CreateAgreementDto extends AgreementFieldsDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  expectedCustomerVersion!: number;
  @ApiProperty({ maxLength: 200 })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  declare title: string;
  @ApiProperty({ enum: ['FIXED', 'LONG_TERM', 'UNKNOWN'] })
  @IsIn(['FIXED', 'LONG_TERM', 'UNKNOWN'])
  declare validityMode: 'FIXED' | 'LONG_TERM' | 'UNKNOWN';
}
export class ReviseAgreementDto extends AgreementFieldsDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  expectedCustomerVersion!: number;
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  expectedAgreementVersion!: number;
}

class InvoiceFieldsDto {
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 100 })
  @Transform(optionalText)
  @ValidateIf((_o, v) => v !== undefined && v !== null)
  @IsString()
  @MaxLength(100)
  invoiceType?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 200 })
  @Transform(optionalText)
  @ValidateIf((_o, v) => v !== undefined && v !== null)
  @IsString()
  @MaxLength(200)
  invoiceSubject?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 100 })
  @Transform(optionalText)
  @ValidateIf((_o, v) => v !== undefined && v !== null)
  @IsString()
  @MaxLength(100)
  taxNo?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 500 })
  @Transform(optionalText)
  @ValidateIf((_o, v) => v !== undefined && v !== null)
  @IsString()
  @MaxLength(500)
  bank?: string | null;
}
export class CreateInvoiceProfileDto extends InvoiceFieldsDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  expectedCustomerVersion!: number;
}
export class ReviseInvoiceProfileDto extends InvoiceFieldsDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  expectedCustomerVersion!: number;
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedInvoiceVersion!: number;
}

export class CustomerDocumentFileDto {
  @ApiProperty({ format: 'uuid' }) materialId!: string;
  @ApiProperty({ format: 'uuid' }) contentVersionId!: string;
  @ApiProperty() originalFilename!: string;
  @ApiProperty() mimeType!: string;
}
export class AgreementVersionResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) agreementId!: string;
  @ApiProperty({ format: 'uuid' }) customerId!: string;
  @ApiProperty({ format: 'uuid' }) departmentId!: string;
  @ApiProperty() version!: number;
  @ApiProperty() title!: string;
  @ApiProperty({ type: String, nullable: true }) model!: string | null;
  @ApiProperty({ type: String, nullable: true }) settlementMethod!:
    string | null;
  @ApiProperty({ enum: ['FIXED', 'LONG_TERM', 'UNKNOWN'] })
  validityMode!: string;
  @ApiProperty({ type: String, format: 'date', nullable: true })
  effectiveFrom!: string | null;
  @ApiProperty({ type: String, format: 'date', nullable: true }) effectiveTo!:
    string | null;
  @ApiProperty({ type: [String] }) contentVersionIds!: string[];
  @ApiProperty({ type: () => [CustomerDocumentFileDto] })
  files!: CustomerDocumentFileDto[];
  @ApiProperty({ format: 'uuid' }) recordedByUserId!: string;
  @ApiProperty({ format: 'date-time' }) recordedAt!: string;
  @ApiProperty({ format: 'uuid' }) auditEventId!: string;
}
export class InvoiceVersionResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) profileId!: string;
  @ApiProperty({ format: 'uuid' }) customerId!: string;
  @ApiProperty({ format: 'uuid' }) departmentId!: string;
  @ApiProperty() version!: number;
  @ApiProperty({ type: String, nullable: true }) invoiceType!: string | null;
  @ApiProperty({ type: String, nullable: true }) invoiceSubject!: string | null;
  @ApiProperty({ type: String, nullable: true }) taxNo!: string | null;
  @ApiProperty({ type: String, nullable: true }) bank!: string | null;
  @ApiProperty({ format: 'uuid' }) recordedByUserId!: string;
  @ApiProperty({ format: 'date-time' }) recordedAt!: string;
  @ApiProperty({ format: 'uuid' }) auditEventId!: string;
}
export class AgreementEntityResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() version!: number;
  @ApiProperty({ type: () => AgreementVersionResponseDto })
  currentVersion!: AgreementVersionResponseDto;
}
export class InvoiceProfileEntityResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() version!: number;
  @ApiProperty({ type: () => InvoiceVersionResponseDto })
  currentVersion!: InvoiceVersionResponseDto;
}
export class AgreementResponseDto {
  @ApiProperty({ type: () => AgreementEntityResponseDto, nullable: true })
  agreement!: AgreementEntityResponseDto | null;
  @ApiProperty() canEdit!: boolean;
  @ApiProperty() customerVersion!: number;
}
export class InvoiceResponseDto {
  @ApiProperty({ type: () => InvoiceProfileEntityResponseDto, nullable: true })
  profile!: InvoiceProfileEntityResponseDto | null;
  @ApiProperty() canEdit!: boolean;
  @ApiProperty() customerVersion!: number;
}
export class AgreementVersionListResponseDto {
  @ApiProperty({ type: () => [AgreementVersionResponseDto] })
  items!: AgreementVersionResponseDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
}
export class InvoiceVersionListResponseDto {
  @ApiProperty({ type: () => [InvoiceVersionResponseDto] })
  items!: InvoiceVersionResponseDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
}
