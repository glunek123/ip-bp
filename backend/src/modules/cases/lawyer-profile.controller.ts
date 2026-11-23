import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ActorContext } from '../../access-control/actor-context';
import { CurrentActor } from '../../access-control/actor-context.decorator';
import { ActorContextGuard } from '../../access-control/actor-context.guard';
import { CsrfGuard } from '../../auth/csrf.guard';
import {
  CreateLawyerProfileDto,
  LawyerProfilePageDto,
  OpenLawyerAccountForProfileDto,
  SetLawyerProfileStatusDto,
  UpdateLawyerProfileDto,
} from './lawyer-profile.dto';
import { LawyerProfileService } from './lawyer-profile.service';

@ApiTags('lawyer-profiles')
@ApiBearerAuth()
@Controller('lawyer-profiles')
@UseGuards(ActorContextGuard, CsrfGuard)
export class LawyerProfileController {
  constructor(private readonly profiles: LawyerProfileService) {}

  @Get()
  list(
    @CurrentActor() actor: ActorContext,
    @Query() query: LawyerProfilePageDto,
  ) {
    return this.profiles.list(actor, query);
  }

  @Get(':id')
  get(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.profiles.get(actor, id);
  }

  @Post()
  create(
    @CurrentActor() actor: ActorContext,
    @Body() body: CreateLawyerProfileDto,
  ) {
    return this.profiles.create(actor, body);
  }

  @Patch(':id')
  update(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: UpdateLawyerProfileDto,
  ) {
    return this.profiles.update(actor, id, body);
  }

  @Patch(':id/status')
  status(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: SetLawyerProfileStatusDto,
  ) {
    return this.profiles.setStatus(
      actor,
      id,
      body.active,
      body.expectedVersion,
    );
  }

  @Post(':id/account')
  openAccount(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: OpenLawyerAccountForProfileDto,
  ) {
    return this.profiles.openAccount(actor, id, body);
  }
}
