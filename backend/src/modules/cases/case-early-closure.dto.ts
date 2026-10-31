import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsDateString,
  IsDefined,
  IsIn,
  IsInt,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateBy,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

// Contract only. No controller exposes this command until its database source
// and terminal guards have been extended and verified together.
export const EARLY_CLOSURE_SOURCE_STAGES = [
  'PENDING_MATCH',
  'WAITING_COMPLAINT',
  'WAITING_COMPLAINT_CONFIRMATION',
  'WAITING_COMPLAINT_STAMP',
  'WAITING_FILING',
  'WAITING_FORMAL_ACCEPTANCE',
  'WAITING_HEARING',
  'WAITING_JUDGMENT',
  'SECOND_INSTANCE',
  'WAITING_EXECUTION_DOCUMENTS',
  'WAITING_EXECUTION_CONFIRMATION',
  'WAITING_EXECUTION_STAMP',
  'WAITING_EXECUTION_FILING',
  'EXECUTING',
] as const;

export type EarlyClosureSourceStage =
  (typeof EARLY_CLOSURE_SOURCE_STAGES)[number];

export function isEarlyClosureSourceStage(
  stage: string,
): stage is EarlyClosureSourceStage {
  return (EARLY_CLOSURE_SOURCE_STAGES as readonly string[]).includes(stage);
}

export class EarlyClosurePaymentInput {
  @ApiProperty({ format: 'date' })
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/u)
  paidOn!: string;

  @ApiProperty({ pattern: '^(?=.*[1-9])\\d{1,14}(?:\\.\\d{1,2})?$' })
  @IsString()
  @Matches(/^(?=.*[1-9])\d{1,14}(?:\.\d{1,2})?$/u, {
    message: '付款金额须大于零，最多两位小数',
  })
  amount!: string;

  @ApiProperty({ maxLength: 200 })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  @Matches(/\S/u)
  payer!: string;

  @ApiProperty({ maxLength: 200 })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  @Matches(/\S/u)
  payee!: string;

  @ApiProperty({ type: String, nullable: true, format: 'uuid' })
  @IsDefined()
  @ValidateIf((_input, value) => value !== null)
  @IsUUID('4')
  screenshotContentVersionId!: string | null;
}

export class RecordEarlyClosureInput {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  expectedVersion!: number;

  @ApiProperty({ enum: EARLY_CLOSURE_SOURCE_STAGES })
  @IsIn(EARLY_CLOSURE_SOURCE_STAGES)
  expectedStage!: EarlyClosureSourceStage;

  @ApiProperty({ minLength: 1, maxLength: 128 })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  @Matches(/^\S(?:[\s\S]*\S)?$/u)
  idempotencyKey!: string;

  @ApiProperty({ format: 'date' })
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/u)
  closeAt!: string;

  @ApiProperty({ enum: ['KNOWN', 'PENDING'] })
  @IsIn(['KNOWN', 'PENDING'])
  closeAmountState!: 'KNOWN' | 'PENDING';

  @ApiProperty({
    type: String,
    nullable: true,
    pattern: '^\\d{1,14}(?:\\.\\d{1,2})?$',
  })
  @ValidateBy({
    name: 'earlyClosureAmountMatchesState',
    validator: {
      validate(value: unknown, args) {
        const state = (args?.object as RecordEarlyClosureInput | undefined)
          ?.closeAmountState;
        return state === 'PENDING'
          ? value === null
          : state === 'KNOWN' &&
              typeof value === 'string' &&
              /^\d{1,14}(?:\.\d{1,2})?$/u.test(value);
      },
    },
  })
  closeAmt!: string | null;

  @ApiProperty({ type: [String], format: 'uuid', maxItems: 10 })
  @IsArray()
  @ArrayMaxSize(10)
  @ArrayUnique((id: unknown) =>
    typeof id === 'string' ? id.toLowerCase() : id,
  )
  @IsUUID('4', { each: true })
  closeContentVersionIds!: string[];

  @ApiProperty({ enum: ['ONE_TIME', 'INSTALLMENTS'] })
  @IsIn(['ONE_TIME', 'INSTALLMENTS'])
  paymentType!: 'ONE_TIME' | 'INSTALLMENTS';

  @ApiProperty({
    type: [EarlyClosurePaymentInput],
    description: 'May be empty when no payment has been received',
  })
  @IsDefined()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateBy({
    name: 'earlyClosurePaymentTypeMatchesRecords',
    validator: {
      validate(value: unknown, args) {
        const type = (args?.object as RecordEarlyClosureInput | undefined)
          ?.paymentType;
        return (
          Array.isArray(value) && (type !== 'ONE_TIME' || value.length <= 1)
        );
      },
    },
  })
  @ValidateNested({ each: true })
  @Type(() => EarlyClosurePaymentInput)
  paymentRecords!: EarlyClosurePaymentInput[];
}
