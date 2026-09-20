import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CsrfGuard } from '../auth/csrf.guard';
import { ActorContext } from './actor-context';
import { CurrentActor } from './actor-context.decorator';
import { ActorContextGuard } from './actor-context.guard';
import { OrganizationService } from './organization.service';
import { CreateOrganizationUserDto } from './organization.dto';

@ApiTags('organization')
@ApiBearerAuth()
@Controller('organization')
@UseGuards(ActorContextGuard, CsrfGuard)
export class OrganizationController {
  constructor(private readonly organization: OrganizationService) {}

  @Get('management-context')
  getManagementContext(@CurrentActor() actor: ActorContext) {
    return this.organization.getManagementContext(actor);
  }

  @Post('users')
  createUser(
    @CurrentActor() actor: ActorContext,
    @Body() input: CreateOrganizationUserDto,
  ) {
    return this.organization.createUser(actor, {
      ...input,
      teamId: input.teamId ?? null,
    });
  }
}
