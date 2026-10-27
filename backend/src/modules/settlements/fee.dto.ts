import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

export const feeTypes = [
  '诉讼费',
  '保全费',
  '保全保费',
  '公告费',
  '调档费',
  '调查费',
  '公证费',
  '披露费',
  '样品费',
  '样品费退款',
  '退货运费',
  '律师费',
  '诉讼退费',
  '其他',
] as const;
export const feeDirections = ['支出', '收入'] as const;
export const ordinaryFeeStatuses = ['未发起', '发起', '已支付'] as const;
export const refundFeeStatuses = ['退原告', '退律所'] as const;

const moneyPattern = /^(?:[1-9]\d{0,15}(?:\.\d{1,2})?|0\.(?:0[1-9]|[1-9]\d))$/u;
const dayPattern = /^\d{4}-\d{2}-\d{2}$/u;

export class FeePageDto {
  @ApiPropertyOptional({ type: String, format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  caseId?: string;
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
  @ApiPropertyOptional({ enum: feeTypes })
  @IsOptional()
  @IsIn(feeTypes)
  type?: (typeof feeTypes)[number];
  @ApiPropertyOptional({ enum: [...ordinaryFeeStatuses, ...refundFeeStatuses] })
  @IsOptional()
  @IsIn([...ordinaryFeeStatuses, ...refundFeeStatuses])
  status?: string;
  @ApiPropertyOptional({ enum: feeDirections })
  @IsOptional()
  @IsIn(feeDirections)
  direction?: (typeof feeDirections)[number];
  @ApiPropertyOptional({ type: String, format: 'date' })
  @IsOptional()
  @Matches(dayPattern)
  from?: string;
  @ApiPropertyOptional({ type: String, format: 'date' })
  @IsOptional()
  @Matches(dayPattern)
  to?: string;
}

export class CancelledFeePageDto extends FeePageDto {
  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  businessNo?: string;
}

export class FeeCaseOptionsDto {
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
  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  query?: string;
}

export class CreateFeeDto {
  @ApiProperty({ type: String, format: 'uuid' }) @IsUUID('4') caseId!: string;
  @ApiProperty({ enum: feeTypes })
  @IsIn(feeTypes)
  type!: (typeof feeTypes)[number];
  @ApiProperty({ enum: feeDirections })
  @IsIn(feeDirections)
  direction!: (typeof feeDirections)[number];
  @ApiProperty({ pattern: moneyPattern.source })
  @IsString()
  @Matches(moneyPattern)
  amount!: string;
  @ApiProperty({ enum: [...ordinaryFeeStatuses, ...refundFeeStatuses] })
  @IsIn([...ordinaryFeeStatuses, ...refundFeeStatuses])
  status!: string;
  @ApiProperty({ type: String, format: 'date' })
  @Matches(dayPattern)
  feeDate!: string;
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

export class UpdateFeeDto {
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion!: number;
  @ApiPropertyOptional({ enum: feeDirections })
  @IsOptional()
  @IsIn(feeDirections)
  direction?: (typeof feeDirections)[number];
  @ApiPropertyOptional({ enum: [...ordinaryFeeStatuses, ...refundFeeStatuses] })
  @IsOptional()
  @IsIn([...ordinaryFeeStatuses, ...refundFeeStatuses])
  status?: string;
  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class FeeIdsDto {
  @ApiProperty({ type: [String], format: 'uuid' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  ids!: string[];
  @ApiProperty({ maxLength: 128 })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  idempotencyKey!: string;
}

export class UpdateFeeProofDto {
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion!: number;
  @ApiProperty({ format: 'uuid', nullable: true })
  @ValidateIf((_object, value) => value !== null)
  @IsUUID('4')
  materialId!: string | null;
  @ApiProperty({ format: 'uuid', nullable: true })
  @ValidateIf((_object, value) => value !== null)
  @IsUUID('4')
  contentVersionId!: string | null;
  @ApiProperty({ maxLength: 128 })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  idempotencyKey!: string;
}

export class CancelFeeDto {
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion!: number;
  @ApiProperty({ maxLength: 128 })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  idempotencyKey!: string;
  @ApiProperty({ maxLength: 500 })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason!: string;
}

const nonnegativeMoneyPattern =
  /^(?:0(?:\.00)?|[1-9]\d{0,15}(?:\.\d{1,2})?|0\.(?:0[1-9]|[1-9]\d))$/u;

export class VerifyCancelledFeePaymentDto {
  @ApiProperty({ pattern: nonnegativeMoneyPattern.source })
  @IsString()
  @Matches(nonnegativeMoneyPattern)
  amount!: string;
  @ApiProperty({ type: String, format: 'date', nullable: true })
  @ValidateIf((_object, value) => value !== null)
  @Matches(dayPattern)
  paymentDate!: string | null;
  @ApiProperty({ format: 'uuid', nullable: true })
  @ValidateIf((_object, value) => value !== null)
  @IsUUID('4')
  proofMaterialId!: string | null;
  @ApiProperty({ format: 'uuid', nullable: true })
  @ValidateIf((_object, value) => value !== null)
  @IsUUID('4')
  proofContentVersionId!: string | null;
  @ApiProperty({ maxLength: 128 })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  idempotencyKey!: string;
}

export class ReconcileCancelledFeeRefundDto {
  @ApiProperty({ pattern: moneyPattern.source })
  @IsString()
  @Matches(moneyPattern)
  amount!: string;
  @ApiProperty({ type: String, format: 'date' })
  @Matches(dayPattern)
  refundDate!: string;
  @ApiProperty({ format: 'uuid', nullable: true })
  @ValidateIf((_object, value) => value !== null)
  @IsUUID('4')
  proofMaterialId!: string | null;
  @ApiProperty({ format: 'uuid', nullable: true })
  @ValidateIf((_object, value) => value !== null)
  @IsUUID('4')
  proofContentVersionId!: string | null;
  @ApiProperty({ maxLength: 128 })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  idempotencyKey!: string;
}
