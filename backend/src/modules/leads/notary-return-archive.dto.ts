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
  @ApiProperty({ enum: ['RETURN', 'KEEP', 'REFUND_ONLY'] })
  @IsIn(['RETURN', 'KEEP', 'REFUND_ONLY'])
  returnChoice!: 'RETURN' | 'KEEP' | 'REFUND_ONLY';

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
  @ApiProperty({ enum: ['RETURN', 'KEEP', 'REFUND_ONLY'] })
  returnChoice!: ArchiveNotaryReturnDto['returnChoice'];
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
