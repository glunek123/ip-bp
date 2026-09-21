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

export class MaterialContentVersionDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  materialId!: string;

  @ApiProperty()
  originalFilename!: string;

  @ApiProperty()
  mimeType!: string;

  @ApiProperty({ minimum: 0 })
  sizeBytes!: number;

  @ApiProperty({ pattern: '^[a-f0-9]{64}$' })
  sha256!: string;

  @ApiProperty({ enum: ['AVAILABLE'] })
  status!: 'AVAILABLE';

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;
}

export class OwnerMaterialDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: materialOwnerTypes })
  ownerType!: MaterialOwnerTypeValue;

  @ApiProperty({ format: 'uuid' })
  ownerId!: string;

  @ApiProperty({ enum: materialCategories })
  category!: MaterialCategoryValue;

  @ApiProperty({ enum: materialPurposes })
  purpose!: MaterialPurposeValue;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  currentVersionId!: string | null;

  @ApiProperty({ enum: ['ACTIVE'] })
  status!: 'ACTIVE';

  @ApiProperty({ minimum: 1 })
  version!: number;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  deletedAt!: Date | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: Date;

  @ApiProperty({ type: () => [MaterialContentVersionDto] })
  contentVersions!: MaterialContentVersionDto[];
}

export class OwnerMaterialListDto {
  @ApiProperty({ type: () => [OwnerMaterialDto] })
  items!: OwnerMaterialDto[];

  @ApiProperty({ minimum: 0 })
  total!: number;
}
