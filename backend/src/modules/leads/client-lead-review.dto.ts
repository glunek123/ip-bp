import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, Max, Min } from 'class-validator';

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
  @ApiProperty({ enum: ['INFRINGEMENT'] })
  @IsIn(['INFRINGEMENT'])
  result!: 'INFRINGEMENT';

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}
