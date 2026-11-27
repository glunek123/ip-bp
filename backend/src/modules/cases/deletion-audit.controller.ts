import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  Max,
  Min,
} from 'class-validator';
import { ActorContext } from '../../access-control/actor-context';
import { CurrentActor } from '../../access-control/actor-context.decorator';
import { ActorContextGuard } from '../../access-control/actor-context.guard';
import { CsrfGuard } from '../../auth/csrf.guard';
import {
  DeletionAuditEntityType,
  DeletionAuditService,
} from './deletion-audit.service';

export const deletionAuditEntityTypes: DeletionAuditEntityType[] = [
  'CASE',
  'LEAD',
  'NOTARY_MATTER',
  'CUSTOMER',
];

export class DeletionAuditQueryDto {
  @ApiPropertyOptional({ enum: deletionAuditEntityTypes })
  @IsOptional()
  @IsEnum(deletionAuditEntityTypes)
  entityType?: DeletionAuditEntityType;

  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;

  @ApiPropertyOptional({ description: '删除时间起点（含）' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ description: '删除时间终点（含）' })
  @IsOptional()
  @IsDateString()
  to?: string;
}

@ApiTags('deletion-audit')
@ApiBearerAuth()
@Controller('deletion-audit-logs')
@UseGuards(ActorContextGuard, CsrfGuard)
export class DeletionAuditController {
  constructor(private readonly audit: DeletionAuditService) {}

  @Get()
  list(@CurrentActor() actor: ActorContext, @Query() query: DeletionAuditQueryDto) {
    return this.audit.list(actor, {
      entityType: query.entityType,
      page: query.page ?? 1,
      pageSize: query.pageSize ?? 20,
      from: query.from,
      to: query.to,
    });
  }
}
