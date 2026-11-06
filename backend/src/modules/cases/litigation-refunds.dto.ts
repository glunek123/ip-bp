import { Type } from 'class-transformer';
import { OmitType } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateBy,
  isUUID,
} from 'class-validator';

export const litigationRefundStatuses = [
  'UNKNOWN',
  'PENDING',
  'SUBMITTED',
  'RETURNED_UNSETTLED',
  'SETTLED',
  'RECEIVED',
  'CONVERTED_TO_COST',
] as const;
export type LitigationRefundStatus = (typeof litigationRefundStatuses)[number];
export type LitigationRefundSourceType = 'JUDGMENT' | 'SECOND_INSTANCE_RESULT';

export class LitigationRefundListQuery {
  @IsOptional() @IsString() @MaxLength(200) plaintiff?: string;
  @IsOptional() @IsString() @MaxLength(200) defendant?: string;
  @IsOptional() @IsString() @MaxLength(100) courtNo?: string;
  @IsOptional() @IsString() @MaxLength(200) lawyer?: string;
  @IsOptional() @IsIn(litigationRefundStatuses) status?: LitigationRefundStatus;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 20;
}

export class RegisterLitigationRefundInput {
  @IsUUID('4') itemId!: string;
  @ValidateBy({
    name: 'nullableInventoryVersion',
    validator: {
      validate(value: unknown) {
        return value === null || (typeof value === 'string' && isUUID(value, '4'));
      },
    },
  })
  expectedInventoryVersionId!: string | null;
  @IsIn(['JUDGMENT', 'SECOND_INSTANCE_RESULT'])
  sourceType!: LitigationRefundSourceType;
  @IsUUID('4') sourceId!: string;
  @IsIn(['COURT', 'DEFENDANT']) party!: 'COURT' | 'DEFENDANT';
  @ValidateBy({
    name: 'knownOrUnknownRefundAmount',
    validator: {
      validate(value: unknown) {
        return value === null ||
          (typeof value === 'string' &&
            /^(?:0|[1-9]\d{0,13})(?:\.\d{1,2})?$/u.test(value));
      },
    },
  })
  amount!: string | null;
  @IsString() @MaxLength(1000) @Matches(/\S/u) description!: string;
  @IsString() @MaxLength(1000) @Matches(/\S/u) reason!: string;
  @IsString() @MaxLength(128) @Matches(/^\S(?:[\s\S]{0,126}\S)?$/u)
  idempotencyKey!: string;
}

export class CorrectLitigationRefundInput extends OmitType(
  RegisterLitigationRefundInput,
  ['itemId'] as const,
) {}

export class FollowLitigationRefundInput {
  @IsUUID('4') expectedInventoryVersionId!: string;
  @IsIn(litigationRefundStatuses) status!: LitigationRefundStatus;
  @ValidateBy({
    name: 'nullableRefundRemark',
    validator: {
      validate(value: unknown) {
        return value === null || (typeof value === 'string' && value.length <= 1000);
      },
    },
  })
  remark!: string | null;
  @ValidateBy({
    name: 'nullableRefundReason',
    validator: {
      validate(value: unknown) {
        return value === null || (typeof value === 'string' && value.length <= 1000);
      },
    },
  })
  reason!: string | null;
  @IsString() @MaxLength(128) @Matches(/^\S(?:[\s\S]{0,126}\S)?$/u)
  idempotencyKey!: string;
}
