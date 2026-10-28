import {
  Body,
  Controller,
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
import { LeadRoutineEditService } from './lead-routine-edit.service';

@ApiTags('leads')
@ApiBearerAuth()
@Controller('leads')
@UseGuards(ActorContextGuard, CsrfGuard)
export class LeadRoutineEditController {
  constructor(private readonly routine: LeadRoutineEditService) {}

  @Patch(':id/routine-profile')
  update(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: RoutineBusinessEditWithRemarkDto,
  ) {
    return this.routine.update(actor, id, input);
  }
}
