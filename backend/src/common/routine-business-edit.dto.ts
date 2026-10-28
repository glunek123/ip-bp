import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsInt,
  IsString,
  IsUrl,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

/** Only editable values. Product identities and their order stay unchanged. */
export class RoutineBusinessProductDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  id!: string;

  @ApiProperty({ type: String, nullable: true, maxLength: 200 })
  @ValidateIf((_object, value) => value !== null)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string | null;

  @ApiProperty({ type: String, nullable: true, maxLength: 2048 })
  @ValidateIf((_object, value) => value !== null)
  @IsString()
  @MaxLength(2048)
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  url!: string | null;

  @ApiProperty({ minimum: 0, maximum: 2147483647 })
  @IsInt()
  @Min(0)
  @Max(2147483647)
  quantity!: number;

  @ApiProperty({ pattern: '^(0|[1-9]\\d{0,15})(\\.\\d{1,2})?$' })
  @IsString()
  @Matches(/^(0|[1-9]\d{0,15})(\.\d{1,2})?$/u)
  unitPrice!: string;
}

export class RoutineBusinessEditDto {
  @ApiProperty({ minimum: 0, maximum: 2147483646 })
  @IsInt()
  @Min(0)
  @Max(2147483646)
  expectedRevision!: number;

  @ApiProperty({ maxLength: 200 })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  @Matches(/\S/u)
  shopName!: string;

  @ApiProperty({ type: [RoutineBusinessProductDto], maxItems: 100 })
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique((product: unknown) =>
    product !== null && typeof product === 'object' && 'id' in product
      ? product.id
      : product,
  )
  @ValidateNested({ each: true })
  @Type(() => RoutineBusinessProductDto)
  products!: RoutineBusinessProductDto[];
}

export class RoutineBusinessEditWithRemarkDto extends RoutineBusinessEditDto {
  @ApiProperty({ type: String, nullable: true, maxLength: 5000 })
  @ValidateIf((_object, value) => value !== null)
  @IsString()
  @MaxLength(5000)
  remark!: string | null;
}
