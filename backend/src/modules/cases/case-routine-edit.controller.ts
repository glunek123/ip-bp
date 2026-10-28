import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ActorContext } from '../../access-control/actor-context';
import { CurrentActor } from '../../access-control/actor-context.decorator';
import { ActorContextGuard } from '../../access-control/actor-context.guard';
import { CsrfGuard } from '../../auth/csrf.guard';
import { RoutineBusinessEditWithRemarkDto } from '../../common/routine-business-edit.dto';
import { CaseRoutineEditService } from './case-routine-edit.service';

@ApiTags('cases')
@ApiBearerAuth()
@Controller('cases')
@UseGuards(ActorContextGuard, CsrfGuard)
export class CaseRoutineEditController {
  constructor(private readonly routine: CaseRoutineEditService) {}

  @Get(':id/routine-profile')
  get(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.routine.get(actor, id);
  }

  @Patch(':id/routine-profile')
  update(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: RoutineBusinessEditWithRemarkDto,
  ) {
    return this.routine.update(actor, id, input);
  }
}
