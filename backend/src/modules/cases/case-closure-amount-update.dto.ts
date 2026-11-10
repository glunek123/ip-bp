import { Type } from 'class-transformer';
import {
  IsDefined,
  IsInt,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateBy,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { IsIn, IsOptional } from 'class-validator';
import { SettlementAmountOverrideInput } from './case-closure-settlement-update.dto';

export class ClosureAmountUpdateInput {
  @IsString()
  @MaxLength(128)
  @Matches(/^\S(?:[\s\S]{0,126}\S)?$/u)
  idempotencyKey!: string;
  @IsUUID('4') expectedClosureVersionId!: string;
  @IsDefined()
  @ValidateIf((_o, v) => v !== null)
  @IsInt()
  @Min(1)
  @Max(2147483646)
  expectedTermsVersion!: number | null;
  @IsDefined()
  @ValidateIf((_o, v) => v !== null)
  @IsUUID('4')
  expectedAssessmentVersionId!: string | null;
  /** 只改声明时可随金额一起提交，避免为了改声明而新建结案版本。 */
  @IsOptional()
  @IsIn(['UNKNOWN', 'APPLICABLE', 'NOT_APPLICABLE'])
  declaration?: 'UNKNOWN' | 'APPLICABLE' | 'NOT_APPLICABLE';
  @IsDefined()
  @ValidateNested()
  @Type(() => SettlementAmountOverrideInput)
  @ValidateBy({
    name: 'atLeastOneAmountChange',
    validator: {
      validate(_v, args) {
        const x = args?.object as ClosureAmountUpdateInput;
        return [x.customerAmount, x.lawyerAmount].some(
          (v) => v?.mode === 'MANUAL' || v?.mode === 'AUTOMATIC',
        );
      },
    },
  })
  customerAmount!: SettlementAmountOverrideInput;
  @IsDefined()
  @ValidateNested()
  @Type(() => SettlementAmountOverrideInput)
  lawyerAmount!: SettlementAmountOverrideInput;
}
