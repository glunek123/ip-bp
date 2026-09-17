import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsInt,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class CreateCustomerDraftDto {
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

export class UpdateCustomerDraftDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @ApiPropertyOptional({ example: '测试客户甲', maxLength: 200 })
  @Transform(trim)
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MinLength(1)
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
