import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CsrfGuard } from '../auth/csrf.guard';
import { ActorContext } from './actor-context';
import { CurrentActor } from './actor-context.decorator';
import { ActorContextGuard } from './actor-context.guard';
import { OrganizationService } from './organization.service';
import {
  AssignRoleDto,
  CreateOrganizationUserDto,
  ResetUserPasswordDto,
  SetRoleAssignmentStatusDto,
  SetUserStatusDto,
  UpdateMembershipDto,
} from './organization.dto';

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

  @Patch('users/:userId/status')
  setUserStatus(
    @CurrentActor() actor: ActorContext,
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Body() input: SetUserStatusDto,
  ) {
    return this.organization.setUserStatus(actor, userId, input);
  }

  @Post('users/:userId/password-reset')
  @HttpCode(200)
  resetUserPassword(
    @CurrentActor() actor: ActorContext,
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Body() input: ResetUserPasswordDto,
  ) {
    return this.organization.resetUserPassword(actor, userId, input);
  }

  @Patch('users/:userId/membership')
  updateMembership(
    @CurrentActor() actor: ActorContext,
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Body() input: UpdateMembershipDto,
  ) {
    return this.organization.updateMembership(actor, userId, input);
  }

  @Post('users/:userId/role-assignments')
  assignRole(
    @CurrentActor() actor: ActorContext,
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Body() input: AssignRoleDto,
  ) {
    return this.organization.assignRole(actor, {
      targetUserId: userId,
      roleTemplateId: input.roleTemplateId,
      teamId: input.teamId ?? null,
    });
  }

  @Patch('users/:userId/role-assignments/:assignmentId')
  setRoleAssignmentStatus(
    @CurrentActor() actor: ActorContext,
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Param('assignmentId', new ParseUUIDPipe()) assignmentId: string,
    @Body() input: SetRoleAssignmentStatusDto,
  ) {
    return this.organization.setRoleAssignmentStatus(
      actor,
      userId,
      assignmentId,
      input,
    );
  }
}
