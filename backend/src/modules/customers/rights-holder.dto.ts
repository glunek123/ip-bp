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

export class CreateAndLinkRightsHolderDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  expectedCustomerVersion!: number;

  @ApiProperty({ maxLength: 200 })
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
  credit?: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @Transform(trim)
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MaxLength(500)
  address?: string;

  @ApiPropertyOptional({ maxLength: 100 })
  @Transform(trim)
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MaxLength(100)
  legalRepresentative?: string;

  @ApiPropertyOptional({ maxLength: 100 })
  @Transform(trim)
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MaxLength(100)
  duty?: string;
}

export class LinkExistingRightsHolderDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  expectedCustomerVersion!: number;

  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  rightsHolderId!: string;
}

export class RightsHolderListQueryDto {
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

export class LinkableRightsHolderQueryDto extends RightsHolderListQueryDto {
  @ApiPropertyOptional({ maxLength: 200 })
  @Transform(trim)
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MaxLength(200)
  query?: string;
}
