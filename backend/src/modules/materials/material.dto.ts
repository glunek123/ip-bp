import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export const materialOwnerTypes = ['CUSTOMER', 'LEAD_DRAFT', 'LEAD'] as const;
export type MaterialOwnerTypeValue = (typeof materialOwnerTypes)[number];
export const materialCategories = [
  'CUSTOMER_IDENTITY',
  'LEAD_SCREENSHOT',
] as const;
export type MaterialCategoryValue = (typeof materialCategories)[number];
export const materialPurposes = [
  'IDENTITY_FULL',
  'IDENTITY_FRONT',
  'IDENTITY_BACK',
  'LEAD_SCREENSHOT',
] as const;
export type MaterialPurposeValue = (typeof materialPurposes)[number];

export class CreateUploadDraftDto {
  @ApiProperty({ enum: ['CUSTOMER', 'LEAD_DRAFT'] })
  @IsIn(['CUSTOMER', 'LEAD_DRAFT'])
  ownerType!: Extract<MaterialOwnerTypeValue, 'CUSTOMER' | 'LEAD_DRAFT'>;

  @ApiPropertyOptional({ format: 'uuid' })
  @ValidateIf((_object, value) => value !== undefined)
  @IsUUID('4')
  ownerId?: string;

  @ApiProperty({ enum: materialCategories })
  @IsIn(materialCategories)
  category!: MaterialCategoryValue;

  @ApiProperty({ enum: materialPurposes })
  @IsIn(materialPurposes)
  purpose!: MaterialPurposeValue;

  @ApiProperty({ maxLength: 200 })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  originalFilename!: string;

  @ApiProperty({ maxLength: 100 })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  declaredMimeType!: string;
}

export class MaterialListQueryDto {
  @ApiProperty({ enum: materialOwnerTypes })
  @IsIn(materialOwnerTypes)
  ownerType!: MaterialOwnerTypeValue;

  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  ownerId!: string;
}

export class MaterialVersionQueryDto {
  @ApiProperty({ minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

export class RestoreMaterialDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}
