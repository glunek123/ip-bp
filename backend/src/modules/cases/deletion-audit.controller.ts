import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ActorContext } from '../../access-control/actor-context';
import { CurrentActor } from '../../access-control/actor-context.decorator';
import { ActorContextGuard } from '../../access-control/actor-context.guard';
import { CsrfGuard } from '../../auth/csrf.guard';
import {
  DeletionAuditEntityType,
  DeletionAuditService,
} from './deletion-audit.service';

const entityTypes: DeletionAuditEntityType[] = [
  'CASE',
  'LEAD',
  'NOTARY_MATTER',
  'CUSTOMER',
];

@ApiTags('deletion-audit')
@ApiBearerAuth()
@Controller('deletion-audit-logs')
@UseGuards(ActorContextGuard, CsrfGuard)
export class DeletionAuditController {
  constructor(private readonly audit: DeletionAuditService) {}

  @Get()
  list(
    @CurrentActor() actor: ActorContext,
    @Query('entityType') entityType?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const type = entityTypes.find((item) => item === entityType);
    return this.audit.list(actor, {
      entityType: type,
      page: page && Number.isFinite(Number(page)) ? Number(page) : 1,
      pageSize:
        pageSize && Number.isFinite(Number(pageSize))
          ? Number(pageSize)
          : 20,
    });
  }
}
