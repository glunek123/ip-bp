import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;
const phonePattern = /^(?=(?:\D*\d){6,20}\D*$)[+()\d\s-]+$/u;

export class ContactListQueryDto {
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
  @ApiPropertyOptional({ enum: ['ACTIVE', 'ENDED'] })
  @ValidateIf((_o, v) => v !== undefined)
  @IsIn(['ACTIVE', 'ENDED'])
  status?: 'ACTIVE' | 'ENDED';
}

export class ContactVersionListQueryDto {
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

class ContactFieldsDto {
  @ApiPropertyOptional({ maxLength: 100 })
  @Transform(trim)
  @ValidateIf((_o, v) => v !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;
  @ApiPropertyOptional({ type: String, maxLength: 30, nullable: true })
  @Transform(trim)
  @ValidateIf((_o, v) => v !== undefined && v !== null)
  @IsString()
  @Matches(phonePattern)
  @MaxLength(30)
  phone?: string | null;
  @ApiPropertyOptional({ type: String, maxLength: 254, nullable: true })
  @Transform(trim)
  @ValidateIf((_o, v) => v !== undefined && v !== null)
  @IsEmail()
  @MaxLength(254)
  email?: string | null;
  @ApiPropertyOptional({ type: String, maxLength: 500, nullable: true })
  @Transform(trim)
  @ValidateIf((_o, v) => v !== undefined && v !== null)
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  duty?: string | null;
}

export class CreateContactDto extends ContactFieldsDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  expectedCustomerVersion!: number;
  @ApiProperty({ maxLength: 100 })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  declare name: string;
  @ApiPropertyOptional({ default: false })
  @ValidateIf((_o, v) => v !== undefined)
  @IsBoolean()
  isPrimary?: boolean;
}

export class UpdateContactDto extends ContactFieldsDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  expectedCustomerVersion!: number;
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedContactVersion!: number;
}

export class SetContactPrimaryDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  expectedCustomerVersion!: number;
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedContactVersion!: number;
  @ApiProperty() @IsBoolean() primary!: boolean;
}

export class EndContactDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  expectedCustomerVersion!: number;
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedContactVersion!: number;
  @ApiPropertyOptional({ maxLength: 500 })
  @Transform(trim)
  @ValidateIf((_o, v) => v !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason?: string;
}
