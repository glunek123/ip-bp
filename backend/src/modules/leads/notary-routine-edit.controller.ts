import {
  Body,
  Controller,
  Param,
  ParseUUIDPipe,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentActor } from '../../access-control/actor-context.decorator';
import { ActorContextGuard } from '../../access-control/actor-context.guard';
import { ActorContext } from '../../access-control/actor-context';
import { CsrfGuard } from '../../auth/csrf.guard';
import { RoutineBusinessEditDto } from '../../common/routine-business-edit.dto';
import { NotaryRoutineEditService } from './notary-routine-edit.service';

@ApiTags('notary-matters')
@ApiBearerAuth()
@Controller('notary-matters')
@UseGuards(ActorContextGuard, CsrfGuard)
export class NotaryRoutineEditController {
  constructor(private readonly routine: NotaryRoutineEditService) {}

  @Patch(':id/routine-profile')
  update(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: RoutineBusinessEditDto,
  ) {
    return this.routine.update(actor, id, input);
  }
}
