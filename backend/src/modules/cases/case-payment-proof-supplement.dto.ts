import { ApiProperty, PickType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsUUID,
} from 'class-validator';
import { RecordEarlyClosureInput } from './case-early-closure.dto';

const lowercaseUuid = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.toLowerCase() : value;

/** This command appends proof without revising a payment
 * or the original closure documents/receipt. The transaction must reauthorize the
 * responsible actor in WAITING_ARCHIVE or ARCHIVED and compare both current version
 * heads under locks, including payment ownership. DTO validation cannot prove those
 * relationships. Neither supplement nor reference write gates are enabled here.
 */
export class SupplementCasePaymentProofInput extends PickType(
  RecordEarlyClosureInput,
  ['idempotencyKey'] as const,
) {
  @ApiProperty({ format: 'uuid' })
  @Transform(lowercaseUuid)
  @IsUUID('4')
  expectedClosureVersionId!: string;

  @ApiProperty({ format: 'uuid' })
  @Transform(lowercaseUuid)
  @IsUUID('4')
  paymentId!: string;

  @ApiProperty({ format: 'uuid' })
  @Transform(lowercaseUuid)
  @IsUUID('4')
  expectedPaymentVersionId!: string;

  // Matches the supplement migration's cardinality bound, not the payment count.
  @ApiProperty({ type: [String], format: 'uuid', minItems: 1, maxItems: 10 })
  @Transform(({ value }: { value: unknown }) =>
    Array.isArray(value)
      ? value.map((id: unknown) => lowercaseUuid({ value: id }))
      : value,
  )
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  contentVersionIds!: string[];
}
