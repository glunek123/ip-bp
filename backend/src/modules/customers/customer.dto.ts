import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsInt,
  IsIn,
  IsEmail,
  IsObject,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
  ValidateIf,
} from 'class-validator';
import { AgreementFieldsDto } from './customer-agreement-invoice.dto';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const admissionPhonePattern = /^(?=(?:\D*\d){6,20}\D*$)[+()\d\s-]+$/u;

class CustomerCreationOperatorDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() displayName!: string;
}

export class CustomerCreationContextResponseDto {
  @ApiProperty({ format: 'uuid' }) responsibleUserId!: string;
  @ApiProperty({ type: [CustomerCreationOperatorDto] })
  operators!: CustomerCreationOperatorDto[];
  @ApiProperty() canSetInitialAgreement!: boolean;
}

class AdmissionContactFieldsDto {
  @ApiPropertyOptional({ type: String, maxLength: 100, nullable: true })
  @Transform(trim)
  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @IsString()
  @MaxLength(100)
  customerManagerName?: string | null;

  @ApiPropertyOptional({ maxLength: 100 })
  @Transform(trim)
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  admissionContactName?: string;

  @ApiPropertyOptional({ maxLength: 30 })
  @Transform(trim)
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MinLength(6)
  @MaxLength(30)
  @Matches(admissionPhonePattern)
  admissionContactPhone?: string;

  @ApiPropertyOptional({ maxLength: 254 })
  @Transform(trim)
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MinLength(3)
  @MaxLength(254)
  @IsEmail()
  admissionContactEmail?: string;
}

export class CreateCustomerDraftDto extends AdmissionContactFieldsDto {
  @ApiPropertyOptional({ maxLength: 50 })
  @Transform(trim)
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MaxLength(50)
  customerType?: string;

  @ApiPropertyOptional({ maxLength: 50 })
  @Transform(trim)
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MaxLength(50)
  identityType?: string;

  @ApiPropertyOptional({ maxLength: 100 })
  @Transform(trim)
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MaxLength(100)
  identityNumber?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @ValidateIf((_object, value) => value !== undefined)
  @IsUUID('4')
  responsibleUserId?: string;

  @ApiPropertyOptional({ type: AgreementFieldsDto })
  @ValidateIf((_object, value) => value !== undefined)
  @IsObject()
  @ValidateNested()
  @Type(() => AgreementFieldsDto)
  initialAgreement?: AgreementFieldsDto;

  @ApiProperty({ example: '测试客户甲', maxLength: 200 })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @ApiPropertyOptional({ maxLength: 100 })
  @Transform(trim)
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MaxLength(100)
  category?: string;

  @ApiPropertyOptional({ maxLength: 100 })
  @Transform(trim)
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MaxLength(100)
  region?: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @Transform(trim)
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MaxLength(500)
  duplicateNameReason?: string;
}

export class UpdateCustomerDraftDto extends AdmissionContactFieldsDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @ApiPropertyOptional({ example: '测试客户甲', maxLength: 200 })
  @Transform(trim)
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional({ maxLength: 50 })
  @Transform(trim)
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MaxLength(50)
  customerType?: string;

  @ApiPropertyOptional({ maxLength: 50 })
  @Transform(trim)
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MaxLength(50)
  identityType?: string;

  @ApiPropertyOptional({ maxLength: 100 })
  @Transform(trim)
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MaxLength(100)
  identityNumber?: string;

  @ApiPropertyOptional({ maxLength: 100 })
  @Transform(trim)
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MaxLength(100)
  issuingCountryOrRegion?: string;

  @ApiPropertyOptional({ maxLength: 100 })
  @Transform(trim)
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MaxLength(100)
  category?: string;

  @ApiPropertyOptional({ maxLength: 100 })
  @Transform(trim)
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MaxLength(100)
  region?: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @Transform(trim)
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MaxLength(500)
  duplicateNameReason?: string;
}

export class CustomerDuplicatesQueryDto {
  @ApiPropertyOptional({ maxLength: 200 })
  @Transform(trim)
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional({ maxLength: 50 })
  @Transform(trim)
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MaxLength(50)
  identityType?: string;

  @ApiPropertyOptional({ maxLength: 100 })
  @Transform(trim)
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MaxLength(100)
  identityNumber?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @ValidateIf((_object, value) => value !== undefined)
  @IsUUID('4')
  excludeCustomerId?: string;
}

export class CustomerListQueryDto {
  @ApiPropertyOptional({ maxLength: 200 })
  @Transform(trim)
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MaxLength(200)
  q?: string;

  @ApiPropertyOptional({ enum: ['COOPERATING', 'PAUSED', 'TERMINATED'] })
  @ValidateIf((_object, value) => value !== undefined)
  @IsIn(['COOPERATING', 'PAUSED', 'TERMINATED'])
  cooperationStatus?: 'COOPERATING' | 'PAUSED' | 'TERMINATED';

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;
}
