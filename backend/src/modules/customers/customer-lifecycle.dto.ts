import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsInt,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class CustomerDraftLifecycleDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @ApiPropertyOptional({ maxLength: 500 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason?: string;
}
