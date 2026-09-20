import {
  Controller,
  ForbiddenException,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Body,
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
  OrganizationRoleResponseDto,
  RoleTemplateImpactResponseDto,
} from './organization-response.dto';
import {
  CopyRoleTemplateDto,
  UpdateRoleTemplateDto,
} from './role-template.dto';
import { RoleTemplateService } from './role-template.service';

@ApiTags('organization-role-templates')
@ApiBearerAuth()
@Controller('organization/role-templates')
@UseGuards(ActorContextGuard, CsrfGuard)
export class RoleTemplateController {
  constructor(
    private readonly roleTemplates: RoleTemplateService,
    private readonly organization: OrganizationService,
  ) {}

  @Post()
  @ApiCreatedResponse({ type: OrganizationRoleResponseDto })
  copy(
    @CurrentActor() actor: ActorContext,
    @Body() input: CopyRoleTemplateDto,
  ) {
    return this.execute(actor, 'role-template.copy', () =>
      this.roleTemplates.copy(actor, input),
    );
  }

  @Patch(':roleTemplateId')
  @ApiOkResponse({ type: OrganizationRoleResponseDto })
  update(
    @CurrentActor() actor: ActorContext,
    @Param('roleTemplateId', new ParseUUIDPipe()) roleTemplateId: string,
    @Body() input: UpdateRoleTemplateDto,
  ) {
    return this.execute(actor, 'role-template.update', () =>
      this.roleTemplates.update(actor, roleTemplateId, input),
    );
  }

  @Get(':roleTemplateId/impact')
  @ApiOkResponse({ type: RoleTemplateImpactResponseDto })
  getImpact(
    @CurrentActor() actor: ActorContext,
    @Param('roleTemplateId', new ParseUUIDPipe()) roleTemplateId: string,
  ) {
    return this.execute(actor, 'role-template.impact', () =>
      this.roleTemplates.getImpact(actor, roleTemplateId),
    );
  }

  private async execute<T>(
    actor: ActorContext,
    operation:
      'role-template.impact' | 'role-template.copy' | 'role-template.update',
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
