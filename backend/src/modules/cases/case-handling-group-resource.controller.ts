import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { ActorContext } from '../../access-control/actor-context';
import { CurrentActor } from '../../access-control/actor-context.decorator';
import { ActorContextGuard } from '../../access-control/actor-context.guard';
import { CsrfGuard } from '../../auth/csrf.guard';
import {
  CaseHandlingGroupFeesDto,
  CaseHandlingGroupMaterialsDto,
  CaseHandlingGroupResourcePageQueryDto,
} from './case-handling-group-resource.dto';
import { CaseHandlingGroupResourceRead } from './case-handling-group-resource.read';

@ApiTags('case-handling-groups')
@ApiBearerAuth()
@Controller('case-handling-groups')
@UseGuards(ActorContextGuard, CsrfGuard)
export class CaseHandlingGroupResourceController {
  constructor(private readonly resources: CaseHandlingGroupResourceRead) {}

  @Get(':id/materials')
  @ApiOkResponse({ type: CaseHandlingGroupMaterialsDto })
  materials(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: CaseHandlingGroupResourcePageQueryDto,
  ): Promise<CaseHandlingGroupMaterialsDto> {
    return this.resources.materialsPage(actor, id, query);
  }

  @Get(':id/fees')
  @ApiOkResponse({ type: CaseHandlingGroupFeesDto })
  fees(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: CaseHandlingGroupResourcePageQueryDto,
  ): Promise<CaseHandlingGroupFeesDto> {
    return this.resources.feesPage(actor, id, query);
  }
}
