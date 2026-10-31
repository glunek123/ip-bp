import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { SettlementSideDtoValue } from './settlement.dto';

export const settlementActualPositiveMoney =
  /^(?:[1-9]\d{0,15}(?:\.\d{1,2})?|0\.(?:0[1-9]|[1-9]\d?))$/u;
const financialDay = /^\d{4}-\d{2}-\d{2}$/u;

export class CreateSettlementActualFactDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') caseId!: string;
  @ApiProperty({ enum: SettlementSideDtoValue })
  @IsEnum(SettlementSideDtoValue)
  side!: SettlementSideDtoValue;
  @ApiPropertyOptional({
    format: 'uuid',
    description: '律师开票时的当前承办律师',
  })
  @IsOptional()
  @IsUUID('4')
  lawyerId?: string;
  @ApiProperty({ pattern: settlementActualPositiveMoney.source })
  @IsString()
  @Matches(settlementActualPositiveMoney)
  amount!: string;
  @ApiProperty({ format: 'date' })
  @IsString()
  @Matches(financialDay)
  occurredOn!: string;
  @ApiPropertyOptional({
    maxLength: 200,
    description: '银行交易号或发票号码等可核对的来源编号',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  sourceReference?: string | null;
  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
  @ApiProperty({ maxLength: 128 })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  idempotencyKey!: string;
}

/** Entire recorded amount belongs to this case; no second allocation request is needed. */
export class RegisterCaseSettlementActualDto extends CreateSettlementActualFactDto {}

export class AllocateSettlementActualFactDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') factId!: string;
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') caseId!: string;
  @ApiProperty({ pattern: settlementActualPositiveMoney.source })
  @IsString()
  @Matches(settlementActualPositiveMoney)
  amount!: string;
  @ApiProperty({ maxLength: 128 })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  idempotencyKey!: string;
}

export class SupplementSettlementActualSourceDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') factId!: string;
  @ApiProperty({ maxLength: 200, description: '后补的银行交易号或发票号码' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  sourceReference!: string;
  @ApiProperty({ maxLength: 128 })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  idempotencyKey!: string;
}

export class SettlementActualCandidatesDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') caseId!: string;
}
