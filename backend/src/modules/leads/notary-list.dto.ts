import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { LeadPlatform, CaseStage } from '../../generated/prisma/client';

export const NOTARY_LIST_STAGES = [
  'PENDING_EVIDENCE',
  'WAITING_UNBOX',
  'UNBOX_REVIEW',
  'ISSUANCE_DECISION',
  'WAITING_CERTIFICATE',
  'WAITING_RETURN',
  'ARCHIVED',
] as const;
export type NotaryListStage = (typeof NOTARY_LIST_STAGES)[number];

class NotaryListLeadDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() businessNo!: string;
}

class NotaryListOfficeDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
}

class NotarySourceSummaryDto {
  @ApiProperty({ type: NotaryListOfficeDto }) customer!: NotaryListOfficeDto;
  @ApiProperty({ type: NotaryListOfficeDto })
  rightsHolder!: NotaryListOfficeDto;
  @ApiProperty({ enum: LeadPlatform }) platform!: LeadPlatform;
  @ApiProperty() shopName!: string;
  @ApiProperty({ type: String, nullable: true }) shopExternalId!: string | null;
}

class NotaryOpeningSummaryDto {
  @ApiProperty({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })
  photoCount!: number;
  @ApiProperty({ type: String, nullable: true }) senderName!: string | null;
  @ApiProperty({ type: String, nullable: true }) senderPhone!: string | null;
  @ApiProperty({ type: String, nullable: true }) senderAddress!: string | null;
}

class NotaryCertificateSummaryDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() certificateNo!: string;
  @ApiProperty({ format: 'date' }) certificateDate!: string;
  @ApiProperty({ format: 'date-time' }) issuedAt!: string;
  @ApiProperty() needDisclose!: boolean;
}

class NotaryDisplayFeeDto {
  @ApiProperty({ enum: ['UNRECORDED', 'PENDING', 'KNOWN'] }) state!:
    'UNRECORDED' | 'PENDING' | 'KNOWN';
  @ApiProperty({
    type: String,
    nullable: true,
    pattern: '^(0|[1-9]\\d*)\\.\\d{2}$',
  })
  amount!: string | null;
}

class NotaryDisplayFeesDto {
  @ApiProperty({ type: NotaryDisplayFeeDto }) notary!: NotaryDisplayFeeDto;
  @ApiProperty({ type: NotaryDisplayFeeDto })
  investigation!: NotaryDisplayFeeDto;
  @ApiProperty({ type: NotaryDisplayFeeDto }) sample!: NotaryDisplayFeeDto;
}

class NotaryLinkedCaseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() businessNo!: string;
  @ApiProperty({ enum: CaseStage }) stage!: CaseStage;
}

class NotaryDisplayCapabilitiesDto {
  @ApiProperty() recordEvidence!: boolean;
  @ApiProperty() recordOpening!: boolean;
  @ApiProperty() reviewOpening!: boolean;
  @ApiProperty() decideIssuance!: boolean;
  @ApiProperty() archiveReturn!: boolean;
}

class NotaryListItemDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() businessNo!: string;
  @ApiProperty({ enum: NOTARY_LIST_STAGES }) stage!: NotaryListStage;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ type: NotaryListLeadDto }) sourceLead!: NotaryListLeadDto;
  @ApiProperty({ type: NotaryListOfficeDto })
  notaryOffice!: NotaryListOfficeDto;
  @ApiProperty({ type: NotarySourceSummaryDto })
  sourceSummary!: NotarySourceSummaryDto;
  @ApiProperty({ format: 'date' }) transferredAt!: string;
  @ApiProperty({ type: String, format: 'date', nullable: true }) evidenceAt!:
    string | null;
  @ApiProperty({ type: NotaryOpeningSummaryDto, nullable: true })
  openingSummary!: NotaryOpeningSummaryDto | null;
  @ApiProperty({ type: NotaryCertificateSummaryDto, nullable: true })
  certificateSummary!: NotaryCertificateSummaryDto | null;
  @ApiProperty({ type: NotaryDisplayFeesDto }) fees!: NotaryDisplayFeesDto;
  @ApiProperty({ type: NotaryLinkedCaseDto, nullable: true })
  linkedCase!: NotaryLinkedCaseDto | null;
  @ApiProperty({ type: NotaryDisplayCapabilitiesDto })
  capabilities!: NotaryDisplayCapabilitiesDto;
}

export class NotaryListCountsDto {
  @ApiProperty({ minimum: 0 }) PENDING_EVIDENCE!: number;
  @ApiProperty({ minimum: 0 }) WAITING_UNBOX!: number;
  @ApiProperty({ minimum: 0 }) UNBOX_REVIEW!: number;
  @ApiProperty({ minimum: 0 }) ISSUANCE_DECISION!: number;
  @ApiProperty({ minimum: 0 }) WAITING_CERTIFICATE!: number;
  @ApiProperty({ minimum: 0 }) WAITING_RETURN!: number;
  @ApiProperty({ minimum: 0 }) ARCHIVED!: number;
}

export class NotaryListResponseDto {
  @ApiProperty({ type: [NotaryListItemDto] }) items!: NotaryListItemDto[];
  @ApiProperty({ minimum: 0 }) total!: number;
  @ApiProperty({ minimum: 1 }) page!: number;
  @ApiProperty({ minimum: 1, maximum: 100 }) pageSize!: number;
  @ApiProperty({ type: NotaryListCountsDto }) counts!: NotaryListCountsDto;
}

export class NotaryListQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  customerId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  rightsHolderId?: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  shopName?: string;

  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  pageSize = 20;

  @ApiPropertyOptional({ enum: NOTARY_LIST_STAGES })
  @IsIn(NOTARY_LIST_STAGES)
  @IsOptional()
  stage?: NotaryListStage;
}
