import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
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

export const rightAssetTypes = [
  'TRADEMARK',
  'PATENT',
  'COPYRIGHT',
  'REPUTATION',
  'AUTHORIZATION',
  'OTHER',
] as const;
export const rightAssetValidityModes = [
  'FIXED',
  'LONG_TERM',
  'UNKNOWN',
] as const;
const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class RightAssetFieldsDto {
  @ApiProperty({ enum: rightAssetTypes })
  @IsEnum(rightAssetTypes)
  type!: (typeof rightAssetTypes)[number];

  @ApiProperty({ maxLength: 200 })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @ApiPropertyOptional({ nullable: true, maxLength: 200 })
  @Transform(trim)
  @ValidateIf((_object, value) => value !== null && value !== undefined)
  @IsString()
  @MaxLength(200)
  number?: string | null;

  @ApiProperty({ maxLength: 200 })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  category!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  holderId!: string;

  @ApiPropertyOptional({ nullable: true, maxLength: 200 })
  @Transform(trim)
  @ValidateIf((_object, value) => value !== null && value !== undefined)
  @IsString()
  @MaxLength(200)
  ownerText?: string | null;

  @ApiPropertyOptional({ nullable: true, maxLength: 100 })
  @Transform(trim)
  @ValidateIf((_object, value) => value !== null && value !== undefined)
  @IsString()
  @MaxLength(100)
  trademarkClass?: string | null;

  @ApiPropertyOptional({ nullable: true, pattern: '^\\d{4}-\\d{2}-\\d{2}$' })
  @ValidateIf((_object, value) => value !== null && value !== undefined)
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  validFrom?: string | null;

  @ApiPropertyOptional({ nullable: true, pattern: '^\\d{4}-\\d{2}-\\d{2}$' })
  @ValidateIf((_object, value) => value !== null && value !== undefined)
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  validTo?: string | null;

  @ApiProperty({ enum: rightAssetValidityModes })
  @IsEnum(rightAssetValidityModes)
  validityMode!: (typeof rightAssetValidityModes)[number];
}

export class CreateRightAssetDto extends RightAssetFieldsDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  expectedCustomerVersion!: number;
}

export class ReviseRightAssetDto extends CreateRightAssetDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  expectedAssetVersion!: number;
}

export class WithdrawRightAssetDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  expectedCustomerVersion!: number;

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  expectedAssetVersion!: number;

  @ApiProperty({ maxLength: 500 })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason!: string;
}

export class RightAssetListQueryDto {
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
