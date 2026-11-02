import { ApiProperty, OmitType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsDefined,
  IsDateString,
  IsIn,
  IsInt,
  Min,
  Max,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateBy,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  RecordEarlyClosureInput,
  EarlyClosurePaymentInput,
} from './case-early-closure.dto';

export class SettlementUpdateRefundItemInput {
  @IsUUID('4') itemId!: string;
  @IsIn(['COURT', 'DEFENDANT']) party!: 'COURT' | 'DEFENDANT';
  @IsIn([
    'UNKNOWN',
    'PENDING',
    'SUBMITTED',
    'RETURNED_UNSETTLED',
    'SETTLED',
    'RECEIVED',
    'CONVERTED_TO_COST',
  ])
  @ValidateBy({
    name: 'courtCannotConvertToCost',
    validator: {
      validate(value: unknown, args) {
        return (
          value !== 'CONVERTED_TO_COST' ||
          (args?.object as SettlementUpdateRefundItemInput).party ===
            'DEFENDANT'
        );
      },
    },
  })
  status!:
    | 'UNKNOWN'
    | 'PENDING'
    | 'SUBMITTED'
    | 'RETURNED_UNSETTLED'
    | 'SETTLED'
    | 'RECEIVED'
    | 'CONVERTED_TO_COST';
  @IsString() @MaxLength(1000) @Matches(/\S/u) description!: string;
  @IsOptional()
  @Matches(/^(?:0|[1-9]\d{0,13})(?:\.\d{1,2})?$/u)
  amount?: string | null;
}
export class SettlementUpdateRefundInput {
  @IsDefined()
  @ValidateIf((_o, value) => value !== null)
  @IsUUID('4')
  expectedVersionId!: string | null;
  @ValidateBy({
    name: 'confirmationNeedsPriorInventory',
    validator: {
      validate(value: unknown, args) {
        return (
          value !== 'CONFIRM_COMPLETE' ||
          typeof (args?.object as SettlementUpdateRefundInput)
            .expectedVersionId === 'string'
        );
      },
    },
  })
  @IsIn(['RECORD', 'CONFIRM_COMPLETE', 'DECLARE_NOT_APPLICABLE'])
  kind!: 'RECORD' | 'CONFIRM_COMPLETE' | 'DECLARE_NOT_APPLICABLE';
  @ValidateBy({
    name: 'refundItemsMatchCommand',
    validator: {
      validate(value: unknown, args) {
        const kind = (args?.object as SettlementUpdateRefundInput).kind;
        return kind === 'CONFIRM_COMPLETE'
          ? value === undefined
          : Array.isArray(value) &&
              (kind !== 'DECLARE_NOT_APPLICABLE' || value.length === 0);
      },
    },
  })
  @ValidateIf((o) => o.kind !== 'CONFIRM_COMPLETE' || o.items !== undefined)
  @IsArray()
  @ArrayUnique((item: unknown) =>
    typeof item === 'object' &&
    item !== null &&
    'itemId' in item &&
    typeof item.itemId === 'string'
      ? item.itemId.toLowerCase()
      : item,
  )
  @ValidateNested({ each: true })
  @Type(() => SettlementUpdateRefundItemInput)
  items?: SettlementUpdateRefundItemInput[];
}
export class SettlementAmountOverrideInput {
  @IsIn(['KEEP', 'AUTOMATIC', 'MANUAL'])
  mode!: 'KEEP' | 'AUTOMATIC' | 'MANUAL';

  @ValidateBy({
    name: 'manualAmountOnly',
    validator: {
      validate(value: unknown, args) {
        return (args?.object as SettlementAmountOverrideInput).mode === 'MANUAL'
          ? typeof value === 'string' &&
              /^(0|[1-9]\d{0,15})(?:\.\d{1,2})?$/u.test(value)
          : value === undefined;
      },
    },
  })
  amount?: string;
}
export class SettlementUpdateAssessmentInput {
  @ValidateIf((_o, value) => value !== undefined)
  @IsDefined()
  @ValidateNested()
  @Type(() => SettlementAmountOverrideInput)
  customerAmount?: SettlementAmountOverrideInput;
  @ValidateIf((_o, value) => value !== undefined)
  @IsDefined()
  @ValidateNested()
  @Type(() => SettlementAmountOverrideInput)
  lawyerAmount?: SettlementAmountOverrideInput;
  // Hidden optimistic concurrency preconditions populated from the authorized read model.
  // The future transaction must compare BOTH values under its locks; mismatch means refresh.
  @IsDefined()
  @ValidateIf((_o, value) => value !== null)
  @IsUUID('4')
  expectedAssessmentVersionId!: string | null;
  @IsDefined()
  @ValidateIf((_o, value) => value !== null)
  @IsInt()
  @Min(1)
  @Max(2147483647)
  expectedTermsVersion!: number | null;

  @IsIn(['UNKNOWN', 'APPLICABLE', 'NOT_APPLICABLE']) declaration!:
    'UNKNOWN' | 'APPLICABLE' | 'NOT_APPLICABLE';
}
/** Omitted refund/assessment commands preserve prior versions; omission never declares non-applicability.
 * Payment records are additive. Existing-payment correction/void use their separate command contract.
 * The settlement-update controller/coordinator owns authorization, transaction and receipt handling.
 */
export class UpdateClosureSettlementInput extends OmitType(
  RecordEarlyClosureInput,
  ['expectedStage', 'closeAt'] as const,
) {
  @ApiProperty({ type: String, nullable: true, format: 'date' })
  @ValidateIf((_o, value) => value !== null)
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/u)
  closeAt!: string | null;

  @IsUUID('4') expectedClosureVersionId!: string;
  @IsOptional() @IsString() @MaxLength(500) @Matches(/\S/u) correctionReason?:
    string | null;
  @ValidateIf((_o, value) => value !== undefined)
  @IsDefined()
  @ValidateNested()
  @Type(() => SettlementUpdateRefundInput)
  refund?: SettlementUpdateRefundInput;
  @ValidateIf((_o, value) => value !== undefined)
  @IsDefined()
  @ValidateNested()
  @Type(() => SettlementUpdateAssessmentInput)
  settlement?: SettlementUpdateAssessmentInput;
  declare paymentRecords: EarlyClosurePaymentInput[];
}
export type ClosureSettlementUpdateResult = Readonly<{
  id: string;
  stage: 'WAITING_ARCHIVE';
  version: number;
  closureId: string;
  closureVersionId: string;
  recordedAt: string;
  paymentVersionIds: readonly string[];
  /** Null means this command did not write a refund version; prior history is preserved. */
  refundInventoryVersionId: string | null;
  /** Null means this command did not write an assessment version; prior history is preserved. */
  settlementAssessmentVersionId: string | null;
  settlementTermsChange: SettlementTermsChange | null;
}>;
export type SettlementTermsChange = Readonly<{
  auditEventId: string;
  before: {
    version: number | null;
    customerManualAmount: string | null;
    lawyerManualAmount: string | null;
  };
  after: {
    version: number;
    customerManualAmount: string | null;
    lawyerManualAmount: string | null;
  };
}>;
/** Persist as a dedicated command namespace in the same serializable transaction as every fact.
 * Fingerprint covers the complete canonical request, including omitted-vs-present subcommands,
 * expected versions and exact attachment UUIDs. Reauthorize before replay. Replay returns this
 * original final snapshot, never a mixture with current versions. No successful receipt exists yet.
 */
export type ClosureSettlementUpdateReceiptContract = Readonly<{
  command: 'CLOSURE_SETTLEMENT_UPDATE';
  departmentId: string;
  actorUserId: string;
  caseId: string;
  idempotencyKey: string;
  requestFingerprint: string;
  resultSnapshot: ClosureSettlementUpdateResult;
}>;
