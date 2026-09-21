import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsDateString,
  IsEmail,
  IsIn,
  IsInt,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;
const dateOnlyPattern = /^\d{4}-\d{2}-\d{2}$/u;
const admissionPhonePattern = /^(?=(?:\D*\d){6,20}\D*$)[+()\d\s-]+$/u;

export const CUSTOMER_TYPE_CODES = [
  'ENTERPRISE',
  'SOLE_PROPRIETOR',
  'NATURAL_PERSON',
  'PUBLIC_INSTITUTION',
  'SOCIAL_ORGANIZATION',
  'OTHER_ORGANIZATION',
] as const;
export type CustomerTypeCode = (typeof CUSTOMER_TYPE_CODES)[number];

export const IDENTITY_TYPE_CODES = [
  'BUSINESS_LICENSE',
  'VERIFIED_E_BUSINESS_LICENSE',
  'NATIONAL_ID',
  'PASSPORT',
  'OTHER_VALID_ID',
  'ORGANIZATION_REGISTRATION_CERTIFICATE',
] as const;
export type IdentityTypeCode = (typeof IDENTITY_TYPE_CODES)[number];

export const CUSTOMER_IDENTITY_COMPATIBILITY = {
  ENTERPRISE: ['BUSINESS_LICENSE', 'VERIFIED_E_BUSINESS_LICENSE'],
  SOLE_PROPRIETOR: ['BUSINESS_LICENSE', 'VERIFIED_E_BUSINESS_LICENSE'],
  NATURAL_PERSON: ['NATIONAL_ID', 'PASSPORT', 'OTHER_VALID_ID'],
  PUBLIC_INSTITUTION: ['ORGANIZATION_REGISTRATION_CERTIFICATE'],
  SOCIAL_ORGANIZATION: ['ORGANIZATION_REGISTRATION_CERTIFICATE'],
  OTHER_ORGANIZATION: ['ORGANIZATION_REGISTRATION_CERTIFICATE'],
} as const satisfies Record<CustomerTypeCode, readonly IdentityTypeCode[]>;

export const IDENTITY_VALIDITY_MODES = [
  'FIXED',
  'LONG_TERM',
  'NOT_STATED',
] as const;
export type IdentityValidityModeCode = (typeof IDENTITY_VALIDITY_MODES)[number];

export class AdmitCustomerDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @ApiProperty({ enum: CUSTOMER_TYPE_CODES })
  @IsIn(CUSTOMER_TYPE_CODES)
  customerType!: CustomerTypeCode;

  @ApiProperty({ maxLength: 200 })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @ApiProperty({ enum: IDENTITY_TYPE_CODES })
  @IsIn(IDENTITY_TYPE_CODES)
  identityType!: IdentityTypeCode;

  @ApiProperty({ maxLength: 100 })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  identityNumber!: string;

  @ApiPropertyOptional({ maxLength: 100 })
  @Transform(trim)
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  issuingCountryOrRegion?: string;

  @ApiPropertyOptional({ format: 'date' })
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @Matches(dateOnlyPattern)
  @IsDateString({ strict: true })
  identityValidFrom?: string;

  @ApiPropertyOptional({ format: 'date' })
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @Matches(dateOnlyPattern)
  @IsDateString({ strict: true })
  identityValidTo?: string;

  @ApiProperty({ enum: IDENTITY_VALIDITY_MODES })
  @IsIn(IDENTITY_VALIDITY_MODES)
  identityValidityMode!: IdentityValidityModeCode;

  @ApiProperty({ maxLength: 100 })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  admissionContactName!: string;

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

  @ApiProperty({ type: [String], minItems: 1, maxItems: 10 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  identityDocumentContentVersionIds!: string[];
}
