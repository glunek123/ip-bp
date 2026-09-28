import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

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

class NotaryListItemDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() businessNo!: string;
  @ApiProperty({ enum: NOTARY_LIST_STAGES }) stage!: NotaryListStage;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ type: NotaryListLeadDto }) sourceLead!: NotaryListLeadDto;
  @ApiProperty({ type: NotaryListOfficeDto })
  notaryOffice!: NotaryListOfficeDto;
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
