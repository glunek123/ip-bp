import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  Validate,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

@ValidatorConstraint({ name: 'reviewReasonMatchesResult' })
class ReviewReasonMatchesResult implements ValidatorConstraintInterface {
  validate(_result: unknown, { object }: ValidationArguments): boolean {
    const input = object as ReviewClientLeadDto;
    if (input.result === 'INFRINGEMENT') return input.reason === undefined;
    if (input.result === 'NO_INFRINGEMENT')
      return typeof input.reason === 'string' && input.reason.trim().length > 0;
    return true;
  }
}

export const CLIENT_LEAD_VIEWS = ['PENDING', 'PROCESSED'] as const;
export type ClientLeadView = (typeof CLIENT_LEAD_VIEWS)[number];

export class ClientLeadListQueryDto {
  @ApiPropertyOptional({ enum: CLIENT_LEAD_VIEWS, default: 'PENDING' })
  @IsIn(CLIENT_LEAD_VIEWS)
  view: ClientLeadView = 'PENDING';

  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;
}

export class ReviewClientLeadDto {
  @ApiProperty({ enum: ['INFRINGEMENT', 'NO_INFRINGEMENT'] })
  @IsIn(['INFRINGEMENT', 'NO_INFRINGEMENT'])
  @Validate(ReviewReasonMatchesResult)
  result!: 'INFRINGEMENT' | 'NO_INFRINGEMENT';

  @ApiPropertyOptional({ maxLength: 5000 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  reason?: string;

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}
