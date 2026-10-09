import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsDefined,
  IsInt,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

const moneyPattern = /^(0|[1-9]\d{0,15})(?:\.\d{1,2})?$/u;
const dayPattern = /^\d{4}-\d{2}-\d{2}$/u;

export class CustomerSettlementPageDto {
  @ApiPropertyOptional({ default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 20, maximum: 100 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;
}

class SettlementRequiredFactsDto {
  @ApiProperty({ type: String, format: 'date' })
  @IsString()
  @Matches(dayPattern)
  settlementDate!: string;

  @ApiProperty({ type: String, pattern: moneyPattern.source })
  @IsString()
  @Matches(moneyPattern)
  settlementAmount!: string;
}

export class RegisterCustomerSettlementDto extends SettlementRequiredFactsDto {
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    pattern: moneyPattern.source,
  })
  @ValidateIf((_o, value) => value !== undefined && value !== null)
  @IsString()
  @Matches(moneyPattern)
  invoiceAmount?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    pattern: moneyPattern.source,
  })
  @ValidateIf((_o, value) => value !== undefined && value !== null)
  @IsString()
  @Matches(moneyPattern)
  receivedAmount?: string | null;

  @ApiPropertyOptional({ type: String, format: 'date', nullable: true })
  @ValidateIf((_o, value) => value !== undefined && value !== null)
  @IsString()
  @Matches(dayPattern)
  receivedDate?: string | null;

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  expectedCustomerVersion!: number;
}

export class CorrectCustomerSettlementDto extends SettlementRequiredFactsDto {
  @ApiProperty({ type: String, nullable: true, pattern: moneyPattern.source })
  @ValidateIf((_o, value) => value !== null)
  @IsDefined()
  @IsString()
  @Matches(moneyPattern)
  invoiceAmount!: string | null;

  @ApiProperty({ type: String, nullable: true, pattern: moneyPattern.source })
  @ValidateIf((_o, value) => value !== null)
  @IsDefined()
  @IsString()
  @Matches(moneyPattern)
  receivedAmount!: string | null;

  @ApiProperty({ type: String, format: 'date', nullable: true })
  @ValidateIf((_o, value) => value !== null)
  @IsDefined()
  @IsString()
  @Matches(dayPattern)
  receivedDate!: string | null;

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  expectedCustomerVersion!: number;

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  expectedRecordVersion!: number;

  @ApiProperty({ minLength: 1, maxLength: 500 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason!: string;
}
