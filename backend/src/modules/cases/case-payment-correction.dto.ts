import { ApiProperty, ApiPropertyOptional, PickType } from '@nestjs/swagger';
import {
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateBy,
  ValidateIf,
} from 'class-validator';
import { RecordEarlyClosureInput } from './case-early-closure.dto';

export class CorrectCasePaymentInput extends PickType(RecordEarlyClosureInput, [
  'idempotencyKey',
] as const) {
  @ApiProperty({ enum: ['CORRECT', 'VOID'] })
  @IsIn(['CORRECT', 'VOID'])
  @ValidateBy({
    name: 'voidHasNoReplacement',
    validator: {
      validate: (value: unknown, args) =>
        value !== 'VOID' ||
        ['paidOn', 'amount', 'payer', 'payee'].every(
          (key) => !Object.hasOwn(args?.object ?? {}, key),
        ),
    },
  })
  kind!: 'CORRECT' | 'VOID';

  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  paymentId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  expectedVersionId!: string;

  @ApiPropertyOptional({ maxLength: 500, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string | null;

  @ApiPropertyOptional({ format: 'date' })
  @ValidateIf((input: CorrectCasePaymentInput) => input.kind === 'CORRECT')
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/u)
  declare paidOn?: string;

  @ApiPropertyOptional()
  @ValidateIf((input: CorrectCasePaymentInput) => input.kind === 'CORRECT')
  @IsString()
  @Matches(/^(?=.*[1-9])(?:0|[1-9]\d{0,13})(?:\.\d{1,2})?$/u)
  declare amount?: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @ValidateIf((input: CorrectCasePaymentInput) => input.kind === 'CORRECT')
  @IsString()
  @Matches(/\S/u)
  @MaxLength(200)
  declare payer?: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @ValidateIf((input: CorrectCasePaymentInput) => input.kind === 'CORRECT')
  @IsString()
  @Matches(/\S/u)
  @MaxLength(200)
  declare payee?: string;
}
