import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export const NOTARY_ARCHIVE_TYPES = [
  'LINK_REMOVED',
  'NO_INFRINGEMENT_INFORMATION',
  'NO_EVIDENCE',
  'NOT_SHIPPED_REFUND_ONLY',
  'RECEIVED_KEEP',
  'RECEIVED_RETURN_REFUND',
] as const;
export type NotaryArchiveType = (typeof NOTARY_ARCHIVE_TYPES)[number];

const AMOUNT = /^(0|[1-9]\d{0,15})\.\d{2}$/u;

export class NotaryReturnAmountInputDto {
  @ApiProperty({ enum: ['KNOWN', 'PENDING'] })
  @IsIn(['KNOWN', 'PENDING'])
  state!: 'KNOWN' | 'PENDING';

  @ApiPropertyOptional({ pattern: AMOUNT.source })
  @IsOptional()
  @Matches(AMOUNT)
  amount?: string;

  @ApiPropertyOptional({ enum: ['CUSTOMER', 'FIRM', 'MERCHANT', 'OTHER'] })
  @IsOptional()
  @IsIn(['CUSTOMER', 'FIRM', 'MERCHANT', 'OTHER'])
  partyKind?: 'CUSTOMER' | 'FIRM' | 'MERCHANT' | 'OTHER';

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  partyName?: string;
}

export class ArchiveNotaryReturnDto {
  @ApiPropertyOptional({ enum: ['RETURN', 'KEEP', 'REFUND_ONLY'] })
  @IsOptional()
  @IsIn(['RETURN', 'KEEP', 'REFUND_ONLY'])
  returnChoice?: 'RETURN' | 'KEEP' | 'REFUND_ONLY';

  @ApiPropertyOptional({ enum: NOTARY_ARCHIVE_TYPES })
  @IsOptional()
  @IsIn(NOTARY_ARCHIVE_TYPES)
  archiveType?: NotaryArchiveType;

  @ApiPropertyOptional({ format: 'date' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/u)
  archiveDate?: string;

  @ApiPropertyOptional({ pattern: AMOUNT.source })
  @IsOptional()
  @Matches(AMOUNT)
  notaryFeeAmount?: string;

  @ApiPropertyOptional({ pattern: AMOUNT.source })
  @IsOptional()
  @Matches(AMOUNT)
  sampleFeeAmount?: string;

  @ApiPropertyOptional({ type: NotaryReturnAmountInputDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => NotaryReturnAmountInputDto)
  refund?: NotaryReturnAmountInputDto;

  @ApiPropertyOptional({ type: NotaryReturnAmountInputDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => NotaryReturnAmountInputDto)
  freight?: NotaryReturnAmountInputDto;

  @ApiProperty({ minLength: 1, maxLength: 5000 })
  @IsString()
  @MaxLength(5000)
  archiveReason!: string;

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

export class NotaryReturnAmountSummaryDto {
  @ApiProperty({ enum: ['KNOWN', 'PENDING'] }) state!: 'KNOWN' | 'PENDING';
  @ApiProperty({ nullable: true }) amount!: string | null;
  @ApiProperty({
    enum: ['CUSTOMER', 'FIRM', 'MERCHANT', 'OTHER'],
    nullable: true,
  })
  partyKind!: 'CUSTOMER' | 'FIRM' | 'MERCHANT' | 'OTHER' | null;
  @ApiProperty({ nullable: true }) partyName!: string | null;
}

export class NotaryReturnArchiveSummaryDto {
  @ApiProperty({ enum: ['RETURN', 'KEEP', 'REFUND_ONLY'], nullable: true })
  returnChoice!: NonNullable<ArchiveNotaryReturnDto['returnChoice']> | null;
  @ApiPropertyOptional({ enum: NOTARY_ARCHIVE_TYPES })
  archiveType?: NotaryArchiveType;
  @ApiPropertyOptional({ format: 'date' })
  archiveDate?: string;
  @ApiPropertyOptional()
  notaryFeeAmount?: string;
  @ApiPropertyOptional({ nullable: true })
  sampleFeeAmount?: string | null;
  @ApiProperty() archiveReason!: string;
  @ApiProperty({ format: 'date-time' }) archivedAt!: string;
  @ApiProperty() actorDisplayName!: string;
  @ApiProperty({ type: NotaryReturnAmountSummaryDto, nullable: true })
  refund!: NotaryReturnAmountSummaryDto | null;
  @ApiProperty({ type: NotaryReturnAmountSummaryDto, nullable: true })
  freight!: NotaryReturnAmountSummaryDto | null;
}

export class NotaryReturnArchiveResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: ['ARCHIVED'] }) stage!: 'ARCHIVED';
  @ApiProperty() version!: number;
  @ApiProperty({ type: NotaryReturnArchiveSummaryDto })
  returnArchive!: NotaryReturnArchiveSummaryDto;
}
