import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
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

export class CustomerCooperationDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @ApiProperty({ enum: ['pause', 'terminate', 'resume'] })
  @IsIn(['pause', 'terminate', 'resume'])
  action!: 'pause' | 'terminate' | 'resume';

  @ApiPropertyOptional({ maxLength: 500 })
  @Transform(trim)
  @ValidateIf(
    (input: CustomerCooperationDto) =>
      input.action !== 'resume' || input.reason !== undefined,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason?: string;
}

export class CustomerResponsibleTransferDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  targetUserId!: string;

  @ApiProperty({ minLength: 1, maxLength: 500 })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason!: string;
}
