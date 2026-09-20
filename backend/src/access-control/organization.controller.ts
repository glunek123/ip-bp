import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CsrfGuard } from '../auth/csrf.guard';
import { ActorContext } from './actor-context';
import { CurrentActor } from './actor-context.decorator';
import { ActorContextGuard } from './actor-context.guard';
import { OrganizationService } from './organization.service';
import {
  AssignRoleDto,
  CreateTeamDto,
  CreateOrganizationUserDto,
  ResetUserPasswordDto,
  SetRoleAssignmentStatusDto,
  SetTeamStatusDto,
  SetUserStatusDto,
  UpdateMembershipDto,
} from './organization.dto';
import {
  CreateOrganizationUserResponseDto,
  OrganizationManagementContextResponseDto,
  OrganizationMembershipResponseDto,
  OrganizationPasswordResetResponseDto,
  OrganizationRoleAssignmentResponseDto,
  OrganizationTeamResponseDto,
  OrganizationUserStatusResponseDto,
} from './organization-response.dto';

@ApiTags('organization')
@ApiBearerAuth()
@Controller('organization')
@UseGuards(ActorContextGuard, CsrfGuard)
export class OrganizationController {
  constructor(private readonly organization: OrganizationService) {}

  @Get('management-context')
  @ApiOkResponse({ type: OrganizationManagementContextResponseDto })
  getManagementContext(@CurrentActor() actor: ActorContext) {
    return this.organization.getManagementContext(actor);
  }

  @Post('users')
  @ApiCreatedResponse({ type: CreateOrganizationUserResponseDto })
  createUser(
    @CurrentActor() actor: ActorContext,
    @Body() input: CreateOrganizationUserDto,
  ) {
    return this.execute(actor, 'user.create', () =>
      this.organization.createUser(actor, {
        ...input,
        teamId: input.teamId ?? null,
      }),
    );
  }

  @Patch('users/:userId/status')
  @ApiOkResponse({ type: OrganizationUserStatusResponseDto })
  setUserStatus(
    @CurrentActor() actor: ActorContext,
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Body() input: SetUserStatusDto,
  ) {
    return this.execute(actor, 'user.status', () =>
      this.organization.setUserStatus(actor, userId, input),
    );
  }

  @Post('users/:userId/password-reset')
  @HttpCode(200)
  @ApiOkResponse({ type: OrganizationPasswordResetResponseDto })
  resetUserPassword(
    @CurrentActor() actor: ActorContext,
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Body() input: ResetUserPasswordDto,
  ) {
    return this.execute(actor, 'user.password-reset', () =>
      this.organization.resetUserPassword(actor, userId, input),
    );
  }

  @Patch('users/:userId/membership')
  @ApiOkResponse({ type: OrganizationMembershipResponseDto })
  updateMembership(
    @CurrentActor() actor: ActorContext,
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Body() input: UpdateMembershipDto,
  ) {
    return this.execute(actor, 'membership.update', () =>
      this.organization.updateMembership(actor, userId, input),
    );
  }

  @Post('users/:userId/role-assignments')
  @ApiCreatedResponse({ type: OrganizationRoleAssignmentResponseDto })
  assignRole(
    @CurrentActor() actor: ActorContext,
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Body() input: AssignRoleDto,
  ) {
    return this.execute(actor, 'role.assign', () =>
      this.organization.assignRole(actor, {
        targetUserId: userId,
        roleTemplateId: input.roleTemplateId,
        teamId: input.teamId ?? null,
      }),
    );
  }

  @Patch('users/:userId/role-assignments/:assignmentId')
  @ApiOkResponse({ type: OrganizationRoleAssignmentResponseDto })
  setRoleAssignmentStatus(
    @CurrentActor() actor: ActorContext,
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Param('assignmentId', new ParseUUIDPipe()) assignmentId: string,
    @Body() input: SetRoleAssignmentStatusDto,
  ) {
    return this.execute(actor, 'role.status', () =>
      this.organization.setRoleAssignmentStatus(
        actor,
        userId,
        assignmentId,
        input,
      ),
    );
  }

  @Post('teams')
  @ApiCreatedResponse({ type: OrganizationTeamResponseDto })
  createTeam(
    @CurrentActor() actor: ActorContext,
    @Body() input: CreateTeamDto,
  ) {
    return this.execute(actor, 'team.create', () =>
      this.organization.createTeam(actor, input),
    );
  }

  @Patch('teams/:teamId/status')
  @ApiOkResponse({ type: OrganizationTeamResponseDto })
  setTeamStatus(
    @CurrentActor() actor: ActorContext,
    @Param('teamId', new ParseUUIDPipe()) teamId: string,
    @Body() input: SetTeamStatusDto,
  ) {
    return this.execute(actor, 'team.status', () =>
      this.organization.setTeamStatus(actor, teamId, input.status),
    );
  }

  private async execute<T>(
    actor: ActorContext,
    operation:
      | 'user.create'
      | 'user.status'
      | 'user.password-reset'
      | 'membership.update'
      | 'role.assign'
      | 'role.status'
      | 'team.create'
      | 'team.status',
    action: () => Promise<T>,
  ): Promise<T> {
    try {
      return await action();
    } catch (error) {
      if (error instanceof ForbiddenException) {
        await this.organization.recordDeniedAttempt(actor, operation);
      }
      throw error;
    }
  }
}
