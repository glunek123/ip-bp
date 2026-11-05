import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { ActorContext } from '../../access-control/actor-context';
import { CurrentActor } from '../../access-control/actor-context.decorator';
import { ActorContextGuard } from '../../access-control/actor-context.guard';
import { CsrfGuard } from '../../auth/csrf.guard';
import {
  AssignCaseLawyerDto,
  AssignCaseLawyerResponseDto,
} from './case-lawyer-assignment.dto';
import { CaseLawyerAssignmentService } from './case-lawyer-assignment.service';

@ApiTags('cases')
@ApiBearerAuth()
@Controller('cases')
@UseGuards(ActorContextGuard, CsrfGuard)
export class CaseLawyerAssignmentController {
  constructor(private readonly assignment: CaseLawyerAssignmentService) {}

  @Get(':id/lawyer-assignment/capability')
  @ApiOkResponse({
    description: '仅有本案读取和独立律师分配权限的内部账号可读取',
  })
  capability(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.assignment.capability(actor, id);
  }

  @Post(':id/lawyer-assignment')
  @ApiOkResponse({ type: AssignCaseLawyerResponseDto })
  assign(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: AssignCaseLawyerDto,
  ) {
    return this.assignment.assign(actor, id, body);
  }
}
