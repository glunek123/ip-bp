import {
  Controller,
  Body,
  Get,
  Param,
  Post,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ActorContext } from '../../access-control/actor-context';
import { CurrentActor } from '../../access-control/actor-context.decorator';
import { ActorContextGuard } from '../../access-control/actor-context.guard';
import { CsrfGuard } from '../../auth/csrf.guard';
import {
  CaseHandlingGroupCandidateQueryDto,
  CaseHandlingGroupCandidatesDto,
  CaseHandlingGroupCapabilityDto,
  CaseHandlingGroupDetailDto,
  CaseHandlingGroupListDto,
  CaseHandlingGroupPageQueryDto,
  CreateCaseHandlingGroupDto,
  DissolveCaseHandlingGroupDto,
  CaseHandlingGroupResultDto,
} from './case-handling-group.dto';
import { CaseHandlingGroupRead } from './case-handling-group.read';
import { CaseHandlingGroupService } from './case-handling-group.service';

@ApiTags('case-handling-groups')
@ApiBearerAuth()
@Controller('case-handling-groups')
@UseGuards(ActorContextGuard, CsrfGuard)
export class CaseHandlingGroupController {
  constructor(
    private readonly groups: CaseHandlingGroupRead,
    private readonly commands: CaseHandlingGroupService,
  ) {}

  @Post()
  @ApiCreatedResponse({ type: CaseHandlingGroupResultDto })
  create(
    @CurrentActor() actor: ActorContext,
    @Body() input: CreateCaseHandlingGroupDto,
  ): Promise<CaseHandlingGroupResultDto> {
    return this.commands.create(actor, input);
  }

  @Post(':id/dissolve')
  @ApiCreatedResponse({ type: CaseHandlingGroupResultDto })
  dissolve(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: DissolveCaseHandlingGroupDto,
  ): Promise<CaseHandlingGroupResultDto> {
    return this.commands.dissolve(actor, id, input);
  }

  @Get('capability')
  @ApiOkResponse({ type: CaseHandlingGroupCapabilityDto })
  capability(
    @CurrentActor() actor: ActorContext,
  ): Promise<CaseHandlingGroupCapabilityDto> {
    return this.groups.capability(actor);
  }

  @Get('candidates')
  @ApiOkResponse({ type: CaseHandlingGroupCandidatesDto })
  candidates(
    @CurrentActor() actor: ActorContext,
    @Query() query: CaseHandlingGroupCandidateQueryDto,
  ): Promise<CaseHandlingGroupCandidatesDto> {
    return this.groups.candidates(actor, query);
  }

  @Get()
  @ApiOkResponse({ type: CaseHandlingGroupListDto })
  list(
    @CurrentActor() actor: ActorContext,
    @Query() query: CaseHandlingGroupPageQueryDto,
  ): Promise<CaseHandlingGroupListDto> {
    return this.groups.list(actor, query);
  }

  @Get(':id')
  @ApiOkResponse({ type: CaseHandlingGroupDetailDto })
  detail(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<CaseHandlingGroupDetailDto> {
    return this.groups.detail(actor, id);
  }
}
