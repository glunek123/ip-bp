import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

export const NOTARY_LIST_STAGES = [
  'PENDING_EVIDENCE',
  'WAITING_UNBOX',
  'UNBOX_REVIEW',
] as const;
export type NotaryListStage = (typeof NOTARY_LIST_STAGES)[number];

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
